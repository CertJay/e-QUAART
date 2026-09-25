import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

/** Wrap an async handler so rejections reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export const idParam = (req: Request, name = 'id'): number => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('Invalid id'), { status: 400 });
  return n;
};

export const optionalInt = z.preprocess((v) => (v === '' || v === undefined || v === null ? undefined : Number(v)), z.number().int().positive().optional());
export const optionalDate = z.preprocess((v) => (v === '' || v === undefined || v === null ? undefined : new Date(String(v))), z.date().optional());
export const nullableDate = z.preprocess((v) => (v === '' || v === null ? null : v === undefined ? undefined : new Date(String(v))), z.date().nullable().optional());

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(25),
});

export function paged<T>(data: T[], total: number, page: number, perPage: number) {
  return { data, meta: { page, perPage, total, pages: Math.max(1, Math.ceil(total / perPage)) } };
}
