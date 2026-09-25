import type { Band } from '../api/client';

/** Client-side preview of the server's classification (the server remains authoritative). */
export function previewPercentage(raw: number | null, max: number | null) {
  if (raw === null || !max) return null;
  return Math.round((raw / max) * 10000) / 100;
}

export function previewBand(bands: Band[], mode: 'PERCENTAGE' | 'PROFILE', pct: number | null, descriptor: string | null) {
  if (mode === 'PROFILE') return descriptor ? bands.find((b) => b.descriptorKey === descriptor) ?? null : null;
  if (pct === null) return null;
  return [...bands].filter((b) => b.minPct !== null && pct >= b.minPct).sort((a, b) => (b.minPct ?? 0) - (a.minPct ?? 0))[0] ?? null;
}

export interface GridRow {
  learnerId: number;
  rawScore: string;
  descriptor: string;
  isAbsent: boolean;
  remarks: string;
  comps: Record<number, string>;
}

/** Validate one grid row the same way the API does, so problems show before saving. */
export function rowProblems(r: GridRow, opts: { mode: 'PERCENTAGE' | 'PROFILE'; maxScore: number | null; comps: { competencyId: number; itemsTotal: number }[] }): string[] {
  if (r.isAbsent) return [];
  const p: string[] = [];
  for (const c of opts.comps) {
    const v = r.comps[c.competencyId];
    if (v === undefined || v === '') continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) p.push('Items must be whole numbers');
    else if (n > c.itemsTotal) p.push(`Max ${c.itemsTotal} items`);
  }
  const score = effectiveScore(r, opts);
  if (opts.mode === 'PERCENTAGE') {
    if (score === null) p.push('Score missing');
    else if (Number.isNaN(score)) p.push('Score must be a number');
    else if (score < 0) p.push('Negative score');
    else if (opts.maxScore !== null && score > opts.maxScore) p.push(`Exceeds ${opts.maxScore}`);
  } else if (!r.descriptor) p.push('Level missing');
  return p;
}

export function effectiveScore(r: GridRow, opts: { maxScore: number | null; comps: { competencyId: number; itemsTotal: number }[] }): number | null {
  if (r.rawScore.trim() !== '') return Number(r.rawScore);
  const total = opts.comps.reduce((s, c) => s + c.itemsTotal, 0);
  const filled = opts.comps.filter((c) => (r.comps[c.competencyId] ?? '') !== '');
  if (opts.comps.length && filled.length === opts.comps.length && total === opts.maxScore) {
    return filled.reduce((s, c) => s + Number(r.comps[c.competencyId]), 0);
  }
  return null;
}
