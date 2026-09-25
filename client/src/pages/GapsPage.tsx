import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Paged, Query, Tier } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { GapLevel, LeastMasteredCard } from '../components/analytics';
import { InterventionForm, type InterventionSeed } from '../components/InterventionForm';
import { Button, Card, Empty, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Tabs, TierBadge } from '../components/ui';
import { pct } from '../lib/format';
import { useApi, useBootstrap, usePeriod } from '../lib/hooks';
import { isLearnerLevel, isSchoolLevel } from '../lib/nav';

interface GapRow { id: number; status: string; severity: Tier; masteryPct: number | null; learner: { id: number; lrn: string; name: string }; competency: { id: number; code: string; description: string } | null; learningAreaId: number; sectionId: number; assessment: { id: number; title: string; learningArea: { name: string }; term: { name: string } }; result: { percentage: number | null; tier: Tier | null; band: { label: string } | null }; interventions: { id: number; title: string; status: string }[] }
interface Group { key: string; label: string; section: string; sectionId: number; learningAreaId: number; learningArea: string; competency: { id: number; code: string } | null; size: number; notInIntervention: number; learners: GapRow[] }

export function GapsPage() {
  const { user, can } = useAuth();
  const period = usePeriod();
  const boot = useBootstrap().data;
  const [sp] = useSearchParams();
  const learnerLevel = isLearnerLevel(user!);
  const [la, setLa] = useState('');
  const [grade, setGrade] = useState('');
  const [school, setSchool] = useState('');
  const base: Query = { schoolYearId: period.schoolYearId, termId: period.termId, learningAreaId: la, gradeLevelId: grade, schoolId: school, assessmentId: sp.get('assessmentId') ?? undefined };
  const [tab, setTab] = useState<'competencies' | 'groups' | 'learners' | 'persistent'>(sp.get('competencyId') || sp.get('assessmentId') ? 'learners' : 'competencies');
  const focus = sp.get('competencyId') ?? sp.get('assessmentId');
  useEffect(() => {
    if (focus && learnerLevel) setTab('learners');
  }, [focus, learnerLevel]);
  return (
    <>
      <PageHeader title="Learning gaps" subtitle="Competencies and learners that need attention — from individual gaps to class, school and division-wide patterns — and the learners not yet covered by an intervention." />
      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Select aria-label="Learning area" value={la} onChange={(e) => setLa(e.target.value)} options={(boot?.learningAreas ?? []).filter((l) => l.inScope).map((l) => ({ value: l.id, label: l.name }))} placeholder="All learning areas" />
          <Select aria-label="Grade level" value={grade} onChange={(e) => setGrade(e.target.value)} options={(boot?.gradeLevels ?? []).map((l) => ({ value: l.id, label: l.name }))} placeholder="All grades" />
          {!isSchoolLevel(user!) && <Select aria-label="School" value={school} onChange={(e) => setSchool(e.target.value)} options={(boot?.schools ?? []).map((l) => ({ value: l.id, label: l.name }))} placeholder="All schools" />}
        </div>
      </Card>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'competencies', label: 'Least-mastered competencies' },
        ...(learnerLevel ? [{ value: 'groups' as const, label: 'Suggested intervention groups' }, { value: 'learners' as const, label: 'Individual gaps' }] : []),
        { value: 'persistent', label: 'Persistent gaps' },
      ]} />
      {tab === 'competencies' && <LeastMasteredCard filters={base} limit={50} learnerLevel={learnerLevel} title="Competencies ranked by share not mastered" />}
      {tab === 'groups' && <Groups filters={base} canPlan={can('intervention:write')} />}
      {tab === 'learners' && <Individual filters={{ ...base, competencyId: sp.get('competencyId') ?? undefined }} canPlan={can('intervention:write')} />}
      {tab === 'persistent' && <Persistent filters={base} />}
      {!learnerLevel && <p className="mt-3 text-xs text-ink-3">Gap level: <GapLevel level="DIVISION" /> shared by several schools · <GapLevel level="SCHOOL" /> several classes in one school · <GapLevel level="CLASS" /> one class. Thresholds are set by the division administrator.</p>}
    </>
  );
}

function Groups({ filters, canPlan }: { filters: Query; canPlan: boolean }) {
  const q = useApi<Group[]>('/gaps/groups', filters);
  const nav = useNavigate();
  const [seed, setSeed] = useState<InterventionSeed | null>(null);
  if (q.isLoading) return <Spinner />;
  if (!q.data?.length) return <Card><Empty title="No open learning gaps" icon="check" /></Card>;
  return (
    <>
      <p className="mb-3 text-sm text-ink-2">Learners sharing the same unmastered competency (or the same reading/numeracy profile) are grouped so one intervention can serve them together. These are suggestions — the teacher decides.</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {q.data.slice(0, 40).map((g) => (
          <Card key={g.key} title={g.label} subtitle={`${g.section} · ${g.learningArea} · ${g.size} learner${g.size > 1 ? 's' : ''}, ${g.notInIntervention} without an intervention`}
            actions={canPlan && g.notInIntervention > 0 ? <Button size="sm" onClick={() => setSeed({
              title: `Remediation: ${g.competency ? g.competency.code : g.label}`.slice(0, 150),
              sectionId: g.sectionId,
              learningAreaId: g.learningAreaId,
              competencyIds: g.competency ? [g.competency.id] : [],
              tier: g.learners.filter((l) => l.severity === 'TIER_3').length > g.size / 2 ? 'TIER_3' : 'TIER_2',
              sourceAssessmentId: g.learners[0]?.assessment.id,
              learners: g.learners.filter((l) => !l.interventions.length).map((l) => ({ learnerId: l.learner.id, learningGapId: l.id, name: l.learner.name })),
            })}>Plan intervention</Button> : null}>
            <ul className="flex flex-wrap gap-1.5">
              {g.learners.map((l) => (
                <li key={l.id}>
                  <Link to={`/learners/${l.learner.id}`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${l.interventions.length ? 'border-line text-ink-3' : 'border-line text-ink hover:border-brand'}`} title={l.interventions.length ? `In: ${l.interventions.map((i) => i.title).join(', ')}` : 'Not yet in an intervention'}>
                    <span className="h-2 w-2 rounded-sm" style={{ background: `var(--tier-${l.severity.slice(-1)})` }} />
                    {l.learner.name}{l.masteryPct != null ? ` · ${Math.round(l.masteryPct)}%` : ''}{l.interventions.length ? ' ✓' : ''}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {seed && <InterventionForm seed={seed} onClose={() => setSeed(null)} onCreated={(id) => nav(`/interventions/${id}`)} />}
    </>
  );
}

function Individual({ filters, canPlan }: { filters: Query; canPlan: boolean }) {
  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Map<number, GapRow>>(new Map());
  const [seed, setSeed] = useState<InterventionSeed | null>(null);
  const nav = useNavigate();
  const q = useApi<Paged<GapRow>>('/gaps', { ...filters, status, page, perPage: 50 });
  const toggle = (g: GapRow) => setSelected((m) => { const n = new Map(m); if (n.has(g.id)) n.delete(g.id); else n.set(g.id, g); return n; });
  const sel = [...selected.values()];
  const las = new Set(sel.map((g) => g.learningAreaId));
  return (
    <Card pad={false} title="Individual learning gaps" actions={
      <>
        <Select className="h-8 w-40 text-xs" aria-label="Gap status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: 'OPEN', label: 'Open' }, { value: 'IN_INTERVENTION', label: 'In intervention' }, { value: 'RESOLVED', label: 'Resolved' }]} placeholder="All statuses" />
        {canPlan && <Button size="sm" disabled={!sel.length || las.size > 1} title={las.size > 1 ? 'Select gaps from one learning area' : undefined} onClick={() => setSeed({
          learningAreaId: sel[0].learningAreaId,
          sectionId: new Set(sel.map((g) => g.sectionId)).size === 1 ? sel[0].sectionId : null,
          competencyIds: [...new Set(sel.filter((g) => g.competency).map((g) => g.competency!.id))],
          sourceAssessmentId: sel[0].assessment.id,
          tier: sel.filter((g) => g.severity === 'TIER_3').length > sel.length / 2 ? 'TIER_3' : 'TIER_2',
          learners: [...new Map(sel.map((g) => [g.learner.id, { learnerId: g.learner.id, learningGapId: g.id, name: g.learner.name }])).values()],
        })}>Plan intervention for {sel.length || ''} selected</Button>}
      </>
    }>
      {q.isLoading ? <Spinner /> : (
        <>
          <Table rows={q.data?.data ?? []} rowKey={(r) => r.id} empty="No gaps match" columns={[
            ...(canPlan ? [{ key: 'sel', label: '', render: (r: GapRow) => <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r)} aria-label={`Select ${r.learner.name}`} /> }] : []),
            { key: 'learner', label: 'Learner', render: (r) => <Link className="font-medium hover:text-brand" to={`/learners/${r.learner.id}`}>{r.learner.name}</Link> },
            { key: 'gap', label: 'Competency / gap', render: (r) => r.competency ? <span><span className="font-medium">{r.competency.code}</span> <span className="text-xs text-ink-2">{r.competency.description}</span></span> : <span className="text-xs">{r.assessment.learningArea.name}: {r.result.band?.label ?? 'below standard'}</span> },
            { key: 'from', label: 'Source', render: (r) => <Link className="text-xs text-brand hover:underline" to={`/assessments/${r.assessment.id}`}>{r.assessment.term.name} · {r.assessment.learningArea.name}</Link> },
            { key: 'm', label: 'Mastery', align: 'right', render: (r) => pct(r.masteryPct, 0) },
            { key: 'sev', label: 'Severity', render: (r) => <TierBadge tier={r.severity} /> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'int', label: 'Intervention', render: (r) => r.interventions.length ? <Link className="text-xs text-brand hover:underline" to={`/interventions/${r.interventions[0].id}`}>{r.interventions[0].title}</Link> : <span className="text-xs text-ink-3">—</span> },
          ]} />
          {q.data && <Pagination {...q.data.meta} onPage={setPage} />}
        </>
      )}
      {seed && <InterventionForm seed={seed} onClose={() => setSeed(null)} onCreated={(id) => nav(`/interventions/${id}`)} />}
    </Card>
  );
}

function Persistent({ filters }: { filters: Query }) {
  const q = useApi<{ school: number; schoolName: string; gradeLevelName: string; learningAreaName: string; terms: string[]; latestAtRiskRate: number }[]>('/analytics/persistent-gaps', { ...filters, schoolYearId: undefined, termId: undefined });
  return (
    <Card title="Persistent gaps" subtitle="Grade / learning-area combinations that stayed above the at-risk alert rate for consecutive terms." pad={false}>
      {q.isLoading ? <Spinner /> : (
        <Table rows={q.data ?? []} rowKey={(r) => `${r.school}${r.gradeLevelName}${r.learningAreaName}`} empty="No persistent gaps detected" columns={[
          { key: 'schoolName', label: 'School' },
          { key: 'gradeLevelName', label: 'Grade' },
          { key: 'learningAreaName', label: 'Learning area' },
          { key: 'terms', label: 'Consecutive terms', render: (r) => <span className="text-xs">{r.terms.join(' → ')}</span> },
          { key: 'latestAtRiskRate', label: 'Latest at-risk', align: 'right', render: (r) => pct(r.latestAtRiskRate) },
        ]} />
      )}
    </Card>
  );
}
