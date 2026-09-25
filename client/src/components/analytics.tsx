import { Link, useNavigate } from 'react-router-dom';
import type { PerfRow, Query } from '../api/client';
import { useApi } from '../lib/hooks';
import { humanize, num, pct } from '../lib/format';
import { DistributionBars, Meter, TierBars, TrendLines, type TrendData } from './charts';
import { Badge, Card, Empty, ErrorBox, Kpi, Spinner, Table, type Column } from './ui';

export type Dim = 'district' | 'school' | 'keyStage' | 'gradeLevel' | 'section' | 'learningArea' | 'assessmentType' | 'schoolYear' | 'term' | 'assessment' | 'band' | 'learner';
export const DIM_LABEL: Record<Dim, string> = {
  district: 'District', school: 'School', keyStage: 'Key stage', gradeLevel: 'Grade level', section: 'Class', learningArea: 'Learning area',
  assessmentType: 'Assessment type', schoolYear: 'School year', term: 'Term', assessment: 'Assessment', band: 'Performance level', learner: 'Learner',
};
export const DIM_FILTER: Record<Dim, string> = {
  district: 'districtId', school: 'schoolId', keyStage: 'keyStageId', gradeLevel: 'gradeLevelId', section: 'sectionId', learningArea: 'learningAreaId',
  assessmentType: 'assessmentTypeId', schoolYear: 'schoolYearId', term: 'termId', assessment: 'assessmentId', band: 'bandId', learner: 'learnerId',
};

export interface Summary {
  enrolledLearners: number;
  learnersAssessed: number;
  averagePercentage: number | null;
  assessed: number;
  tier1: number;
  tier2: number;
  tier3: number;
  proficiencyRate: number | null;
  atRiskRate: number | null;
  tier3Rate: number | null;
  completion: { assessments: number; draft: number; submitted: number; verified: number; returned: number; finalized: number; encoded: number; enrolled: number; completionRate: number | null; finalizationRate: number | null } | null;
  coverage: { identified: number; covered: number; coverageRate: number | null; gaps: number; resolvedGaps: number } | null;
  outcomes: { interventions: number; byStatus: Record<string, number>; learnersInIntervention: number; reassessed: number; improved: number; reachedStandard: number; improvementRate: number | null; averageGain: number | null };
  distribution: { label: string; tier: 'TIER_1' | 'TIER_2' | 'TIER_3'; color: string; count: number }[];
}

export function useSummary(filters: Query) {
  return useApi<Summary>('/analytics/summary', filters);
}

export function KpiRow({ s, learnerLevel, links }: { s: Summary; learnerLevel: boolean; links?: { atRisk?: string; gaps?: string; interventions?: string; assessments?: string } }) {
  const c = s.completion;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi label={learnerLevel ? 'Learners enrolled' : 'Learners enrolled (scope)'} value={num(s.enrolledLearners)} hint={`${num(s.learnersAssessed)} assessed`} />
      <Kpi label="Average score" value={pct(s.averagePercentage)} hint="percentage-based assessments" />
      <Kpi label="Meeting expected standard" value={pct(s.proficiencyRate)} hint={`${num(s.tier1)} Tier 1 results`} />
      <Kpi label="Requiring intervention" value={pct(s.atRiskRate)} hint={`${num(s.tier2 + s.tier3)} Tier 2–3 · ${pct(s.tier3Rate, 0)} Tier 3`} tone={s.atRiskRate != null && s.atRiskRate >= 40 ? 'bad' : s.atRiskRate != null && s.atRiskRate >= 25 ? 'warn' : 'good'} to={links?.atRisk} />
      <Kpi label="Assessment completion" value={pct(c?.completionRate ?? null)} hint={c ? `${c.finalized}/${c.assessments} finalized · ${c.submitted} awaiting verification` : undefined} tone={c?.completionRate != null && c.completionRate < 80 ? 'warn' : 'good'} to={links?.assessments} />
      <Kpi
        label="Intervention coverage"
        value={pct(s.coverage?.coverageRate ?? null)}
        hint={s.outcomes.reassessed ? `${pct(s.outcomes.improvementRate, 0)} of ${s.outcomes.reassessed} reassessed improved` : `${num(s.coverage?.covered)} of ${num(s.coverage?.identified)} learners with gaps`}
        tone={s.coverage?.coverageRate != null && s.coverage.coverageRate < 60 ? 'warn' : 'good'}
        to={links?.interventions}
      />
    </div>
  );
}

/** Breakdown card: tier bars + table, rows drill down through `onSelect`. */
export function BreakdownCard({ title, subtitle, dim, filters, onSelect, showTable = true, limit }: { title: string; subtitle?: string; dim: Dim; filters: Query; onSelect?: (r: PerfRow) => void; showTable?: boolean; limit?: number }) {
  const q = useApi<PerfRow[]>('/analytics/breakdown', { ...filters, dim });
  const rows = (q.data ?? []).slice(0, limit ?? 1000);
  const suppressed = rows.filter((r) => r.suppressed).length;
  return (
    <Card title={title} subtitle={subtitle}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : !rows.length ? <Empty title="No finalized results for these filters" /> : (
        <>
          <TierBars rows={rows} onSelect={onSelect} />
          {suppressed > 0 && <p className="mt-2 text-[11px] text-ink-3">{suppressed} group{suppressed > 1 ? 's' : ''} hidden: too few learners to show without risking identification.</p>}
          {showTable && <PerfTable rows={rows} dim={dim} onSelect={onSelect} />}
        </>
      )}
    </Card>
  );
}

export function PerfTable({ rows, dim, onSelect }: { rows: PerfRow[]; dim: Dim; onSelect?: (r: PerfRow) => void }) {
  const cols: Column<PerfRow>[] = [
    { key: 'label', label: DIM_LABEL[dim], render: (r) => (
      <span className="font-medium">
        {dim === 'learner' ? <Link className="text-brand hover:underline" to={`/learners/${r.key}`} onClick={(e) => e.stopPropagation()}>{r.label}</Link> : r.label}
        {r.meta?.school && dim === 'section' ? <span className="ml-1 text-xs font-normal text-ink-3">{String(r.meta.school)}</span> : null}
        {r.suppressed && <Badge>suppressed</Badge>}
      </span>
    ) },
    { key: 'assessed', label: 'Results', align: 'right', render: (r) => num(r.assessed) },
    { key: 'learners', label: 'Learners', align: 'right', render: (r) => num(r.learners) },
    { key: 'avgPct', label: 'Avg %', align: 'right', render: (r) => pct(r.avgPct) },
    { key: 'proficiencyRate', label: 'Meeting standard', render: (r) => <Meter value={r.proficiencyRate} tone="tier-1" /> },
    { key: 'atRiskRate', label: 'Needs intervention', render: (r) => <Meter value={r.atRiskRate} tone="tier-3" /> },
  ];
  return (
    <details className="mt-3" open={rows.length <= 12}>
      <summary className="cursor-pointer text-xs font-medium text-ink-2">Table view ({rows.length})</summary>
      <div className="mt-2">
        <Table columns={cols} rows={rows} rowKey={(r) => r.key} onRowClick={onSelect} dense />
      </div>
    </details>
  );
}

export function DistributionCard({ filters, onSelect, title = 'Performance level distribution' }: { filters: Query; onSelect?: (b: { label: string; tier: string }) => void; title?: string }) {
  const q = useApi<Summary['distribution']>('/analytics/distribution', filters);
  // Different instruments have different level scales; mixing them is only readable as tiers.
  const mixed = new Set((q.data ?? []).map((b) => b.label)).size > 6 || !filters.assessmentTypeId;
  const bands = mixed ? collapseToTiers(q.data ?? []) : q.data ?? [];
  return (
    <Card title={title} subtitle={mixed ? 'Results per tier across all instruments. Choose one assessment type to see its own performance levels.' : 'Learners per configured performance level.'}>
      {q.isLoading ? <Spinner /> : !bands.length ? <Empty title="No results yet" /> : <DistributionBars bands={bands} onSelect={onSelect} />}
    </Card>
  );
}

const TIER_NAMES = { TIER_1: 'Tier 1 (meets)', TIER_2: 'Tier 2 (targeted)', TIER_3: 'Tier 3 (intensive)' } as const;
function collapseToTiers(bands: Summary['distribution']): Summary['distribution'] {
  return (['TIER_1', 'TIER_2', 'TIER_3'] as const)
    .map((t) => ({ label: TIER_NAMES[t], tier: t, color: `var(--tier-${t.slice(-1)})`, count: bands.filter((b) => b.tier === t).reduce((s, b) => s + b.count, 0) }))
    .filter((b) => b.count > 0);
}

export interface LeastMasteredRow {
  competencyId: number;
  code: string;
  description: string;
  learningArea?: { id: number; name: string };
  gradeLevel?: { id: number; name: string };
  assessed: number | null;
  notMastered: number | null;
  notMasteredRate: number | null;
  gapSections: number | null;
  gapSchools: number | null;
  sections: number | null;
  schools: number | null;
  level: 'DIVISION' | 'SCHOOL' | 'CLASS' | 'INDIVIDUAL';
  suppressed: boolean;
}

const LEVEL_TONE = { DIVISION: 'red', SCHOOL: 'amber', CLASS: 'blue', INDIVIDUAL: 'slate' } as const;
export function GapLevel({ level }: { level: LeastMasteredRow['level'] }) {
  return <Badge tone={LEVEL_TONE[level]}>{humanize(level)}-level</Badge>;
}

export function LeastMasteredCard({ filters, limit = 8, learnerLevel, title = 'Least-mastered competencies' }: { filters: Query; limit?: number; learnerLevel: boolean; title?: string }) {
  const q = useApi<LeastMasteredRow[]>('/analytics/least-mastered', { ...filters, limit });
  const nav = useNavigate();
  return (
    <Card title={title} subtitle="Ranked by share of learners not mastering the competency." actions={<Link to="/gaps" className="text-xs text-brand hover:underline">All learning gaps →</Link>}>
      {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty title="No competency-level results yet" /> : (
        <Table
          dense
          rows={q.data}
          rowKey={(r) => r.competencyId}
          onRowClick={learnerLevel ? (r) => nav(`/gaps?competencyId=${r.competencyId}`) : undefined}
          columns={[
            { key: 'code', label: 'Competency', render: (r) => <div><div className="font-medium">{r.code}</div><div className="text-xs text-ink-3">{r.description}</div></div> },
            { key: 'grade', label: 'Grade / area', render: (r) => <span className="text-xs text-ink-2">{r.gradeLevel?.name} · {r.learningArea?.name}</span> },
            { key: 'rate', label: 'Not mastered', render: (r) => <Meter value={r.notMasteredRate} label={r.suppressed ? '<n' : `${r.notMastered}/${r.assessed}`} /> },
            { key: 'level', label: 'Pattern', render: (r) => <div className="space-y-0.5"><GapLevel level={r.level} /><div className="text-[11px] text-ink-3">{r.gapSections ?? '–'} class(es) · {r.gapSchools ?? '–'} school(s)</div></div> },
          ]}
        />
      )}
    </Card>
  );
}

export function TrendCard({ filters, series, title = 'Performance across terms', metric = 'avgPct' }: { filters: Query; series?: Dim; title?: string; metric?: 'avgPct' | 'proficiencyRate' | 'atRiskRate' }) {
  const q = useApi<TrendData>('/analytics/trend', { ...filters, series });
  const metricLabel = { avgPct: 'Average score', proficiencyRate: 'Share meeting the standard', atRiskRate: 'Share requiring intervention' }[metric];
  return (
    <Card title={title} subtitle={`${metricLabel} per term${series ? `, by ${DIM_LABEL[series].toLowerCase()}` : ''}.`}>
      {q.isLoading ? <Spinner /> : !q.data?.terms.length ? <Empty title="No trend data" /> : <TrendLines data={q.data} metric={metric} />}
    </Card>
  );
}

export function OutcomesCard({ s }: { s: Summary }) {
  const o = s.outcomes;
  const order = ['IDENTIFIED', 'PLANNED', 'ONGOING', 'FOR_MONITORING', 'REASSESSMENT_REQUIRED', 'COMPLETED'];
  const max = Math.max(1, ...Object.values(o.byStatus));
  return (
    <Card title="Intervention monitoring" subtitle="Status of interventions and evidence of improvement after reassessment." actions={<Link to="/interventions" className="text-xs text-brand hover:underline">Open →</Link>}>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div><div className="num text-xl font-semibold">{num(o.learnersInIntervention)}</div><div className="text-[11px] text-ink-3">learners supported</div></div>
        <div><div className="num text-xl font-semibold">{num(o.reassessed)}</div><div className="text-[11px] text-ink-3">reassessed</div></div>
        <div><div className="num text-xl font-semibold">{pct(o.improvementRate, 0)}</div><div className="text-[11px] text-ink-3">improved{o.averageGain != null ? ` · +${o.averageGain} pts avg` : ''}</div></div>
      </div>
      <div className="mt-4 space-y-1.5">
        {order.filter((k) => o.byStatus[k]).map((k) => (
          <div key={k} className="flex items-center gap-2 text-xs">
            <span className="w-40 text-ink-2">{humanize(k)}</span>
            <div className="h-2 flex-1 rounded bg-surface-2"><div className="h-full rounded bg-brand" style={{ width: `${(o.byStatus[k] / max) * 100}%` }} /></div>
            <span className="num w-8 text-right">{o.byStatus[k]}</span>
          </div>
        ))}
        {!o.interventions && <Empty title="No interventions recorded yet" />}
      </div>
    </Card>
  );
}
