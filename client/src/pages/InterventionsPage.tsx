import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Paged, Tier } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { OutcomesCard, useSummary } from '../components/analytics';
import { InterventionForm } from '../components/InterventionForm';
import { Button, Card, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Tabs, TierBadge } from '../components/ui';
import { date } from '../lib/format';
import { useApi, useBootstrap, usePeriod } from '../lib/hooks';
import { isSchoolLevel } from '../lib/nav';

interface Row { id: number; title: string; status: string; tier: Tier; strategy: string; startDate: string | null; targetEndDate: string | null; school: { name: string }; section: { name: string; gradeLevel: { name: string } } | null; learningArea: { name: string }; owner: { fullName: string }; learnerCount: number; reassessedCount: number; improvedCount: number; sessionCount: number }
type S = '' | 'PLANNED' | 'ONGOING' | 'REASSESSMENT_REQUIRED' | 'FOR_MONITORING' | 'COMPLETED';

export function InterventionsPage() {
  const { can, user } = useAuth();
  const period = usePeriod();
  const boot = useBootstrap().data;
  const nav = useNavigate();
  const [status, setStatus] = useState<S>('');
  const [la, setLa] = useState('');
  const [school, setSchool] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useApi<Paged<Row>>('/interventions', { status, learningAreaId: la, schoolId: school, schoolYearId: period.schoolYearId, page, perPage: 25 });
  const summary = useSummary({ schoolYearId: period.schoolYearId, learningAreaId: la, schoolId: school });
  const division = !isSchoolLevel(user!);
  return (
    <>
      <PageHeader
        title={division ? 'Intervention monitoring' : 'Interventions & remediation'}
        subtitle="Interventions planned from identified learning gaps, their implementation, and whether learners improved on reassessment."
        actions={can('intervention:write') ? <Button onClick={() => setCreating(true)}>New intervention</Button> : null}
      />
      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-1">{summary.data && <OutcomesCard s={summary.data} />}</div>
        <Card className="xl:col-span-2" title="How to read this">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>Each intervention targets a learning area and, usually, specific competencies.</li>
            <li>Every learner's pre-intervention result is recorded as a baseline when they are added.</li>
            <li>Sessions and attendance show implementation; reassessment shows the effect.</li>
            <li>E-QuAART suggests options (continue, modify, complete, repeat, refer) from the data — the teacher decides.</li>
          </ol>
        </Card>
      </div>
      <Tabs<S> value={status} onChange={(s) => { setStatus(s); setPage(1); }} tabs={[{ value: '', label: 'All' }, { value: 'PLANNED', label: 'Planned' }, { value: 'ONGOING', label: 'Ongoing' }, { value: 'REASSESSMENT_REQUIRED', label: 'Reassessment required' }, { value: 'FOR_MONITORING', label: 'For monitoring' }, { value: 'COMPLETED', label: 'Completed' }]} />
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select className="max-w-xs" aria-label="Learning area" value={la} onChange={(e) => setLa(e.target.value)} options={(boot?.learningAreas ?? []).filter((l) => l.inScope).map((l) => ({ value: l.id, label: l.name }))} placeholder="All learning areas" />
          {division && <Select className="max-w-xs" aria-label="School" value={school} onChange={(e) => setSchool(e.target.value)} options={(boot?.schools ?? []).map((l) => ({ value: l.id, label: l.name }))} placeholder="All schools" />}
        </div>
        {q.isLoading ? <Spinner /> : (
          <>
            <Table rows={q.data?.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => nav(`/interventions/${r.id}`)} empty="No interventions yet" columns={[
              { key: 'title', label: 'Intervention', render: (r) => <div><div className="font-medium">{r.title}</div><div className="text-xs text-ink-3">{r.strategy}</div></div> },
              { key: 'where', label: division ? 'School / class' : 'Class', render: (r) => <span className="text-xs">{division && <>{r.school.name}<br /></>}{r.section ? `${r.section.gradeLevel.name} – ${r.section.name}` : 'School-wide'}</span> },
              { key: 'la', label: 'Area', render: (r) => r.learningArea.name },
              { key: 'tier', label: 'Tier', render: (r) => <TierBadge tier={r.tier} /> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'learners', label: 'Learners', align: 'right', render: (r) => r.learnerCount },
              { key: 'sessions', label: 'Sessions', align: 'right', render: (r) => r.sessionCount },
              { key: 'improved', label: 'Improved / reassessed', align: 'right', render: (r) => r.reassessedCount ? `${r.improvedCount} / ${r.reassessedCount}` : '—' },
              { key: 'dates', label: 'Target', render: (r) => <span className="text-xs">{date(r.targetEndDate)}</span> },
            ]} />
            {q.data && <Pagination {...q.data.meta} onPage={setPage} />}
          </>
        )}
      </Card>
      {creating && <InterventionForm seed={{}} onClose={() => setCreating(false)} onCreated={(id) => nav(`/interventions/${id}`)} />}
    </>
  );
}
