import { Router, type Request } from 'express';
import { z } from 'zod';
import type { ClassificationBand, Prisma, Tier } from '@prisma/client';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ah, idParam, nullableDate, paged, paginationSchema } from '../lib/http.js';
import { classify, competencyTier, computePercentage } from '../domain/classification.js';
import { computeEffectiveness } from '../domain/effectiveness.js';
import { learnerName } from '../domain/lrn.js';
import { interventionWhere, learnerWhere, learningAreaInScope, schoolInScope, sectionInScope, type DataScope } from '../rbac/scope.js';

export const interventionsRouter = Router();

const TIER_TYPE: Record<Tier, 'ENRICHMENT' | 'TARGETED' | 'INTENSIVE'> = { TIER_1: 'ENRICHMENT', TIER_2: 'TARGETED', TIER_3: 'INTENSIVE' };

async function loadIntervention(s: DataScope, id: number) {
  const i = await prisma.intervention.findFirst({
    where: { id, ...interventionWhere(s) },
    include: {
      school: { select: { id: true, name: true } },
      section: { include: { gradeLevel: true } },
      learningArea: true,
      owner: { select: { id: true, fullName: true } },
      competencies: { include: { competency: true } },
      sourceAssessment: { select: { id: true, title: true } },
    },
  });
  if (!i) throw notFound('Intervention');
  return i;
}

function assertCanManage(s: DataScope, i: { schoolId: number; sectionId: number | null; ownerId: number }, userId: number) {
  if (!schoolInScope(s, i.schoolId)) throw forbidden();
  if (s.level === 'SECTION' && i.ownerId !== userId && !(i.sectionId && s.sectionIds?.includes(i.sectionId))) {
    throw forbidden('Only the intervention owner or the class teacher can change this intervention');
  }
}

// ───────────── Baseline (pre-intervention) values ─────────────
interface Baseline {
  prePercentage: number | null;
  preTier: Tier | null;
  preBandId: number | null;
  entryReason: string;
  learningGapId: number | null;
}

async function baselineFor(learnerId: number, learningAreaId: number, schoolYearId: number, gapId?: number | null): Promise<Baseline> {
  if (gapId) {
    const g = await prisma.learningGap.findUnique({ where: { id: gapId }, include: { competency: true, assessmentResult: { include: { band: true, assessment: { include: { assessmentType: true, term: true } } } } } });
    if (!g || g.learnerId !== learnerId) throw badRequest('Learning gap does not belong to this learner');
    const a = g.assessmentResult.assessment;
    if (g.competencyId) {
      return { prePercentage: g.masteryPct, preTier: g.severity, preBandId: null, learningGapId: g.id, entryReason: `Not mastered: ${g.competency!.code} (${g.masteryPct ?? '–'}% in ${a.assessmentType.name}, ${a.term.name})` };
    }
    return { prePercentage: g.assessmentResult.percentage, preTier: g.assessmentResult.tier, preBandId: g.assessmentResult.bandId, learningGapId: g.id, entryReason: `${a.assessmentType.name} ${a.term.name}: ${g.assessmentResult.band?.label ?? g.severity}` };
  }
  const latest = await prisma.assessmentResult.findFirst({
    where: { learnerId, isAbsent: false, tier: { not: null }, assessment: { learningAreaId, schoolYearId, deletedAt: null, status: { in: ['SUBMITTED', 'VERIFIED'] } } },
    include: { band: true, assessment: { include: { assessmentType: true, term: true } } },
    orderBy: { assessment: { term: { sortOrder: 'desc' } } },
  });
  if (!latest) return { prePercentage: null, preTier: null, preBandId: null, learningGapId: null, entryReason: 'Referred by teacher' };
  return { prePercentage: latest.percentage, preTier: latest.tier, preBandId: latest.bandId, learningGapId: null, entryReason: `${latest.assessment.assessmentType.name} ${latest.assessment.term.name}: ${latest.band?.label ?? latest.tier}` };
}

const learnerRef = z.object({ learnerId: z.number().int(), learningGapId: z.number().int().nullable().optional() });

async function addLearners(req: Request, interventionId: number, i: { learningAreaId: number; schoolYearId: number }, refs: z.infer<typeof learnerRef>[]) {
  const s = req.scope!;
  const visible = await prisma.learner.findMany({ where: { id: { in: refs.map((r) => r.learnerId) }, ...learnerWhere(s) }, select: { id: true } });
  if (visible.length !== new Set(refs.map((r) => r.learnerId)).size) throw forbidden('One or more learners are outside your classes');
  const existing = new Set((await prisma.interventionLearner.findMany({ where: { interventionId }, select: { learnerId: true } })).map((x) => x.learnerId));
  let added = 0;
  for (const r of refs) {
    if (existing.has(r.learnerId)) continue;
    const b = await baselineFor(r.learnerId, i.learningAreaId, i.schoolYearId, r.learningGapId);
    const il = await prisma.interventionLearner.create({ data: { interventionId, learnerId: r.learnerId, ...b } });
    if (b.learningGapId) await prisma.learningGap.update({ where: { id: b.learningGapId }, data: { status: 'IN_INTERVENTION' } });
    existing.add(r.learnerId);
    added++;
    await audit(req, 'CREATE', 'InterventionLearner', il.id, null, il);
  }
  return added;
}

// ───────────── List / create / update ─────────────
interventionsRouter.get('/', requirePermission('intervention:read'), ah(async (req, res) => {
  const s = req.scope!;
  const { page, perPage } = paginationSchema.parse(req.query);
  const q = z.object({
    status: z.enum(['IDENTIFIED', 'PLANNED', 'ONGOING', 'COMPLETED', 'FOR_MONITORING', 'REASSESSMENT_REQUIRED']).optional(),
    schoolYearId: z.coerce.number().int().optional(),
    schoolId: z.coerce.number().int().optional(),
    sectionId: z.coerce.number().int().optional(),
    learningAreaId: z.coerce.number().int().optional(),
    tier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']).optional(),
    districtId: z.coerce.number().int().optional(),
  }).parse(req.query);
  const { districtId, ...rest } = q;
  const where: Prisma.InterventionWhereInput = { AND: [interventionWhere(s), rest, districtId ? { school: { districtId } } : {}] };
  const [total, rows] = await Promise.all([
    prisma.intervention.count({ where }),
    prisma.intervention.findMany({
      where,
      include: {
        school: { select: { name: true } },
        section: { select: { name: true, gradeLevel: { select: { name: true } } } },
        learningArea: { select: { name: true, code: true } },
        owner: { select: { fullName: true } },
        competencies: { include: { competency: { select: { code: true } } } },
        learners: { select: { prePercentage: true, preTier: true, decision: true, reassessments: { orderBy: { date: 'desc' }, take: 1, include: { band: true } } } },
        _count: { select: { sessions: true } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);
  res.json(paged(rows.map(({ learners, _count, ...i }) => {
    const reassessed = learners.filter((l) => l.reassessments.length);
    const improved = reassessed.filter((l) => computeEffectiveness({ percentage: l.prePercentage, tier: l.preTier }, { percentage: l.reassessments[0].percentage, tier: l.reassessments[0].tier, bandLabel: l.reassessments[0].band?.label })?.improved).length;
    return { ...i, learnerCount: learners.length, reassessedCount: reassessed.length, improvedCount: improved, sessionCount: _count.sessions };
  }), total, page, perPage));
}));

const interventionBody = z.object({
  title: z.string().trim().min(3).max(160),
  schoolId: z.number().int().optional(),
  sectionId: z.number().int().nullable().optional(),
  schoolYearId: z.number().int(),
  termId: z.number().int().nullable().optional(),
  learningAreaId: z.number().int(),
  sourceAssessmentId: z.number().int().nullable().optional(),
  tier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']),
  type: z.enum(['ENRICHMENT', 'TARGETED', 'INTENSIVE']).optional(),
  strategy: z.string().trim().min(3).max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  bannerProgram: z.string().trim().max(60).nullable().optional(),
  frequency: z.string().trim().max(100).nullable().optional(),
  startDate: nullableDate,
  targetEndDate: nullableDate,
  reassessmentDate: nullableDate,
  status: z.enum(['IDENTIFIED', 'PLANNED', 'ONGOING', 'COMPLETED', 'FOR_MONITORING', 'REASSESSMENT_REQUIRED']).optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
  competencyIds: z.array(z.number().int()).default([]),
  learners: z.array(learnerRef).default([]),
});

interventionsRouter.post('/', requirePermission('intervention:write'), ah(async (req, res) => {
  const s = req.scope!;
  const b = interventionBody.parse(req.body);
  let schoolId = b.schoolId;
  if (b.sectionId) {
    const sec = await prisma.section.findUnique({ where: { id: b.sectionId } });
    if (!sec || !sectionInScope(s, sec)) throw forbidden('Class is outside your scope');
    schoolId = sec.schoolId;
  }
  schoolId ??= s.schoolIds?.[0];
  if (!schoolId || !schoolInScope(s, schoolId)) throw forbidden('School is outside your scope');
  if (!learningAreaInScope(s, b.learningAreaId)) throw forbidden();
  if (b.targetEndDate && b.startDate && b.targetEndDate < b.startDate) throw badRequest('Target completion date is before the start date');
  const { learners, competencyIds, ...data } = b;
  const i = await prisma.intervention.create({
    data: {
      ...data,
      schoolId,
      type: b.type ?? TIER_TYPE[b.tier],
      status: b.status ?? 'PLANNED',
      ownerId: req.user!.id,
      createdById: req.user!.id,
      competencies: { create: competencyIds.map((competencyId) => ({ competencyId })) },
    },
  });
  await audit(req, 'CREATE', 'Intervention', i.id, null, i);
  const added = await addLearners(req, i.id, i, learners);
  res.status(201).json({ ...i, learnersAdded: added });
}));

interventionsRouter.put('/:id', requirePermission('intervention:write'), ah(async (req, res) => {
  const s = req.scope!;
  const before = await loadIntervention(s, idParam(req));
  assertCanManage(s, before, req.user!.id);
  const b = interventionBody.omit({ learners: true, schoolId: true, schoolYearId: true }).partial().parse(req.body);
  const { competencyIds, ...data } = b;
  const i = await prisma.$transaction(async (tx) => {
    if (competencyIds) {
      await tx.interventionCompetency.deleteMany({ where: { interventionId: before.id } });
      await tx.interventionCompetency.createMany({ data: competencyIds.map((competencyId) => ({ interventionId: before.id, competencyId })) });
    }
    return tx.intervention.update({ where: { id: before.id }, data });
  });
  await audit(req, 'UPDATE', 'Intervention', i.id, before, i);
  res.json(i);
}));

interventionsRouter.delete('/:id', requirePermission('intervention:write'), ah(async (req, res) => {
  const s = req.scope!;
  const before = await loadIntervention(s, idParam(req));
  assertCanManage(s, before, req.user!.id);
  await prisma.$transaction([
    prisma.intervention.update({ where: { id: before.id }, data: { deletedAt: new Date() } }),
    prisma.learningGap.updateMany({ where: { status: 'IN_INTERVENTION', interventionLinks: { some: { interventionId: before.id } } }, data: { status: 'OPEN' } }),
  ]);
  await audit(req, 'DELETE', 'Intervention', before.id, before, null);
  res.json({ ok: true });
}));

// ───────────── Detail ─────────────
interventionsRouter.get('/:id', requirePermission('intervention:read'), ah(async (req, res) => {
  const s = req.scope!;
  const i = await loadIntervention(s, idParam(req));
  const [learners, sessions] = await Promise.all([
    prisma.interventionLearner.findMany({
      where: { interventionId: i.id },
      include: { learner: true, reassessments: { include: { band: true }, orderBy: { date: 'asc' } }, learningGap: { include: { competency: true } } },
      orderBy: [{ learner: { lastName: 'asc' } }],
    }),
    prisma.interventionSession.findMany({ where: { interventionId: i.id }, include: { attendance: true }, orderBy: { date: 'asc' } }),
  ]);
  const preBands = await prisma.classificationBand.findMany({ where: { id: { in: learners.map((l) => l.preBandId).filter((x): x is number => !!x) } } });
  const preBandById = new Map(preBands.map((b) => [b.id, b]));
  const rows = learners.map((l, idx) => {
    const post = l.reassessments[l.reassessments.length - 1] ?? null;
    const preBand = l.preBandId ? preBandById.get(l.preBandId) : null;
    const attended = sessions.filter((x) => x.attendance.some((a) => a.learnerId === l.learnerId && a.present)).length;
    return {
      id: l.id,
      learner: s.learnerLevel ? { id: l.learner.id, lrn: l.learner.lrn, name: learnerName(l.learner) } : { id: null, lrn: null, name: `Learner ${idx + 1}` },
      entryReason: s.learnerLevel ? l.entryReason : null,
      gap: l.learningGap ? { id: l.learningGap.id, status: l.learningGap.status, competency: l.learningGap.competency } : null,
      pre: { percentage: l.prePercentage, tier: l.preTier, band: preBand?.label ?? null },
      reassessments: s.learnerLevel ? l.reassessments : [],
      post: post ? { percentage: post.percentage, tier: post.tier, band: post.band?.label ?? null, date: post.date } : null,
      effectiveness: computeEffectiveness({ percentage: l.prePercentage, tier: l.preTier, bandLabel: preBand?.label }, post ? { percentage: post.percentage, tier: post.tier, bandLabel: post.band?.label } : null),
      decision: l.decision,
      progressNote: s.learnerLevel ? l.progressNote : null,
      attendance: { attended, sessions: sessions.length, rate: sessions.length ? Math.round((attended / sessions.length) * 100) : null },
    };
  });
  res.json({
    ...i,
    learners: rows,
    sessions: s.learnerLevel ? sessions : sessions.map(({ attendance, ...x }) => ({ ...x, attendance: [], present: attendance.filter((a) => a.present).length, total: attendance.length })),
    canManage: s.learnerLevel && ['TEACHER', 'MASTER_TEACHER', 'ASSESSMENT_COORDINATOR'].includes(req.user!.role),
  });
}));

// ───────────── Learners in an intervention ─────────────
interventionsRouter.post('/:id/learners', requirePermission('intervention:write'), ah(async (req, res) => {
  const s = req.scope!;
  const i = await loadIntervention(s, idParam(req));
  assertCanManage(s, i, req.user!.id);
  const { learners } = z.object({ learners: z.array(learnerRef).min(1) }).parse(req.body);
  res.status(201).json({ added: await addLearners(req, i.id, i, learners) });
}));

async function loadMember(s: DataScope, userId: number, interventionId: number, ilId: number) {
  const i = await loadIntervention(s, interventionId);
  assertCanManage(s, i, userId);
  const il = await prisma.interventionLearner.findFirst({ where: { id: ilId, interventionId: i.id }, include: { learningGap: { include: { assessmentResult: { include: { assessment: { include: { model: { include: { bands: true, assessmentType: true } } } } } } } } } });
  if (!il) throw notFound('Learner in intervention');
  return { i, il };
}

interventionsRouter.delete('/:id/learners/:ilId', requirePermission('intervention:write'), ah(async (req, res) => {
  const { il } = await loadMember(req.scope!, req.user!.id, idParam(req), idParam(req, 'ilId'));
  await prisma.$transaction([
    prisma.interventionLearner.delete({ where: { id: il.id } }),
    ...(il.learningGapId ? [prisma.learningGap.update({ where: { id: il.learningGapId }, data: { status: 'OPEN' } })] : []),
  ]);
  await audit(req, 'DELETE', 'InterventionLearner', il.id, il, null);
  res.json({ ok: true });
}));

interventionsRouter.put('/:id/learners/:ilId', requirePermission('intervention:write'), ah(async (req, res) => {
  const { il } = await loadMember(req.scope!, req.user!.id, idParam(req), idParam(req, 'ilId'));
  const b = z.object({
    progressNote: z.string().trim().max(2000).nullable().optional(),
    decision: z.enum(['CONTINUE', 'MODIFY', 'COMPLETE', 'REPEAT', 'REFER']).nullable().optional(),
  }).parse(req.body);
  const u = await prisma.interventionLearner.update({ where: { id: il.id }, data: { ...b, decidedAt: b.decision ? new Date() : undefined } });
  await audit(req, 'UPDATE', 'InterventionLearner', il.id, il, u);
  res.json(u);
}));

/**
 * Record a reassessment. Competency-level gaps are re-scored against the mastery threshold;
 * other gaps are classified with the same model that produced the original result, so the
 * pre/post comparison is like-for-like.
 */
interventionsRouter.post('/:id/learners/:ilId/reassessments', requirePermission('intervention:write'), ah(async (req, res) => {
  const { i, il } = await loadMember(req.scope!, req.user!.id, idParam(req), idParam(req, 'ilId'));
  const b = z.object({
    date: z.coerce.date(),
    rawScore: z.number().min(0).nullable().optional(),
    maxScore: z.number().positive().nullable().optional(),
    descriptor: z.string().trim().nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  }).parse(req.body);
  if (b.rawScore != null && b.maxScore != null && b.rawScore > b.maxScore) throw badRequest('Score exceeds the maximum score');

  const sourceModel =
    il.learningGap?.assessmentResult.assessment.model ??
    (i.sourceAssessment ? (await prisma.assessment.findUnique({ where: { id: i.sourceAssessment.id }, include: { model: { include: { bands: true, assessmentType: true } } } }))?.model : null) ??
    (await prisma.classificationModel.findFirst({ where: { isActive: true, assessmentType: { resultMode: 'PERCENTAGE' } }, include: { bands: true, assessmentType: true }, orderBy: { createdAt: 'asc' } }));
  if (!sourceModel) throw conflict('No classification model is configured');

  let percentage: number | null = null;
  let tier: Tier | null = null;
  let band: ClassificationBand | null = null;
  if (il.learningGap?.competencyId) {
    if (b.rawScore == null || !b.maxScore) throw badRequest('Enter the score and number of items for the competency reassessment');
    percentage = computePercentage(b.rawScore, b.maxScore);
    tier = competencyTier(percentage, sourceModel.masteryThreshold);
  } else {
    const mode = sourceModel.assessmentType.resultMode;
    if (mode === 'PROFILE' && !b.descriptor) throw badRequest(`Select the learner's ${sourceModel.assessmentType.name} level`);
    if (mode === 'PERCENTAGE' && (b.rawScore == null || !b.maxScore)) throw badRequest('Enter the score and maximum score');
    const c = classify({ mode, rawScore: b.rawScore, maxScore: b.maxScore, descriptor: b.descriptor }, sourceModel.bands);
    if (mode === 'PROFILE' && !c.band) throw badRequest('Unknown level for this instrument');
    percentage = c.percentage;
    tier = c.tier;
    band = c.band;
  }
  const r = await prisma.reassessment.create({
    data: {
      interventionLearnerId: il.id,
      date: b.date,
      rawScore: b.rawScore ?? null,
      maxScore: b.maxScore ?? null,
      percentage,
      profileDescriptor: band?.descriptorKey ?? null,
      bandId: band?.id ?? null,
      tier,
      notes: b.notes ?? null,
      recordedById: req.user!.id,
    },
    include: { band: true },
  });
  if (tier === 'TIER_1' && il.learningGapId) {
    await prisma.learningGap.update({ where: { id: il.learningGapId }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
  }
  await audit(req, 'CREATE', 'Reassessment', r.id, null, r);
  const effectiveness = computeEffectiveness({ percentage: il.prePercentage, tier: il.preTier }, { percentage, tier, bandLabel: band?.label });
  res.status(201).json({ reassessment: r, effectiveness });
}));

// ───────────── Sessions & attendance ─────────────
interventionsRouter.post('/:id/sessions', requirePermission('intervention:write'), ah(async (req, res) => {
  const s = req.scope!;
  const i = await loadIntervention(s, idParam(req));
  assertCanManage(s, i, req.user!.id);
  const b = z.object({
    date: z.coerce.date(),
    topic: z.string().trim().min(2).max(200),
    notes: z.string().trim().max(2000).nullable().optional(),
    attendance: z.array(z.object({ learnerId: z.number().int(), present: z.boolean() })).default([]),
  }).parse(req.body);
  const members = new Set((await prisma.interventionLearner.findMany({ where: { interventionId: i.id }, select: { learnerId: true } })).map((x) => x.learnerId));
  if (b.attendance.some((a) => !members.has(a.learnerId))) throw badRequest('Attendance includes a learner who is not in this intervention');
  const session = await prisma.interventionSession.create({
    data: { interventionId: i.id, date: b.date, topic: b.topic, notes: b.notes ?? null, facilitatorId: req.user!.id, attendance: { create: b.attendance } },
    include: { attendance: true },
  });
  if (i.status === 'PLANNED' || i.status === 'IDENTIFIED') await prisma.intervention.update({ where: { id: i.id }, data: { status: 'ONGOING' } });
  await audit(req, 'CREATE', 'InterventionSession', session.id, null, session);
  res.status(201).json(session);
}));

interventionsRouter.delete('/:id/sessions/:sessionId', requirePermission('intervention:write'), ah(async (req, res) => {
  const s = req.scope!;
  const i = await loadIntervention(s, idParam(req));
  assertCanManage(s, i, req.user!.id);
  const session = await prisma.interventionSession.findFirst({ where: { id: idParam(req, 'sessionId'), interventionId: i.id }, include: { attendance: true } });
  if (!session) throw notFound('Session');
  await prisma.interventionSession.delete({ where: { id: session.id } });
  await audit(req, 'DELETE', 'InterventionSession', session.id, session, null);
  res.json({ ok: true });
}));

/** Learners in interventions who are due (or overdue) for reassessment. */
interventionsRouter.get('/queue/reassessment', requirePermission('intervention:read'), ah(async (req, res) => {
  const s = req.scope!;
  const rows = await prisma.interventionLearner.findMany({
    where: {
      intervention: { ...interventionWhere(s), status: { in: ['ONGOING', 'REASSESSMENT_REQUIRED', 'FOR_MONITORING', 'COMPLETED'] } },
      reassessments: { none: {} },
      decision: null,
    },
    include: {
      learner: true,
      intervention: { select: { id: true, title: true, status: true, reassessmentDate: true, learningArea: { select: { name: true } } } },
      learningGap: { include: { competency: { select: { code: true, description: true } }, assessmentResult: { include: { assessment: { include: { model: { include: { bands: true, assessmentType: true } } } } } } } },
    },
    orderBy: [{ intervention: { reassessmentDate: 'asc' } }],
    take: 500,
  });
  res.json(rows.map((r, idx) => ({
    id: r.id,
    interventionId: r.intervention.id,
    intervention: r.intervention,
    learner: s.learnerLevel ? { id: r.learner.id, lrn: r.learner.lrn, name: learnerName(r.learner) } : { id: null, lrn: null, name: `Learner ${idx + 1}` },
    pre: { percentage: r.prePercentage, tier: r.preTier },
    competency: r.learningGap?.competency ?? null,
    instrument: r.learningGap && !r.learningGap.competencyId
      ? { name: r.learningGap.assessmentResult.assessment.model.assessmentType.name, mode: r.learningGap.assessmentResult.assessment.model.assessmentType.resultMode, levels: r.learningGap.assessmentResult.assessment.model.bands.map((b) => ({ key: b.descriptorKey, label: b.label })) }
      : null,
    due: r.intervention.reassessmentDate,
    overdue: !!r.intervention.reassessmentDate && r.intervention.reassessmentDate < new Date(),
  })));
}));
