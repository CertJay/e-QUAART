import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Paged } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LearnerForm } from '../components/LearnerForm';
import { Badge, Button, Card, Input, PageHeader, Pagination, Select, Spinner, Table } from '../components/ui';
import { humanize } from '../lib/format';
import { useApi, usePeriod } from '../lib/hooks';

interface Row {
  id: number; lrn: string; lastName: string; firstName: string; middleName: string | null; extensionName: string | null; sex: string; status: string;
  currentEnrolment: { section: { id: number; name: string; gradeLevel: { name: string }; school: { name: string } }; schoolYear: { label: string } } | null;
  openGaps: number; interventionCount: number;
}
interface Section { id: number; name: string; gradeLevel: { name: string } }

export function LearnersPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { schoolYearId } = usePeriod();
  const [search, setSearch] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const sections = useApi<Section[]>('/sections', { schoolYearId });
  const q = useApi<Paged<Row>>('/learners', { search, sectionId, page, perPage: 25 });
  return (
    <>
      <PageHeader
        title="Learners"
        subtitle="Learner master data keyed on the LRN. Assessment history stays with the learner across terms and school years."
        actions={can('learner:write') && sections.data?.length ? <Button onClick={() => setAdding(true)}>Register learner</Button> : null}
      />
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search by name or LRN" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search learners" />
          <Select className="max-w-xs" aria-label="Class" value={sectionId} onChange={(e) => { setSectionId(e.target.value); setPage(1); }} options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.gradeLevel.name} – ${s.name}` }))} placeholder="All classes" />
        </div>
        {q.isLoading ? <Spinner /> : (
          <>
            <Table
              rows={q.data?.data ?? []}
              rowKey={(r) => r.id}
              onRowClick={(r) => nav(`/learners/${r.id}`)}
              empty="No learners match"
              columns={[
                { key: 'lrn', label: 'LRN', render: (r) => <span className="num font-mono text-xs">{r.lrn}</span> },
                { key: 'name', label: 'Name', render: (r) => <span className="font-medium">{r.lastName}, {r.firstName}{r.extensionName ? ` ${r.extensionName}` : ''} {r.middleName ? `${r.middleName[0]}.` : ''}</span> },
                { key: 'sex', label: 'Sex', render: (r) => humanize(r.sex) },
                { key: 'class', label: 'Current class', render: (r) => r.currentEnrolment ? `${r.currentEnrolment.section.gradeLevel.name} – ${r.currentEnrolment.section.name}` : '—' },
                { key: 'status', label: 'Status', render: (r) => r.status === 'ACTIVE' ? <Badge tone="green">Active</Badge> : <Badge>{humanize(r.status)}</Badge> },
                { key: 'gaps', label: 'Open gaps', align: 'right', render: (r) => r.openGaps || '—' },
                { key: 'int', label: 'Interventions', align: 'right', render: (r) => r.interventionCount || '—' },
              ]}
            />
            {q.data && <Pagination {...q.data.meta} onPage={setPage} />}
          </>
        )}
      </Card>
      {adding && <LearnerFormWithSection sections={sections.data ?? []} onClose={() => setAdding(false)} onSaved={() => q.refetch()} />}
    </>
  );
}

function LearnerFormWithSection({ sections, onClose, onSaved }: { sections: Section[]; onClose: () => void; onSaved: () => void }) {
  const [sectionId, setSectionId] = useState<number | null>(sections.length === 1 ? sections[0].id : null);
  if (!sectionId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <Card title="Which class?" className="w-full max-w-sm" actions={<Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>}>
          <Select aria-label="Class" onChange={(e) => setSectionId(Number(e.target.value))} options={sections.map((s) => ({ value: s.id, label: `${s.gradeLevel.name} – ${s.name}` }))} placeholder="Select a class" />
        </Card>
      </div>
    );
  }
  return <LearnerForm open onClose={onClose} sectionId={sectionId} onSaved={onSaved} />;
}
