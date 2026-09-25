import type { Tier } from '../api/client';

export const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? '—' : `${v.toFixed(digits)}%`);
export const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-PH'));
export const date = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const dateTime = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const isoDate = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : '');

export const TIER_LABEL: Record<Tier, string> = { TIER_1: 'Tier 1', TIER_2: 'Tier 2', TIER_3: 'Tier 3' };
export const TIER_MEANING: Record<Tier, string> = { TIER_1: 'Meets standard', TIER_2: 'Targeted support', TIER_3: 'Intensive support' };
export const TIER_VAR: Record<Tier, string> = { TIER_1: 'var(--tier-1)', TIER_2: 'var(--tier-2)', TIER_3: 'var(--tier-3)' };

export const humanize = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—');

/** Fixed categorical slot per entity (by id), so colours never repaint when filters change. */
export const seriesColor = (index: number) => `var(--series-${(index % 8) + 1})`;
