import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError, badRequest } from './errors.js';

const KEY = /^[A-Za-z0-9_-]{8,100}$/;
const TTL_HOURS = 24;

const hashRequest = (req: Request) =>
  crypto.createHash('sha256').update(`${req.method} ${req.baseUrl}${req.path}\n${JSON.stringify(req.body ?? null)}`).digest('hex');

/**
 * Double-submission guard for create endpoints. When the client sends `Idempotency-Key`:
 *   - first request: runs normally and its response (status < 500) is remembered for 24 h;
 *   - same key, same body, while the first is still running: 409 REQUEST_IN_PROGRESS;
 *   - same key, same body, afterwards: the first response is replayed (`Idempotent-Replayed: true`);
 *   - same key, different body: 422 IDEMPOTENCY_KEY_REUSED.
 * Requests without the header are not affected. Keys are per user.
 */
export function idempotent() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.get('idempotency-key');
    if (!key) return next();
    try {
      if (!KEY.test(key)) throw badRequest('Idempotency-Key must be 8–100 letters, digits, "-" or "_"');
      const userId = req.user!.id;
      const requestHash = hashRequest(req);
      const now = new Date();
      await prisma.idempotencyKey.deleteMany({ where: { userId, expiresAt: { lt: now } } });
      let record;
      try {
        record = await prisma.idempotencyKey.create({
          data: { userId, key, method: req.method, path: `${req.baseUrl}${req.path}`, requestHash, state: 'IN_PROGRESS', expiresAt: new Date(now.getTime() + TTL_HOURS * 3600_000) },
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        const prior = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
        if (!prior) throw new AppError(409, 'REQUEST_IN_PROGRESS', 'This request is already being processed. Please wait.');
        if (prior.requestHash !== requestHash) {
          throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request');
        }
        if (prior.state !== 'DONE') throw new AppError(409, 'REQUEST_IN_PROGRESS', 'This request is already being processed. Please wait.');
        res.setHeader('Idempotent-Replayed', 'true');
        return res.status(prior.responseStatus ?? 200).json(prior.responseBody);
      }

      // Remember the response before it is sent, so an immediate repeat is replayed rather than
      // seeing the request as still in progress.
      const json = res.json.bind(res);
      res.json = (b: unknown) => {
        const status = res.statusCode;
        const saved = status < 500
          ? prisma.idempotencyKey.update({ where: { id: record.id }, data: { state: 'DONE', responseStatus: status, responseBody: (b ?? Prisma.JsonNull) as Prisma.InputJsonValue } })
          : prisma.idempotencyKey.delete({ where: { id: record.id } }); // server error: let the client retry
        saved.catch((err) => console.error('idempotency record update failed', err)).finally(() => json(b));
        return res;
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}
