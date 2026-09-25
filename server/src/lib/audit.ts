import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../db.js';

export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE' | 'SUBMIT' | 'VERIFY' | 'RETURN' | 'REOPEN'
  | 'IMPORT' | 'EXPORT' | 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT' | 'PASSWORD_CHANGE' | 'ENROL' | 'VIEW_LEARNER';

const toJson = (v: unknown) => (v === undefined || v === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

/** Append an entry to the audit trail (who, what, when, before → after). */
export async function audit(
  req: Request | null,
  action: AuditAction,
  entity: string,
  entityId: string | number | null,
  before?: unknown,
  after?: unknown,
  tx: Tx = prisma,
) {
  await tx.auditLog.create({
    data: {
      userId: req?.user?.id ?? null,
      userEmail: req?.user?.email ?? null,
      action,
      entity,
      entityId: entityId === null ? null : String(entityId),
      beforeJson: toJson(before),
      afterJson: toJson(after),
      ip: req?.ip ?? null,
      userAgent: req?.get?.('user-agent')?.slice(0, 250) ?? null,
    },
  });
}
