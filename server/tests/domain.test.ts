import { describe, expect, it } from 'vitest';
import { classify, classifyPercentage, competencyTier, computePercentage, validateBands, type BandLike } from '../src/domain/classification.js';
import { computeEffectiveness } from '../src/domain/effectiveness.js';
import { suppress, tierMetrics } from '../src/domain/metrics.js';
import { isValidLrn, maskLrn, normalizeLrn } from '../src/domain/lrn.js';

const pctBands: BandLike[] = [
  { id: 1, label: 'Proficient', tier: 'TIER_1', minPct: 80, maxPct: 100, descriptorKey: null, sortOrder: 1 },
  { id: 2, label: 'Approaching', tier: 'TIER_2', minPct: 70, maxPct: 79.99, descriptorKey: null, sortOrder: 2 },
  { id: 3, label: 'Developing', tier: 'TIER_2', minPct: 60, maxPct: 69.99, descriptorKey: null, sortOrder: 3 },
  { id: 4, label: 'Beginning', tier: 'TIER_3', minPct: 0, maxPct: 59.99, descriptorKey: null, sortOrder: 4 },
];
const crla: BandLike[] = [
  { id: 11, label: 'Grade Ready', tier: 'TIER_1', minPct: null, maxPct: null, descriptorKey: 'GRADE_READY', sortOrder: 1 },
  { id: 12, label: 'Full Refresher', tier: 'TIER_3', minPct: null, maxPct: null, descriptorKey: 'FULL_REFRESHER', sortOrder: 4 },
];

describe('classification', () => {
  it('computes percentages to two decimals', () => {
    expect(computePercentage(24, 40)).toBe(60);
    expect(computePercentage(1, 3)).toBe(33.33);
    expect(() => computePercentage(1, 0)).toThrow();
  });

  it('uses configured band boundaries, including decimals between bands', () => {
    expect(classifyPercentage(80, pctBands)?.label).toBe('Proficient');
    expect(classifyPercentage(79.995, pctBands)?.label).toBe('Approaching');
    expect(classifyPercentage(60, pctBands)?.label).toBe('Developing');
    expect(classifyPercentage(0, pctBands)?.label).toBe('Beginning');
  });

  it('classifies a profile instrument by descriptor, never by percentage', () => {
    const c = classify({ mode: 'PROFILE', descriptor: 'FULL_REFRESHER', rawScore: 40, maxScore: 40 }, crla);
    expect(c.tier).toBe('TIER_3');
    expect(c.band?.label).toBe('Full Refresher');
    expect(classify({ mode: 'PROFILE', descriptor: 'grade ready' }, crla).tier).toBe('TIER_1');
    expect(classify({ mode: 'PROFILE', descriptor: null }, crla).tier).toBeNull();
  });

  it('leaves unscored percentage results unclassified', () => {
    expect(classify({ mode: 'PERCENTAGE', rawScore: null, maxScore: 40 }, pctBands).band).toBeNull();
  });

  it('validates band sets', () => {
    expect(validateBands('PERCENTAGE', pctBands)).toEqual([]);
    expect(validateBands('PERCENTAGE', pctBands.slice(0, 3))).toContain('One level must start at 0% so every score is classified');
    expect(validateBands('PERCENTAGE', [{ ...pctBands[0], maxPct: 100 }, { ...pctBands[1], maxPct: 85 }, pctBands[3]]).some((p) => p.includes('overlaps'))).toBe(true);
    expect(validateBands('PROFILE', [{ ...crla[0], descriptorKey: null }])).toContain('"Grade Ready" needs a descriptor key');
  });

  it('derives competency tiers from the mastery threshold', () => {
    expect(competencyTier(80, 0.75)).toBe('TIER_1');
    expect(competencyTier(60, 0.75)).toBe('TIER_2');
    expect(competencyTier(40, 0.75)).toBe('TIER_3');
  });
});

describe('intervention effectiveness', () => {
  it('reports the spec example 60% → 78% as an improvement', () => {
    const e = computeEffectiveness({ percentage: 60, tier: 'TIER_2' }, { percentage: 78, tier: 'TIER_2', bandLabel: 'Approaching' })!;
    expect(e.scoreDifference).toBe(18);
    expect(e.percentImprovement).toBe(30);
    expect(e.improved).toBe(true);
    expect(e.suggestedDecisions).toContain('CONTINUE');
  });
  it('suggests completion once the standard is met, and referral when performance declines', () => {
    expect(computeEffectiveness({ percentage: 50, tier: 'TIER_3' }, { percentage: 85, tier: 'TIER_1' })!.suggestedDecisions).toEqual(['COMPLETE']);
    const down = computeEffectiveness({ percentage: 65, tier: 'TIER_2' }, { percentage: 40, tier: 'TIER_3' })!;
    expect(down.levelChange).toBe('DECLINED');
    expect(down.suggestedDecisions).toContain('REFER');
  });
  it('handles profile-only reassessments through tiers', () => {
    const e = computeEffectiveness({ percentage: null, tier: 'TIER_3' }, { percentage: null, tier: 'TIER_2' })!;
    expect(e.levelChange).toBe('IMPROVED');
    expect(e.scoreDifference).toBeNull();
  });
  it('returns null before reassessment', () => {
    expect(computeEffectiveness({ percentage: 50, tier: 'TIER_3' }, null)).toBeNull();
  });
});

describe('metrics', () => {
  it('computes rates from tier counts', () => {
    const m = tierMetrics({ assessed: 40, tier1: 10, tier2: 20, tier3: 10 });
    expect(m.proficiencyRate).toBe(25);
    expect(m.atRiskRate).toBe(75);
    expect(m.tier3Rate).toBe(25);
    expect(tierMetrics({ assessed: 0, tier1: 0, tier2: 0, tier3: 0 }).proficiencyRate).toBeNull();
  });
  it('suppresses small cells only for aggregate-only roles', () => {
    const row = { key: 1, label: 'X', assessed: 3, avgPct: 70, tier1: 1 };
    expect(suppress(row, 5, true)).toMatchObject({ suppressed: true, avgPct: null, tier1: null, label: 'X' });
    expect(suppress(row, 5, false)).toMatchObject({ suppressed: false, avgPct: 70 });
  });
});

describe('LRN', () => {
  it('accepts 12-digit LRNs only', () => {
    expect(isValidLrn('123456789012')).toBe(true);
    expect(isValidLrn('1234-5678-9012')).toBe(true);
    expect(normalizeLrn(' 1234 5678 9012 ')).toBe('123456789012');
    expect(isValidLrn('12345678901')).toBe(false);
    expect(isValidLrn('12345678901A')).toBe(false);
    expect(maskLrn('123456789012')).toBe('••••••••9012');
  });
});
