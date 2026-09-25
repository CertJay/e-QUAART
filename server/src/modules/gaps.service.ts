import type { Prisma, Tier } from '@prisma/client';
import { competencyTier, round2 } from '../domain/classification.js';

type TxClient = Prisma.TransactionClient;

interface DesiredGap {
  assessmentResultId: number;
  learnerId: number;
  competencyId: number | null;
  severity: Tier;
  masteryPct: number | null;
}

/**
 * Derive individual learning gaps from a finalized assessment and persist them.
 *   - every competency a learner did not master becomes a competency-level gap;
 *   - a Tier 2/3 result without competency breakdown (e.g. CRLA profile) becomes a
 *     learning-area-level gap.
 * Gaps already linked to an intervention are never deleted.
 */
export async function syncLearningGaps(tx: TxClient, assessmentId: number) {
  const a = await tx.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    include: { results: { include: { competencyResults: true } }, model: true },
  });
  const desired: DesiredGap[] = [];
  const finalized = a.status === 'SUBMITTED' || a.status === 'VERIFIED';
  if (finalized) {
    for (const r of a.results) {
      if (r.isAbsent) continue;
      const unmastered = r.competencyResults.filter((c) => !c.mastered);
      for (const c of unmastered) {
        const pct = c.itemsTotal ? round2((c.itemsCorrect / c.itemsTotal) * 100) : 0;
        desired.push({ assessmentResultId: r.id, learnerId: r.learnerId, competencyId: c.competencyId, masteryPct: pct, severity: competencyTier(pct, a.model.masteryThreshold) === 'TIER_3' ? 'TIER_3' : 'TIER_2' });
      }
      if (r.competencyResults.length === 0 && (r.tier === 'TIER_2' || r.tier === 'TIER_3')) {
        desired.push({ assessmentResultId: r.id, learnerId: r.learnerId, competencyId: null, masteryPct: r.percentage, severity: r.tier });
      }
    }
  }
  const existing = await tx.learningGap.findMany({
    where: { assessmentResult: { assessmentId } },
    include: { _count: { select: { interventionLinks: true } } },
  });
  const key = (g: { assessmentResultId: number; competencyId: number | null }) => `${g.assessmentResultId}:${g.competencyId ?? 'LA'}`;
  const existingByKey = new Map(existing.map((g) => [key(g), g]));
  const desiredKeys = new Set(desired.map(key));

  const toCreate = desired.filter((d) => !existingByKey.has(key(d)));
  if (toCreate.length) {
    await tx.learningGap.createMany({
      data: toCreate.map((d) => ({
        ...d,
        learningAreaId: a.learningAreaId,
        schoolId: a.schoolId,
        sectionId: a.sectionId,
        schoolYearId: a.schoolYearId,
        termId: a.termId,
      })),
    });
  }
  for (const d of desired) {
    const g = existingByKey.get(key(d));
    if (g && (g.severity !== d.severity || g.masteryPct !== d.masteryPct)) {
      await tx.learningGap.update({ where: { id: g.id }, data: { severity: d.severity, masteryPct: d.masteryPct } });
    }
  }
  const stale = existing.filter((g) => !desiredKeys.has(key(g)) && g._count.interventionLinks === 0).map((g) => g.id);
  if (stale.length) await tx.learningGap.deleteMany({ where: { id: { in: stale } } });
  return { created: toCreate.length, removed: stale.length, total: desired.length };
}
