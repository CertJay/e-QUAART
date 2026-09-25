import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { ah, idParam, nullableDate } from '../lib/http.js';
import { classify, validateBands } from '../domain/classification.js';
import { syncLearningGaps } from './gaps.service.js';

export const referenceRouter = Router();
const canWrite = requirePermission('reference:write');

/** Everything the client needs for dropdowns, filtered to the caller's scope where it matters. */
referenceRouter.get(
  '/bootstrap',
  ah(async (req, res) => {
    const s = req.scope!;
    const [divisions, districts, schools, schoolYears, keyStages, gradeLevels, learningAreas, assessmentTypes] = await Promise.all([
      prisma.division.findMany({ orderBy: { name: 'asc' } }),
      prisma.district.findMany({ orderBy: { name: 'asc' } }),
      prisma.school.findMany({
        where: s.schoolIds === null ? {} : { id: { in: s.schoolIds } },
        orderBy: { name: 'asc' },
      }),
      prisma.schoolYear.findMany({ orderBy: { startDate: 'desc' }, include: { terms: { orderBy: { sortOrder: 'asc' } } } }),
      prisma.keyStage.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.gradeLevel.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.learningArea.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.assessmentType.findMany({
        orderBy: { name: 'asc' },
        include: { models: { where: { isActive: true }, include: { bands: { orderBy: { sortOrder: 'asc' } } } } },
      }),
    ]);
    const scopedDistricts = s.schoolIds === null ? districts : districts.filter((d) => schools.some((sc) => sc.districtId === d.id));
    res.json({
      divisions,
      districts: scopedDistricts,
      schools,
      schoolYears,
      keyStages,
      gradeLevels,
      learningAreas: learningAreas.map((la) => ({ ...la, inScope: s.learningAreaIds === null || s.learningAreaIds.includes(la.id) })),
      assessmentTypes,
    });
  }),
);

// ───────────── Districts & schools ─────────────
const districtSchema = z.object({ name: z.string().trim().min(2), divisionId: z.number().int() });
referenceRouter.post('/districts', canWrite, ah(async (req, res) => {
  const d = await prisma.district.create({ data: districtSchema.parse(req.body) });
  await audit(req, 'CREATE', 'District', d.id, null, d);
  res.status(201).json(d);
}));
referenceRouter.put('/districts/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req);
  const before = await prisma.district.findUniqueOrThrow({ where: { id } });
  const d = await prisma.district.update({ where: { id }, data: districtSchema.partial().parse(req.body) });
  await audit(req, 'UPDATE', 'District', id, before, d);
  res.json(d);
}));

const schoolSchema = z.object({
  name: z.string().trim().min(2),
  schoolIdDeped: z.string().trim().regex(/^\d{6}$/, 'DepEd School ID must be 6 digits'),
  districtId: z.number().int(),
  address: z.string().trim().optional().nullable(),
  schoolType: z.enum(['ELEMENTARY', 'SECONDARY', 'INTEGRATED']).optional().nullable(),
  isActive: z.boolean().optional(),
});
referenceRouter.get('/schools', ah(async (req, res) => {
  const s = req.scope!;
  res.json(await prisma.school.findMany({
    where: s.schoolIds === null ? {} : { id: { in: s.schoolIds } },
    include: { district: true },
    orderBy: { name: 'asc' },
  }));
}));
referenceRouter.post('/schools', canWrite, ah(async (req, res) => {
  const d = await prisma.school.create({ data: schoolSchema.parse(req.body) });
  await audit(req, 'CREATE', 'School', d.id, null, d);
  res.status(201).json(d);
}));
referenceRouter.put('/schools/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req);
  const before = await prisma.school.findUniqueOrThrow({ where: { id } });
  const d = await prisma.school.update({ where: { id }, data: schoolSchema.partial().parse(req.body) });
  await audit(req, 'UPDATE', 'School', id, before, d);
  res.json(d);
}));

// ───────────── School years & terms ─────────────
const syBody = z.object({
  label: z.string().regex(/^\d{4}-\d{4}$/, 'Use the format 2025-2026'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isCurrent: z.boolean().optional(),
  terms: z.array(z.object({ code: z.string().min(1).max(10), name: z.string().min(1), sortOrder: z.number().int() })).optional(),
});
referenceRouter.post('/school-years', canWrite, ah(async (req, res) => {
  const b = syBody.parse(req.body);
  const sy = await prisma.$transaction(async (tx) => {
    if (b.isCurrent) await tx.schoolYear.updateMany({ data: { isCurrent: false } });
    return tx.schoolYear.create({
      data: { label: b.label, startDate: b.startDate, endDate: b.endDate, isCurrent: b.isCurrent ?? false, terms: { create: b.terms ?? [] } },
      include: { terms: true },
    });
  });
  await audit(req, 'CREATE', 'SchoolYear', sy.id, null, sy);
  res.status(201).json(sy);
}));
referenceRouter.put('/school-years/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req);
  const b = syBody.partial().parse(req.body);
  const before = await prisma.schoolYear.findUniqueOrThrow({ where: { id } });
  const sy = await prisma.$transaction(async (tx) => {
    if (b.isCurrent) await tx.schoolYear.updateMany({ where: { id: { not: id } }, data: { isCurrent: false } });
    return tx.schoolYear.update({ where: { id }, data: { label: b.label, startDate: b.startDate, endDate: b.endDate, isCurrent: b.isCurrent } });
  });
  await audit(req, 'UPDATE', 'SchoolYear', id, before, sy);
  res.json(sy);
}));
const termBody = z.object({ code: z.string().min(1).max(10), name: z.string().min(1), sortOrder: z.number().int(), startDate: nullableDate, endDate: nullableDate });
referenceRouter.post('/school-years/:id/terms', canWrite, ah(async (req, res) => {
  const t = await prisma.term.create({ data: { ...termBody.parse(req.body), schoolYearId: idParam(req) } });
  await audit(req, 'CREATE', 'Term', t.id, null, t);
  res.status(201).json(t);
}));
referenceRouter.put('/terms/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req);
  const before = await prisma.term.findUniqueOrThrow({ where: { id } });
  const t = await prisma.term.update({ where: { id }, data: termBody.partial().parse(req.body) });
  await audit(req, 'UPDATE', 'Term', id, before, t);
  res.json(t);
}));

// ───────────── Key stages, grade levels, learning areas ─────────────
const ksBody = z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1), sortOrder: z.number().int() });
referenceRouter.post('/key-stages', canWrite, ah(async (req, res) => {
  const k = await prisma.keyStage.create({ data: ksBody.parse(req.body) });
  await audit(req, 'CREATE', 'KeyStage', k.id, null, k);
  res.status(201).json(k);
}));
referenceRouter.put('/key-stages/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req);
  const before = await prisma.keyStage.findUniqueOrThrow({ where: { id } });
  const k = await prisma.keyStage.update({ where: { id }, data: ksBody.partial().parse(req.body) });
  await audit(req, 'UPDATE', 'KeyStage', id, before, k);
  res.json(k);
}));

const glBody = z.object({ code: z.string().trim().min(1), name: z.string().trim().min(1), sortOrder: z.number().int(), keyStageId: z.number().int(), isActive: z.boolean().optional() });
referenceRouter.post('/grade-levels', canWrite, ah(async (req, res) => {
  const g = await prisma.gradeLevel.create({ data: glBody.parse(req.body) });
  await audit(req, 'CREATE', 'GradeLevel', g.id, null, g);
  res.status(201).json(g);
}));
referenceRouter.put('/grade-levels/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req);
  const before = await prisma.gradeLevel.findUniqueOrThrow({ where: { id } });
  const g = await prisma.gradeLevel.update({ where: { id }, data: glBody.partial().parse(req.body) });
  await audit(req, 'UPDATE', 'GradeLevel', id, before, g);
  res.json(g);
}));

const laBody = z.object({ code: z.string().trim().min(1).max(12).toUpperCase(), name: z.string().trim().min(1), sortOrder: z.number().int().optional(), isActive: z.boolean().optional() });
referenceRouter.post('/learning-areas', canWrite, ah(async (req, res) => {
  const l = await prisma.learningArea.create({ data: laBody.parse(req.body) });
  await audit(req, 'CREATE', 'LearningArea', l.id, null, l);
  res.status(201).json(l);
}));
referenceRouter.put('/learning-areas/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req);
  const before = await prisma.learningArea.findUniqueOrThrow({ where: { id } });
  const l = await prisma.learningArea.update({ where: { id }, data: laBody.partial().parse(req.body) });
  await audit(req, 'UPDATE', 'LearningArea', id, before, l);
  res.json(l);
}));

// ───────────── Competencies ─────────────
referenceRouter.get('/competencies', ah(async (req, res) => {
  const q = z.object({ learningAreaId: z.coerce.number().int().optional(), gradeLevelId: z.coerce.number().int().optional(), search: z.string().optional() }).parse(req.query);
  res.json(await prisma.competency.findMany({
    where: {
      learningAreaId: q.learningAreaId,
      gradeLevelId: q.gradeLevelId,
      ...(q.search ? { OR: [{ code: { contains: q.search } }, { description: { contains: q.search } }] } : {}),
    },
    include: { learningArea: { select: { code: true, name: true } }, gradeLevel: { select: { code: true, name: true } } },
    orderBy: [{ learningAreaId: 'asc' }, { gradeLevelId: 'asc' }, { code: 'asc' }],
    take: 500,
  }));
}));
const compBody = z.object({
  learningAreaId: z.number().int(),
  gradeLevelId: z.number().int(),
  code: z.string().trim().min(1).max(40),
  description: z.string().trim().min(3),
  curriculum: z.enum(['MELC', 'MATATAG', 'OTHER']).optional(),
  isActive: z.boolean().optional(),
});
referenceRouter.post('/competencies', canWrite, ah(async (req, res) => {
  const c = await prisma.competency.create({ data: compBody.parse(req.body) });
  await audit(req, 'CREATE', 'Competency', c.id, null, c);
  res.status(201).json(c);
}));
referenceRouter.put('/competencies/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req);
  const before = await prisma.competency.findUniqueOrThrow({ where: { id } });
  const c = await prisma.competency.update({ where: { id }, data: compBody.partial().parse(req.body) });
  await audit(req, 'UPDATE', 'Competency', id, before, c);
  res.json(c);
}));

// ───────────── Assessment types & classification models ─────────────
const typeBody = z.object({
  code: z.string().trim().min(2).max(20).toUpperCase().regex(/^[A-Z0-9_]+$/, 'Use letters, digits and underscores'),
  name: z.string().trim().min(2),
  description: z.string().trim().optional().nullable(),
  resultMode: z.enum(['PERCENTAGE', 'PROFILE']),
  isActive: z.boolean().optional(),
});
referenceRouter.get('/assessment-types', ah(async (_req, res) => {
  res.json(await prisma.assessmentType.findMany({
    orderBy: { name: 'asc' },
    include: { models: { include: { bands: { orderBy: { sortOrder: 'asc' } }, _count: { select: { assessments: true } } }, orderBy: { createdAt: 'desc' } } },
  }));
}));
referenceRouter.post('/assessment-types', canWrite, ah(async (req, res) => {
  const t = await prisma.assessmentType.create({ data: typeBody.parse(req.body) });
  await audit(req, 'CREATE', 'AssessmentType', t.id, null, t);
  res.status(201).json(t);
}));
referenceRouter.put('/assessment-types/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req);
  const before = await prisma.assessmentType.findUniqueOrThrow({ where: { id }, include: { _count: { select: { assessments: true } } } });
  const b = typeBody.partial().parse(req.body);
  if (b.resultMode && b.resultMode !== before.resultMode && before._count.assessments > 0) {
    throw conflict('Result mode cannot change once assessments of this type exist');
  }
  const t = await prisma.assessmentType.update({ where: { id }, data: b });
  await audit(req, 'UPDATE', 'AssessmentType', id, before, t);
  res.json(t);
}));

const bandBody = z.object({
  id: z.number().int().optional(),
  label: z.string().trim().min(1),
  tier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']),
  minPct: z.number().min(0).max(100).nullable().optional(),
  maxPct: z.number().min(0).max(100).nullable().optional(),
  descriptorKey: z.string().trim().nullable().optional(),
  description: z.string().trim().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sortOrder: z.number().int(),
});
const modelBody = z.object({
  assessmentTypeId: z.number().int(),
  name: z.string().trim().min(2),
  version: z.string().trim().min(1).optional(),
  effectiveSchoolYearId: z.number().int().nullable().optional(),
  masteryThreshold: z.number().min(0.05).max(1).optional(),
  isActive: z.boolean().optional(),
  isProvisional: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  bands: z.array(bandBody).min(1),
});

referenceRouter.post('/classification-models', canWrite, ah(async (req, res) => {
  const b = modelBody.parse(req.body);
  const type = await prisma.assessmentType.findUniqueOrThrow({ where: { id: b.assessmentTypeId } });
  const problems = validateBands(type.resultMode, b.bands.map(normBand));
  if (problems.length) throw badRequest('Performance levels are not valid', problems);
  const { bands, ...rest } = b;
  const m = await prisma.classificationModel.create({
    data: { ...rest, bands: { create: bands.map(({ id: _id, ...x }) => normBand(x)) } },
    include: { bands: true },
  });
  await audit(req, 'CREATE', 'ClassificationModel', m.id, null, m);
  res.status(201).json(m);
}));

/**
 * Update a model and its performance levels. Existing results that use the model are
 * re-classified so dashboards reflect the new configuration; the change is audit-logged.
 */
referenceRouter.put('/classification-models/:id', canWrite, ah(async (req, res) => {
  const id = idParam(req);
  const b = modelBody.omit({ assessmentTypeId: true }).parse(req.body);
  const before = await prisma.classificationModel.findUnique({ where: { id }, include: { bands: true, assessmentType: true } });
  if (!before) throw notFound('Classification model');
  const problems = validateBands(before.assessmentType.resultMode, b.bands.map(normBand));
  if (problems.length) throw badRequest('Performance levels are not valid', problems);

  const keepIds = b.bands.filter((x) => x.id).map((x) => x.id!);
  const removed = before.bands.filter((x) => !keepIds.includes(x.id));
  const reclassified = await prisma.$transaction(async (tx) => {
    const { bands, ...rest } = b;
    await tx.classificationModel.update({ where: { id }, data: rest });
    for (const rb of removed) {
      await tx.assessmentResult.updateMany({ where: { bandId: rb.id }, data: { bandId: null } });
      await tx.reassessment.updateMany({ where: { bandId: rb.id }, data: { bandId: null } });
      await tx.classificationBand.delete({ where: { id: rb.id } });
    }
    for (const band of bands) {
      const data = normBand(band);
      if (band.id && before.bands.some((x) => x.id === band.id)) await tx.classificationBand.update({ where: { id: band.id }, data });
      else await tx.classificationBand.create({ data: { ...data, modelId: id } });
    }
    return reclassifyModel(tx, id);
  }, { timeout: 60000 });
  const after = await prisma.classificationModel.findUniqueOrThrow({ where: { id }, include: { bands: { orderBy: { sortOrder: 'asc' } } } });
  await audit(req, 'UPDATE', 'ClassificationModel', id, before, { ...after, reclassifiedResults: reclassified });
  res.json({ ...after, reclassifiedResults: reclassified });
}));

function normBand(b: z.infer<typeof bandBody>) {
  return {
    label: b.label,
    tier: b.tier,
    minPct: b.minPct ?? null,
    maxPct: b.maxPct ?? null,
    descriptorKey: b.descriptorKey || null,
    description: b.description ?? null,
    color: b.color ?? '#64748b',
    sortOrder: b.sortOrder,
  };
}

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function reclassifyModel(tx: TxClient, modelId: number) {
  const model = await tx.classificationModel.findUniqueOrThrow({ where: { id: modelId }, include: { bands: true, assessmentType: true } });
  const assessments = await tx.assessment.findMany({ where: { modelId }, include: { results: { include: { competencyResults: true } } } });
  let n = 0;
  for (const a of assessments) {
    for (const r of a.results) {
      if (r.isAbsent) continue;
      const c = classify({ mode: model.assessmentType.resultMode, rawScore: r.rawScore, maxScore: a.maxScore, descriptor: r.profileDescriptor }, model.bands);
      if (c.band?.id !== r.bandId || c.tier !== r.tier) {
        await tx.assessmentResult.update({ where: { id: r.id }, data: { bandId: c.band?.id ?? null, tier: c.tier, percentage: c.percentage } });
        n++;
      }
      for (const cr of r.competencyResults) {
        const mastered = cr.itemsTotal > 0 && cr.itemsCorrect / cr.itemsTotal >= model.masteryThreshold;
        if (mastered !== cr.mastered) await tx.competencyResult.update({ where: { id: cr.id }, data: { mastered } });
      }
    }
    if (a.status === 'SUBMITTED' || a.status === 'VERIFIED') await syncLearningGaps(tx, a.id);
  }
  return n;
}
