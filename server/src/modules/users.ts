import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { hashPassword, passwordProblems } from '../auth/password.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, staleRecord } from '../lib/errors.js';
import { idempotent } from '../lib/idempotency.js';
import { emailField, expectedUpdatedAtField, idSchema, positionField, searchField, userFullNameField } from '../domain/validation.js';
import { ah, idParam, paged, paginationSchema } from '../lib/http.js';
import { ROLE_LABELS } from '../rbac/permissions.js';

export const usersRouter = Router();
usersRouter.use(requirePermission('user:manage'));

const ROLES = Object.keys(ROLE_LABELS) as [Role, ...Role[]];
const scopeSchema = z.object({
  scopeType: z.enum(['DIVISION', 'DISTRICT', 'SCHOOL', 'SECTION', 'LEARNING_AREA']),
  divisionId: idSchema.nullable().optional(),
  districtId: idSchema.nullable().optional(),
  schoolId: idSchema.nullable().optional(),
  sectionId: idSchema.nullable().optional(),
  learningAreaId: idSchema.nullable().optional(),
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
  email: emailField,
  fullName: userFullNameField,
  position: positionField,
  role: z.enum(ROLES, { error: 'Select a valid role' }),
  isActive: z.boolean().optional(),
  scopes: z.array(scopeSchema).max(50, 'At most 50 assignments per account').default([]),
});

const publicUser = { id: true, email: true, fullName: true, position: true, role: true, isActive: true, lastLoginAt: true, mustChangePassword: true, lockedUntil: true, createdAt: true, updatedAt: true } as const;

async function assertEmailFree(email: string, exceptId?: number) {
  const other = await prisma.user.findUnique({ where: { email } });
  if (other && other.id !== exceptId) throw conflict('An account with this email already exists', { field: 'email' });
}

usersRouter.get('/', ah(async (req, res) => {
  const { page, perPage } = paginationSchema.parse(req.query);
  const q = z.object({ search: searchField, role: z.enum(ROLES).optional(), schoolId: z.coerce.number().int().optional(), isActive: z.enum(['true', 'false']).optional() }).parse(req.query);
  const where: Prisma.UserWhereInput = {
    role: q.role,
    isActive: q.isActive ? q.isActive === 'true' : undefined,
    scopes: q.schoolId ? { some: { schoolId: q.schoolId } } : undefined,
    OR: q.search ? [{ fullName: { contains: q.search } }, { email: { contains: q.search } }] : undefined,
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
usersRouter.post('/', idempotent(), ah(async (req, res) => {
  const b = userBody.parse(req.body);
  await assertEmailFree(b.email);
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
  // `scopes` must stay undefined when omitted: the create schema's `.default([])` would survive
  // `.partial()` and wipe every assignment of the account.
  const { expectedUpdatedAt, ...b } = userBody.partial().extend({
    scopes: z.array(scopeSchema).max(50, 'At most 50 assignments per account').optional(),
    expectedUpdatedAt: expectedUpdatedAtField,
  }).parse(req.body);
  if (b.email) await assertEmailFree(b.email, id);
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
    // Optimistic concurrency: refuse to overwrite an edit saved after this editor loaded the account.
    if (expectedUpdatedAt) {
      const { count } = await tx.user.updateMany({ where: { id, updatedAt: expectedUpdatedAt }, data });
      if (!count) throw staleRecord('account', (await tx.user.findUniqueOrThrow({ where: { id } })).updatedAt);
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
