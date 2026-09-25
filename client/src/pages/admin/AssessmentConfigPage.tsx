import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Band, type Tier } from '../../api/client';
import { FormModal, type FieldDef } from '../../components/FormModal';
import { Badge, Button, Card, ErrorBox, Input, Notice, PageHeader, Select, Spinner, TierBadge } from '../../components/ui';
import { useApi } from '../../lib/hooks';

interface Model { id: number; name: string; version: string; isActive: boolean; isProvisional: boolean; masteryThreshold: number; notes: string | null; bands: Band[]; _count: { assessments: number } }
interface Type { id: number; code: string; name: string; description: string | null; resultMode: 'PERCENTAGE' | 'PROFILE'; isActive: boolean; models: Model[] }

const typeFields: FieldDef[] = [
  { key: 'code', label: 'Code', hint: 'Letters, digits, underscores (e.g. PHIL_IRI)' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'resultMode', label: 'How results are recorded', type: 'select', options: [{ value: 'PERCENTAGE', label: 'Score → percentage bands' }, { value: 'PROFILE', label: 'Instrument level / descriptor' }] },
  { key: 'isActive', label: 'Active', type: 'checkbox' },
];

export function AssessmentConfigPage() {
  const q = useApi<Type[]>('/reference/assessment-types', undefined, { staleTime: 0 });
  const qc = useQueryClient();
  const [edit, setEdit] = useState<{ title: string; initial?: Record<string, unknown>; submit: (v: Record<string, unknown>) => Promise<unknown> } | null>(null);
  const done = () => { q.refetch(); qc.invalidateQueries({ queryKey: ['bootstrap'] }); };
  return (
    <>
      <PageHeader
        title="Assessment standards"
        subtitle="Assessment types and their performance-level configuration. Thresholds and descriptors are data, not code: update them here when DepEd policy changes. Saving re-classifies existing results."
        actions={<Button onClick={() => setEdit({ title: 'New assessment type', initial: { resultMode: 'PERCENTAGE', isActive: true }, submit: (v) => api.post('/reference/assessment-types', v).then(done) })}>New assessment type</Button>}
      />
      <div className="mb-4"><Notice tone="warn">Levels marked <strong>provisional</strong> were seeded for demonstration. Confirm every cut-off and descriptor (CRLA, Phil-IRI, RMA, ELLNA, quarterly bands) against the current DepEd / Region / SDO issuance.</Notice></div>
      {q.isLoading ? <Spinner /> : (
        <div className="space-y-4">
          {(q.data ?? []).map((t) => (
            <Card key={t.id} title={<>{t.name} <Badge>{t.code}</Badge> {!t.isActive && <Badge>Inactive</Badge>}</>} subtitle={`${t.resultMode === 'PERCENTAGE' ? 'Score-based: percentage bands' : 'Profile-based: instrument descriptors (no percentage rule)'}${t.description ? ` · ${t.description}` : ''}`}
              actions={
                <>
                  <Button size="sm" variant="secondary" onClick={() => setEdit({ title: `Edit ${t.name}`, initial: t as unknown as Record<string, unknown>, submit: (v) => api.put(`/reference/assessment-types/${t.id}`, v).then(done) })}>Edit type</Button>
                  {!t.models.length && <Button size="sm" onClick={() => api.post('/reference/classification-models', { assessmentTypeId: t.id, name: `${t.name} levels`, bands: t.resultMode === 'PERCENTAGE' ? [{ label: 'Meets standard', tier: 'TIER_1', minPct: 75, maxPct: 100, sortOrder: 1 }, { label: 'Below standard', tier: 'TIER_3', minPct: 0, maxPct: 74.99, sortOrder: 2 }] : [{ label: 'Ready', descriptorKey: 'READY', tier: 'TIER_1', sortOrder: 1 }, { label: 'Needs support', descriptorKey: 'NEEDS_SUPPORT', tier: 'TIER_3', sortOrder: 2 }] }).then(done)}>Add performance levels</Button>}
                </>
              }>
              {t.models.map((m) => <ModelEditor key={m.id} type={t} model={m} onSaved={done} />)}
            </Card>
          ))}
        </div>
      )}
      {edit && <FormModal title={edit.title} fields={typeFields} initial={edit.initial} onClose={() => setEdit(null)} onSubmit={edit.submit} />}
    </>
  );
}

type BandDraft = Omit<Band, 'id'> & { id?: number };

function ModelEditor({ type, model, onSaved }: { type: Type; model: Model; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [bands, setBands] = useState<BandDraft[]>(model.bands);
  const [threshold, setThreshold] = useState(String(Math.round(model.masteryThreshold * 100)));
  const [provisional, setProvisional] = useState(model.isProvisional);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const pctMode = type.resultMode === 'PERCENTAGE';
  const upd = (i: number, patch: Partial<BandDraft>) => setBands((b) => b.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    setError(null);
    try {
      const r = await api.put<{ reclassifiedResults: number }>(`/reference/classification-models/${model.id}`, {
        name: model.name, masteryThreshold: Number(threshold) / 100, isProvisional: provisional, notes: model.notes,
        bands: bands.map((b, i) => ({ id: b.id, label: b.label, tier: b.tier, minPct: pctMode ? Number(b.minPct) : null, maxPct: pctMode && b.maxPct !== null && String(b.maxPct) !== '' ? Number(b.maxPct) : null, descriptorKey: pctMode ? null : b.descriptorKey, description: b.description, color: b.color, sortOrder: i + 1 })),
      });
      setMsg(`Saved. ${r.reclassifiedResults} existing result(s) were re-classified.`);
      setEditing(false);
      onSaved();
    } catch (e) { setError(e); }
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span className="font-medium text-ink">{model.name}</span><span>v{model.version}</span>
        {model.isProvisional && <Badge tone="amber">Provisional</Badge>}
        <span>· competency mastery at {Math.round(model.masteryThreshold * 100)}% of items</span>
        <span>· used by {model._count.assessments} assessment(s)</span>
        {!editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit levels</Button>}
      </div>
      {msg && <div className="mb-2"><Notice>{msg}</Notice></div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-ink-3">
            <th className="px-2 py-1.5">Level</th><th className="px-2 py-1.5">Tier</th>
            {pctMode ? <><th className="px-2 py-1.5">Min %</th><th className="px-2 py-1.5">Max %</th></> : <th className="px-2 py-1.5">Descriptor key</th>}
            <th className="px-2 py-1.5">Colour</th><th className="px-2 py-1.5">Description</th>{editing && <th />}
          </tr></thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={b.id ?? `new${i}`} className="border-b border-line last:border-0">
                <td className="px-2 py-1">{editing ? <Input className="h-8" value={b.label} onChange={(e) => upd(i, { label: e.target.value })} /> : <span className="font-medium">{b.label}</span>}</td>
                <td className="px-2 py-1">{editing ? <Select className="h-8 w-28" value={b.tier} onChange={(e) => upd(i, { tier: e.target.value as Tier })} options={[{ value: 'TIER_1', label: 'Tier 1' }, { value: 'TIER_2', label: 'Tier 2' }, { value: 'TIER_3', label: 'Tier 3' }]} /> : <TierBadge tier={b.tier} />}</td>
                {pctMode ? (
                  <>
                    <td className="px-2 py-1">{editing ? <Input className="h-8 w-20" type="number" value={b.minPct ?? ''} onChange={(e) => upd(i, { minPct: e.target.value === '' ? null : Number(e.target.value) })} /> : b.minPct}</td>
                    <td className="px-2 py-1">{editing ? <Input className="h-8 w-20" type="number" value={b.maxPct ?? ''} onChange={(e) => upd(i, { maxPct: e.target.value === '' ? null : Number(e.target.value) })} /> : b.maxPct ?? '—'}</td>
                  </>
                ) : <td className="px-2 py-1">{editing ? <Input className="h-8" value={b.descriptorKey ?? ''} onChange={(e) => upd(i, { descriptorKey: e.target.value.toUpperCase().replace(/\s+/g, '_') })} /> : <code className="text-xs">{b.descriptorKey}</code>}</td>}
                <td className="px-2 py-1">{editing ? <input type="color" value={b.color} onChange={(e) => upd(i, { color: e.target.value })} aria-label="Colour" /> : <span className="inline-block h-3 w-6 rounded-sm" style={{ background: b.color }} />}</td>
                <td className="px-2 py-1 text-xs text-ink-2">{editing ? <Input className="h-8" value={b.description ?? ''} onChange={(e) => upd(i, { description: e.target.value })} /> : b.description ?? '—'}</td>
                {editing && <td className="px-2 py-1"><Button size="sm" variant="ghost" onClick={() => setBands((x) => x.filter((_, j) => j !== i))} aria-label="Remove level">✕</Button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Button size="sm" variant="secondary" onClick={() => setBands((b) => [...b, { label: 'New level', tier: 'TIER_2', minPct: pctMode ? 0 : null, maxPct: null, descriptorKey: pctMode ? null : 'NEW_LEVEL', description: null, color: '#64748b', sortOrder: b.length + 1 }])}>Add level</Button>
            <label className="flex items-center gap-2">Competency mastery at <Input className="h-8 w-16" type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} />% of items</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} /> Provisional (awaiting confirmation)</label>
          </div>
          <ErrorBox error={error} />
          <div className="flex gap-2">
            <Button onClick={save}>Save & re-classify</Button>
            <Button variant="secondary" onClick={() => { setEditing(false); setBands(model.bands); setError(null); }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
