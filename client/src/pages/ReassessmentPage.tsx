import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Tier } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, ErrorBox, Field, Input, Modal, Notice, PageHeader, Select, Spinner, Table, TierBadge } from '../components/ui';
import { date, humanize, pct } from '../lib/format';
import { useApi } from '../lib/hooks';

export interface QueueRow {
  id: number; interventionId: number; intervention: { id: number; title: string; status: string; reassessmentDate: string | null; learningArea: { name: string } };
  learner: { id: number | null; name: string }; pre: { percentage: number | null; tier: Tier | null }; competency: { code: string; description: string } | null;
  instrument: { name: string; mode: 'PERCENTAGE' | 'PROFILE'; levels: { key: string | null; label: string }[] } | null; due: string | null; overdue: boolean;
}

export function ReassessmentPage() {
  const { can } = useAuth();
  const q = useApi<QueueRow[]>('/interventions/queue/reassessment', undefined, { staleTime: 0 });
  const [row, setRow] = useState<QueueRow | null>(null);
  return (
    <>
      <PageHeader title="Reassessment" subtitle="Learners in interventions who have not yet been reassessed. Recording the post-intervention result measures whether the intervention worked." />
      <Card pad={false}>
        {q.isLoading ? <Spinner /> : (
          <Table rows={q.data ?? []} rowKey={(r) => r.id} empty="No learners are waiting for reassessment" columns={[
            { key: 'learner', label: 'Learner', render: (r) => r.learner.id ? <Link className="font-medium hover:text-brand" to={`/learners/${r.learner.id}`}>{r.learner.name}</Link> : r.learner.name },
            { key: 'int', label: 'Intervention', render: (r) => <Link className="text-brand hover:underline" to={`/interventions/${r.interventionId}`}>{r.intervention.title}</Link> },
            { key: 'target', label: 'Reassess on', render: (r) => r.competency ? <span className="text-xs">{r.competency.code}</span> : <span className="text-xs">{r.instrument?.name ?? r.intervention.learningArea.name}</span> },
            { key: 'pre', label: 'Baseline', render: (r) => <span className="text-xs">{pct(r.pre.percentage, 0)} <TierBadge tier={r.pre.tier} /></span> },
            { key: 'due', label: 'Due', render: (r) => <span className="text-xs">{date(r.due)} {r.overdue && <Badge tone="red">overdue</Badge>}</span> },
            { key: 'status', label: 'Intervention status', render: (r) => <span className="text-xs">{humanize(r.intervention.status)}</span> },
            ...(can('intervention:write') ? [{ key: 'act', label: '', render: (r: QueueRow) => <Button size="sm" onClick={() => setRow(r)}>Record result</Button> }] : []),
          ]} />
        )}
      </Card>
      {row && <ReassessDialog row={row} onClose={() => setRow(null)} onSaved={() => q.refetch()} />}
    </>
  );
}

export function ReassessDialog({ row, onClose, onSaved }: { row: Pick<QueueRow, 'id' | 'interventionId' | 'competency' | 'instrument' | 'pre'> & { learner: { name: string } }; onClose: () => void; onSaved: () => void }) {
  const profile = !row.competency && row.instrument?.mode === 'PROFILE';
  const [v, setV] = useState({ date: new Date().toISOString().slice(0, 10), rawScore: '', maxScore: row.competency ? '10' : '', descriptor: '', notes: '' });
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ effectiveness: { scoreDifference: number | null; percentImprovement: number | null; levelChange: string; signal: string; suggestedDecisions: string[]; post: { percentage: number | null; tier: Tier | null } } } | null>(null);
  const submit = async () => {
    setError(null);
    try {
      const r = await api.post<typeof result>(`/interventions/${row.interventionId}/learners/${row.id}/reassessments`, {
        date: v.date, rawScore: v.rawScore === '' ? null : Number(v.rawScore), maxScore: v.maxScore === '' ? null : Number(v.maxScore), descriptor: v.descriptor || null, notes: v.notes || null,
      });
      setResult(r);
      onSaved();
    } catch (e) { setError(e); }
  };
  return (
    <Modal open onClose={onClose} title={`Reassess ${row.learner.name}`} footer={result ? <Button onClick={onClose}>Done</Button> : <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit}>Save reassessment</Button></>}>
      {result ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded border border-line p-2"><div className="text-xs text-ink-3">Before</div><div className="num font-semibold">{pct(row.pre.percentage, 0)}</div><TierBadge tier={row.pre.tier} /></div>
            <div className="rounded border border-line p-2"><div className="text-xs text-ink-3">After</div><div className="num font-semibold">{pct(result.effectiveness.post.percentage, 0)}</div><TierBadge tier={result.effectiveness.post.tier} /></div>
            <div className="rounded border border-line p-2"><div className="text-xs text-ink-3">Change</div><div className="num font-semibold">{result.effectiveness.scoreDifference != null ? `${result.effectiveness.scoreDifference > 0 ? '+' : ''}${result.effectiveness.scoreDifference} pts` : humanize(result.effectiveness.levelChange)}</div>{result.effectiveness.percentImprovement != null && <div className="text-xs text-ink-3">{result.effectiveness.percentImprovement}% relative</div>}</div>
          </div>
          <Notice>{result.effectiveness.signal} Options the data points to: <strong>{result.effectiveness.suggestedDecisions.map(humanize).join(', ')}</strong>. Record your decision on the intervention page.</Notice>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <p className="col-span-2 text-sm text-ink-2">{row.competency ? <>Competency check on <strong>{row.competency.code}</strong> — {row.competency.description}. Mastery is judged against the same threshold as the original assessment.</> : profile ? <>Record the learner's current <strong>{row.instrument!.name}</strong> level.</> : 'Record the reassessment score.'}</p>
          <Field label="Date"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          {profile ? (
            <Field label="Level"><Select value={v.descriptor} onChange={(e) => setV({ ...v, descriptor: e.target.value })} options={row.instrument!.levels.map((l) => ({ value: l.key ?? l.label, label: l.label }))} placeholder="Select…" /></Field>
          ) : (
            <>
              <Field label="Score"><Input type="number" min={0} value={v.rawScore} onChange={(e) => setV({ ...v, rawScore: e.target.value })} /></Field>
              <Field label="Out of (items / max score)"><Input type="number" min={1} value={v.maxScore} onChange={(e) => setV({ ...v, maxScore: e.target.value })} /></Field>
            </>
          )}
          <Field label="Notes" className="col-span-2"><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
          <div className="col-span-2"><ErrorBox error={error} /></div>
        </div>
      )}
    </Modal>
  );
}
