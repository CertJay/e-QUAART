import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { badRequest } from '../lib/errors.js';
import { ah, idParam, nullableDate, paged, paginationSchema } from '../lib/http.js';
import { SETTING_DEFAULTS, getSettings, type SettingKey } from '../domain/settings.js';

export const governanceRouter = Router();

// ───────────── System settings ─────────────
governanceRouter.get('/settings', ah(async (_req, res) => {
  const values = await getSettings();
  res.json(Object.entries(SETTING_DEFAULTS).map(([key, d]) => ({ key, value: values[key as SettingKey], default: d.value, description: d.description })));
}));
governanceRouter.put('/settings/:key', requirePermission('settings:write'), ah(async (req, res) => {
  const key = req.params.key as SettingKey;
  if (!(key in SETTING_DEFAULTS)) throw badRequest('Unknown setting');
  const { value } = z.object({ value: z.number().min(0).max(100) }).parse(req.body);
  const before = await prisma.systemSetting.findUnique({ where: { key } });
  const s = await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value, description: SETTING_DEFAULTS[key].description, updatedById: req.user!.id },
    update: { value, updatedById: req.user!.id },
  });
  await audit(req, 'UPDATE', 'SystemSetting', key, before, s);
  res.json(s);
}));

// ───────────── Audit trail ─────────────
governanceRouter.get('/audit-logs', requirePermission('audit:read'), ah(async (req, res) => {
  const { page, perPage } = paginationSchema.parse(req.query);
  const q = z.object({
    entity: z.string().optional(),
    entityId: z.string().optional(),
    action: z.string().optional(),
    userId: z.coerce.number().int().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    search: z.string().optional(),
  }).parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    entity: q.entity,
    entityId: q.entityId,
    action: q.action,
    userId: q.userId,
    at: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    userEmail: q.search ? { contains: q.search } : undefined,
  };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
  ]);
  res.json(paged(rows, total, page, perPage));
}));

// ───────────── Retention policies ─────────────
governanceRouter.get('/retention', requirePermission('governance:manage'), ah(async (_req, res) => {
  res.json(await prisma.retentionPolicy.findMany({ orderBy: { entity: 'asc' } }));
}));
governanceRouter.put('/retention/:id', requirePermission('governance:manage'), ah(async (req, res) => {
  const id = idParam(req);
  const b = z.object({ retentionMonths: z.number().int().min(1).max(1200), disposalAction: z.enum(['ANONYMIZE', 'DELETE', 'ARCHIVE']), legalBasis: z.string().trim().min(3) }).partial().parse(req.body);
  const before = await prisma.retentionPolicy.findUniqueOrThrow({ where: { id } });
  const r = await prisma.retentionPolicy.update({ where: { id }, data: b });
  await audit(req, 'UPDATE', 'RetentionPolicy', id, before, r);
  res.json(r);
}));

// ───────────── Breach register (RA 10173 / NPC Circular 16-03) ─────────────
const breachBody = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3),
  discoveredAt: z.coerce.date(),
  affectedRecords: z.number().int().min(0).nullable().optional(),
  status: z.enum(['OPEN', 'CONTAINED', 'NOTIFIED', 'CLOSED']).optional(),
  npcNotifiedAt: nullableDate,
  actionsTaken: z.string().trim().nullable().optional(),
});
governanceRouter.get('/breaches', requirePermission('governance:manage'), ah(async (_req, res) => {
  const rows = await prisma.breachIncident.findMany({ orderBy: { discoveredAt: 'desc' } });
  // NPC expects notification within 72 hours of knowledge of a qualifying breach.
  res.json(rows.map((b) => ({ ...b, notificationDeadline: new Date(b.discoveredAt.getTime() + 72 * 3600 * 1000) })));
}));
governanceRouter.post('/breaches', requirePermission('governance:manage'), ah(async (req, res) => {
  const b = await prisma.breachIncident.create({ data: { ...breachBody.parse(req.body), createdById: req.user!.id } });
  await audit(req, 'CREATE', 'BreachIncident', b.id, null, b);
  res.status(201).json(b);
}));
governanceRouter.put('/breaches/:id', requirePermission('governance:manage'), ah(async (req, res) => {
  const id = idParam(req);
  const before = await prisma.breachIncident.findUniqueOrThrow({ where: { id } });
  const b = await prisma.breachIncident.update({ where: { id }, data: breachBody.partial().parse(req.body) });
  await audit(req, 'UPDATE', 'BreachIncident', id, before, b);
  res.json(b);
}));
