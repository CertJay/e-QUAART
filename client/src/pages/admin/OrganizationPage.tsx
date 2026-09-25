import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { FormModal, type FieldDef } from '../../components/FormModal';
import { Badge, Button, Card, PageHeader, Table, Tabs } from '../../components/ui';
import { date } from '../../lib/format';
import { useBootstrap } from '../../lib/hooks';

type Edit = { title: string; fields: FieldDef[]; initial?: Record<string, unknown>; submit: (v: Record<string, unknown>) => Promise<unknown> };

export function OrganizationPage() {
  const boot = useBootstrap().data;
  const qc = useQueryClient();
  const [tab, setTab] = useState<'schools' | 'districts' | 'calendar'>('schools');
  const [edit, setEdit] = useState<Edit | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: ['bootstrap'] });
  const schoolFields: FieldDef[] = [
    { key: 'name', label: 'School name', required: true },
    { key: 'schoolIdDeped', label: 'DepEd School ID (6 digits)', required: true },
    { key: 'districtId', label: 'District', type: 'select', options: (boot?.districts ?? []).map((d) => ({ value: d.id, label: d.name })) },
    { key: 'schoolType', label: 'Type', type: 'select', options: [{ value: 'ELEMENTARY', label: 'Elementary' }, { value: 'SECONDARY', label: 'Secondary' }, { value: 'INTEGRATED', label: 'Integrated' }] },
    { key: 'address', label: 'Address' },
    { key: 'isActive', label: 'Active', type: 'checkbox' },
  ];
  return (
    <>
      <PageHeader title="Schools & calendar" subtitle="Division structure (districts and schools) and the school-year calendar used by every assessment." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'schools', label: 'Schools' }, { value: 'districts', label: 'Districts' }, { value: 'calendar', label: 'School years & terms' }]} />
      {tab === 'schools' && (
        <Card pad={false} actions={<Button size="sm" onClick={() => setEdit({ title: 'New school', fields: schoolFields, initial: { isActive: true }, submit: (v) => api.post('/reference/schools', v).then(done) })}>Add school</Button>} title="Schools">
          <Table rows={boot?.schools ?? []} rowKey={(r) => r.id} onRowClick={(r) => setEdit({ title: 'Edit school', fields: schoolFields, initial: r, submit: (v) => api.put(`/reference/schools/${r.id}`, v).then(done) })} columns={[
            { key: 'name', label: 'School', render: (r) => <span className="font-medium">{r.name}</span> },
            { key: 'schoolIdDeped', label: 'School ID' },
            { key: 'district', label: 'District', render: (r) => boot?.districts.find((d) => d.id === r.districtId)?.name },
            { key: 'schoolType', label: 'Type', render: (r) => r.schoolType ?? '—' },
            { key: 'isActive', label: 'Status', render: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
          ]} />
        </Card>
      )}
      {tab === 'districts' && (
        <Card pad={false} title="Districts" actions={<Button size="sm" onClick={() => setEdit({ title: 'New district', fields: [{ key: 'name', label: 'Name' }], submit: (v) => api.post('/reference/districts', { ...v, divisionId: boot?.divisions[0]?.id }).then(done) })}>Add district</Button>}>
          <Table rows={boot?.districts ?? []} rowKey={(r) => r.id} onRowClick={(r) => setEdit({ title: 'Edit district', fields: [{ key: 'name', label: 'Name' }], initial: r, submit: (v) => api.put(`/reference/districts/${r.id}`, v).then(done) })} columns={[
            { key: 'name', label: 'District' },
            { key: 'n', label: 'Schools', align: 'right', render: (r) => boot?.schools.filter((s) => s.districtId === r.id).length },
          ]} />
        </Card>
      )}
      {tab === 'calendar' && (
        <div className="space-y-4">
          <div className="flex justify-end"><Button size="sm" onClick={() => setEdit({
            title: 'New school year',
            fields: [{ key: 'label', label: 'Label (e.g. 2027-2028)' }, { key: 'startDate', label: 'Start', type: 'date' }, { key: 'endDate', label: 'End', type: 'date' }, { key: 'isCurrent', label: 'Make this the current school year', type: 'checkbox' }],
            submit: (v) => api.post('/reference/school-years', { ...v, terms: [['BOSY', 'Beginning of School Year'], ['Q1', 'Quarter 1'], ['Q2', 'Quarter 2'], ['Q3', 'Quarter 3'], ['Q4', 'Quarter 4'], ['EOSY', 'End of School Year']].map(([code, name], i) => ({ code, name, sortOrder: i })) }).then(done),
          })}>Add school year</Button></div>
          {(boot?.schoolYears ?? []).map((sy) => (
            <Card key={sy.id} title={<>SY {sy.label} {sy.isCurrent && <Badge tone="blue">Current</Badge>}</>} subtitle={`${date(sy.startDate)} – ${date(sy.endDate)}`} actions={
              <>
                {!sy.isCurrent && <Button size="sm" variant="secondary" onClick={() => api.put(`/reference/school-years/${sy.id}`, { isCurrent: true }).then(done)}>Set as current</Button>}
                <Button size="sm" variant="secondary" onClick={() => setEdit({ title: `Add term to SY ${sy.label}`, fields: [{ key: 'code', label: 'Code (e.g. MOSY)' }, { key: 'name', label: 'Name' }, { key: 'sortOrder', label: 'Order', type: 'number' }], submit: (v) => api.post(`/reference/school-years/${sy.id}/terms`, v).then(done) })}>Add term</Button>
              </>
            }>
              <div className="flex flex-wrap gap-2">{sy.terms.map((t) => <Badge key={t.id}>{t.code} · {t.name}</Badge>)}</div>
            </Card>
          ))}
        </div>
      )}
      {edit && <FormModal title={edit.title} fields={edit.fields} initial={edit.initial} onClose={() => setEdit(null)} onSubmit={edit.submit} />}
    </>
  );
}
