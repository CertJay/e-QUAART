import { useState } from 'react';
import { api, type Tier } from '../api/client';
import { useBootstrap, usePeriod } from '../lib/hooks';
import { Button, ErrorBox, Field, Input, Modal, Notice, Select, Textarea } from './ui';

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
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const submit = async () => {
    setError(null);
    try {
      const r = await api.post<{ id: number }>('/interventions', {
        ...v,
        learningAreaId: Number(v.learningAreaId),
        sectionId: seed.sectionId ?? null,
        schoolYearId: period.schoolYearId,
        termId: period.termId ?? null,
        sourceAssessmentId: seed.sourceAssessmentId ?? null,
        targetEndDate: v.targetEndDate || null,
        reassessmentDate: v.reassessmentDate || v.targetEndDate || null,
        competencyIds: seed.competencyIds ?? [],
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
        <Field label="Learning area"><Select value={v.learningAreaId} onChange={set('learningAreaId')} options={(boot?.learningAreas ?? []).map((l) => ({ value: l.id, label: l.name }))} placeholder="Select…" /></Field>
        <Field label="Tier of support"><Select value={v.tier} onChange={set('tier')} options={[{ value: 'TIER_1', label: 'Tier 1 – enrichment' }, { value: 'TIER_2', label: 'Tier 2 – targeted' }, { value: 'TIER_3', label: 'Tier 3 – intensive' }]} /></Field>
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
