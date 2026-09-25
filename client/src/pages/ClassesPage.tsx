import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type Paged } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BreakdownCard, LeastMasteredCard } from '../components/analytics';
import { ImportDialog } from '../components/ImportDialog';
import { EnrolExistingForm, LearnerForm } from '../components/LearnerForm';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Tabs } from '../components/ui';
import { humanize, pct } from '../lib/format';
import { useApi, useBootstrap, usePeriod } from '../lib/hooks';
import { isLearnerLevel } from '../lib/nav';

interface SectionRow {
  id: number; name: string; schoolId: number; learnerCount: number; assessmentCount: number;
  gradeLevel: { id: number; name: string }; school: { id: number; name: string }; schoolYear: { label: string };
  adviser: { id: number; fullName: string } | null; teachers: { id: number; user: { fullName: string }; learningArea: { code: string } | null }[];
}

export function ClassesPage() {
  const { can, user } = useAuth();
  const { schoolYearId } = usePeriod();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const q = useApi<SectionRow[]>('/sections', { schoolYearId });
  const mine = user!.role === 'TEACHER';
  return (
    <>
      <PageHeader
        title={mine ? 'My classes' : 'Classes'}
        subtitle="Sections for the selected school year. Open a class for its roster, assessments and analytics."
        actions={can('section:write') ? <Button onClick={() => setCreating(true)}>New class</Button> : null}
      />
      <Card pad={false}>
        {q.isLoading ? <Spinner /> : (
          <Table rows={q.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => nav(`/classes/${r.id}`)} empty="No classes for this school year" columns={[
            { key: 'name', label: 'Class', render: (r) => <span className="font-medium">{r.gradeLevel.name} – {r.name}</span> },
            ...(mine ? [] : [{ key: 'school', label: 'School', render: (r: SectionRow) => r.school.name }]),
            { key: 'adviser', label: 'Adviser', render: (r) => r.adviser?.fullName ?? '—' },
            { key: 'teachers', label: 'Subject teachers', render: (r) => r.teachers.length ? r.teachers.map((t) => `${t.user.fullName}${t.learningArea ? ` (${t.learningArea.code})` : ''}`).join(', ') : '—' },
            { key: 'learnerCount', label: 'Learners', align: 'right' },
            { key: 'assessmentCount', label: 'Assessments', align: 'right' },
          ]} />
        )}
      </Card>
      {creating && <SectionForm onClose={() => setCreating(false)} onSaved={(id) => nav(`/classes/${id}`)} />}
    </>
  );
}

function SectionForm({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const boot = useBootstrap().data;
  const { schoolYearId } = usePeriod();
  const [v, setV] = useState({ name: '', schoolId: String(boot?.schools[0]?.id ?? ''), gradeLevelId: '', schoolYearId: String(schoolYearId ?? '') });
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open onClose={onClose} title="New class" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => {
      try {
        const s = await api.post<{ id: number }>('/sections', { name: v.name, schoolId: Number(v.schoolId), gradeLevelId: Number(v.gradeLevelId), schoolYearId: Number(v.schoolYearId) });
        onSaved(s.id);
      } catch (e) { setError(e); }
    }}>Create</Button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="School" className="col-span-2"><Select value={v.schoolId} onChange={(e) => setV({ ...v, schoolId: e.target.value })} options={(boot?.schools ?? []).map((s) => ({ value: s.id, label: s.name }))} /></Field>
        <Field label="School year"><Select value={v.schoolYearId} onChange={(e) => setV({ ...v, schoolYearId: e.target.value })} options={(boot?.schoolYears ?? []).map((s) => ({ value: s.id, label: s.label }))} /></Field>
        <Field label="Grade level"><Select value={v.gradeLevelId} onChange={(e) => setV({ ...v, gradeLevelId: e.target.value })} options={(boot?.gradeLevels ?? []).filter((g) => g.isActive).map((g) => ({ value: g.id, label: g.name }))} placeholder="Select…" /></Field>
        <Field label="Section name" className="col-span-2"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Sampaguita" /></Field>
        <div className="col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Modal>
  );
}

interface SectionDetail extends SectionRow {
  gradeLevel: { id: number; name: string; keyStage: { name: string } } & SectionRow['gradeLevel'];
  roster: { id: number; enrolmentId: number; isCurrent: boolean; endReason: string | null; lrn: string; lastName: string; firstName: string; middleName: string | null; sex: string; status: string }[] | null;
}

export function ClassDetailPage() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const nav = useNavigate();
  const q = useApi<SectionDetail>(`/sections/${id}`);
  const assessments = useApi<Paged<{ id: number; title: string; status: string; completionRate: number | null; term: { name: string }; learningArea: { name: string }; assessmentType: { name: string } }>>('/assessments', { sectionId: id, perPage: 100 });
  const [tab, setTab] = useState<'roster' | 'assessments' | 'analytics'>('roster');
  const [adding, setAdding] = useState<'new' | 'existing' | 'import' | null>(null);
  const [ending, setEnding] = useState<number | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const s = q.data!;
  const filters = { sectionId: s.id };
  const canWrite = can('learner:write');
  const current = (s.roster ?? []).filter((r) => r.isCurrent);
  const counts = { m: current.filter((r) => r.sex === 'MALE').length, f: current.filter((r) => r.sex === 'FEMALE').length };
  return (
    <>
      <PageHeader
        crumbs={[{ to: '/classes', label: 'Classes' }]}
        title={`${s.gradeLevel.name} – ${s.name}`}
        subtitle={`${s.school.name} · SY ${s.schoolYear.label} · ${s.gradeLevel.keyStage.name} · Adviser: ${s.adviser?.fullName ?? '—'}`}
        actions={
          <>
            {can('assessment:write') && <Button variant="secondary" onClick={() => nav(`/assessments?new=1&sectionId=${s.id}`)}>New assessment</Button>}
            <Button variant="secondary" onClick={() => api.download('/reports/class', { sectionId: s.id, format: 'xlsx' })}>Class report</Button>
          </>
        }
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'roster', label: `Roster (${current.length})` }, { value: 'assessments', label: `Assessments (${assessments.data?.meta.total ?? 0})` }, { value: 'analytics', label: 'Class analytics' }]} />
      {tab === 'roster' && (
        <Card
          title="Learners"
          subtitle={s.roster ? `${counts.m} male · ${counts.f} female currently enrolled` : 'Learner identities are not shown at your access level.'}
          actions={canWrite && s.roster ? (
            <>
              <Button size="sm" onClick={() => setAdding('new')}>Register learner</Button>
              <Button size="sm" variant="secondary" onClick={() => setAdding('existing')}>Enrol existing (by LRN)</Button>
              <Button size="sm" variant="secondary" onClick={() => setAdding('import')}>Import roster</Button>
            </>
          ) : null}
          pad={false}
        >
          {s.roster && (
            <Table rows={s.roster} rowKey={(r) => r.enrolmentId} onRowClick={isLearnerLevel(user!) ? (r) => nav(`/learners/${r.id}`) : undefined} empty="No learners enrolled yet" columns={[
              { key: 'lrn', label: 'LRN', render: (r) => <span className="font-mono text-xs">{r.lrn}</span> },
              { key: 'name', label: 'Name', render: (r) => <span className={r.isCurrent ? 'font-medium' : 'text-ink-3 line-through'}>{r.lastName}, {r.firstName} {r.middleName ? `${r.middleName[0]}.` : ''}</span> },
              { key: 'sex', label: 'Sex', render: (r) => humanize(r.sex) },
              { key: 'status', label: 'Enrolment', render: (r) => r.isCurrent ? <Badge tone="green">Enrolled</Badge> : <Badge>{r.endReason ?? 'Ended'}</Badge> },
              ...(canWrite ? [{ key: 'act', label: '', render: (r: NonNullable<SectionDetail['roster']>[number]) => r.isCurrent ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEnding(r.enrolmentId); }}>Transfer / drop</Button> : null }] : []),
            ]} />
          )}
        </Card>
      )}
      {tab === 'assessments' && (
        <Card pad={false}>
          <Table rows={assessments.data?.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => nav(`/assessments/${r.id}`)} empty="No assessments yet" columns={[
            { key: 'term', label: 'Term', render: (r) => r.term.name },
            { key: 'type', label: 'Assessment', render: (r) => r.assessmentType.name },
            { key: 'la', label: 'Learning area', render: (r) => r.learningArea.name },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'c', label: 'Encoded', align: 'right', render: (r) => pct(r.completionRate, 0) },
          ]} />
        </Card>
      )}
      {tab === 'analytics' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <BreakdownCard title="By learning area" dim="learningArea" filters={filters} onSelect={(r) => nav(`/performance/results?sectionId=${s.id}&sectionIdL=${encodeURIComponent(`${s.gradeLevel.name} – ${s.name}`)}&learningAreaId=${r.key}&learningAreaIdL=${encodeURIComponent(r.label)}&dim=assessment`)} />
          <LeastMasteredCard filters={filters} learnerLevel={isLearnerLevel(user!)} title="Class-level learning gaps" />
        </div>
      )}
      {adding === 'new' && <LearnerForm open onClose={() => setAdding(null)} sectionId={s.id} onSaved={() => q.refetch()} />}
      {adding === 'existing' && <EnrolExistingForm open onClose={() => setAdding(null)} sectionId={s.id} onSaved={() => q.refetch()} />}
      <ImportDialog
        open={adding === 'import'}
        onClose={() => setAdding(null)}
        path="/learners/import"
        fields={{ sectionId: String(s.id) }}
        title="Import class roster"
        onDone={() => q.refetch()}
        help={<>Upload a CSV or Excel file (e.g. from an LIS export) with columns <code>lrn, last_name, first_name, middle_name, extension_name, sex, birthdate</code>. The whole file is validated first: invalid or duplicate LRNs and missing fields are listed and nothing is imported until every row is valid.</>}
      />
      {ending && <EndEnrolment enrolmentId={ending} onClose={() => setEnding(null)} onSaved={() => q.refetch()} />}
    </>
  );
}

function EndEnrolment({ enrolmentId, onClose, onSaved }: { enrolmentId: number; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState('TRANSFERRED_OUT');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open onClose={onClose} title="End enrolment" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={async () => {
      try { await api.post(`/learners/enrolments/${enrolmentId}/end`, { status, reason: reason || undefined }); onSaved(); onClose(); } catch (e) { setError(e); }
    }}>Confirm</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-2">The learner's assessment history is kept. They can be enrolled elsewhere using their LRN.</p>
        <Field label="Reason"><Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'TRANSFERRED_OUT', label: 'Transferred out' }, { value: 'DROPPED', label: 'Dropped / no longer attending' }, { value: 'GRADUATED', label: 'Completed / graduated' }]} /></Field>
        <Field label="Notes (optional)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Transferred to another school" /></Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
