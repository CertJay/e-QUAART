import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { hasPermission, type Permission } from '../rbac/permissions.js';
import { resolveScope } from '../rbac/scope.js';
import { verifyAccessToken } from './tokens.js';

/** Authenticate the bearer token, confirm the session is live, and attach user + data scope. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let claims;
    try {
      claims = verifyAccessToken(header.slice(7));
    } catch {
      throw unauthorized('Session expired or invalid token');
    }
    const session = await prisma.userSession.findUnique({ where: { id: claims.sid }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== claims.sub) {
      throw unauthorized('Session has ended; please sign in again');
    }
    const u = session.user;
    if (!u.isActive) throw unauthorized('Account is deactivated');
    req.user = { id: u.id, email: u.email, role: u.role, fullName: u.fullName, sessionId: session.id };
    req.scope = await resolveScope(u.id, u.role);
    next();
  } catch (e) {
    next(e);
  }
}

export const requirePermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!perms.every((p) => hasPermission(req.user!.role, p))) return next(forbidden());
    next();
  };

export const requireAnyPermission =
  (...perms: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!perms.some((p) => hasPermission(req.user!.role, p))) return next(forbidden());
    next();
  };
