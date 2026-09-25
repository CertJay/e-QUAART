import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { ah, idParam } from '../lib/http.js';
import { assertAcademic, schoolInScope, sectionInScope, sectionWhere } from '../rbac/scope.js';

export const sectionsRouter = Router();

sectionsRouter.get('/', requirePermission('analytics:read'), ah(async (req, res) => {
  const s = req.scope!;
  assertAcademic(s);
  const q = z.object({
    schoolYearId: z.coerce.number().int().optional(),
    schoolId: z.coerce.number().int().optional(),
    gradeLevelId: z.coerce.number().int().optional(),
    mine: z.enum(['true', 'false']).optional(),
  }).parse(req.query);
  const sections = await prisma.section.findMany({
    where: {
      AND: [
        sectionWhere(s),
        { schoolYearId: q.schoolYearId, schoolId: q.schoolId, gradeLevelId: q.gradeLevelId },
        q.mine === 'true' ? { OR: [{ adviserId: req.user!.id }, { teachers: { some: { userId: req.user!.id } } }] } : {},
      ],
    },
    include: {
      school: { select: { id: true, name: true } },
      gradeLevel: true,
      schoolYear: { select: { id: true, label: true } },
      adviser: { select: { id: true, fullName: true } },
      teachers: { include: { user: { select: { id: true, fullName: true } }, learningArea: { select: { id: true, code: true } } } },
      _count: { select: { enrolments: { where: { isCurrent: true } }, assessments: { where: { deletedAt: null } } } },
    },
    orderBy: [{ school: { name: 'asc' } }, { gradeLevel: { sortOrder: 'asc' } }, { name: 'asc' }],
  });
  res.json(sections.map(({ _count, ...sec }) => ({ ...sec, learnerCount: _count.enrolments, assessmentCount: _count.assessments })));
}));

const sectionBody = z.object({
  name: z.string().trim().min(1).max(60),
  schoolId: z.number().int(),
  gradeLevelId: z.number().int(),
  schoolYearId: z.number().int(),
  adviserId: z.number().int().nullable().optional(),
});

sectionsRouter.post('/', requirePermission('section:write'), ah(async (req, res) => {
  const s = req.scope!;
  const b = sectionBody.parse(req.body);
  if (!schoolInScope(s, b.schoolId)) throw forbidden('You can only create classes in your own school');
  const adviserId = req.user!.role === 'TEACHER' ? req.user!.id : (b.adviserId ?? null);
  if (adviserId) await assertSchoolStaff(adviserId, b.schoolId);
  const sec = await prisma.section.create({ data: { ...b, adviserId } });
  await audit(req, 'CREATE', 'Section', sec.id, null, sec);
  res.status(201).json(sec);
}));

sectionsRouter.get('/:id', requirePermission('analytics:read'), ah(async (req, res) => {
  const s = req.scope!;
  const sec = await prisma.section.findUnique({
    where: { id: idParam(req) },
    include: {
      school: true,
      gradeLevel: { include: { keyStage: true } },
      schoolYear: true,
      adviser: { select: { id: true, fullName: true } },
      teachers: { include: { user: { select: { id: true, fullName: true } }, learningArea: true } },
    },
  });
  if (!sec || !sectionInScope(s, sec)) throw notFound('Class');
  let roster = null;
  if (s.learnerLevel) {
    const enrolments = await prisma.enrolment.findMany({
      where: { sectionId: sec.id, learner: { deletedAt: null } },
      include: { learner: true },
      orderBy: [{ learner: { sex: 'asc' } }, { learner: { lastName: 'asc' } }, { learner: { firstName: 'asc' } }],
    });
    roster = enrolments.map((e) => ({ enrolmentId: e.id, isCurrent: e.isCurrent, endReason: e.endReason, ...e.learner }));
  }
  res.json({ ...sec, roster });
}));

sectionsRouter.put('/:id', requirePermission('section:write'), ah(async (req, res) => {
  const s = req.scope!;
  const id = idParam(req);
  const before = await prisma.section.findUnique({ where: { id } });
  if (!before || !sectionInScope(s, before)) throw notFound('Class');
  const b = sectionBody.partial().omit({ schoolId: true }).parse(req.body);
  if (req.user!.role === 'TEACHER') delete b.adviserId;
  if (b.adviserId) await assertSchoolStaff(b.adviserId, before.schoolId);
  const sec = await prisma.section.update({ where: { id }, data: b });
  await audit(req, 'UPDATE', 'Section', id, before, sec);
  res.json(sec);
}));

sectionsRouter.post('/:id/teachers', requirePermission('section:write'), ah(async (req, res) => {
  const s = req.scope!;
  const id = idParam(req);
  const sec = await prisma.section.findUnique({ where: { id } });
  if (!sec || !sectionInScope(s, sec)) throw notFound('Class');
  const b = z.object({ userId: z.number().int(), learningAreaId: z.number().int().nullable().optional() }).parse(req.body);
  await assertSchoolStaff(b.userId, sec.schoolId);
  const t = await prisma.sectionTeacher.create({ data: { sectionId: id, userId: b.userId, learningAreaId: b.learningAreaId ?? null } });
  await audit(req, 'CREATE', 'SectionTeacher', t.id, null, t);
  res.status(201).json(t);
}));

sectionsRouter.delete('/:id/teachers/:assignmentId', requirePermission('section:write'), ah(async (req, res) => {
  const s = req.scope!;
  const t = await prisma.sectionTeacher.findUnique({ where: { id: idParam(req, 'assignmentId') }, include: { section: true } });
  if (!t || t.sectionId !== idParam(req) || !sectionInScope(s, t.section)) throw notFound('Assignment');
  await prisma.sectionTeacher.delete({ where: { id: t.id } });
  await audit(req, 'DELETE', 'SectionTeacher', t.id, t, null);
  res.json({ ok: true });
}));

/** Staff of a school, for adviser / subject-teacher pickers. */
sectionsRouter.get('/staff/:schoolId', requirePermission('section:write'), ah(async (req, res) => {
  const schoolId = idParam(req, 'schoolId');
  if (!schoolInScope(req.scope!, schoolId)) throw forbidden();
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['TEACHER', 'MASTER_TEACHER', 'ASSESSMENT_COORDINATOR'] }, scopes: { some: { schoolId } } },
    select: { id: true, fullName: true, role: true, position: true },
    orderBy: { fullName: 'asc' },
  });
  res.json(users);
}));

async function assertSchoolStaff(userId: number, schoolId: number) {
  const ok = await prisma.userScope.findFirst({ where: { userId, schoolId, user: { isActive: true } } });
  if (!ok) throw badRequest('Selected teacher is not assigned to this school');
}
