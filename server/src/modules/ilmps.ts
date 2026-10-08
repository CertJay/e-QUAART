import { Router, type Request } from 'express';
import { z } from 'zod';
import type { InterventionType, Prisma, Tier } from '@prisma/client';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { ah, idParam } from '../lib/http.js';
import { learnerName } from '../domain/lrn.js';
import { idSchema } from '../domain/validation.js';
import { assertLearnerLevel, sectionInScope } from '../rbac/scope.js';

/**
 * Individual Learning Monitoring Plans, kept deliberately light for the adviser (spec §8):
 * the system drafts one plan per learner and learning area from the learner's open gaps;
 * the adviser only confirms the support level, may add a note, and finalizes. No schedules,
 * sessions or materials — those belong to class interventions, not to the learner's plan.
 */
export const ilmpsRouter = Router();

const SUPPORT_FOR_TIER: Record<Tier, InterventionType> = { TIER_1: 'ENRICHMENT', TIER_2: 'TARGETED', TIER_3: 'INTENSIVE' };

/** Plain default wording per support level; the adviser can replace it with their own note. */
export const SUPPORT_TEXT: Record<InterventionType, string> = {
  ENRICHMENT: 'Enrichment activities during class.',
  TARGETED: 'Small-group reteaching of the listed competencies during class.',
  INTENSIVE: 'One-on-one or small-group remediation on the listed competencies, with regular progress checks.',
};

async function loadSection(req: Request, sectionId: number) {
  const sec = await prisma.section.findUnique({ where: { id: sectionId }, include: { gradeLevel: true } });
  if (!sec || !sectionInScope(req.scope!, sec)) throw notFound('Class');
  return sec;
}

/** Only the class adviser drafts and finalizes the plans of their class. */
function assertAdviser(req: Request, sec: { adviserId: number | null }) {
  if (sec.adviserId !== req.user!.id) throw forbidden('Only the class adviser prepares the ILMPs of this class');
}

const pct = (n: number | null) => (n == null ? '' : ` — ${Math.round(n)}%`);

/**
 * Draft ILMPs for a class from its open learning gaps in the class's school year: one plan per
 * learner × learning area that does not already have a plan. Learners who left the class are skipped.
 */
ilmpsRouter.post('/generate', requirePermission('intervention:write'), ah(async (req, res) => {
  assertLearnerLevel(req.scope!);
  const { sectionId } = z.object({ sectionId: idSchema }).parse(req.body);
  const sec = await loadSection(req, sectionId);
  assertAdviser(req, sec);

  const gaps = await prisma.learningGap.findMany({
    where: {
      sectionId: sec.id,
      schoolYearId: sec.schoolYearId,
      status: { not: 'RESOLVED' },
      learner: { status: 'ACTIVE', enrolments: { some: { sectionId: sec.id, isCurrent: true } } },
    },
    include: {
      competency: true,
      assessmentResult: { include: { band: true, assessment: { include: { assessmentType: true, term: true, learningArea: true } } } },
    },
    orderBy: [{ severity: 'desc' }, { masteryPct: 'asc' }],
  });
  const existing = await prisma.ilmp.findMany({ where: { schoolYearId: sec.schoolYearId, learnerId: { in: [...new Set(gaps.map((g) => g.learnerId))] } }, select: { learnerId: true, learningAreaId: true } });
  const has = new Set(existing.map((e) => `${e.learnerId}:${e.learningAreaId}`));

  const groups = new Map<string, typeof gaps>();
  for (const g of gaps) {
    const k = `${g.learnerId}:${g.learningAreaId}`;
    if (has.has(k)) continue;
    groups.set(k, [...(groups.get(k) ?? []), g]);
  }
  const data: Prisma.IlmpCreateManyInput[] = [...groups.values()].map((gs) => {
    const worst: Tier = gs.some((g) => g.severity === 'TIER_3') ? 'TIER_3' : 'TIER_2';
    const supportLevel = SUPPORT_FOR_TIER[worst];
    const lines = gs.map((g) => {
      const a = g.assessmentResult.assessment;
      const source = `${a.assessmentType.code === 'TERM_EXAM' ? 'LOA' : a.assessmentType.name.split(' — ')[0]}, ${a.term.name}`;
      return g.competency
        ? `• ${g.competency.code} ${g.competency.description}${pct(g.masteryPct)} (${source})`
        : `• Overall level: ${g.assessmentResult.band?.label ?? 'below standard'} (${source})`;
    });
    return {
      learnerId: gs[0].learnerId,
      learningAreaId: gs[0].learningAreaId,
      schoolYearId: sec.schoolYearId,
      termId: gs[0].termId,
      sectionId: sec.id,
      identifiedGaps: lines.join('\n'),
      strategies: SUPPORT_TEXT[supportLevel],
      supportLevel,
      generated: true,
      status: 'DRAFT',
      createdById: req.user!.id,
    };
  });
  if (data.length) await prisma.ilmp.createMany({ data });
  await audit(req, 'CREATE', 'Ilmp', null, null, { generated: data.length, sectionId: sec.id });
  res.status(201).json({ created: data.length, alreadyPlanned: existing.length });
}));

/** Plans of a class, newest first, with the learner's name (school staff with learner-level access). */
ilmpsRouter.get('/', requirePermission('learner:read'), ah(async (req, res) => {
  assertLearnerLevel(req.scope!);
  const q = z.object({ sectionId: z.coerce.number().int().positive(), status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED']).optional() }).parse(req.query);
  const sec = await loadSection(req, q.sectionId);
  const rows = await prisma.ilmp.findMany({
    where: { sectionId: sec.id, status: q.status },
    include: { learner: true, learningArea: { select: { id: true, name: true } } },
    orderBy: [{ status: 'asc' }, { learner: { lastName: 'asc' } }, { learningArea: { sortOrder: 'asc' } }],
  });
  const counts = await prisma.ilmp.groupBy({ by: ['status'], where: { sectionId: sec.id }, _count: true });
  res.json({
    canEdit: sec.adviserId === req.user!.id,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    data: rows.map(({ learner, ...p }) => ({ ...p, learner: { id: learner.id, lrn: learner.lrn, name: learnerName(learner) } })),
  });
}));

async function loadPlan(req: Request, id: number) {
  const p = await prisma.ilmp.findUnique({ where: { id } });
  if (!p || !p.sectionId) throw notFound('ILMP');
  const sec = await loadSection(req, p.sectionId);
  assertAdviser(req, sec);
  return p;
}

/** The adviser's only choices: support level, an optional note, and completing the plan. */
ilmpsRouter.patch('/:id', requirePermission('intervention:write'), ah(async (req, res) => {
  const before = await loadPlan(req, idParam(req));
  const b = z.object({
    supportLevel: z.enum(['ENRICHMENT', 'TARGETED', 'INTENSIVE']).optional(),
    note: z.string().trim().max(1000).optional(),
    status: z.literal('COMPLETED').optional(),
  }).parse(req.body);
  if (before.status === 'COMPLETED') throw conflict('This plan is completed');
  if (b.status && before.status !== 'ACTIVE') throw badRequest('Finalize the plan before marking it completed');
  const data: Prisma.IlmpUpdateInput = {};
  if (b.supportLevel) {
    data.supportLevel = b.supportLevel;
    // Keep the default wording in step with the level unless the adviser wrote their own.
    if (Object.values(SUPPORT_TEXT).includes(before.strategies)) data.strategies = SUPPORT_TEXT[b.supportLevel];
  }
  if (b.note !== undefined) data.strategies = b.note || SUPPORT_TEXT[(b.supportLevel ?? before.supportLevel ?? 'TARGETED') as InterventionType];
  if (b.status) data.status = b.status;
  const p = await prisma.ilmp.update({ where: { id: before.id }, data });
  await audit(req, 'UPDATE', 'Ilmp', p.id, before, p);
  res.json(p);
}));

/** Finalize one or more drafts in one step (e.g. "Finalize all"). */
ilmpsRouter.post('/finalize', requirePermission('intervention:write'), ah(async (req, res) => {
  const { ids } = z.object({ ids: z.array(idSchema).min(1).max(500) }).parse(req.body);
  const plans = await prisma.ilmp.findMany({ where: { id: { in: ids } } });
  if (plans.length !== new Set(ids).size) throw notFound('ILMP');
  for (const sid of new Set(plans.map((p) => p.sectionId))) {
    if (!sid) throw notFound('ILMP');
    assertAdviser(req, await loadSection(req, sid));
  }
  const drafts = plans.filter((p) => p.status === 'DRAFT').map((p) => p.id);
  const now = new Date();
  await prisma.ilmp.updateMany({ where: { id: { in: drafts } }, data: { status: 'ACTIVE', finalizedAt: now, finalizedById: req.user!.id } });
  for (const id of drafts) await audit(req, 'UPDATE', 'Ilmp', id, { status: 'DRAFT' }, { status: 'ACTIVE', finalizedAt: now });
  res.json({ finalized: drafts.length });
}));

/** Send a finalized or completed plan back to "To check" so the adviser can revise it. */
ilmpsRouter.post('/:id/reopen', requirePermission('intervention:write'), ah(async (req, res) => {
  const before = await loadPlan(req, idParam(req));
  if (before.status === 'DRAFT') throw conflict('This plan is already a draft');
  const p = await prisma.ilmp.update({ where: { id: before.id }, data: { status: 'DRAFT', finalizedAt: null, finalizedById: null } });
  await audit(req, 'REOPEN', 'Ilmp', p.id, { status: before.status, finalizedAt: before.finalizedAt }, { status: 'DRAFT' });
  res.json(p);
}));

/**
 * Delete a draft plan. A plan in use must first be moved back to drafts, so an active plan
 * cannot disappear with one click. Drafting again re-creates it from the current results.
 */
ilmpsRouter.delete('/:id', requirePermission('intervention:write'), ah(async (req, res) => {
  const before = await loadPlan(req, idParam(req));
  if (before.status !== 'DRAFT') throw conflict('Move this plan back to drafts before deleting it');
  await prisma.ilmp.delete({ where: { id: before.id } });
  await audit(req, 'DELETE', 'Ilmp', before.id, before, null);
  res.json({ ok: true });
}));
