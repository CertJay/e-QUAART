import { useState } from 'react';
import type { Query } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { DIM_LABEL, type Dim } from '../components/analytics';
import { TrendLines, type TrendData } from '../components/charts';
import { Card, Empty, PageHeader, Select, Spinner, Table } from '../components/ui';
import { pct } from '../lib/format';
import { useApi, useBootstrap } from '../lib/hooks';
import { isSchoolLevel } from '../lib/nav';

export function TrendsPage() {
  const { user } = useAuth();
  const boot = useBootstrap().data;
  const schoolLevel = isSchoolLevel(user!);
  const [series, setSeries] = useState<Dim | ''>('learningArea');
  const [metric, setMetric] = useState<'avgPct' | 'proficiencyRate' | 'atRiskRate'>('proficiencyRate');
  const [f, setF] = useState<Query>({});
  const q = useApi<TrendData>('/analytics/trend', { ...f, series: series || undefined });
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v || undefined }));
  const seriesOpts: Dim[] = schoolLevel ? ['learningArea', 'gradeLevel', 'keyStage', 'assessmentType'] : ['learningArea', 'keyStage', 'gradeLevel', 'school', 'district', 'assessmentType'];
  const metricLabel = { avgPct: 'Average score', proficiencyRate: 'Meeting standard', atRiskRate: 'Requiring intervention' }[metric];
  // Fixed colour slot per entity: learning areas / grades follow their configured order.
  const slotOf = (key: number) => {
    const list = series === 'learningArea' ? boot?.learningAreas : series === 'gradeLevel' ? boot?.gradeLevels : series === 'keyStage' ? boot?.keyStages : series === 'school' ? boot?.schools : undefined;
    const i = list?.findIndex((x) => x.id === key) ?? -1;
    return i >= 0 ? i : 0;
  };
  return (
    <>
      <PageHeader title="Performance trends" subtitle="Compare terms and school years. Metrics are computed identically for every term so comparisons are fair." />
      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Select aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} options={[{ value: 'proficiencyRate', label: 'Meeting standard (%)' }, { value: 'atRiskRate', label: 'Requiring intervention (%)' }, { value: 'avgPct', label: 'Average score (%)' }]} />
          <Select aria-label="Series" value={series} onChange={(e) => setSeries(e.target.value as Dim)} options={seriesOpts.map((d) => ({ value: d, label: `Lines: ${DIM_LABEL[d]}` }))} placeholder="Single line (all)" />
          <Select aria-label="Assessment type" value={String(f.assessmentTypeId ?? '')} onChange={(e) => set('assessmentTypeId', e.target.value)} options={(boot?.assessmentTypes ?? []).map((t) => ({ value: t.id, label: t.name }))} placeholder="All assessments" />
          <Select aria-label="Learning area" value={String(f.learningAreaId ?? '')} onChange={(e) => set('learningAreaId', e.target.value)} options={(boot?.learningAreas ?? []).filter((l) => l.inScope).map((t) => ({ value: t.id, label: t.name }))} placeholder="All learning areas" />
          <Select aria-label="Grade level" value={String(f.gradeLevelId ?? '')} onChange={(e) => set('gradeLevelId', e.target.value)} options={(boot?.gradeLevels ?? []).map((t) => ({ value: t.id, label: t.name }))} placeholder="All grades" />
          {!schoolLevel && <Select aria-label="School" value={String(f.schoolId ?? '')} onChange={(e) => set('schoolId', e.target.value)} options={(boot?.schools ?? []).map((t) => ({ value: t.id, label: t.name }))} placeholder="All schools" />}
        </div>
      </Card>
      <Card title={`${metricLabel} by term`}>
        {q.isLoading ? <Spinner /> : !q.data?.terms.length ? <Empty title="No data" /> : <TrendLines data={q.data} metric={metric} height={360} slotOf={series ? slotOf : undefined} />}
      </Card>
      {q.data && q.data.terms.length > 0 && (
        <Card className="mt-4" title="Table view" pad={false}>
          <Table
            dense
            rows={q.data.series}
            rowKey={(s) => s.key}
            columns={[
              { key: 'label', label: series ? DIM_LABEL[series] : 'Series' },
              ...q.data.terms.map((t) => ({
                key: `t${t.key}`,
                label: t.label,
                align: 'right' as const,
                render: (s: { key: number }) => pct(q.data!.points.find((p) => p.term === t.key && p.series === s.key)?.[metric] ?? null),
              })),
            ]}
          />
        </Card>
      )}
    </>
  );
}
