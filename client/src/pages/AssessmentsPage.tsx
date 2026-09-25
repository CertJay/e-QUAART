import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Paged } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, ErrorBox, Field, Input, Modal, Notice, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Tabs } from '../components/ui';
import { date, pct } from '../lib/format';
import { useApi, useBootstrap, usePeriod } from '../lib/hooks';

interface Row {
  id: number; title: string; status: string; updatedAt: string; completionRate: number | null; encodedCount: number; enrolledCount: number;
  assessmentType: { code: string; name: string }; learningArea: { name: string }; gradeLevel: { name: string }; section: { id: number; name: string }; school: { name: string }; term: { name: string }; schoolYear: { label: string }; createdBy: { fullName: string };
}
type StatusTab = '' | 'DRAFT' | 'RETURNED' | 'SUBMITTED' | 'VERIFIED';

export function AssessmentsPage() {
  const { can } = useAuth();
  const { schoolYearId, termId } = usePeriod();
  const boot = useBootstrap().data;
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const verifier = can('assessment:verify');
  const [status, setStatus] = useState<StatusTab>((sp.get('status') as StatusTab) ?? '');
  const [la, setLa] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const q = useApi<Paged<Row>>('/assessments', { schoolYearId, termId, status, learningAreaId: la, assessmentTypeId: type, page, perPage: 25 });
  return (
    <>
      <PageHeader
        title={verifier ? 'Assessments & verification' : 'Assessments'}
        subtitle="Set up an assessment, encode or import results, pass the quality checks, then submit for verification. Verified results are locked."
        actions={can('assessment:write') ? <Button onClick={() => setCreating(true)}>New assessment</Button> : null}
      />
      <Tabs<StatusTab>
        value={status}
        onChange={(s) => { setStatus(s); setPage(1); }}
        tabs={[{ value: '', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'RETURNED', label: 'Returned' }, { value: 'SUBMITTED', label: verifier ? 'Awaiting my verification' : 'Submitted' }, { value: 'VERIFIED', label: 'Verified' }]}
      />
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Select className="max-w-xs" aria-label="Assessment type" value={type} onChange={(e) => setType(e.target.value)} options={(boot?.assessmentTypes ?? []).map((t) => ({ value: t.id, label: t.name }))} placeholder="All types" />
          <Select className="max-w-xs" aria-label="Learning area" value={la} onChange={(e) => setLa(e.target.value)} options={(boot?.learningAreas ?? []).filter((l) => l.inScope).map((t) => ({ value: t.id, label: t.name }))} placeholder="All learning areas" />
        </div>
        {q.isLoading ? <Spinner /> : (
          <>
            <Table rows={q.data?.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => nav(`/assessments/${r.id}`)} empty="No assessments match" columns={[
              { key: 'title', label: 'Assessment', render: (r) => <div><div className="font-medium">{r.assessmentType.name} · {r.learningArea.name}</div><div className="text-xs text-ink-3">{r.gradeLevel.name} – {r.section.name} · {r.school.name}</div></div> },
              { key: 'term', label: 'Term', render: (r) => <span className="text-xs">{r.term.name}<br /><span className="text-ink-3">SY {r.schoolYear.label}</span></span> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'enc', label: 'Encoded', align: 'right', render: (r) => <span title={`${r.encodedCount} of ${r.enrolledCount}`}>{pct(r.completionRate, 0)}</span> },
              { key: 'by', label: 'Encoder', render: (r) => <span className="text-xs">{r.createdBy.fullName}</span> },
              { key: 'updatedAt', label: 'Updated', render: (r) => <span className="text-xs">{date(r.updatedAt)}</span> },
            ]} />
            {q.data && <Pagination {...q.data.meta} onPage={setPage} />}
          </>
        )}
      </Card>
      {creating && <NewAssessment presetSection={sp.get('sectionId') ?? ''} onClose={() => { setCreating(false); sp.delete('new'); setSp(sp); }} onCreated={(id) => nav(`/assessments/${id}`)} />}
    </>
  );
}

interface Competency { id: number; code: string; description: string }
interface Section { id: number; name: string; gradeLevel: { id: number; name: string }; school: { name: string } }

function NewAssessment({ presetSection, onClose, onCreated }: { presetSection: string; onClose: () => void; onCreated: (id: number) => void }) {
  const boot = useBootstrap().data;
  const period = usePeriod();
  const [v, setV] = useState({ assessmentTypeId: '', schoolYearId: String(period.schoolYearId ?? ''), termId: String(period.termId ?? ''), sectionId: presetSection, learningAreaId: '', maxScore: '', assessmentDate: new Date().toISOString().slice(0, 10), windowClose: '', title: '' });
  const [items, setItems] = useState<Record<number, string>>({});
  const [error, setError] = useState<unknown>(null);
  const sections = useApi<Section[]>('/sections', { schoolYearId: v.schoolYearId, mine: undefined });
  const section = sections.data?.find((s) => String(s.id) === v.sectionId);
  const type = boot?.assessmentTypes.find((t) => String(t.id) === v.assessmentTypeId);
  const comps = useApi<Competency[]>(section && v.learningAreaId ? '/reference/competencies' : null, { learningAreaId: v.learningAreaId, gradeLevelId: section?.gradeLevel.id });
  const sy = boot?.schoolYears.find((s) => String(s.id) === v.schoolYearId);
  const itemTotal = Object.values(items).reduce((s, x) => s + (Number(x) || 0), 0);
  useEffect(() => setItems({}), [v.learningAreaId, v.sectionId]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    setError(null);
    try {
      const competencies = Object.entries(items).filter(([, n]) => Number(n) > 0).map(([id, n]) => ({ competencyId: Number(id), itemsTotal: Number(n) }));
      const a = await api.post<{ id: number }>('/assessments', {
        assessmentTypeId: Number(v.assessmentTypeId), schoolYearId: Number(v.schoolYearId), termId: Number(v.termId), sectionId: Number(v.sectionId), learningAreaId: Number(v.learningAreaId),
        maxScore: v.maxScore ? Number(v.maxScore) : null, assessmentDate: v.assessmentDate || null, windowOpen: v.assessmentDate || null, windowClose: v.windowClose || null, title: v.title || undefined, competencies,
      });
      onCreated(a.id);
    } catch (e) { setError(e); }
  };
  const provisional = type?.models[0]?.isProvisional;
  return (
    <Modal open wide onClose={onClose} title="New assessment" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit}>Create assessment</Button></>}>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="1. Assessment type" className="md:col-span-3">
          <Select value={v.assessmentTypeId} onChange={set('assessmentTypeId')} options={(boot?.assessmentTypes ?? []).filter((t) => t.isActive).map((t) => ({ value: t.id, label: `${t.name}${t.resultMode === 'PROFILE' ? ' (level / profile)' : ' (score-based)'}` }))} placeholder="Select…" />
        </Field>
        {type && (
          <div className="md:col-span-3">
            <Notice>
              {type.resultMode === 'PROFILE' ? <>Results are recorded as the learner's <strong>{type.name.split('—')[0].trim()} level</strong>: {type.models[0]?.bands.map((b) => b.label).join(' · ')}. No percentage rule is applied.</> : <>Scores are converted to a percentage and classified as {type.models[0]?.bands.map((b) => `${b.label} (≥${b.minPct}%)`).join(' · ')}.</>}
              {provisional && <> These levels are marked <strong>provisional</strong> pending confirmation against the current issuance.</>}
            </Notice>
          </div>
        )}
        <Field label="2. School year"><Select value={v.schoolYearId} onChange={set('schoolYearId')} options={(boot?.schoolYears ?? []).map((s) => ({ value: s.id, label: s.label }))} /></Field>
        <Field label="3. Term / quarter"><Select value={v.termId} onChange={set('termId')} options={(sy?.terms ?? []).map((t) => ({ value: t.id, label: t.name }))} placeholder="Select…" /></Field>
        <Field label="4. Class (grade & section)"><Select value={v.sectionId} onChange={set('sectionId')} options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.gradeLevel.name} – ${s.name}` }))} placeholder="Select…" /></Field>
        <Field label="5. Learning area"><Select value={v.learningAreaId} onChange={set('learningAreaId')} options={(boot?.learningAreas ?? []).filter((l) => l.isActive && l.inScope).map((l) => ({ value: l.id, label: l.name }))} placeholder="Select…" /></Field>
        <Field label="Assessment date"><Input type="date" value={v.assessmentDate} onChange={set('assessmentDate')} /></Field>
        <Field label="Encoding closes" hint="Optional deadline for encoding."><Input type="date" value={v.windowClose} onChange={set('windowClose')} /></Field>
        {type?.resultMode === 'PERCENTAGE' && (
          <Field label="Maximum score" hint={itemTotal ? `Competency items total ${itemTotal}` : 'Total number of points'}>
            <Input type="number" min={1} value={v.maxScore} onChange={set('maxScore')} />
          </Field>
        )}
        <Field label="Title (optional)" className="md:col-span-2"><Input value={v.title} onChange={set('title')} placeholder="Generated from the selections if left blank" /></Field>
      </div>
      {section && v.learningAreaId && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-ink-2">6. Competencies measured (items per competency)</div>
          <p className="mb-2 text-xs text-ink-3">Enter the number of items for each competency the test measures. This is what lets E-QuAART pinpoint learning gaps instead of reporting only a total score.</p>
          {comps.isLoading ? <Spinner /> : !comps.data?.length ? <Notice tone="warn">No competencies are configured for this grade and learning area. Results will be recorded as totals only.</Notice> : (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-line p-2">
              {comps.data.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <Input type="number" min={0} className="h-8 w-16" value={items[c.id] ?? ''} onChange={(e) => setItems((x) => ({ ...x, [c.id]: e.target.value }))} aria-label={`Items for ${c.code}`} />
                  <span className="font-medium">{c.code}</span>
                  <span className="text-xs text-ink-2">{c.description}</span>
                </label>
              ))}
            </div>
          )}
          {type?.resultMode === 'PERCENTAGE' && itemTotal > 0 && Number(v.maxScore) !== itemTotal && (
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => setV((x) => ({ ...x, maxScore: String(itemTotal) }))}>Use {itemTotal} as maximum score</Button>
          )}
        </div>
      )}
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Modal>
  );
}
