import { useState } from 'react';
import { api, type Paged, type Role } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, Notice, PageHeader, Pagination, Select, Spinner, Table } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { useApi, useBootstrap } from '../../lib/hooks';

const ROLES: { value: Role; label: string; scope: 'SCHOOL' | 'DISTRICT' | 'LEARNING_AREA' | 'DIVISION' }[] = [
  { value: 'TEACHER', label: 'Teacher', scope: 'SCHOOL' },
  { value: 'MASTER_TEACHER', label: 'Master Teacher', scope: 'SCHOOL' },
  { value: 'ASSESSMENT_COORDINATOR', label: 'Assessment Coordinator', scope: 'SCHOOL' },
  { value: 'PRINCIPAL', label: 'School Head / Principal', scope: 'SCHOOL' },
  { value: 'PSDS', label: 'District Supervisor (PSDS)', scope: 'DISTRICT' },
  { value: 'EPS', label: 'Education Program Supervisor', scope: 'LEARNING_AREA' },
  { value: 'CHIEF_CID', label: 'Chief, CID', scope: 'DIVISION' },
  { value: 'DIVISION_ADMIN', label: 'Division Administrator', scope: 'DIVISION' },
  { value: 'SYSTEM_ADMIN', label: 'ICT / System Administrator', scope: 'DIVISION' },
  { value: 'DPO', label: 'Data Protection Officer', scope: 'DIVISION' },
];

interface Scope { scopeType: string; divisionId?: number | null; districtId?: number | null; schoolId?: number | null; learningAreaId?: number | null; school?: { name: string } | null; district?: { name: string } | null; learningArea?: { name: string } | null; division?: { name: string } | null }
interface UserRow { id: number; email: string; fullName: string; position: string | null; role: Role; isActive: boolean; lastLoginAt: string | null; lockedUntil: string | null; scopes: Scope[] }

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const q = useApi<Paged<UserRow>>('/users', { search, role, page, perPage: 25 });
  return (
    <>
      <PageHeader title="Users & access" subtitle="Accounts, roles and data scopes. Access is least-privilege: each role sees only the schools, classes or learning areas assigned here." actions={<Button onClick={() => setEditing('new')}>New user</Button>} />
      {temp && <div className="mb-4"><Notice tone="warn">Temporary password for <strong>{temp.email}</strong>: <code className="rounded bg-surface-2 px-1 font-mono">{temp.password}</code> — share it securely. It must be changed at first sign-in and will not be shown again.</Notice></div>}
      <Card pad={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <Input className="max-w-xs" placeholder="Search name or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search users" />
          <Select className="max-w-xs" aria-label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} options={ROLES} placeholder="All roles" />
        </div>
        {q.isLoading ? <Spinner /> : (
          <>
            <Table rows={q.data?.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => setEditing(r)} columns={[
              { key: 'name', label: 'Name', render: (r) => <div><div className="font-medium">{r.fullName}</div><div className="text-xs text-ink-3">{r.email}</div></div> },
              { key: 'role', label: 'Role', render: (r) => ROLES.find((x) => x.value === r.role)?.label },
              { key: 'scope', label: 'Scope', render: (r) => <span className="text-xs">{r.scopes.map((s) => s.school?.name ?? s.district?.name ?? s.learningArea?.name ?? s.division?.name ?? s.scopeType).join(', ') || '—'}</span> },
              { key: 'status', label: 'Status', render: (r) => !r.isActive ? <Badge>Inactive</Badge> : r.lockedUntil && new Date(r.lockedUntil) > new Date() ? <Badge tone="red">Locked</Badge> : <Badge tone="green">Active</Badge> },
              { key: 'last', label: 'Last sign-in', render: (r) => <span className="text-xs">{dateTime(r.lastLoginAt)}</span> },
            ]} />
            {q.data && <Pagination {...q.data.meta} onPage={setPage} />}
          </>
        )}
      </Card>
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(t) => { q.refetch(); if (t) setTemp(t); }} />}
    </>
  );
}

function UserForm({ user, onClose, onSaved }: { user: UserRow | null; onClose: () => void; onSaved: (temp?: { email: string; password: string }) => void }) {
  const boot = useBootstrap().data;
  const me = useAuth().user!;
  const [v, setV] = useState({ email: user?.email ?? '', fullName: user?.fullName ?? '', position: user?.position ?? '', role: user?.role ?? 'TEACHER', isActive: user?.isActive ?? true });
  const [refs, setRefs] = useState<number[]>(() => (user?.scopes ?? []).map((s) => s.schoolId ?? s.districtId ?? s.learningAreaId ?? s.divisionId ?? 0).filter(Boolean));
  const [error, setError] = useState<unknown>(null);
  const scopeKind = ROLES.find((r) => r.value === v.role)!.scope;
  const options = scopeKind === 'SCHOOL' ? boot?.schools : scopeKind === 'DISTRICT' ? boot?.districts : scopeKind === 'LEARNING_AREA' ? boot?.learningAreas : boot?.divisions;
  const scopes = scopeKind === 'DIVISION'
    ? [{ scopeType: 'DIVISION', divisionId: boot?.divisions[0]?.id }]
    : refs.map((id) => ({ scopeType: scopeKind, [scopeKind === 'SCHOOL' ? 'schoolId' : scopeKind === 'DISTRICT' ? 'districtId' : 'learningAreaId']: id }));
  const save = async () => {
    setError(null);
    try {
      if (user) {
        await api.put(`/users/${user.id}`, { ...v, position: v.position || null, scopes });
        onSaved();
      } else {
        const r = await api.post<{ temporaryPassword: string; email: string }>('/users', { ...v, position: v.position || null, scopes });
        onSaved({ email: r.email, password: r.temporaryPassword });
      }
      onClose();
    } catch (e) { setError(e); }
  };
  return (
    <Modal open onClose={onClose} title={user ? 'Edit user' : 'New user'} footer={
      <>
        {user && <Button variant="ghost" onClick={async () => { try { const r = await api.post<{ temporaryPassword: string }>(`/users/${user.id}/reset-password`); onSaved({ email: user.email, password: r.temporaryPassword }); onClose(); } catch (e) { setError(e); } }}>Reset password</Button>}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </>
    }>
      <div className="grid gap-3">
        <Field label="Full name"><Input value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} /></Field>
        <Field label="Email (DepEd account)"><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Position / designation"><Input value={v.position} onChange={(e) => setV({ ...v, position: e.target.value })} /></Field>
        <Field label="Role"><Select value={v.role} onChange={(e) => { setV({ ...v, role: e.target.value as Role }); setRefs([]); }} options={ROLES.filter((r) => r.value !== 'SYSTEM_ADMIN' || me.role === 'SYSTEM_ADMIN')} /></Field>
        {scopeKind !== 'DIVISION' && (
          <Field label={scopeKind === 'SCHOOL' ? 'School' : scopeKind === 'DISTRICT' ? 'District' : 'Learning areas supervised'}>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded border border-line p-2">
              {(options ?? []).map((o) => (
                <label key={o.id} className="flex items-center gap-2 text-sm">
                  <input type={scopeKind === 'LEARNING_AREA' ? 'checkbox' : 'radio'} name="scope" checked={refs.includes(o.id)} onChange={() => setRefs((r) => (scopeKind === 'LEARNING_AREA' ? (r.includes(o.id) ? r.filter((x) => x !== o.id) : [...r, o.id]) : [o.id]))} />
                  {o.name}
                </label>
              ))}
            </div>
          </Field>
        )}
        {user && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />Account active (deactivating signs the user out everywhere)</label>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
