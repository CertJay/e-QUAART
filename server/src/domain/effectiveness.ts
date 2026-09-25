import type { InterventionDecision, Tier } from '@prisma/client';
import { round2 } from './classification.js';

const TIER_RANK: Record<Tier, number> = { TIER_3: 1, TIER_2: 2, TIER_1: 3 };

export interface Point {
  percentage: number | null;
  tier: Tier | null;
  bandLabel?: string | null;
}

export type LevelChange = 'IMPROVED' | 'SAME' | 'DECLINED' | 'UNKNOWN';

export interface Effectiveness {
  pre: Point;
  post: Point;
  scoreDifference: number | null; // percentage points
  percentImprovement: number | null; // relative change vs pre
  levelChange: LevelChange;
  improved: boolean | null;
  /** Options the data points to; the teacher makes the decision. */
  suggestedDecisions: InterventionDecision[];
  signal: string;
}

export function computeEffectiveness(pre: Point, post: Point | null): Effectiveness | null {
  if (!post) return null;
  const scoreDifference = pre.percentage != null && post.percentage != null ? round2(post.percentage - pre.percentage) : null;
  const percentImprovement =
    scoreDifference != null && pre.percentage ? round2((scoreDifference / pre.percentage) * 100) : null;

  let levelChange: LevelChange = 'UNKNOWN';
  if (pre.tier && post.tier) {
    const d = TIER_RANK[post.tier] - TIER_RANK[pre.tier];
    levelChange = d > 0 ? 'IMPROVED' : d < 0 ? 'DECLINED' : 'SAME';
  }
  if (levelChange === 'SAME' && scoreDifference != null && pre.bandLabel && post.bandLabel && pre.bandLabel !== post.bandLabel) {
    levelChange = scoreDifference > 0 ? 'IMPROVED' : 'DECLINED';
  }
  if (levelChange === 'UNKNOWN' && scoreDifference != null) {
    levelChange = scoreDifference > 0 ? 'IMPROVED' : scoreDifference < 0 ? 'DECLINED' : 'SAME';
  }
  const improved =
    levelChange === 'IMPROVED' || (levelChange === 'SAME' && scoreDifference != null && scoreDifference > 0)
      ? true
      : levelChange === 'UNKNOWN'
        ? null
        : false;

  let suggestedDecisions: InterventionDecision[];
  let signal: string;
  if (post.tier === 'TIER_1') {
    suggestedDecisions = ['COMPLETE'];
    signal = 'Learner now meets the expected standard.';
  } else if (improved) {
    suggestedDecisions = ['CONTINUE', 'MODIFY'];
    signal = 'Performance improved but the expected standard is not yet met.';
  } else if (levelChange === 'DECLINED') {
    suggestedDecisions = ['MODIFY', 'REFER'];
    signal = 'Performance declined after intervention.';
  } else {
    suggestedDecisions = ['MODIFY', 'REPEAT', 'REFER'];
    signal = 'No measurable change after intervention.';
  }
  return { pre, post, scoreDifference, percentImprovement, levelChange, improved, suggestedDecisions, signal };
}
