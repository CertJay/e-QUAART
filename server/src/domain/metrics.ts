/**
 * Central metric definitions (build spec §6.5). Every dashboard and report computes
 * these through this module so a metric always means the same thing.
 */
export interface TierCounts {
  assessed: number; // classified results (absent learners excluded)
  tier1: number;
  tier2: number;
  tier3: number;
}

export const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export const METRIC_DEFINITIONS = {
  proficiencyRate: 'Learners classified Tier 1 (meeting the expected standard) ÷ learners assessed',
  atRiskRate: 'Learners classified Tier 2 or Tier 3 (requiring intervention) ÷ learners assessed',
  tier3Rate: 'Learners classified Tier 3 (intensive support) ÷ learners assessed',
  averagePercentage: 'Mean percentage score of percentage-based results',
  completionRate: 'Learners with an encoded result (present or absent) ÷ learners enrolled in the assessed classes',
  interventionCoverage: 'Learners with an identified gap who are enrolled in an intervention ÷ learners with an identified gap',
  improvementRate: 'Reassessed intervention learners whose score or level improved ÷ reassessed intervention learners',
  resultTurnaround: 'Days from encoding-window close to verification',
} as const;

export function tierMetrics(c: TierCounts) {
  return {
    assessed: c.assessed,
    tier1: c.tier1,
    tier2: c.tier2,
    tier3: c.tier3,
    proficiencyRate: rate(c.tier1, c.assessed),
    atRiskRate: rate(c.tier2 + c.tier3, c.assessed),
    tier3Rate: rate(c.tier3, c.assessed),
  };
}

/** Small-cell suppression for aggregate views shown to roles without learner-level access. */
export function suppress<T extends { assessed: number }>(row: T, threshold: number, applies: boolean): T & { suppressed: boolean } {
  if (!applies || row.assessed === 0 || row.assessed >= threshold) return { ...row, suppressed: false };
  const masked: Record<string, unknown> = { ...row };
  for (const k of Object.keys(masked)) {
    if (k === 'key' || k === 'label' || k === 'sortKey' || k === 'meta') continue;
    if (typeof masked[k] === 'number') masked[k] = null;
    if (k === 'bands') masked[k] = [];
  }
  return { ...(masked as T), suppressed: true };
}
