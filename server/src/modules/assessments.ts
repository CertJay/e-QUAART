import { Router, type Request } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ah, idParam, nullableDate, paged, paginationSchema } from '../lib/http.js';
import { parseTabular } from '../lib/tabular.js';
import { learnerName } from '../domain/lrn.js';
import { tierMetrics } from '../domain/metrics.js';
import { assessmentWhere, learningAreaInScope, sectionInScope, type DataScope } from '../rbac/scope.js';
import { applyEntries, parseResultRows, validateEntry, type FullAssessment, type ResultEntry } from './assessments.service.js';
import { syncLearningGaps } from './gaps.service.js';

export const assessmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const fullInclude = {
  assessmentType: true,
  model: { include: { bands: { orderBy: { sortOrder: 'asc' } } } },
  competencies: { include: { competency: true }, orderBy: { competency: { code: 'asc' } } },
  gradeLevel: true,
  learningArea: true,
  section: true,
  school: { select: { id: true, name: true } },
  schoolYear: true,
  term: true,
  createdBy: { select: { id: true, fullName: true } },
  verifiedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.AssessmentInclude;

async function loadAssessment(s: DataScope, id: number) {
  const a = await prisma.assessment.findFirst({ where: { id, ...assessmentWhere(s) }, include: fullInclude });
  if (!a) throw notFound('Assessment');
  return a;
}

function assertEditable(a: { status: string }) {
  if (a.status !== 'DRAFT' && a.status !== 'RETURNED') {
    throw new AppError(423, 'LOCKED', `This assessment is ${a.status.toLowerCase()} and locked. Ask a verifier to reopen it.`);
  }
}

function assertCanEncode(req: Request, a: { sectionId: number; schoolId: number }) {
  if (!sectionInScope(req.scope!, { id: a.sectionId, schoolId: a.schoolId })) throw forbidden('You can only encode results for your own classes');
}

/** Learners on the assessment roster: current enrolments plus anyone who already has a result. */
async function roster(a: { id: number; sectionId: number }) {
  const [enrolments, results] = await Promise.all([
    prisma.enrolment.findMany({ where: { sectionId: a.sectionId, learner: { deletedAt: null } }, include: { learner: true } }),
    prisma.assessmentResult.findMany({ where: { assessmentId: a.id }, include: { learner: true } }),
  ]);
  const map = new Map<number, { learner: (typeof enrolments)[number]['learner']; enrolled: boolean }>();
  for (const e of enrolments) {
    const cur = map.get(e.learnerId);
    map.set(e.learnerId, { learner: e.learner, enrolled: (cur?.enrolled ?? false) || e.isCurrent });
  }
  for (const r of results) if (!map.has(r.learnerId)) map.set(r.learnerId, { learner: r.learner, enrolled: false });
  return [...map.values()].sort((x, y) => x.learner.sex.localeCompare(y.learner.sex) || x.learner.lastName.localeCompare(y.learner.lastName) || x.learner.firstName.localeCompare(y.learner.firstName));
}

// ───────────── List ─────────────
assessmentsRouter.get('/', requirePermission('assessment:read'), ah(async (req, res) => {
  const s = req.scope!;
  const { page, perPage } = paginationSchema.parse(req.query);
  const q = z.object({
    status: z.enum(['DRAFT', 'SUBMITTED', 'VERIFIED', 'RETURNED']).optional(),
    schoolYearId: z.coerce.number().int().optional(),
    termId: z.coerce.number().int().optional(),
    sectionId: z.coerce.number().int().optional(),
    schoolId: z.coerce.number().int().optional(),
    gradeLevelId: z.coerce.number().int().optional(),
    learningAreaId: z.coerce.number().int().optional(),
    assessmentTypeId: z.coerce.number().int().optional(),
    search: z.string().optional(),
  }).parse(req.query);
  const { search, ...filters } = q;
  const where: Prisma.AssessmentWhereInput = {
    AND: [assessmentWhere(s), filters, search ? { title: { contains: search, mode: 'insensitive' } } : {}],
  };
  const [total, rows] = await Promise.all([
    prisma.assessment.count({ where }),
    prisma.assessment.findMany({
      where,
      include: {
        assessmentType: { select: { code: true, name: true, resultMode: true } },
        learningArea: { select: { code: true, name: true } },
        gradeLevel: { select: { code: true, name: true } },
        section: { select: { id: true, name: true, _count: { select: { enrolments: { where: { isCurrent: true } } } } } },
        school: { select: { id: true, name: true } },
        term: { select: { code: true, name: true } },
        schoolYear: { select: { label: true } },
        createdBy: { select: { fullName: true } },
        _count: { select: { results: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);
  res.json(paged(rows.map(({ _count, section, ...a }) => ({
    ...a,
    section: { id: section.id, name: section.name },
    encodedCount: _count.results,
    enrolledCount: section._count.enrolments,
    completionRate: section._count.enrolments ? Math.min(100, Math.round((_count.results / section._count.enrolments) * 1000) / 10) : null,
  })), total, page, perPage));
}));

// ───────────── Create / update ─────────────
const compItems = z.array(z.object({ competencyId: z.number().int(), itemsTotal: z.number().int().min(1).max(500) })).default([]);
const createBody = z.object({
  title: z.string().trim().max(160).optional(),
  assessmentTypeId: z.number().int(),
  schoolYearId: z.number().int(),
  termId: z.number().int(),
  sectionId: z.number().int(),
  learningAreaId: z.number().int(),
  assessmentDate: nullableDate,
  maxScore: z.number().positive().max(10000).nullable().optional(),
  windowOpen: nullableDate,
  windowClose: nullableDate,
  competencies: compItems,
});

async function validateConfig(b: { assessmentTypeId: number; schoolYearId: number; termId: number; learningAreaId: number; maxScore?: number | null; windowOpen?: Date | null; windowClose?: Date | null; competencies: { competencyId: number; itemsTotal: number }[] }, gradeLevelId: number) {
  const [type, term, comps] = await Promise.all([
    prisma.assessmentType.findUnique({ where: { id: b.assessmentTypeId }, include: { models: { where: { isActive: true }, orderBy: { createdAt: 'desc' } } } }),
    prisma.term.findUnique({ where: { id: b.termId } }),
    prisma.competency.findMany({ where: { id: { in: b.competencies.map((c) => c.competencyId) } } }),
  ]);
  if (!type || !type.isActive) throw badRequest('Select an active assessment type');
  const model = type.models.find((m) => m.effectiveSchoolYearId === b.schoolYearId) ?? type.models.find((m) => m.effectiveSchoolYearId === null) ?? type.models[0];
  if (!model) throw badRequest(`${type.name} has no active classification model. Ask the division administrator to configure one.`);
  if (!term || term.schoolYearId !== b.schoolYearId) throw badRequest('The term does not belong to the selected school year');
  if (type.resultMode === 'PERCENTAGE' && !b.maxScore) throw badRequest('Maximum score is required for score-based assessments', [{ path: 'maxScore', message: 'Required' }]);
  if (b.windowOpen && b.windowClose && b.windowClose < b.windowOpen) throw badRequest('Encoding window closes before it opens');
  if (new Set(b.competencies.map((c) => c.competencyId)).size !== b.competencies.length) throw badRequest('A competency is listed twice');
  for (const c of comps) {
    if (c.learningAreaId !== b.learningAreaId || c.gradeLevelId !== gradeLevelId) throw badRequest(`Competency ${c.code} is not for this grade level and learning area`);
  }
  if (comps.length !== b.competencies.length) throw badRequest('Unknown competency selected');
  const items = b.competencies.reduce((s, c) => s + c.itemsTotal, 0);
  if (b.maxScore && items > b.maxScore) throw badRequest(`Competency items (${items}) exceed the maximum score (${b.maxScore})`);
  return { type, model };
}

async function assertNoDuplicate(b: { assessmentTypeId: number; termId: number; sectionId: number; learningAreaId: number }, exceptId?: number) {
  const dup = await prisma.assessment.findFirst({
    where: { assessmentTypeId: b.assessmentTypeId, termId: b.termId, sectionId: b.sectionId, learningAreaId: b.learningAreaId, deletedAt: null, id: exceptId ? { not: exceptId } : undefined },
  });
  if (dup) throw conflict(`Duplicate assessment: this class already has "${dup.title}" for the same type, term and learning area`, { duplicateId: dup.id });
}

assessmentsRouter.post('/', requirePermission('assessment:write'), ah(async (req, res) => {
  const s = req.scope!;
  const b = createBody.parse(req.body);
  const section = await prisma.section.findUnique({ where: { id: b.sectionId }, include: { gradeLevel: true } });
  if (!section || !sectionInScope(s, section)) throw forbidden('You can only create assessments for your own classes');
  if (section.schoolYearId !== b.schoolYearId) throw badRequest('The class belongs to a different school year');
  if (!learningAreaInScope(s, b.learningAreaId)) throw forbidden();
  const { type, model } = await validateConfig(b, section.gradeLevelId);
  await assertNoDuplicate(b);
  const [la, term] = await Promise.all([
    prisma.learningArea.findUniqueOrThrow({ where: { id: b.learningAreaId } }),
    prisma.term.findUniqueOrThrow({ where: { id: b.termId } }),
  ]);
  const { competencies, title, ...rest } = b;
  const a = await prisma.assessment.create({
    data: {
      ...rest,
      title: title || `${type.name} – ${la.name} – ${section.gradeLevel.name} ${section.name} (${term.name})`,
      maxScore: b.maxScore ?? null,
      modelId: model.id,
      gradeLevelId: section.gradeLevelId,
      schoolId: section.schoolId,
      createdById: req.user!.id,
      competencies: { create: competencies },
    },
    include: fullInclude,
  });
  await audit(req, 'CREATE', 'Assessment', a.id, null, a);
  res.status(201).json(a);
}));

assessmentsRouter.put('/:id', requirePermission('assessment:write'), ah(async (req, res) => {
  const s = req.scope!;
  const before = await loadAssessment(s, idParam(req));
  assertCanEncode(req, before);
  assertEditable(before);
  const b = createBody.omit({ sectionId: true, schoolYearId: true, assessmentTypeId: true }).partial().parse(req.body);
  const merged = {
    assessmentTypeId: before.assessmentTypeId,
    schoolYearId: before.schoolYearId,
    sectionId: before.sectionId,
    termId: b.termId ?? before.termId,
    learningAreaId: b.learningAreaId ?? before.learningAreaId,
    maxScore: b.maxScore === undefined ? before.maxScore : b.maxScore,
    windowOpen: b.windowOpen === undefined ? before.windowOpen : b.windowOpen,
    windowClose: b.windowClose === undefined ? before.windowClose : b.windowClose,
    competencies: b.competencies ?? before.competencies.map((c) => ({ competencyId: c.competencyId, itemsTotal: c.itemsTotal })),
  };
  await validateConfig(merged, before.gradeLevelId);
  await assertNoDuplicate(merged, before.id);
  const resultCount = await prisma.assessmentResult.count({ where: { assessmentId: before.id } });
  if (resultCount && b.maxScore !== undefined && b.maxScore !== before.maxScore) {
    throw conflict('Maximum score cannot change after results are encoded. Clear the results first.');
  }
  const a = await prisma.$transaction(async (tx) => {
    if (b.competencies) {
      const keep = b.competencies.map((c) => c.competencyId);
      await tx.assessmentCompetency.deleteMany({ where: { assessmentId: before.id, competencyId: { notIn: keep } } });
      await tx.competencyResult.deleteMany({ where: { result: { assessmentId: before.id }, competencyId: { notIn: keep } } });
      for (const c of b.competencies) {
        await tx.assessmentCompetency.upsert({
          where: { assessmentId_competencyId: { assessmentId: before.id, competencyId: c.competencyId } },
          create: { assessmentId: before.id, ...c },
          update: { itemsTotal: c.itemsTotal },
        });
      }
    }
    const { competencies: _c, ...rest } = b;
    return tx.assessment.update({ where: { id: before.id }, data: rest, include: fullInclude });
  });
  await audit(req, 'UPDATE', 'Assessment', a.id, before, a);
  res.json(a);
}));

assessmentsRouter.delete('/:id', requirePermission('assessment:write'), ah(async (req, res) => {
  const a = await loadAssessment(req.scope!, idParam(req));
  assertCanEncode(req, a);
  if (a.status !== 'DRAFT') throw conflict('Only draft assessments can be deleted');
  await prisma.assessment.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
  await audit(req, 'DELETE', 'Assessment', a.id, a, null);
  res.json({ ok: true });
}));

// ───────────── Detail, results, QA ─────────────
assessmentsRouter.get('/:id', requirePermission('assessment:read'), ah(async (req, res) => {
  const s = req.scope!;
  const a = await loadAssessment(s, idParam(req));
  const results = await prisma.assessmentResult.findMany({ where: { assessmentId: a.id }, include: { competencyResults: true, band: true } });
  const counts = { assessed: 0, tier1: 0, tier2: 0, tier3: 0 };
  const bandCounts = new Map<number, number>();
  let pctSum = 0;
  let pctN = 0;
  for (const r of results) {
    if (r.isAbsent || !r.tier) continue;
    counts.assessed++;
    if (r.tier === 'TIER_1') counts.tier1++;
    else if (r.tier === 'TIER_2') counts.tier2++;
    else counts.tier3++;
    if (r.bandId) bandCounts.set(r.bandId, (bandCounts.get(r.bandId) ?? 0) + 1);
    if (r.percentage != null) {
      pctSum += r.percentage;
      pctN++;
    }
  }
  const compStats = a.competencies.map((c) => {
    const rs = results.flatMap((r) => r.competencyResults.filter((x) => x.competencyId === c.competencyId));
    const mastered = rs.filter((x) => x.mastered).length;
    return { competencyId: c.competencyId, code: c.competency.code, description: c.competency.description, itemsTotal: c.itemsTotal, assessed: rs.length, mastered, masteryRate: rs.length ? Math.round((mastered / rs.length) * 1000) / 10 : null };
  });
  const summary = {
    ...tierMetrics(counts),
    averagePercentage: pctN ? Math.round((pctSum / pctN) * 10) / 10 : null,
    absent: results.filter((r) => r.isAbsent).length,
    bands: a.model.bands.map((b) => ({ id: b.id, label: b.label, tier: b.tier, color: b.color, count: bandCounts.get(b.id) ?? 0 })),
    competencies: compStats,
  };
  let rows = null;
  if (s.learnerLevel) {
    const byLearner = new Map(results.map((r) => [r.learnerId, r]));
    rows = (await roster(a)).map(({ learner, enrolled }) => ({
      learner: { id: learner.id, lrn: learner.lrn, name: learnerName(learner), sex: learner.sex },
      enrolled,
      result: byLearner.get(learner.id) ?? null,
    }));
  }
  const canEncode = sectionInScope(s, { id: a.sectionId, schoolId: a.schoolId }) && ['TEACHER', 'MASTER_TEACHER', 'ASSESSMENT_COORDINATOR'].includes(req.user!.role);
  res.json({ ...a, summary, rows, canEncode, canVerify: ['MASTER_TEACHER', 'ASSESSMENT_COORDINATOR', 'PRINCIPAL'].includes(req.user!.role) && a.createdById !== req.user!.id });
}));

const entrySchema = z.object({
  learnerId: z.number().int(),
  rawScore: z.number().nullable().optional(),
  descriptor: z.string().trim().nullable().optional(),
  isAbsent: z.boolean().optional(),
  remarks: z.string().trim().max(300).nullable().optional(),
  competencies: z.array(z.object({ competencyId: z.number().int(), itemsCorrect: z.number().nullable() })).optional(),
});

/** Save (upsert) results from the encoding grid. Validates everything before writing anything. */
assessmentsRouter.put('/:id/results', requirePermission('assessment:write'), ah(async (req, res) => {
  const s = req.scope!;
  const a = await loadAssessment(s, idParam(req));
  assertCanEncode(req, a);
  assertEditable(a);
  const { entries } = z.object({ entries: z.array(entrySchema).max(500) }).parse(req.body);
  const r = await roster(a);
  const allowed = new Set(r.map((x) => x.learner.id));
  const errors = entries.flatMap((e) => (allowed.has(e.learnerId) ? validateEntry(a, e) : [{ learnerId: e.learnerId, field: 'learnerId', message: 'Learner is not enrolled in this class' }]));
  const ids = entries.map((e) => e.learnerId);
  if (new Set(ids).size !== ids.length) errors.push({ message: 'The same learner appears twice', field: 'learnerId' } as never);
  if (errors.length) throw badRequest('Some results are invalid. Nothing was saved.', errors);
  const changes = await prisma.$transaction((tx) => applyEntries(tx, a, entries, req.user!.id), { timeout: 60000 });
  for (const c of changes) await audit(req, c.before ? 'UPDATE' : 'CREATE', 'AssessmentResult', c.resultId, c.before, { ...c.after, assessmentId: a.id, learnerId: c.learnerId });
  res.json({ saved: entries.length, changed: changes.length });
}));

/** Pre-filled template with the class roster. */
assessmentsRouter.get('/:id/template', requirePermission('assessment:write'), ah(async (req, res) => {
  const s = req.scope!;
  const a = await loadAssessment(s, idParam(req));
  assertCanEncode(req, a);
  const r = await roster(a);
  const compCols = a.competencies.map((c) => `comp:${c.competency.code}`);
  const scoreCol = a.assessmentType.resultMode === 'PERCENTAGE' ? ['score'] : ['descriptor', 'score'];
  const header = ['lrn', 'last_name', 'first_name', ...scoreCol, ...compCols, 'absent', 'remarks'];
  const rows = r.filter((x) => x.enrolled).map((x) => [x.learner.lrn, x.learner.lastName, x.learner.firstName, ...scoreCol.map(() => ''), ...compCols.map(() => ''), '', '']);
  const fname = `equaart-template-${a.id}`;
  if (req.query.format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Results');
    ws.addRow(header);
    rows.forEach((row) => ws.addRow(row));
    ws.getColumn(1).numFmt = '@';
    ws.getRow(1).font = { bold: true };
    if (a.assessmentType.resultMode === 'PROFILE') {
      const notes = wb.addWorksheet('Valid levels');
      notes.addRow(['descriptor', 'meaning']);
      a.model.bands.forEach((b) => notes.addRow([b.descriptorKey, b.label]));
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
    return res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}.csv"`);
  res.send(stringify([header, ...rows]));
}));

assessmentsRouter.post('/:id/results/import', requirePermission('assessment:write'), upload.single('file'), ah(async (req, res) => {
  const s = req.scope!;
  const a = await loadAssessment(s, idParam(req));
  assertCanEncode(req, a);
  assertEditable(a);
  if (!req.file) throw badRequest('Attach a CSV or XLSX file');
  const dryRun = req.body.dryRun === 'true' || req.body.dryRun === true;
  const rows = await parseTabular(req.file);
  if (!rows.length) throw badRequest('The file has no data rows');
  const r = await roster(a);
  const existing = await prisma.assessmentResult.findMany({ where: { assessmentId: a.id }, select: { learnerId: true } });
  const parsed = parseResultRows(rows, {
    assessment: a,
    rosterByLrn: new Map(r.map((x) => [x.learner.lrn, { learnerId: x.learner.id, enrolled: x.enrolled }])),
    existingLearnerIds: new Set(existing.map((x) => x.learnerId)),
  });
  const summary = { rows: rows.length, valid: parsed.entries.length, errorCount: parsed.errors.length, warningCount: parsed.warnings.length };
  if (parsed.errors.length || dryRun) {
    return res.status(parsed.errors.length && !dryRun ? 422 : 200).json({ committed: false, summary, errors: parsed.errors, warnings: parsed.warnings });
  }
  const changes = await prisma.$transaction((tx) => applyEntries(tx, a, parsed.entries, req.user!.id), { timeout: 60000 });
  for (const c of changes) await audit(req, c.before ? 'UPDATE' : 'CREATE', 'AssessmentResult', c.resultId, c.before, { ...c.after, assessmentId: a.id, learnerId: c.learnerId, source: 'import' });
  await audit(req, 'IMPORT', 'Assessment', a.id, null, { file: req.file.originalname, ...summary, changed: changes.length });
  res.json({ committed: true, summary: { ...summary, changed: changes.length }, errors: [], warnings: parsed.warnings });
}));

// ───────────── Quality assurance ─────────────
export interface QaCheck {
  key: string;
  label: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  blocking: boolean;
  count: number;
  details: string[];
}

async function runQa(a: FullAssessment & { windowClose: Date | null }): Promise<QaCheck[]> {
  const [r, results, dup] = await Promise.all([
    roster(a),
    prisma.assessmentResult.findMany({ where: { assessmentId: a.id }, include: { learner: true, competencyResults: true } }),
    prisma.assessment.findFirst({ where: { id: { not: a.id }, assessmentTypeId: a.assessmentTypeId, termId: a.termId, sectionId: a.sectionId, learningAreaId: a.learningAreaId, deletedAt: null } }),
  ]);
  const byLearner = new Map(results.map((x) => [x.learnerId, x]));
  const enrolled = r.filter((x) => x.enrolled);
  const missing = enrolled.filter((x) => !byLearner.has(x.learner.id));
  const invalid = results.filter((x) => !x.isAbsent && validateEntry(a, {
    learnerId: x.learnerId, rawScore: x.rawScore, descriptor: x.profileDescriptor,
    competencies: x.competencyResults.map((c) => ({ competencyId: c.competencyId, itemsCorrect: c.itemsCorrect })),
  }).length > 0);
  const unclassified = results.filter((x) => !x.isAbsent && !x.tier);
  const notEnrolled = r.filter((x) => !x.enrolled && byLearner.has(x.learner.id));
  const incompleteComp = a.competencies.length ? results.filter((x) => !x.isAbsent && x.competencyResults.length < a.competencies.length) : [];
  const absent = results.filter((x) => x.isAbsent);
  const inactive = r.filter((x) => byLearner.has(x.learner.id) && x.learner.status !== 'ACTIVE');
  const nm = (l: { lastName: string; firstName: string }) => `${l.lastName}, ${l.firstName}`;
  const check = (key: string, label: string, items: string[], blocking: boolean, warnOnly = false): QaCheck => ({
    key, label, count: items.length, details: items.slice(0, 50), blocking: blocking && items.length > 0,
    status: items.length === 0 ? 'PASS' : warnOnly ? 'WARN' : 'FAIL',
  });
  return [
    check('completeness', 'Every enrolled learner has a result or is marked absent', missing.map((x) => nm(x.learner)), true),
    check('valid_scores', 'Scores are within range and levels are valid', invalid.map((x) => nm(x.learner)), true),
    check('classified', 'Every result maps to a configured performance level', unclassified.map((x) => nm(x.learner)), true),
    check('duplicate_assessment', 'No duplicate assessment for this class, term and learning area', dup ? [dup.title] : [], true),
    check('competency_breakdown', 'Competency items encoded for every learner', incompleteComp.map((x) => nm(x.learner)), false, true),
    check('enrolment', 'Results only for learners currently enrolled', notEnrolled.map((x) => nm(x.learner)), false, true),
    check('learner_status', 'Learners on the result list are active', inactive.map((x) => nm(x.learner)), false, true),
    check('absences', 'Learners marked absent (follow up for make-up assessment)', absent.map((x) => nm(x.learner)), false, true),
    check('window', 'Encoded within the assessment window', a.windowClose && a.windowClose < new Date() && a.status !== 'VERIFIED' ? ['Encoding window has closed'] : [], false, true),
  ];
}

assessmentsRouter.get('/:id/qa', requirePermission('assessment:read'), ah(async (req, res) => {
  const a = await loadAssessment(req.scope!, idParam(req));
  const checks = await runQa(a);
  res.json({ checks, blocking: checks.some((c) => c.blocking), passed: checks.filter((c) => c.status === 'PASS').length, total: checks.length });
}));

// ───────────── Workflow ─────────────
assessmentsRouter.post('/:id/submit', requirePermission('assessment:write'), ah(async (req, res) => {
  const a = await loadAssessment(req.scope!, idParam(req));
  assertCanEncode(req, a);
  assertEditable(a);
  const checks = await runQa(a);
  if (checks.some((c) => c.blocking)) {
    throw new AppError(422, 'QA_FAILED', 'Quality checks must pass before submission', checks.filter((c) => c.blocking));
  }
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.assessment.update({ where: { id: a.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), submittedById: req.user!.id, returnReason: null } });
    const gaps = await syncLearningGaps(tx, a.id);
    return { ...u, gaps };
  });
  await audit(req, 'SUBMIT', 'Assessment', a.id, { status: a.status }, { status: 'SUBMITTED', gaps: updated.gaps });
  res.json(updated);
}));

assessmentsRouter.post('/:id/verify', requirePermission('assessment:verify'), ah(async (req, res) => {
  const a = await loadAssessment(req.scope!, idParam(req));
  if (a.status !== 'SUBMITTED') throw conflict('Only submitted assessments can be verified');
  if (a.createdById === req.user!.id) throw forbidden('Results must be verified by someone other than the encoder');
  const u = await prisma.$transaction(async (tx) => {
    const x = await tx.assessment.update({ where: { id: a.id }, data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedById: req.user!.id } });
    await syncLearningGaps(tx, a.id);
    return x;
  });
  await audit(req, 'VERIFY', 'Assessment', a.id, { status: a.status }, { status: 'VERIFIED' });
  res.json(u);
}));

const reasonBody = z.object({ reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500) });

assessmentsRouter.post('/:id/return', requirePermission('assessment:verify'), ah(async (req, res) => {
  const a = await loadAssessment(req.scope!, idParam(req));
  if (a.status !== 'SUBMITTED') throw conflict('Only submitted assessments can be returned');
  const { reason } = reasonBody.parse(req.body);
  const u = await prisma.$transaction(async (tx) => {
    const x = await tx.assessment.update({ where: { id: a.id }, data: { status: 'RETURNED', returnReason: reason } });
    await syncLearningGaps(tx, a.id);
    return x;
  });
  await audit(req, 'RETURN', 'Assessment', a.id, { status: a.status }, { status: 'RETURNED', reason });
  res.json(u);
}));

/** Re-open a verified assessment for correction (an "edit request"); fully audit-logged. */
assessmentsRouter.post('/:id/reopen', requirePermission('assessment:verify'), ah(async (req, res) => {
  const a = await loadAssessment(req.scope!, idParam(req));
  if (a.status !== 'VERIFIED') throw conflict('Only verified assessments can be reopened');
  const { reason } = reasonBody.parse(req.body);
  const u = await prisma.assessment.update({ where: { id: a.id }, data: { status: 'RETURNED', returnReason: `Reopened: ${reason}`, verifiedAt: null, verifiedById: null } });
  await audit(req, 'REOPEN', 'Assessment', a.id, { status: a.status }, { status: 'RETURNED', reason });
  res.json(u);
}));

/** Change history for an assessment and its results (from the audit trail). */
assessmentsRouter.get('/:id/history', requirePermission('assessment:read'), ah(async (req, res) => {
  const s = req.scope!;
  const a = await loadAssessment(s, idParam(req));
  const resultIds = (await prisma.assessmentResult.findMany({ where: { assessmentId: a.id }, select: { id: true } })).map((r) => String(r.id));
  const logs = await prisma.auditLog.findMany({
    where: { OR: [{ entity: 'Assessment', entityId: String(a.id) }, { entity: 'AssessmentResult', entityId: { in: resultIds } }] },
    orderBy: { at: 'desc' },
    take: 300,
  });
  if (!s.learnerLevel) {
    return res.json(logs.filter((l) => l.entity === 'Assessment').map(({ beforeJson: _b, afterJson: _a, ip: _i, userAgent: _u, ...l }) => l));
  }
  res.json(logs.map(({ ip: _i, userAgent: _u, ...l }) => l));
}));
