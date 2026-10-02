import { useState } from 'react';
import { api, type Tier } from '../api/client';
import { useApi, useBootstrap, usePeriod } from '../lib/hooks';
import { Button, ErrorBox, Field, Input, Modal, Notice, Select, Textarea } from './ui';

interface Comp { id: number; code: string; description: string; learningAreaId: number }

export interface InterventionSeed {
  title?: string;
  sectionId?: number | null;
  learningAreaId?: number;
  competencyIds?: number[];
  tier?: Tier;
  learners?: { learnerId: number; learningGapId?: number | null; name?: string }[];
  sourceAssessmentId?: number | null;
}

const STRATEGIES = [
  'Small-group targeted instruction',
  'One-on-one tutoring / remediation',
  'Peer tutoring',
  'Guided reading in small groups',
  'Concrete–pictorial–abstract remediation',
  'Differentiated practice and review',
  'Enrichment / extension activities',
];

export function InterventionForm({ seed, onClose, onCreated }: { seed: InterventionSeed; onClose: () => void; onCreated: (id: number) => void }) {
  const boot = useBootstrap().data;
  const period = usePeriod();
  const [v, setV] = useState({
    title: seed.title ?? '',
    learningAreaId: String(seed.learningAreaId ?? ''),
    tier: seed.tier ?? 'TIER_2',
    strategy: STRATEGIES[0],
    description: '',
    frequency: '3x a week, 30 minutes',
    startDate: new Date().toISOString().slice(0, 10),
    targetEndDate: '',
    reassessmentDate: '',
    status: 'PLANNED',
  });
  const [error, setError] = useState<unknown>(null);
  // An intervention from a gap inherits that gap's learning area: lock it so the targeted
  // competencies always belong to the right subject (e.g. a Filipino gap → Filipino competencies).
  const lockedArea = seed.learningAreaId != null;
  const [competencyIds, setCompetencyIds] = useState<Set<number>>(new Set(seed.competencyIds ?? []));
  const laId = Number(v.learningAreaId) || 0;
  const comps = useApi<Comp[]>(laId ? '/reference/competencies' : null, { learningAreaId: laId });
  const laName = (boot?.learningAreas ?? []).find((l) => l.id === laId)?.name ?? '';
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const changeArea = (e: { target: { value: string } }) => { setV((x) => ({ ...x, learningAreaId: e.target.value })); setCompetencyIds(new Set()); };
  const toggleComp = (id: number) => setCompetencyIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = async () => {
    setError(null);
    try {
      const r = await api.post<{ id: number }>('/interventions', {
        ...v,
        learningAreaId: laId,
        sectionId: seed.sectionId ?? null,
        schoolYearId: period.schoolYearId,
        termId: period.termId ?? null,
        sourceAssessmentId: seed.sourceAssessmentId ?? null,
        targetEndDate: v.targetEndDate || null,
        reassessmentDate: v.reassessmentDate || v.targetEndDate || null,
        competencyIds: [...competencyIds],
        learners: (seed.learners ?? []).map((l) => ({ learnerId: l.learnerId, learningGapId: l.learningGapId ?? null })),
      });
      onCreated(r.id);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal open wide onClose={onClose} title="Plan an intervention" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit}>Create intervention</Button></>}>
      <div className="grid gap-3 md:grid-cols-2">
        {!!seed.learners?.length && (
          <div className="md:col-span-2">
            <Notice>{seed.learners.length} learner{seed.learners.length > 1 ? 's' : ''} will be enrolled with their pre-intervention results recorded as the baseline{seed.learners.some((l) => l.name) ? `: ${seed.learners.slice(0, 8).map((l) => l.name).join(', ')}${seed.learners.length > 8 ? '…' : ''}` : ''}.</Notice>
          </div>
        )}
        <Field label="Title" className="md:col-span-2"><Input value={v.title} onChange={set('title')} placeholder="e.g. Remediation: adding fractions" /></Field>
        <Field label="Learning area" hint={lockedArea ? 'Set by the learning gap this intervention addresses.' : undefined}>
          {lockedArea
            ? <Input value={laName} disabled readOnly />
            : <Select value={v.learningAreaId} onChange={changeArea} options={(boot?.learningAreas ?? []).map((l) => ({ value: l.id, label: l.name }))} placeholder="Select…" />}
        </Field>
        <Field label="Tier of support"><Select value={v.tier} onChange={set('tier')} options={[{ value: 'TIER_1', label: 'Tier 1 – enrichment' }, { value: 'TIER_2', label: 'Tier 2 – targeted' }, { value: 'TIER_3', label: 'Tier 3 – intensive' }]} /></Field>
        <Field label="Target competencies" hint={laName ? `Only ${laName} competencies can be targeted.` : 'Choose a learning area first.'} className="md:col-span-2">
          {!laId ? <p className="text-sm text-ink-3">Select a learning area to choose competencies.</p>
            : comps.isLoading ? <p className="text-sm text-ink-3">Loading competencies…</p>
            : !comps.data?.length ? <p className="text-sm text-ink-3">No competencies are configured for {laName}.</p>
            : (
              <div className="max-h-44 overflow-y-auto rounded-md border border-line p-1">
                {comps.data.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2">
                    <input type="checkbox" className="mt-0.5" checked={competencyIds.has(c.id)} onChange={() => toggleComp(c.id)} />
                    <span><span className="font-medium">{c.code}</span> <span className="text-ink-2">{c.description}</span></span>
                  </label>
                ))}
              </div>
            )}
        </Field>
        <Field label="Strategy"><Select value={v.strategy} onChange={set('strategy')} options={STRATEGIES.map((s) => ({ value: s, label: s }))} /></Field>
        <Field label="Frequency"><Input value={v.frequency} onChange={set('frequency')} /></Field>
        <Field label="Description / activities" className="md:col-span-2"><Textarea value={v.description} onChange={set('description')} placeholder="What will be done, materials, who facilitates" /></Field>
        <Field label="Start date"><Input type="date" value={v.startDate} onChange={set('startDate')} /></Field>
        <Field label="Target completion"><Input type="date" value={v.targetEndDate} onChange={set('targetEndDate')} /></Field>
        <Field label="Reassessment date" hint="Defaults to the target completion date."><Input type="date" value={v.reassessmentDate} onChange={set('reassessmentDate')} /></Field>
        <Field label="Status"><Select value={v.status} onChange={set('status')} options={[{ value: 'IDENTIFIED', label: 'Identified' }, { value: 'PLANNED', label: 'Planned' }, { value: 'ONGOING', label: 'Ongoing' }]} /></Field>
        <div className="md:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Modal>
  );
}
