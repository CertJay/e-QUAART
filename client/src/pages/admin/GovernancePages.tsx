import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Paged } from '../../api/client';
import { FormModal, type FieldDef } from '../../components/FormModal';
import { Badge, Button, Card, Input, Notice, PageHeader, Pagination, Select, Spinner, StatusBadge, Table } from '../../components/ui';
import { dateTime, humanize } from '../../lib/format';
import { useApi } from '../../lib/hooks';

interface Log { id: number; at: string; userEmail: string | null; action: string; entity: string; entityId: string | null; ip: string | null; beforeJson: unknown; afterJson: unknown }
const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'VERIFY', 'RETURN', 'REOPEN', 'IMPORT', 'EXPORT', 'ENROL', 'VIEW_LEARNER', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGE'];

export function AuditPage() {
  const [sp] = useSearchParams();
  const [f, setF] = useState({ action: sp.get('action') ?? '', entity: '', search: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const q = useApi<Paged<Log>>('/governance/audit-logs', { ...f, page, perPage: 50 });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setPage(1); };
  return (
    <>
      <PageHeader title="Audit trail" subtitle="Every sign-in, change, verification, export and learner-record view: who, what, when, and the previous and new values." />
      <Card pad={false}>
        <div className="grid grid-cols-2 gap-2 border-b border-line p-3 md:grid-cols-5">
          <Select aria-label="Action" value={f.action} onChange={set('action')} options={ACTIONS.map((a) => ({ value: a, label: humanize(a) }))} placeholder="All actions" />
          <Input aria-label="Record type" placeholder="Record type (e.g. AssessmentResult)" value={f.entity} onChange={set('entity')} />
          <Input aria-label="User" placeholder="User email contains…" value={f.search} onChange={set('search')} />
          <Input aria-label="From" type="date" value={f.from} onChange={set('from')} />
          <Input aria-label="To" type="date" value={f.to} onChange={set('to')} />
        </div>
        {q.isLoading ? <Spinner /> : (
          <>
            <Table dense rows={q.data?.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => setOpen(open === r.id ? null : r.id)} columns={[
              { key: 'at', label: 'When', render: (r) => <span className="whitespace-nowrap text-xs">{dateTime(r.at)}</span> },
              { key: 'user', label: 'User', render: (r) => <span className="text-xs">{r.userEmail ?? 'system'}</span> },
              { key: 'action', label: 'Action', render: (r) => <Badge tone={r.action === 'LOGIN_FAILED' || r.action === 'DELETE' ? 'red' : r.action === 'EXPORT' ? 'amber' : 'slate'}>{humanize(r.action)}</Badge> },
              { key: 'entity', label: 'Record', render: (r) => <span className="text-xs">{r.entity}{r.entityId ? ` #${r.entityId}` : ''}</span> },
              { key: 'ip', label: 'IP', render: (r) => <span className="font-mono text-[11px] text-ink-3">{r.ip ?? '—'}</span> },
              { key: 'detail', label: 'Detail', render: (r) => open === r.id ? (
                <div className="grid max-w-xl gap-2 text-[11px] md:grid-cols-2">
                  <pre className="overflow-x-auto rounded bg-surface-2 p-2">{JSON.stringify(r.beforeJson, null, 1) ?? '—'}</pre>
                  <pre className="overflow-x-auto rounded bg-surface-2 p-2">{JSON.stringify(r.afterJson, null, 1) ?? '—'}</pre>
                </div>
              ) : <span className="text-xs text-ink-3">{r.beforeJson || r.afterJson ? 'Show' : ''}</span> },
            ]} />
            {q.data && <Pagination {...q.data.meta} onPage={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}

interface Retention { id: number; entity: string; retentionMonths: number; disposalAction: string; legalBasis: string; updatedAt: string }
export function RetentionPage() {
  const q = useApi<Retention[]>('/governance/retention', undefined, { staleTime: 0 });
  const [edit, setEdit] = useState<Retention | null>(null);
  const fields: FieldDef[] = [
    { key: 'retentionMonths', label: 'Retention (months)', type: 'number' },
    { key: 'disposalAction', label: 'Disposal action', type: 'select', options: [{ value: 'ANONYMIZE', label: 'Anonymize' }, { value: 'ARCHIVE', label: 'Archive' }, { value: 'DELETE', label: 'Delete' }] },
    { key: 'legalBasis', label: 'Legal basis / reference', type: 'textarea' },
  ];
  return (
    <>
      <PageHeader title="Retention & disposal" subtitle="How long each class of record is kept and how it is disposed of. Agree these with the DPO and the DepEd records schedule." />
      <div className="mb-4"><Notice>Disposal runs are an operational task: export the records due for disposal, obtain DPO approval, then anonymize or delete. Each change to these rules is audit-logged.</Notice></div>
      <Card pad={false}>
        {q.isLoading ? <Spinner /> : (
          <Table rows={q.data ?? []} rowKey={(r) => r.id} onRowClick={setEdit} columns={[
            { key: 'entity', label: 'Record class', render: (r) => <span className="font-medium">{r.entity}</span> },
            { key: 'retentionMonths', label: 'Retention', render: (r) => `${r.retentionMonths} months (${(r.retentionMonths / 12).toFixed(1)} yrs)` },
            { key: 'disposalAction', label: 'Disposal', render: (r) => <Badge>{humanize(r.disposalAction)}</Badge> },
            { key: 'legalBasis', label: 'Basis', render: (r) => <span className="text-xs">{r.legalBasis}</span> },
          ]} />
        )}
      </Card>
      {edit && <FormModal title={`Retention: ${edit.entity}`} fields={fields} initial={edit as unknown as Record<string, unknown>} onClose={() => setEdit(null)} onSubmit={(v) => api.put(`/governance/retention/${edit.id}`, v).then(() => q.refetch())} />}
    </>
  );
}

interface Breach { id: number; title: string; description: string; discoveredAt: string; affectedRecords: number | null; status: string; npcNotifiedAt: string | null; actionsTaken: string | null; notificationDeadline: string }
const breachFields: FieldDef[] = [
  { key: 'title', label: 'Title' },
  { key: 'description', label: 'What happened', type: 'textarea' },
  { key: 'discoveredAt', label: 'Discovered on', type: 'date' },
  { key: 'affectedRecords', label: 'Records affected (estimate)', type: 'number' },
  { key: 'status', label: 'Status', type: 'select', options: ['OPEN', 'CONTAINED', 'NOTIFIED', 'CLOSED'].map((s) => ({ value: s, label: humanize(s) })) },
  { key: 'npcNotifiedAt', label: 'NPC notified on', type: 'date' },
  { key: 'actionsTaken', label: 'Actions taken', type: 'textarea' },
];
export function BreachesPage() {
  const q = useApi<Breach[]>('/governance/breaches', undefined, { staleTime: 0 });
  const [edit, setEdit] = useState<Breach | 'new' | null>(null);
  return (
    <>
      <PageHeader title="Breach register" subtitle="Record and track personal-data breaches and the response, including National Privacy Commission notification." actions={<Button onClick={() => setEdit('new')}>Record incident</Button>} />
      <div className="mb-4"><Notice tone="warn">For breaches that require notification, the NPC and affected data subjects must be notified within 72 hours of knowledge of the breach (NPC Circular 16-03).</Notice></div>
      <Card pad={false}>
        {q.isLoading ? <Spinner /> : (
          <Table rows={q.data ?? []} rowKey={(r) => r.id} onRowClick={setEdit} empty="No incidents recorded" columns={[
            { key: 'title', label: 'Incident', render: (r) => <div><div className="font-medium">{r.title}</div><div className="text-xs text-ink-3">{r.description.slice(0, 120)}</div></div> },
            { key: 'discoveredAt', label: 'Discovered', render: (r) => <span className="text-xs">{dateTime(r.discoveredAt)}</span> },
            { key: 'deadline', label: 'Notify by', render: (r) => <span className={`text-xs ${!r.npcNotifiedAt && r.status !== 'CLOSED' && new Date(r.notificationDeadline) < new Date() ? 'font-semibold text-red-700' : ''}`}>{dateTime(r.notificationDeadline)}</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status === 'CLOSED' ? 'COMPLETED' : r.status === 'OPEN' ? 'RETURNED' : 'SUBMITTED'} /> },
            { key: 'npc', label: 'NPC notified', render: (r) => <span className="text-xs">{r.npcNotifiedAt ? dateTime(r.npcNotifiedAt) : '—'}</span> },
          ]} />
        )}
      </Card>
      {edit && (
        <FormModal
          title={edit === 'new' ? 'Record breach incident' : 'Update incident'}
          fields={breachFields}
          initial={edit === 'new' ? { status: 'OPEN', discoveredAt: new Date().toISOString() } : (edit as unknown as Record<string, unknown>)}
          onClose={() => setEdit(null)}
          onSubmit={(v) => (edit === 'new' ? api.post('/governance/breaches', v) : api.put(`/governance/breaches/${edit.id}`, v)).then(() => q.refetch())}
        />
      )}
    </>
  );
}
