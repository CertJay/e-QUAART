import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requirePermission } from '../auth/middleware.js';
import { ah, idParam, paged, paginationSchema } from '../lib/http.js';
import { learnerName } from '../domain/lrn.js';
import { assertLearnerLevel, type DataScope } from '../rbac/scope.js';
import { filterSchema, type Filters } from './analytics.service.js';

export const gapsRouter = Router();
gapsRouter.use(requirePermission('gap:read'));

export function gapWhere(s: DataScope, f: Filters): Prisma.LearningGapWhereInput {
  return {
    AND: [
      s.schoolIds ? { schoolId: { in: s.schoolIds } } : {},
      s.sectionIds ? { sectionId: { in: s.sectionIds } } : {},
      s.learningAreaIds ? { learningAreaId: { in: s.learningAreaIds } } : {},
      {
        schoolYearId: f.schoolYearId,
        termId: f.termId,
        schoolId: f.schoolId,
        sectionId: f.sectionId,
        learningAreaId: f.learningAreaId,
        assessmentResult: { assessment: { deletedAt: null, assessmentTypeId: f.assessmentTypeId, id: f.assessmentId, gradeLevelId: f.gradeLevelId } },
      },
    ],
  };
}

const include = {
  learner: true,
  competency: { select: { id: true, code: true, description: true } },
  assessmentResult: { select: { percentage: true, tier: true, band: { select: { label: true, color: true } }, assessment: { select: { id: true, title: true, learningArea: { select: { name: true } }, term: { select: { name: true } } } } } },
  interventionLinks: { select: { intervention: { select: { id: true, title: true, status: true } } } },
} satisfies Prisma.LearningGapInclude;

const shape = (g: Prisma.LearningGapGetPayload<{ include: typeof include }>) => ({
  id: g.id,
  status: g.status,
  severity: g.severity,
  masteryPct: g.masteryPct,
  learner: { id: g.learner.id, lrn: g.learner.lrn, name: learnerName(g.learner) },
  competency: g.competency,
  learningAreaId: g.learningAreaId,
  sectionId: g.sectionId,
  assessment: g.assessmentResult.assessment,
  result: { percentage: g.assessmentResult.percentage, tier: g.assessmentResult.tier, band: g.assessmentResult.band },
  interventions: g.interventionLinks.map((l) => l.intervention),
});

/** Individual learning gaps (learner-level roles only). */
gapsRouter.get('/', ah(async (req, res) => {
  const s = req.scope!;
  assertLearnerLevel(s);
  const f = filterSchema.parse(req.query);
  const { page, perPage } = paginationSchema.parse(req.query);
  const q = z.object({ status: z.enum(['OPEN', 'IN_INTERVENTION', 'RESOLVED']).optional(), competencyId: z.coerce.number().int().optional(), learnerId: z.coerce.number().int().optional() }).parse(req.query);
  const where: Prisma.LearningGapWhereInput = { AND: [gapWhere(s, f), { status: q.status, competencyId: q.competencyId, learnerId: q.learnerId }] };
  const [total, rows] = await Promise.all([
    prisma.learningGap.count({ where }),
    prisma.learningGap.findMany({ where, include, orderBy: [{ severity: 'desc' }, { masteryPct: 'asc' }], skip: (page - 1) * perPage, take: perPage }),
  ]);
  res.json(paged(rows.map(shape), total, page, perPage));
}));

/**
 * Suggested intervention groups for a class: learners who share the same unmastered
 * competency (or the same literacy/numeracy profile gap) are grouped together.
 */
gapsRouter.get('/groups', ah(async (req, res) => {
  const s = req.scope!;
  assertLearnerLevel(s);
  const f = filterSchema.parse(req.query);
  const gaps = await prisma.learningGap.findMany({ where: { AND: [gapWhere(s, f), { status: { not: 'RESOLVED' } }] }, include, take: 3000 });
  const groups = new Map<string, { key: string; competency: (typeof gaps)[number]['competency']; learningAreaId: number; learningArea: string; sectionId: number; label: string; learners: ReturnType<typeof shape>[] }>();
  for (const g of gaps) {
    const key = `${g.sectionId}:${g.competencyId ?? `LA${g.learningAreaId}:${g.assessmentResult.band?.label}`}`;
    const label = g.competency ? `${g.competency.code} — ${g.competency.description}` : `${g.assessmentResult.assessment.learningArea.name}: ${g.assessmentResult.band?.label ?? g.severity}`;
    const cur = groups.get(key) ?? { key, competency: g.competency, learningAreaId: g.learningAreaId, learningArea: g.assessmentResult.assessment.learningArea.name, sectionId: g.sectionId, label, learners: [] };
    if (!cur.learners.some((l) => l.learner.id === g.learnerId)) cur.learners.push(shape(g));
    groups.set(key, cur);
  }
  const sections = await prisma.section.findMany({ where: { id: { in: [...new Set([...groups.values()].map((g) => g.sectionId))] } }, include: { gradeLevel: true } });
  const secName = new Map(sections.map((x) => [x.id, `${x.gradeLevel.name} – ${x.name}`]));
  res.json([...groups.values()]
    .map((g) => ({ ...g, section: secName.get(g.sectionId), size: g.learners.length, notInIntervention: g.learners.filter((l) => l.interventions.length === 0).length }))
    .sort((a, b) => b.size - a.size));
}));
