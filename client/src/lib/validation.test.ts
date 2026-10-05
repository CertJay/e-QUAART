import { describe, expect, it } from 'vitest';
import { addYears, learnerBirthdateBounds, todayManila } from './validation';

describe('client date helpers', () => {
  it('shifts 29 February to 28 February in common years', () => {
    expect(addYears('2024-02-29', -3)).toBe('2021-02-28');
    expect(addYears('2024-02-29', 4)).toBe('2028-02-29');
  });

  it('gives inclusive birthdate bounds for ages 3 to 25', () => {
    expect(learnerBirthdateBounds('2026-10-05')).toEqual({ min: '2000-10-06', max: '2023-10-05' });
    expect(learnerBirthdateBounds('2028-02-29')).toEqual({ min: '2002-03-01', max: '2025-02-28' });
  });

  it('uses the Manila calendar day', () => {
    expect(todayManila(new Date('2026-10-04T16:00:00Z'))).toBe('2026-10-05');
  });
});
