import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { PerfRow, Query } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BreakdownCard, DIM_FILTER, DIM_LABEL, DistributionCard, KpiRow, LeastMasteredCard, useSummary, type Dim } from '../components/analytics';
import { Heatmap } from '../components/charts';
import { Button, Card, PageHeader, Select, Spinner, Tabs } from '../components/ui';
import { useApi, useBootstrap, usePeriod } from '../lib/hooks';
import { isLearnerLevel, isSchoolLevel } from '../lib/nav';

interface View {
  title: string;
  subtitle: string;
  /** Drill path: clicking a row filters by it and moves to the next dimension. */
  school: Dim[];
  division: Dim[];
}

const VIEWS: Record<string, View> = {
  results: { title: 'Assessment results', subtitle: 'Your classes by learning area, assessment and learner.', school: ['section', 'learningArea', 'assessment', 'learner'], division: [] },
  school: { title: 'School performance', subtitle: 'School → grade level → class → learning area → assessment → learner.', school: ['gradeLevel', 'section', 'learningArea', 'assessment', 'learner'], division: ['school', 'gradeLevel', 'section', 'learningArea', 'assessment'] },
  'grade-levels': { title: 'Grade levels', subtitle: 'Performance by grade level, drilling down to classes and learning areas.', school: ['gradeLevel', 'section', 'learningArea', 'assessment', 'learner'], division: ['gradeLevel', 'school', 'learningArea', 'assessment'] },
  'learning-areas': { title: 'Learning areas', subtitle: 'Performance by learning area across grade levels and schools.', school: ['learningArea', 'gradeLevel', 'section', 'assessment', 'learner'], division: ['learningArea', 'school', 'gradeLevel', 'assessment'] },
  'key-stages': { title: 'Key stages', subtitle: 'Performance by key stage, then grade level and learning area.', school: ['keyStage', 'gradeLevel', 'learningArea', 'section', 'learner'], division: ['keyStage', 'gradeLevel', 'learningArea', 'school'] },
  schools: { title: 'Schools', subtitle: 'School comparison (alphabetical — not a ranking), drilling into grade levels and learning areas.', school: ['gradeLevel', 'section', 'learningArea', 'assessment', 'learner'], division: ['school', 'gradeLevel', 'learningArea', 'assessment'] },
  assessments: { title: 'Assessment analytics', subtitle: 'Performance by assessment instrument (CRLA, Phil-IRI, RMA, quarterly…).', school: ['assessmentType', 'learningArea', 'gradeLevel', 'assessment', 'learner'], division: ['assessmentType', 'learningArea', 'school', 'gradeLevel'] },
  division: { title: 'Division overview', subtitle: 'Division → district → school → grade level → learning area → assessment.', school: ['gradeLevel', 'learningArea'], division: ['district', 'school', 'gradeLevel', 'learningArea', 'assessment'] },
};

const FILTER_KEYS = ['districtId', 'schoolId', 'keyStageId', 'gradeLevelId', 'sectionId', 'learningAreaId', 'assessmentTypeId', 'assessmentId', 'bandId', 'tier'] as const;
const GROUPABLE: Dim[] = ['district', 'school', 'keyStage', 'gradeLevel', 'section', 'learningArea', 'assessmentType', 'term', 'assessment', 'learner'];

export function PerformancePage() {
  const { view = 'school' } = useParams();
  const { user } = useAuth();
  const boot = useBootstrap();
  const period = usePeriod();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<'breakdown' | 'heatmap' | 'gaps'>('breakdown');
  const v = VIEWS[view] ?? VIEWS.school;
  const learnerLevel = isLearnerLevel(user!);
  const schoolLevel = isSchoolLevel(user!);
  const path = (schoolLevel ? v.school : v.division).filter((d) => learnerLevel || d !== 'learner');

  const filters: Query = useMemo(() => {
    const q: Query = { schoolYearId: period.schoolYearId, termId: period.termId };
    for (const k of FILTER_KEYS) if (sp.get(k)) q[k] = sp.get(k)!;
    return q;
  }, [sp, period.schoolYearId, period.termId]);

  const dim = (sp.get('dim') as Dim) || path[0] || 'gradeLevel';
  const nextDim = path[path.indexOf(dim) + 1];
  const summary = useSummary(filters);

  const setFilter = (k: string, val?: string | number) => {
    const n = new URLSearchParams(sp);
    if (val === undefined || val === '') n.delete(k);
    else n.set(k, String(val));
    setSp(n);
  };
  const drill = (r: PerfRow) => {
    if (dim === 'learner') return;
    const n = new URLSearchParams(sp);
    n.set(DIM_FILTER[dim], String(r.key));
    n.set(`${DIM_FILTER[dim]}L`, r.label);
    const next = nextDim ?? GROUPABLE.find((d) => d !== dim && !n.get(DIM_FILTER[d]) && (learnerLevel || d !== 'learner'));
    if (next) n.set('dim', next);
    setSp(n);
  };

  const b = boot.data;
  const opts = <T extends { id: number; name?: string; label?: string }>(xs: T[] | undefined) => (xs ?? []).map((x) => ({ value: x.id, label: x.name ?? x.label ?? String(x.id) }));
  const activeCount = FILTER_KEYS.filter((k) => sp.get(k)).length;

  return (
    <>
      <PageHeader title={v.title} subtitle={v.subtitle} />
      <Card className="mb-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
          {!schoolLevel && <Select aria-label="District" value={sp.get('districtId') ?? ''} onChange={(e) => setFilter('districtId', e.target.value)} options={opts(b?.districts)} placeholder="All districts" />}
          {!schoolLevel && <Select aria-label="School" value={sp.get('schoolId') ?? ''} onChange={(e) => setFilter('schoolId', e.target.value)} options={opts(b?.schools)} placeholder="All schools" />}
          <Select aria-label="Key stage" value={sp.get('keyStageId') ?? ''} onChange={(e) => setFilter('keyStageId', e.target.value)} options={opts(b?.keyStages)} placeholder="All key stages" />
          <Select aria-label="Grade level" value={sp.get('gradeLevelId') ?? ''} onChange={(e) => setFilter('gradeLevelId', e.target.value)} options={opts(b?.gradeLevels)} placeholder="All grades" />
          <Select aria-label="Learning area" value={sp.get('learningAreaId') ?? ''} onChange={(e) => setFilter('learningAreaId', e.target.value)} options={opts(b?.learningAreas.filter((l) => l.inScope))} placeholder="All learning areas" />
          <Select aria-label="Assessment type" value={sp.get('assessmentTypeId') ?? ''} onChange={(e) => setFilter('assessmentTypeId', e.target.value)} options={opts(b?.assessmentTypes)} placeholder="All assessments" />
          <Select aria-label="Group by" value={dim} onChange={(e) => setFilter('dim', e.target.value)} options={GROUPABLE.filter((d) => (learnerLevel || d !== 'learner') && !(schoolLevel && (d === 'district' || d === 'school'))).map((d) => ({ value: d, label: `Group by ${DIM_LABEL[d].toLowerCase()}` }))} />
        </div>
        <Crumbs sp={sp} setSp={setSp} />
        {activeCount > 0 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setSp(new URLSearchParams())}>Clear filters</Button>}
      </Card>

      {summary.data && <KpiRow s={summary.data} learnerLevel={learnerLevel} />}

      <div className="mt-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'breakdown', label: `By ${DIM_LABEL[dim].toLowerCase()}` }, { value: 'heatmap', label: 'Heatmap' }, { value: 'gaps', label: 'Competency gaps' }]} />
        {tab === 'breakdown' && (
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <BreakdownCard
                title={`Performance by ${DIM_LABEL[dim].toLowerCase()}`}
                subtitle={dim === 'learner' ? 'Select a learner to open their profile.' : nextDim ? `Click a bar or row to drill into ${DIM_LABEL[nextDim].toLowerCase()}.` : 'Click a row to drill further.'}
                dim={dim}
                filters={filters}
                onSelect={dim === 'learner' ? undefined : drill}
              />
            </div>
            <DistributionCard
              filters={filters}
              onSelect={(band) => {
                const n = new URLSearchParams(sp);
                n.set('tier', band.tier);
                n.set('dim', learnerLevel ? 'learner' : dim);
                setSp(n);
              }}
              title="Performance levels"
            />
          </div>
        )}
        {tab === 'heatmap' && <HeatmapTab filters={filters} schoolLevel={schoolLevel} onCell={(rk, rv, ck, cv) => { const n = new URLSearchParams(sp); n.set(rk, String(rv)); n.set(ck, String(cv)); n.set('dim', nextDim ?? 'assessment'); setSp(n); setTab('breakdown'); }} />}
        {tab === 'gaps' && <LeastMasteredCard filters={filters} limit={40} learnerLevel={learnerLevel} />}
      </div>
    </>
  );
}

function HeatmapTab({ filters, schoolLevel, onCell }: { filters: Query; schoolLevel: boolean; onCell: (rk: string, rv: number, ck: string, cv: number) => void }) {
  const [rows, setRows] = useState<Dim>(schoolLevel ? 'gradeLevel' : 'school');
  const [metric, setMetric] = useState<'proficiencyRate' | 'atRiskRate' | 'avgPct'>('proficiencyRate');
  const q = useApi<{ rows: { key: number; label: string }[]; cols: { key: number; label: string }[]; cells: never[] }>('/analytics/heatmap', { ...filters, rows, cols: 'learningArea' });
  return (
    <Card
      title="Heatmap"
      subtitle="Click a cell to drill down."
      actions={
        <>
          <Select className="h-8 w-44 text-xs" aria-label="Rows" value={rows} onChange={(e) => setRows(e.target.value as Dim)} options={(schoolLevel ? ['gradeLevel', 'section', 'keyStage'] : ['school', 'gradeLevel', 'keyStage', 'district']).map((d) => ({ value: d, label: `Rows: ${DIM_LABEL[d as Dim]}` }))} />
          <Select className="h-8 w-52 text-xs" aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} options={[{ value: 'proficiencyRate', label: 'Meeting standard (%)' }, { value: 'atRiskRate', label: 'Requiring intervention (%)' }, { value: 'avgPct', label: 'Average score (%)' }]} />
        </>
      }
    >
      {q.isLoading ? <Spinner /> : q.data && <Heatmap {...q.data} metric={metric} onSelect={(r, c) => onCell(DIM_FILTER[rows], r, 'learningAreaId', c)} />}
    </Card>
  );
}

/** Active drill filters as removable chips. */
function Crumbs({ sp, setSp }: { sp: URLSearchParams; setSp: (s: URLSearchParams) => void }) {
  const boot = useBootstrap().data;
  const labels: Record<string, (v: string) => string | undefined> = {
    districtId: (v) => boot?.districts.find((x) => x.id === +v)?.name,
    schoolId: (v) => boot?.schools.find((x) => x.id === +v)?.name,
    keyStageId: (v) => boot?.keyStages.find((x) => x.id === +v)?.name,
    gradeLevelId: (v) => boot?.gradeLevels.find((x) => x.id === +v)?.name,
    learningAreaId: (v) => boot?.learningAreas.find((x) => x.id === +v)?.name,
    assessmentTypeId: (v) => boot?.assessmentTypes.find((x) => x.id === +v)?.name,
    sectionId: (v) => `Class #${v}`,
    assessmentId: (v) => `Assessment #${v}`,
    tier: (v) => v.replace('TIER_', 'Tier '),
    bandId: (v) => `Level #${v}`,
  };
  const active = FILTER_KEYS.filter((k) => sp.get(k));
  if (!active.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {active.map((k) => (
        <button
          key={k}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs text-ink-2 hover:border-brand"
          onClick={() => {
            const n = new URLSearchParams(sp);
            n.delete(k);
            n.delete(`${k}L`);
            setSp(n);
          }}
          aria-label={`Remove filter ${labels[k]?.(sp.get(k)!)}`}
        >
          {sp.get(`${k}L`) ?? labels[k]?.(sp.get(k)!) ?? sp.get(k)} <span aria-hidden>✕</span>
        </button>
      ))}
    </div>
  );
}
