import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ah, idParam, paged, paginationSchema } from '../lib/http.js';
import { parseTabular } from '../lib/tabular.js';
import { isValidLrn, normalizeLrn } from '../domain/lrn.js';
import { computeEffectiveness } from '../domain/effectiveness.js';
import { assertLearnerLevel, learnerWhere, sectionInScope, type DataScope } from '../rbac/scope.js';

export const learnersRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const lrnField = z.string().transform(normalizeLrn).refine(isValidLrn, 'LRN must be exactly 12 digits');
const nameField = z.string().trim().min(1).max(80);
const learnerBody = z.object({
  lrn: lrnField,
  firstName: nameField,
  middleName: z.string().trim().max(80).nullable().optional(),
  lastName: nameField,
  extensionName: z.string().trim().max(10).nullable().optional(),
  sex: z.enum(['MALE', 'FEMALE']),
  birthdate: z.coerce.date().nullable().optional(),
  status: z.enum(['ACTIVE', 'TRANSFERRED_OUT', 'DROPPED', 'GRADUATED']).optional(),
});

export async function findLearnerInScope(s: DataScope, id: number) {
  const l = await prisma.learner.findFirst({ where: { id, ...learnerWhere(s) } });
  if (!l) throw notFound('Learner');
  return l;
}

async function sectionForWrite(s: DataScope, sectionId: number) {
  const sec = await prisma.section.findUnique({ where: { id: sectionId } });
  if (!sec || !sectionInScope(s, sec)) throw forbidden('You can only enrol learners into your own classes');
  return sec;
}

/** Enrol a learner in a section, closing any other current enrolment for the same school year. */
async function enrol(tx: Prisma.TransactionClient, learnerId: number, sec: { id: number; schoolYearId: number }) {
  const current = await tx.enrolment.findFirst({ where: { learnerId, schoolYearId: sec.schoolYearId, isCurrent: true } });
  if (current?.sectionId === sec.id) return current;
  if (current) await tx.enrolment.update({ where: { id: current.id }, data: { isCurrent: false, endedAt: new Date(), endReason: 'Moved to another class' } });
  return tx.enrolment.create({ data: { learnerId, sectionId: sec.id, schoolYearId: sec.schoolYearId } });
}

learnersRouter.get('/', requirePermission('learner:read'), ah(async (req, res) => {
  const s = req.scope!;
  assertLearnerLevel(s);
  const { page, perPage } = paginationSchema.parse(req.query);
  const q = z.object({
    search: z.string().trim().optional(),
    sectionId: z.coerce.number().int().optional(),
    schoolYearId: z.coerce.number().int().optional(),
    status: z.enum(['ACTIVE', 'TRANSFERRED_OUT', 'DROPPED', 'GRADUATED']).optional(),
  }).parse(req.query);
  const where: Prisma.LearnerWhereInput = {
    AND: [
      learnerWhere(s),
      q.status ? { status: q.status } : {},
      q.sectionId || q.schoolYearId ? { enrolments: { some: { sectionId: q.sectionId, schoolYearId: q.schoolYearId, isCurrent: true } } } : {},
      q.search
        ? { OR: [{ lrn: { contains: normalizeLrn(q.search) || q.search } }, { lastName: { contains: q.search } }, { firstName: { contains: q.search } }] }
        : {},
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.learner.count({ where }),
    prisma.learner.findMany({
      where,
      include: {
        enrolments: {
          where: { isCurrent: true },
          include: { section: { include: { gradeLevel: true, school: { select: { id: true, name: true } } } }, schoolYear: true },
          orderBy: { schoolYear: { startDate: 'desc' } },
          take: 1,
        },
        _count: { select: { gaps: { where: { status: { not: 'RESOLVED' } } }, interventions: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);
  res.json(paged(rows.map(({ enrolments, _count, ...l }) => ({ ...l, currentEnrolment: enrolments[0] ?? null, openGaps: _count.gaps, interventionCount: _count.interventions })), total, page, perPage));
}));

learnersRouter.post('/', requirePermission('learner:write'), ah(async (req, res) => {
  const s = req.scope!;
  const b = learnerBody.extend({ sectionId: z.number().int() }).parse(req.body);
  const sec = await sectionForWrite(s, b.sectionId);
  const existing = await prisma.learner.findUnique({ where: { lrn: b.lrn } });
  if (existing) {
    throw conflict('A learner with this LRN is already registered. Use "Enrol existing learner" to add them to your class.', { field: 'lrn' });
  }
  const { sectionId: _s, ...data } = b;
  const learner = await prisma.$transaction(async (tx) => {
    const l = await tx.learner.create({ data: { ...data, createdById: req.user!.id } });
    await enrol(tx, l.id, sec);
    return l;
  });
  await audit(req, 'CREATE', 'Learner', learner.id, null, learner);
  res.status(201).json(learner);
}));

/**
 * Enrol an already-registered learner (e.g. a transferee). The caller must know both the
 * LRN and the learner's last name, so the LRN alone cannot be used to probe other records.
 */
learnersRouter.post('/enrol-existing', requirePermission('learner:write'), ah(async (req, res) => {
  const s = req.scope!;
  const b = z.object({ lrn: lrnField, lastName: nameField, sectionId: z.number().int() }).parse(req.body);
  const sec = await sectionForWrite(s, b.sectionId);
  const l = await prisma.learner.findUnique({ where: { lrn: b.lrn } });
  if (!l || l.deletedAt || l.lastName.toLowerCase() !== b.lastName.toLowerCase()) throw notFound('Learner with that LRN and last name');
  const e = await prisma.$transaction(async (tx) => {
    const en = await enrol(tx, l.id, sec);
    if (l.status !== 'ACTIVE') await tx.learner.update({ where: { id: l.id }, data: { status: 'ACTIVE' } });
    return en;
  });
  await audit(req, 'ENROL', 'Learner', l.id, null, { sectionId: sec.id, enrolmentId: e.id });
  res.status(201).json({ learnerId: l.id, enrolmentId: e.id });
}));

learnersRouter.post('/enrolments/:id/end', requirePermission('learner:write'), ah(async (req, res) => {
  const s = req.scope!;
  const e = await prisma.enrolment.findUnique({ where: { id: idParam(req) }, include: { section: true } });
  if (!e || !sectionInScope(s, e.section)) throw notFound('Enrolment');
  const b = z.object({ status: z.enum(['TRANSFERRED_OUT', 'DROPPED', 'GRADUATED']), reason: z.string().trim().max(200).optional() }).parse(req.body);
  await prisma.$transaction([
    prisma.enrolment.update({ where: { id: e.id }, data: { isCurrent: false, endedAt: new Date(), endReason: b.reason ?? b.status } }),
    prisma.learner.update({ where: { id: e.learnerId }, data: { status: b.status } }),
  ]);
  await audit(req, 'UPDATE', 'Enrolment', e.id, e, { ...b, isCurrent: false });
  res.json({ ok: true });
}));

learnersRouter.get('/:id', requirePermission('learner:read'), ah(async (req, res) => {
  const s = req.scope!;
  const id = idParam(req);
  await findLearnerInScope(s, id);
  const learner = await prisma.learner.findUniqueOrThrow({
    where: { id },
    include: {
      enrolments: {
        include: { section: { include: { gradeLevel: { include: { keyStage: true } }, school: { select: { id: true, name: true } } } }, schoolYear: true },
        orderBy: [{ schoolYear: { startDate: 'desc' } }, { dateEnrolled: 'desc' }],
      },
      ilmps: { include: { learningArea: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  const results = await prisma.assessmentResult.findMany({
    where: { learnerId: id, assessment: { deletedAt: null } },
    include: {
      band: true,
      competencyResults: { include: { competency: true } },
      assessment: { include: { assessmentType: true, learningArea: true, term: true, schoolYear: true, gradeLevel: true } },
    },
  });
  results.sort((a, b) =>
    a.assessment.schoolYear.startDate.getTime() - b.assessment.schoolYear.startDate.getTime() ||
    a.assessment.term.sortOrder - b.assessment.term.sortOrder ||
    a.assessment.learningArea.name.localeCompare(b.assessment.learningArea.name));

  // Delta vs the previous result of the same instrument and learning area (§6.1).
  const lastBy = new Map<string, (typeof results)[number]>();
  const history = results.map((r) => {
    const k = `${r.assessment.assessmentTypeId}:${r.assessment.learningAreaId}`;
    const prev = lastBy.get(k);
    if (!r.isAbsent) lastBy.set(k, r);
    const delta = prev && prev.percentage != null && r.percentage != null ? Math.round((r.percentage - prev.percentage) * 100) / 100 : null;
    const trend = !prev || r.isAbsent ? null : delta != null ? (delta > 0 ? 'UP' : delta < 0 ? 'DOWN' : 'SAME') : tierTrend(prev.tier, r.tier);
    return { ...r, deltaVsPrevious: delta, trend };
  });

  const gaps = await prisma.learningGap.findMany({
    where: { learnerId: id },
    include: { competency: true, assessmentResult: { include: { assessment: { include: { learningArea: true, term: true, schoolYear: true, assessmentType: true } } } } },
    orderBy: { createdAt: 'desc' },
  });
  const interventions = await prisma.interventionLearner.findMany({
    where: { learnerId: id, intervention: { deletedAt: null } },
    include: {
      intervention: { include: { learningArea: true, owner: { select: { fullName: true } } } },
      reassessments: { include: { band: true }, orderBy: { date: 'desc' } },
      learningGap: { include: { competency: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  await audit(req, 'VIEW_LEARNER', 'Learner', id);
  res.json({
    ...learner,
    history,
    gaps,
    interventions: interventions.map((il) => {
      const post = il.reassessments[0];
      return {
        ...il,
        effectiveness: computeEffectiveness(
          { percentage: il.prePercentage, tier: il.preTier },
          post ? { percentage: post.percentage, tier: post.tier, bandLabel: post.band?.label } : null,
        ),
      };
    }),
  });
}));

function tierTrend(a: string | null, b: string | null) {
  if (!a || !b) return null;
  return a === b ? 'SAME' : a > b ? 'UP' : 'DOWN'; // TIER_1 < TIER_3 lexically; lower tier number = better
}

learnersRouter.put('/:id', requirePermission('learner:write'), ah(async (req, res) => {
  const s = req.scope!;
  const id = idParam(req);
  const before = await findLearnerInScope(s, id);
  const b = learnerBody.partial().parse(req.body);
  if (b.lrn && b.lrn !== before.lrn) {
    const dup = await prisma.learner.findUnique({ where: { lrn: b.lrn } });
    if (dup) throw conflict('Another learner already uses this LRN', { field: 'lrn' });
  }
  const l = await prisma.learner.update({ where: { id }, data: b });
  await audit(req, 'UPDATE', 'Learner', id, before, l);
  res.json(l);
}));

learnersRouter.delete('/:id', requirePermission('learner:write'), ah(async (req, res) => {
  const s = req.scope!;
  if (req.user!.role === 'TEACHER') throw forbidden('Ask your school assessment coordinator to archive learner records');
  const id = idParam(req);
  const before = await findLearnerInScope(s, id);
  await prisma.learner.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(req, 'DELETE', 'Learner', id, before, null);
  res.json({ ok: true });
}));

// ───────────── ILMP (Individual Learning Monitoring Plan) ─────────────
const ilmpBody = z.object({
  learningAreaId: z.number().int(),
  schoolYearId: z.number().int(),
  termId: z.number().int().nullable().optional(),
  identifiedGaps: z.string().trim().min(3),
  strategies: z.string().trim().min(3),
  monitoringNotes: z.string().trim().nullable().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED']).optional(),
});
learnersRouter.post('/:id/ilmps', requirePermission('intervention:write'), ah(async (req, res) => {
  const id = idParam(req);
  await findLearnerInScope(req.scope!, id);
  const i = await prisma.ilmp.create({ data: { ...ilmpBody.parse(req.body), learnerId: id, createdById: req.user!.id } });
  await audit(req, 'CREATE', 'Ilmp', i.id, null, i);
  res.status(201).json(i);
}));
learnersRouter.put('/:id/ilmps/:ilmpId', requirePermission('intervention:write'), ah(async (req, res) => {
  const id = idParam(req);
  await findLearnerInScope(req.scope!, id);
  const before = await prisma.ilmp.findFirst({ where: { id: idParam(req, 'ilmpId'), learnerId: id } });
  if (!before) throw notFound('ILMP');
  const i = await prisma.ilmp.update({ where: { id: before.id }, data: ilmpBody.partial().parse(req.body) });
  await audit(req, 'UPDATE', 'Ilmp', i.id, before, i);
  res.json(i);
}));

// ───────────── Bulk import ─────────────
export interface ImportIssue {
  row: number;
  field?: string;
  message: string;
}

/**
 * Import a roster into a class. Always validates the whole file first; nothing is written
 * unless every row is valid (or `dryRun` is set, in which case nothing is written at all).
 * Columns: lrn, last_name, first_name, middle_name, extension_name, sex, birthdate
 */
learnersRouter.post('/import', requirePermission('learner:write'), upload.single('file'), ah(async (req, res) => {
  const s = req.scope!;
  if (!req.file) throw badRequest('Attach a CSV or XLSX file');
  const sectionId = Number(req.body.sectionId);
  const dryRun = req.body.dryRun === 'true' || req.body.dryRun === true;
  const sec = await sectionForWrite(s, sectionId);
  const rows = await parseTabular(req.file);
  if (rows.length === 0) throw badRequest('The file has no data rows');
  if (rows.length > 2000) throw badRequest('Import at most 2,000 learners at a time');

  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const seen = new Map<string, number>();
  const parsed: { row: number; data: z.infer<typeof learnerBody> }[] = [];
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    const sexRaw = (r.sex ?? '').trim().toUpperCase();
    const candidate = {
      lrn: r.lrn ?? '',
      lastName: r.last_name ?? r.lastname ?? '',
      firstName: r.first_name ?? r.firstname ?? '',
      middleName: r.middle_name || null,
      extensionName: r.extension_name || r.ext || null,
      sex: sexRaw.startsWith('M') ? 'MALE' : sexRaw.startsWith('F') ? 'FEMALE' : sexRaw,
      birthdate: r.birthdate ? r.birthdate : null,
    };
    const p = learnerBody.safeParse(candidate);
    if (!p.success) {
      for (const iss of p.error.issues) errors.push({ row: rowNo, field: String(iss.path[0] ?? ''), message: iss.message });
      return;
    }
    const prev = seen.get(p.data.lrn);
    if (prev) {
      errors.push({ row: rowNo, field: 'lrn', message: `Duplicate LRN in file (also on row ${prev})` });
      return;
    }
    seen.set(p.data.lrn, rowNo);
    parsed.push({ row: rowNo, data: p.data });
  });

  const existing = await prisma.learner.findMany({ where: { lrn: { in: parsed.map((p) => p.data.lrn) } } });
  const existingByLrn = new Map(existing.map((l) => [l.lrn, l]));
  for (const p of parsed) {
    const ex = existingByLrn.get(p.data.lrn);
    if (ex && ex.lastName.toLowerCase() !== p.data.lastName.toLowerCase()) {
      errors.push({ row: p.row, field: 'lrn', message: 'LRN is already registered to a learner with a different last name' });
    } else if (ex) {
      warnings.push({ row: p.row, field: 'lrn', message: 'Learner already registered; will be enrolled in this class (record not changed)' });
    }
  }

  const summary = { rows: rows.length, valid: parsed.length - errors.filter((e) => parsed.some((p) => p.row === e.row)).length, newLearners: parsed.filter((p) => !existingByLrn.has(p.data.lrn)).length, existingLearners: existing.length };
  if (errors.length || dryRun) {
    return res.status(errors.length && !dryRun ? 422 : 200).json({ committed: false, summary, errors, warnings });
  }
  await prisma.$transaction(async (tx) => {
    for (const p of parsed) {
      const ex = existingByLrn.get(p.data.lrn);
      const l = ex ?? (await tx.learner.create({ data: { ...p.data, createdById: req.user!.id } }));
      await enrol(tx, l.id, sec);
    }
  }, { timeout: 60000 });
  await audit(req, 'IMPORT', 'Learner', null, null, { sectionId, file: req.file.originalname, ...summary });
  res.json({ committed: true, summary, errors, warnings });
}));
