import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma, SchoolYear } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAnyPermission } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { ah } from '../lib/http.js';
import { learnerName } from '../domain/lrn.js';
import { idSchema } from '../domain/validation.js';
import { schoolInScope } from '../rbac/scope.js';

/**
 * Moving to the next school year (spec §6.1, §7.1), as one guided checklist:
 *   1 validate results → 2 open the validation window (CLOSING) → 3 prepare next SY →
 *   4 move learners (promote / retain / complete) → 5 make next SY current → 6 close old SY.
 * Each step names who does it; the checklist shows what is done and what is left.
 */
export const transitionRouter = Router();
const canView = requireAnyPermission('section:write', 'reference:write', 'schoolyear:manage', 'assessment:verify');

type Outcome = 'PROMOTE' | 'RETAIN' | 'COMPLETE' | 'SKIP';
/** End reasons written by this process; an enrolment ended with one of them has been handled. */
const MOVED_REASONS = ['Promoted to ', 'Retained in ', 'Completed '];
const gradeNum = (code: string) => (code === 'K' ? 0 : Number(code.slice(1)));
const gradeCode = (n: number) => (n === 0 ? 'K' : `G${n}`);

/** The year being left (default: current) and the year being prepared (default: the next one). */
async function years(fromId?: number, toId?: number) {
  const all = await prisma.schoolYear.findMany({ orderBy: { startDate: 'asc' }, include: { terms: true } });
  const from = fromId ? all.find((y) => y.id === fromId) : all.find((y) => y.isCurrent);
  if (!from) throw notFound('School year');
  const to = toId ? all.find((y) => y.id === toId) : all.find((y) => y.startDate > from.startDate);
  if (toId && !to) throw notFound('Next school year');
  return { from, to: to ?? null };
}

/** Schools the caller works with: their own for school staff, every school for division roles. */
async function schoolsFor(req: Request) {
  const s = req.scope!;
  return prisma.school.findMany({ where: s.schoolIds === null || s.level === 'NONE' ? { isActive: true } : { id: { in: s.schoolIds } }, orderBy: { name: 'asc' } });
}

const q = z.object({ fromSchoolYearId: z.coerce.number().int().positive().optional(), toSchoolYearId: z.coerce.number().int().positive().optional() });

/** The checklist, with live progress for the caller's schools. */
transitionRouter.get('/', canView, ah(async (req, res) => {
  const p = q.parse(req.query);
  const { from, to } = await years(p.fromSchoolYearId, p.toSchoolYearId);
  const schools = await schoolsFor(req);
  const schoolIds = schools.map((s) => s.id);
  const [unvalidated, waiting] = await Promise.all([
    prisma.assessment.count({ where: { schoolYearId: from.id, deletedAt: null, status: { not: 'VERIFIED' }, schoolId: { in: schoolIds } } }),
    learnersToMove(from, to, schoolIds),
  ]);
  const role = req.user!.role;
  const steps = [
    {
      key: 'validate', title: 'Validate all results', owner: 'Advisers submit; validators validate',
      done: unvalidated === 0, detail: unvalidated ? `${unvalidated} assessment(s) not yet validated` : 'All results are validated',
      canAct: ['TEACHER', 'MASTER_TEACHER', 'ASSESSMENT_COORDINATOR', 'PRINCIPAL'].includes(role),
    },
    {
      key: 'closing', title: 'Start the end-of-year validation window', owner: 'System Administrator',
      done: from.status !== 'OPEN', detail: `SY ${from.label} is ${from.status.toLowerCase()}. While closing, advisers can only submit pending work.`,
      canAct: role === 'SYSTEM_ADMIN' && from.status === 'OPEN',
    },
    {
      key: 'prepare', title: 'Create the next school year and its terms', owner: 'Division Administrator',
      done: !!to && to.terms.length > 0, detail: to ? `SY ${to.label} is ready (${to.terms.length} terms)` : 'No next school year yet',
      canAct: role === 'DIVISION_ADMIN' && !to,
    },
    {
      key: 'promote', title: 'Move learners to the next school year', owner: 'Principal or Assessment Coordinator',
      done: !!to && waiting === 0, detail: !to ? 'Waits for the next school year' : waiting ? `${waiting} learner(s) still to move` : 'Every learner has been moved',
      canAct: ['PRINCIPAL', 'ASSESSMENT_COORDINATOR'].includes(role) && !!to && to.status === 'OPEN',
    },
    {
      key: 'current', title: 'Make the next school year current', owner: 'Division Administrator',
      done: !!to?.isCurrent, detail: to?.isCurrent ? `SY ${to.label} is current` : `SY ${from.label} is still the current year`,
      canAct: role === 'DIVISION_ADMIN' && !!to && !to.isCurrent,
    },
    {
      key: 'close', title: 'Close the previous school year', owner: 'System Administrator',
      done: from.status === 'CLOSED' || from.status === 'ARCHIVED', detail: `SY ${from.label} is ${from.status.toLowerCase()}. Once closed it is read-only history.`,
      canAct: role === 'SYSTEM_ADMIN' && from.status === 'CLOSING',
    },
  ];
  res.json({
    from: { id: from.id, label: from.label, status: from.status, isCurrent: from.isCurrent },
    to: to ? { id: to.id, label: to.label, status: to.status, isCurrent: to.isCurrent, terms: to.terms.length } : null,
    steps,
    nextStep: steps.find((s) => !s.done)?.key ?? null,
  });
}));

/** Learners of the given schools who are active in `from` and have no enrolment in `to` yet. */
async function learnersToMove(from: SchoolYear, to: SchoolYear | null, schoolIds: number[]) {
  if (!to) return 0;
  return prisma.enrolment.count({
    where: {
      schoolYearId: from.id, isCurrent: true, section: { schoolId: { in: schoolIds } },
      learner: { status: 'ACTIVE', enrolments: { none: { schoolYearId: to.id } } },
    },
  });
}

async function assertSchool(req: Request, schoolId: number) {
  if (!['PRINCIPAL', 'ASSESSMENT_COORDINATOR'].includes(req.user!.role)) throw forbidden('The principal or assessment coordinator moves learners to the next school year');
  if (!schoolInScope(req.scope!, schoolId)) throw forbidden('You can only move learners of your own school');
}

/** Proposed outcome for every learner of a school, class by class (nothing is saved). */
async function plan(schoolId: number, from: SchoolYear, to: SchoolYear) {
  const sections = await prisma.section.findMany({
    where: { schoolId, schoolYearId: from.id },
    include: {
      gradeLevel: true,
      // Current learners, plus those this process already moved (so a repeat run reports them as done).
      enrolments: {
        where: {
          learner: { status: { in: ['ACTIVE', 'GRADUATED'] } },
          OR: [{ isCurrent: true }, ...MOVED_REASONS.map((r) => ({ endReason: { startsWith: r } }))],
        },
        include: { learner: { include: { enrolments: { where: { schoolYearId: to.id }, include: { section: { include: { gradeLevel: true } } } } } } },
      },
    },
    orderBy: [{ gradeLevel: { sortOrder: 'asc' } }, { name: 'asc' }],
  });
  const offered = new Set(sections.map((s) => s.gradeLevel.code));
  return sections.map((s) => {
    const n = gradeNum(s.gradeLevel.code);
    const next = gradeCode(n + 1);
    // Default: promote; the school's last grade (e.g. Grade 6 in an elementary school) completes.
    const exitGrade = n >= 12 || !offered.has(next);
    return {
      sectionId: s.id,
      section: s.name,
      grade: s.gradeLevel.name,
      gradeCode: s.gradeLevel.code,
      nextGradeCode: n >= 12 ? null : next,
      defaultOutcome: (exitGrade ? 'COMPLETE' : 'PROMOTE') as Outcome,
      learners: s.enrolments
        .map((e) => ({
          learnerId: e.learnerId,
          lrn: e.learner.lrn,
          name: learnerName(e.learner),
          alreadyMoved: e.learner.enrolments.length > 0
            ? `${e.learner.enrolments[0].section.gradeLevel.name} – ${e.learner.enrolments[0].section.name}`
            : e.isCurrent ? null : e.endReason,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

const schoolQ = q.extend({ schoolId: z.coerce.number().int().positive() });

transitionRouter.get('/promotion', canView, ah(async (req, res) => {
  const p = schoolQ.parse(req.query);
  if (!schoolInScope(req.scope!, p.schoolId) && req.scope!.schoolIds !== null) throw forbidden();
  const { from, to } = await years(p.fromSchoolYearId, p.toSchoolYearId);
  if (!to) throw badRequest('Create the next school year first (Division Administrator)');
  res.json({ from: { id: from.id, label: from.label }, to: { id: to.id, label: to.label, status: to.status }, classes: await plan(p.schoolId, from, to) });
}));

/**
 * Move learners: promote to the next grade, retain in the same grade, or record completion.
 * Next-year classes are created with the same section names when missing (adviser to be
 * assigned). Learners already enrolled in the next year are left as they are.
 */
transitionRouter.post('/promotion', requireAnyPermission('section:write'), ah(async (req, res) => {
  const b = z.object({
    schoolId: idSchema,
    fromSchoolYearId: idSchema,
    toSchoolYearId: idSchema,
    decisions: z.array(z.object({ learnerId: idSchema, outcome: z.enum(['PROMOTE', 'RETAIN', 'COMPLETE', 'SKIP']) })).min(1).max(5000),
  }).parse(req.body);
  await assertSchool(req, b.schoolId);
  const { from, to } = await years(b.fromSchoolYearId, b.toSchoolYearId);
  if (!to || to.id === from.id || to.startDate <= from.startDate) throw badRequest('Choose a later school year to move learners into');
  if (to.status !== 'OPEN') throw new AppError(423, 'SCHOOL_YEAR_LOCKED', `SY ${to.label} is ${to.status.toLowerCase()}; learners can only be moved into an open school year`);

  const classes = await plan(b.schoolId, from, to);
  const where = new Map(classes.flatMap((c) => c.learners.map((l) => [l.learnerId, { c, l }] as const)));
  const grades = Object.fromEntries((await prisma.gradeLevel.findMany()).map((g) => [g.code, g]));
  const counts = { PROMOTE: 0, RETAIN: 0, COMPLETE: 0, SKIP: 0, alreadyMoved: 0, classesCreated: 0 };

  await prisma.$transaction(async (tx) => {
    const targetSection = async (gradeCodeTo: string, name: string) => {
      const g = grades[gradeCodeTo];
      if (!g) throw badRequest(`Grade ${gradeCodeTo} is not configured`);
      const found = await tx.section.findFirst({ where: { schoolId: b.schoolId, schoolYearId: to.id, gradeLevelId: g.id, name } });
      if (found) return found;
      counts.classesCreated++;
      return tx.section.create({ data: { schoolId: b.schoolId, schoolYearId: to.id, gradeLevelId: g.id, name } });
    };
    for (const d of b.decisions) {
      const hit = where.get(d.learnerId);
      if (!hit) throw badRequest(`Learner ${d.learnerId} is not an active learner of this school in SY ${from.label}`);
      if (hit.l.alreadyMoved) { counts.alreadyMoved++; continue; }
      if (d.outcome === 'SKIP') { counts.SKIP++; continue; }
      const { c } = hit;
      const ended: Prisma.EnrolmentUpdateManyMutationInput = { isCurrent: false, endedAt: from.endDate };
      if (d.outcome === 'COMPLETE') {
        await tx.enrolment.updateMany({ where: { learnerId: d.learnerId, sectionId: c.sectionId, isCurrent: true }, data: { ...ended, endReason: `Completed ${c.grade}` } });
        if (c.gradeCode === 'G12') await tx.learner.update({ where: { id: d.learnerId }, data: { status: 'GRADUATED' } });
      } else {
        const toGrade = d.outcome === 'PROMOTE' ? c.nextGradeCode : c.gradeCode;
        if (!toGrade) throw badRequest(`${hit.l.name} is in ${c.grade}; choose Completed instead of Promote`);
        const sec = await targetSection(toGrade, c.section);
        await tx.enrolment.updateMany({ where: { learnerId: d.learnerId, sectionId: c.sectionId, isCurrent: true }, data: { ...ended, endReason: d.outcome === 'PROMOTE' ? `Promoted to ${grades[toGrade].name}` : `Retained in ${c.grade}` } });
        await tx.enrolment.create({ data: { learnerId: d.learnerId, sectionId: sec.id, schoolYearId: to.id, dateEnrolled: to.startDate } });
      }
      counts[d.outcome]++;
    }
  }, { timeout: 120000 });
  await audit(req, 'ENROL', 'SchoolYearTransition', `${from.id}->${to.id}`, null, { schoolId: b.schoolId, ...counts });
  res.json(counts);
}));
