import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { FormModal, type FieldDef } from '../../components/FormModal';
import { Badge, Button, Card, Input, Notice, PageHeader, Select, Spinner, Table, Tabs } from '../../components/ui';
import { useApi, useBootstrap } from '../../lib/hooks';

type Edit = { title: string; fields: FieldDef[]; initial?: Record<string, unknown>; submit: (v: Record<string, unknown>) => Promise<unknown> };
interface Comp { id: number; code: string; description: string; curriculum: string; isActive: boolean; learningAreaId: number; gradeLevelId: number; learningArea: { code: string }; gradeLevel: { name: string } }

export function CurriculumPage() {
  const boot = useBootstrap().data;
  const qc = useQueryClient();
  const [tab, setTab] = useState<'competencies' | 'areas' | 'grades' | 'stages'>('competencies');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [la, setLa] = useState('');
  const [grade, setGrade] = useState('');
  const [search, setSearch] = useState('');
  const comps = useApi<Comp[]>(tab === 'competencies' ? '/reference/competencies' : null, { learningAreaId: la, gradeLevelId: grade, search });
  const done = () => { qc.invalidateQueries({ queryKey: ['bootstrap'] }); comps.refetch(); };
  const laOpts = (boot?.learningAreas ?? []).map((l) => ({ value: l.id, label: l.name }));
  const gradeOpts = (boot?.gradeLevels ?? []).map((l) => ({ value: l.id, label: l.name }));
  const compFields: FieldDef[] = [
    { key: 'learningAreaId', label: 'Learning area', type: 'select', options: laOpts },
    { key: 'gradeLevelId', label: 'Grade level', type: 'select', options: gradeOpts },
    { key: 'code', label: 'Code', hint: 'As printed in the curriculum guide / MELC list' },
    { key: 'description', label: 'Competency', type: 'textarea' },
    { key: 'curriculum', label: 'Curriculum', type: 'select', options: [{ value: 'MATATAG', label: 'MATATAG' }, { value: 'MELC', label: 'MELC' }, { value: 'OTHER', label: 'Other' }] },
    { key: 'isActive', label: 'Active', type: 'checkbox' },
  ];
  const laFields: FieldDef[] = [{ key: 'code', label: 'Code (e.g. MATH)' }, { key: 'name', label: 'Name' }, { key: 'sortOrder', label: 'Display order', type: 'number' }, { key: 'isActive', label: 'Active', type: 'checkbox' }];
  const glFields: FieldDef[] = [{ key: 'code', label: 'Code (e.g. G7)' }, { key: 'name', label: 'Name' }, { key: 'keyStageId', label: 'Key stage', type: 'select', options: (boot?.keyStages ?? []).map((k) => ({ value: k.id, label: k.name })) }, { key: 'sortOrder', label: 'Order', type: 'number' }, { key: 'isActive', label: 'Active', type: 'checkbox' }];
  const ksFields: FieldDef[] = [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'sortOrder', label: 'Order', type: 'number' }];
  return (
    <>
      <PageHeader title="Curriculum" subtitle="Key stages, grade levels, learning areas and competencies are configuration — update them when DepEd issues a new curriculum, without changing the system." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'competencies', label: 'Competencies' }, { value: 'areas', label: 'Learning areas' }, { value: 'grades', label: 'Grade levels' }, { value: 'stages', label: 'Key stages' }]} />
      {tab === 'competencies' && (
        <Card pad={false} title="Competencies" actions={<Button size="sm" onClick={() => setEdit({ title: 'New competency', fields: compFields, initial: { learningAreaId: la, gradeLevelId: grade, curriculum: 'MATATAG', isActive: true }, submit: (v) => api.post('/reference/competencies', v).then(done) })}>Add competency</Button>}>
          <div className="p-3"><Notice tone="warn">Demo competencies are illustrative. Load the official MELC / MATATAG list for each grade and learning area before production use.</Notice></div>
          <div className="flex flex-wrap gap-2 border-b border-line px-3 pb-3">
            <Select className="max-w-xs" aria-label="Learning area" value={la} onChange={(e) => setLa(e.target.value)} options={laOpts} placeholder="All learning areas" />
            <Select className="max-w-xs" aria-label="Grade" value={grade} onChange={(e) => setGrade(e.target.value)} options={gradeOpts} placeholder="All grades" />
            <Input className="max-w-xs" placeholder="Search code or text" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {comps.isLoading ? <Spinner /> : (
            <Table dense rows={comps.data ?? []} rowKey={(r) => r.id} onRowClick={(r) => setEdit({ title: 'Edit competency', fields: compFields, initial: r as unknown as Record<string, unknown>, submit: (v) => api.put(`/reference/competencies/${r.id}`, v).then(done) })} columns={[
              { key: 'code', label: 'Code', render: (r) => <span className="font-mono text-xs">{r.code}</span> },
              { key: 'description', label: 'Competency' },
              { key: 'la', label: 'Area', render: (r) => r.learningArea.code },
              { key: 'grade', label: 'Grade', render: (r) => r.gradeLevel.name },
              { key: 'curriculum', label: 'Curriculum', render: (r) => <Badge>{r.curriculum}</Badge> },
              { key: 'isActive', label: '', render: (r) => (r.isActive ? null : <Badge>Inactive</Badge>) },
            ]} />
          )}
        </Card>
      )}
      {tab === 'areas' && (
        <Card pad={false} title="Learning areas" actions={<Button size="sm" onClick={() => setEdit({ title: 'New learning area', fields: laFields, initial: { isActive: true }, submit: (v) => api.post('/reference/learning-areas', v).then(done) })}>Add learning area</Button>}>
          <Table rows={boot?.learningAreas ?? []} rowKey={(r) => r.id} onRowClick={(r) => setEdit({ title: 'Edit learning area', fields: laFields, initial: r, submit: (v) => api.put(`/reference/learning-areas/${r.id}`, v).then(done) })} columns={[
            { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'isActive', label: 'Status', render: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
          ]} />
        </Card>
      )}
      {tab === 'grades' && (
        <Card pad={false} title="Grade levels" actions={<Button size="sm" onClick={() => setEdit({ title: 'New grade level', fields: glFields, initial: { isActive: true }, submit: (v) => api.post('/reference/grade-levels', v).then(done) })}>Add grade level</Button>}>
          <Table rows={boot?.gradeLevels ?? []} rowKey={(r) => r.id} onRowClick={(r) => setEdit({ title: 'Edit grade level', fields: glFields, initial: r, submit: (v) => api.put(`/reference/grade-levels/${r.id}`, v).then(done) })} columns={[
            { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'ks', label: 'Key stage', render: (r) => boot?.keyStages.find((k) => k.id === r.keyStageId)?.name }, { key: 'isActive', label: 'Status', render: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
          ]} />
        </Card>
      )}
      {tab === 'stages' && (
        <Card pad={false} title="Key stages" actions={<Button size="sm" onClick={() => setEdit({ title: 'New key stage', fields: ksFields, submit: (v) => api.post('/reference/key-stages', v).then(done) })}>Add key stage</Button>}>
          <Table rows={boot?.keyStages ?? []} rowKey={(r) => r.id} onRowClick={(r) => setEdit({ title: 'Edit key stage', fields: ksFields, initial: r, submit: (v) => api.put(`/reference/key-stages/${r.id}`, v).then(done) })} columns={[
            { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'n', label: 'Grade levels', render: (r) => boot?.gradeLevels.filter((g) => g.keyStageId === r.id).map((g) => g.code).join(', ') },
          ]} />
        </Card>
      )}
      {edit && <FormModal title={edit.title} fields={edit.fields} initial={edit.initial} onClose={() => setEdit(null)} onSubmit={edit.submit} />}
    </>
  );
}
