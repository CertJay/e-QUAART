import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { hashPassword, passwordProblems } from '../auth/password.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { ah, idParam, paged, paginationSchema } from '../lib/http.js';
import { ROLE_LABELS } from '../rbac/permissions.js';

export const usersRouter = Router();
usersRouter.use(requirePermission('user:manage'));

const ROLES = Object.keys(ROLE_LABELS) as [Role, ...Role[]];
const scopeSchema = z.object({
  scopeType: z.enum(['DIVISION', 'DISTRICT', 'SCHOOL', 'SECTION', 'LEARNING_AREA']),
  divisionId: z.number().int().nullable().optional(),
  districtId: z.number().int().nullable().optional(),
  schoolId: z.number().int().nullable().optional(),
  sectionId: z.number().int().nullable().optional(),
  learningAreaId: z.number().int().nullable().optional(),
});

/** Scope rules per role — enforced so a misconfigured account cannot see more than intended. */
function validateScopes(role: Role, scopes: z.infer<typeof scopeSchema>[]) {
  const has = (t: string) => scopes.some((s) => s.scopeType === t);
  for (const s of scopes) {
    const ref = { DIVISION: s.divisionId, DISTRICT: s.districtId, SCHOOL: s.schoolId, SECTION: s.sectionId, LEARNING_AREA: s.learningAreaId }[s.scopeType];
    if (!ref) throw badRequest(`A ${s.scopeType.toLowerCase().replace('_', ' ')} scope needs a reference`);
  }
  if (['TEACHER', 'MASTER_TEACHER', 'ASSESSMENT_COORDINATOR', 'PRINCIPAL'].includes(role) && !has('SCHOOL')) throw badRequest('School-based roles need a school assignment');
  if (role === 'PSDS' && !has('DISTRICT')) throw badRequest('District supervisors need a district assignment');
  if (role === 'EPS' && !has('LEARNING_AREA')) throw badRequest('Education Program Supervisors need at least one learning area');
}

const userBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(3).max(120),
  position: z.string().trim().max(120).nullable().optional(),
  role: z.enum(ROLES),
  isActive: z.boolean().optional(),
  scopes: z.array(scopeSchema).default([]),
});

const publicUser = { id: true, email: true, fullName: true, position: true, role: true, isActive: true, lastLoginAt: true, mustChangePassword: true, lockedUntil: true, createdAt: true } as const;

usersRouter.get('/', ah(async (req, res) => {
  const { page, perPage } = paginationSchema.parse(req.query);
  const q = z.object({ search: z.string().optional(), role: z.enum(ROLES).optional(), schoolId: z.coerce.number().int().optional(), isActive: z.enum(['true', 'false']).optional() }).parse(req.query);
  const where: Prisma.UserWhereInput = {
    role: q.role,
    isActive: q.isActive ? q.isActive === 'true' : undefined,
    scopes: q.schoolId ? { some: { schoolId: q.schoolId } } : undefined,
    OR: q.search ? [{ fullName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] : undefined,
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: { ...publicUser, scopes: { include: { school: { select: { name: true } }, district: { select: { name: true } }, learningArea: { select: { name: true } }, division: { select: { name: true } } } } },
      orderBy: { fullName: 'asc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);
  res.json(paged(rows, total, page, perPage));
}));

/** Creates the account with a one-time temporary password the user must change at first sign-in. */
usersRouter.post('/', ah(async (req, res) => {
  const b = userBody.parse(req.body);
  if (b.role === 'SYSTEM_ADMIN' && req.user!.role !== 'SYSTEM_ADMIN') throw forbidden('Only system administrators can create system administrator accounts');
  validateScopes(b.role, b.scopes);
  const temporaryPassword = `Eq-${crypto.randomBytes(6).toString('base64url')}9a`;
  const { scopes, ...data } = b;
  const u = await prisma.user.create({
    data: { ...data, passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, scopes: { create: scopes } },
    select: publicUser,
  });
  await audit(req, 'CREATE', 'User', u.id, null, { ...u, scopes });
  res.status(201).json({ ...u, temporaryPassword });
}));

usersRouter.put('/:id', ah(async (req, res) => {
  const id = idParam(req);
  const before = await prisma.user.findUniqueOrThrow({ where: { id }, select: { ...publicUser, scopes: true } });
  const b = userBody.partial().parse(req.body);
  const role = b.role ?? before.role;
  if ((role === 'SYSTEM_ADMIN' || before.role === 'SYSTEM_ADMIN') && req.user!.role !== 'SYSTEM_ADMIN') throw forbidden();
  if (id === req.user!.id && (b.isActive === false || (b.role && b.role !== before.role))) throw badRequest('You cannot deactivate yourself or change your own role');
  if (b.scopes || b.role) validateScopes(role, b.scopes ?? before.scopes);
  const { scopes, ...data } = b;
  const u = await prisma.$transaction(async (tx) => {
    if (scopes) {
      await tx.userScope.deleteMany({ where: { userId: id } });
      await tx.userScope.createMany({ data: scopes.map((s) => ({ ...s, userId: id })) });
    }
    if (b.isActive === false) await tx.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    return tx.user.update({ where: { id }, data, select: { ...publicUser, scopes: true } });
  });
  await audit(req, 'UPDATE', 'User', id, before, u);
  res.json(u);
}));

usersRouter.post('/:id/reset-password', ah(async (req, res) => {
  const id = idParam(req);
  const target = await prisma.user.findUniqueOrThrow({ where: { id } });
  if (target.role === 'SYSTEM_ADMIN' && req.user!.role !== 'SYSTEM_ADMIN') throw forbidden();
  const temporaryPassword = `Eq-${crypto.randomBytes(6).toString('base64url')}9a`;
  if (passwordProblems(temporaryPassword).length) throw new Error('Generated password failed policy');
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } }),
    prisma.userSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(req, 'UPDATE', 'User', id, null, { passwordReset: true });
  res.json({ temporaryPassword });
}));
