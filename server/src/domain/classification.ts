import type { ResultMode, Tier } from '@prisma/client';

export interface BandLike {
  id: number;
  label: string;
  tier: Tier;
  minPct: number | null;
  maxPct: number | null;
  descriptorKey: string | null;
  sortOrder: number;
  color?: string;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function computePercentage(raw: number, max: number): number {
  if (!(max > 0)) throw new Error('Maximum score must be greater than zero');
  return round2((raw / max) * 100);
}

/**
 * Percentage-mode classification: the band with the highest `minPct` that the
 * percentage reaches. Thresholds come from configuration, never from code.
 */
export function classifyPercentage<B extends BandLike>(pct: number, bands: B[]): B | null {
  const eligible = bands
    .filter((b) => b.minPct !== null && pct >= b.minPct)
    .sort((a, b) => (b.minPct ?? 0) - (a.minPct ?? 0));
  return eligible[0] ?? null;
}

/** Profile-mode classification: the teacher-selected descriptor maps straight to a band. */
export function classifyDescriptor<B extends BandLike>(descriptor: string, bands: B[]): B | null {
  const key = descriptor.trim().toLowerCase();
  return bands.find((b) => b.descriptorKey?.toLowerCase() === key || b.label.toLowerCase() === key) ?? null;
}

export interface ClassifyInput {
  mode: ResultMode;
  rawScore?: number | null;
  maxScore?: number | null;
  descriptor?: string | null;
}

export interface Classification<B> {
  percentage: number | null;
  band: B | null;
  tier: Tier | null;
}

/**
 * Classify a single result. Percentage bands are never applied to profile-based
 * instruments, and descriptors are never applied to percentage instruments.
 */
export function classify<B extends BandLike>(input: ClassifyInput, bands: B[]): Classification<B> {
  if (input.mode === 'PROFILE') {
    if (!input.descriptor) return { percentage: null, band: null, tier: null };
    const band = classifyDescriptor(input.descriptor, bands);
    const percentage = input.rawScore != null && input.maxScore ? computePercentage(input.rawScore, input.maxScore) : null;
    return { percentage, band, tier: band?.tier ?? null };
  }
  if (input.rawScore == null || !input.maxScore) return { percentage: null, band: null, tier: null };
  const percentage = computePercentage(input.rawScore, input.maxScore);
  const band = classifyPercentage(percentage, bands);
  return { percentage, band, tier: band?.tier ?? null };
}

export const isMastered = (correct: number, total: number, threshold: number) => total > 0 && correct / total >= threshold;

/** Validate a band set before saving it. Returns human-readable problems. */
export function validateBands(mode: ResultMode, bands: Omit<BandLike, 'id'>[]): string[] {
  const problems: string[] = [];
  if (bands.length === 0) problems.push('At least one performance level is required');
  if (mode === 'PERCENTAGE') {
    for (const b of bands) {
      if (b.minPct === null || b.minPct === undefined) problems.push(`"${b.label}" needs a minimum percentage`);
      else if (b.minPct < 0 || b.minPct > 100) problems.push(`"${b.label}" minimum must be within 0–100`);
      if (b.maxPct != null && b.minPct != null && b.maxPct < b.minPct) problems.push(`"${b.label}" maximum is below its minimum`);
    }
    if (!bands.some((b) => b.minPct === 0)) problems.push('One level must start at 0% so every score is classified');
    const mins = bands.map((b) => b.minPct);
    if (new Set(mins).size !== mins.length) problems.push('Two levels share the same minimum percentage');
    const sorted = [...bands].filter((b) => b.minPct != null).sort((a, b) => a.minPct! - b.minPct!);
    for (let i = 0; i < sorted.length - 1; i++) {
      const cur = sorted[i];
      const next = sorted[i + 1];
      if (cur.maxPct != null && cur.maxPct >= next.minPct!) problems.push(`"${cur.label}" overlaps "${next.label}"`);
    }
  } else {
    for (const b of bands) if (!b.descriptorKey) problems.push(`"${b.label}" needs a descriptor key`);
    const keys = bands.map((b) => b.descriptorKey?.toLowerCase());
    if (new Set(keys).size !== keys.length) problems.push('Descriptor keys must be unique');
  }
  return problems;
}

/**
 * Tier for a single competency: mastered → Tier 1; otherwise Tier 3 when under half the
 * items were correct, else Tier 2. Used for competency-level gaps and their reassessment.
 */
export function competencyTier(pct: number, masteryThreshold: number): Tier {
  if (pct >= masteryThreshold * 100) return 'TIER_1';
  return pct < 50 ? 'TIER_3' : 'TIER_2';
}
