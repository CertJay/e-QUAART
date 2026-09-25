import { describe, expect, it } from 'vitest';
import type { Band } from '../api/client';
import { effectiveScore, previewBand, previewPercentage, rowProblems, type GridRow } from './classify';

const bands: Band[] = [
  { id: 1, label: 'Proficient', tier: 'TIER_1', minPct: 80, maxPct: 100, descriptorKey: null, description: null, color: '#000', sortOrder: 1 },
  { id: 2, label: 'Developing', tier: 'TIER_2', minPct: 60, maxPct: 79.99, descriptorKey: null, description: null, color: '#000', sortOrder: 2 },
  { id: 3, label: 'Beginning', tier: 'TIER_3', minPct: 0, maxPct: 59.99, descriptorKey: null, description: null, color: '#000', sortOrder: 3 },
];
const row = (x: Partial<GridRow>): GridRow => ({ learnerId: 1, rawScore: '', descriptor: '', isAbsent: false, remarks: '', comps: {}, ...x });
const comps = [{ competencyId: 10, itemsTotal: 10 }, { competencyId: 11, itemsTotal: 10 }];

describe('grid classification preview', () => {
  it('matches the server rules', () => {
    expect(previewPercentage(15, 20)).toBe(75);
    expect(previewBand(bands, 'PERCENTAGE', 80, null)?.label).toBe('Proficient');
    expect(previewBand(bands, 'PERCENTAGE', 59.99, null)?.label).toBe('Beginning');
  });
  it('sums competency items into the score when they make up the whole test', () => {
    expect(effectiveScore(row({ comps: { 10: '7', 11: '8' } }), { maxScore: 20, comps })).toBe(15);
    expect(effectiveScore(row({ comps: { 10: '7' } }), { maxScore: 20, comps })).toBeNull();
  });
  it('flags out-of-range values', () => {
    expect(rowProblems(row({ rawScore: '25' }), { mode: 'PERCENTAGE', maxScore: 20, comps: [] })).toEqual(['Exceeds 20']);
    expect(rowProblems(row({ comps: { 10: '11', 11: '2' } }), { mode: 'PERCENTAGE', maxScore: 20, comps })).toContain('Max 10 items');
    expect(rowProblems(row({ isAbsent: true }), { mode: 'PERCENTAGE', maxScore: 20, comps })).toEqual([]);
    expect(rowProblems(row({}), { mode: 'PROFILE', maxScore: null, comps: [] })).toEqual(['Level missing']);
  });
});
