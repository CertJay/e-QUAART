import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PerfRow, Tier } from '../api/client';
import { TIER_LABEL, TIER_MEANING, pct } from '../lib/format';

/**
 * Chart conventions (from the validated palette): tier colours are CVD-checked in light and
 * dark; categorical series get a fixed slot per entity; one y-axis; thin bars with a 2px
 * surface gap; every chart has a tooltip and a table view nearby.
 */
export const ThemeContext = createContext<{ theme: 'light' | 'dark'; toggle: () => void }>({ theme: 'light', toggle: () => undefined });

export function useColors() {
  const { theme } = useContext(ThemeContext);
  return useMemo(() => {
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim() || '#888';
    return {
      theme,
      tier: { TIER_1: v('--tier-1'), TIER_2: v('--tier-2'), TIER_3: v('--tier-3') } as Record<Tier, string>,
      series: Array.from({ length: 8 }, (_, i) => v(`--series-${i + 1}`)),
      surface: v('--surface-1'),
      grid: v('--grid'),
      text: v('--text-primary'),
      text2: v('--text-secondary'),
      muted: v('--text-muted'),
      border: v('--border'),
    };
  }, [theme]);
}

const axisProps = (c: ReturnType<typeof useColors>) => ({ tick: { fill: c.muted, fontSize: 11 }, axisLine: { stroke: c.grid }, tickLine: false });

function TooltipBox({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-surface-1 px-3 py-2 text-xs text-ink shadow-md">
      <div className="mb-1 font-medium">{title}</div>
      {children}
    </div>
  );
}

export function TierLegend() {
  const c = useColors();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {(['TIER_1', 'TIER_2', 'TIER_3'] as Tier[]).map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.tier[t] }} />
          {TIER_LABEL[t]} <span className="text-ink-3">· {TIER_MEANING[t]}</span>
        </span>
      ))}
    </div>
  );
}

/** 100%-stacked horizontal bars of tier shares per group. Click a bar to drill down. */
export function TierBars({ rows, onSelect, height }: { rows: PerfRow[]; onSelect?: (r: PerfRow) => void; height?: number }) {
  const c = useColors();
  const data = rows
    .filter((r) => !r.suppressed && r.assessed)
    .map((r) => ({
      ...r,
      t1: ((r.tier1 ?? 0) / r.assessed!) * 100,
      t2: ((r.tier2 ?? 0) / r.assessed!) * 100,
      t3: ((r.tier3 ?? 0) / r.assessed!) * 100,
    }));
  const h = height ?? Math.max(120, data.length * 34 + 40);
  const labelWidth = Math.min(220, Math.max(80, ...data.map((d) => d.label.length * 6.2)));
  return (
    <div>
      <TierLegend />
      <div style={{ height: h }} className="mt-2">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 4 }} barSize={20}>
            <CartesianGrid horizontal={false} stroke={c.grid} />
            <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} {...axisProps(c)} />
            <YAxis type="category" dataKey="label" width={labelWidth} {...axisProps(c)} tick={{ fill: c.text2, fontSize: 11 }} />
            <Tooltip
              cursor={{ fill: c.grid, opacity: 0.6 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const r = payload[0].payload as PerfRow;
                return (
                  <TooltipBox title={r.label}>
                    <div>{r.assessed} results · average {pct(r.avgPct)}</div>
                    {(['TIER_1', 'TIER_2', 'TIER_3'] as Tier[]).map((t) => (
                      <div key={t} className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm" style={{ background: c.tier[t] }} />
                        {TIER_LABEL[t]}: {r[t === 'TIER_1' ? 'tier1' : t === 'TIER_2' ? 'tier2' : 'tier3']} ({pct(t === 'TIER_1' ? r.proficiencyRate : t === 'TIER_3' ? r.tier3Rate : (r.atRiskRate ?? 0) - (r.tier3Rate ?? 0))})
                      </div>
                    ))}
                    {onSelect && <div className="mt-1 text-ink-3">Click to drill down</div>}
                  </TooltipBox>
                );
              }}
            />
            {(['t1', 't2', 't3'] as const).map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                stackId="s"
                fill={c.tier[(['TIER_1', 'TIER_2', 'TIER_3'] as Tier[])[i]]}
                stroke={c.surface}
                strokeWidth={2}
                radius={k === 't3' ? [0, 4, 4, 0] : 0}
                cursor={onSelect ? 'pointer' : undefined}
                onClick={onSelect ? (d) => onSelect(d.payload as PerfRow) : undefined}
                isAnimationActive={false}
              >
                {k === 't3' && <LabelList dataKey="proficiencyRate" position="right" formatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)}% T1` : '')} style={{ fill: c.text2, fontSize: 10 }} />}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Learner counts per performance level (configured band colours). */
export function DistributionBars({ bands, onSelect, height = 220 }: { bands: { label: string; tier: Tier; color: string; count: number }[]; onSelect?: (b: { label: string; tier: Tier }) => void; height?: number }) {
  const c = useColors();
  if (!bands.length) return null;
  const total = bands.reduce((s, b) => s + b.count, 0);
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={bands} margin={{ top: 20, right: 8, bottom: 4, left: 0 }} barCategoryGap="25%" maxBarSize={48}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axisProps(c)} interval={0} height={36} tick={(p) => <WrappedTick x={Number(p.x)} y={Number(p.y)} payload={{ value: String(p.payload.value) }} fill={c.text2} />} />
          <YAxis allowDecimals={false} width={40} {...axisProps(c)} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.6 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const b = payload[0].payload as (typeof bands)[number];
              return (
                <TooltipBox title={b.label}>
                  {b.count.toLocaleString()} learners ({pct(total ? (b.count / total) * 100 : null)}) · {TIER_LABEL[b.tier]}
                  {onSelect && <div className="mt-1 text-ink-3">Click to see who</div>}
                </TooltipBox>
              );
            }}
          />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} cursor={onSelect ? 'pointer' : undefined} onClick={onSelect ? (d) => onSelect(d.payload as (typeof bands)[number]) : undefined} isAnimationActive={false}>
            {bands.map((b) => (
              <Cell key={b.label} fill={b.color.startsWith('var(--tier-') ? c.tier[`TIER_${b.color.slice(-2, -1)}` as Tier] : b.color} />
            ))}
            <LabelList dataKey="count" position="top" style={{ fill: c.text2, fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Axis label that wraps onto up to two lines instead of colliding with its neighbours. */
function WrappedTick({ x, y, payload, fill }: { x: number; y: number; payload: { value: string }; fill: string }) {
  const words = String(payload.value).split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + ' ' + w).length <= 12) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] = `${shown[1].slice(0, 10)}…`;
  return (
    <text x={x} y={y + 10} textAnchor="middle" fill={fill} fontSize={10}>
      {shown.map((l, i) => <tspan key={i} x={x} dy={i ? 11 : 0}>{l}</tspan>)}
      <title>{payload.value}</title>
    </text>
  );
}

export interface TrendData {
  terms: { key: number; label: string }[];
  series: { key: number; label: string }[];
  points: { term: number; series: number; avgPct: number | null; proficiencyRate: number | null; atRiskRate: number | null; assessed: number | null }[];
}

/** One metric across terms, one line per series; categorical slots are fixed by series order. */
export function TrendLines({ data, metric, height = 280, slotOf }: { data: TrendData; metric: 'avgPct' | 'proficiencyRate' | 'atRiskRate'; height?: number; slotOf?: (seriesKey: number) => number }) {
  const c = useColors();
  const rows = data.terms.map((t) => {
    const row: Record<string, string | number | null> = { term: t.label };
    for (const s of data.series) row[`s${s.key}`] = data.points.find((p) => p.term === t.key && p.series === s.key)?.[metric] ?? null;
    return row;
  });
  const many = data.series.length > 1;
  return (
    <div>
      {many && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {data.series.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ background: c.series[(slotOf?.(s.key) ?? i) % 8] }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="term" {...axisProps(c)} tick={{ fill: c.text2, fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} width={42} {...axisProps(c)} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <TooltipBox title={label}>
                    {payload.map((p) => (
                      <div key={String(p.dataKey)} className="flex items-center gap-1.5">
                        <span className="h-0.5 w-3 rounded" style={{ background: p.color }} />
                        {data.series.find((s) => `s${s.key}` === p.dataKey)?.label}: {pct(p.value as number)}
                      </div>
                    ))}
                  </TooltipBox>
                );
              }}
            />
            {data.series.map((s, i) => (
              <Line
                key={s.key}
                dataKey={`s${s.key}`}
                stroke={c.series[(slotOf?.(s.key) ?? i) % 8]}
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: c.surface, fill: c.series[(slotOf?.(s.key) ?? i) % 8] }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: c.surface, fill: c.series[(slotOf?.(s.key) ?? i) % 8] }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
            {!many && <Legend content={() => null} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Sequential single-hue heatmap (blue ramp), with the value printed in each cell. */
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];
export function Heatmap({ rows, cols, cells, metric, onSelect }: {
  rows: { key: number; label: string }[];
  cols: { key: number; label: string }[];
  cells: { row: number; col: number; avgPct: number | null; proficiencyRate: number | null; atRiskRate: number | null; assessed: number | null; suppressed: boolean }[];
  metric: 'avgPct' | 'proficiencyRate' | 'atRiskRate';
  onSelect?: (row: number, col: number) => void;
}) {
  const get = (r: number, cl: number) => cells.find((x) => x.row === r && x.col === cl);
  const color = (v: number) => RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.floor((v / 100) * RAMP.length)))];
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th key={c.key} scope="col" className="px-1 pb-1 text-center font-medium text-ink-3">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="whitespace-nowrap pr-2 text-left font-medium text-ink-2">{r.label}</th>
              {cols.map((cl) => {
                const cell = get(r.key, cl.key);
                const v = cell?.[metric];
                const dark = v != null && v >= 50;
                return (
                  <td key={cl.key} className="p-0">
                    <button
                      type="button"
                      disabled={!cell || v == null || !onSelect}
                      onClick={() => onSelect?.(r.key, cl.key)}
                      title={cell ? (cell.suppressed ? 'Too few learners to display' : `${r.label} · ${cl.label}: ${pct(v)} (${cell.assessed} results)`) : 'No data'}
                      className="num h-9 w-full min-w-16 rounded-sm px-1 text-center disabled:cursor-default"
                      style={{ background: v == null ? 'var(--surface-2)' : color(v), color: v == null ? 'var(--text-muted)' : dark ? '#ffffff' : '#0f172a' }}
                    >
                      {cell?.suppressed ? '<n' : v == null ? '—' : `${v.toFixed(0)}%`}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-3">
        <span>0%</span>
        <div className="flex h-2 w-40 overflow-hidden rounded">
          {RAMP.map((c) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <span>100%</span>
      </div>
    </div>
  );
}

/** Inline meter for a single rate (e.g. % not mastered) in tables. */
export function Meter({ value, tone = 'tier-3', label }: { value: number | null; tone?: 'tier-1' | 'tier-2' | 'tier-3' | 'brand'; label?: string }) {
  if (value === null || value === undefined) return <span className="text-ink-3">—</span>;
  return (
    <div className="flex min-w-28 items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded bg-surface-2">
        <div className="h-full rounded" style={{ width: `${Math.min(100, value)}%`, background: `var(--${tone})` }} />
      </div>
      <span className="num w-12 text-right text-xs text-ink">{label ?? pct(value, 0)}</span>
    </div>
  );
}
