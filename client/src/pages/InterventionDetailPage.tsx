import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Tier } from '../api/client';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Kpi, Modal, Notice, PageHeader, Select, Spinner, StatusBadge, Table, Textarea, TierBadge } from '../components/ui';
import { date, humanize, pct } from '../lib/format';
import { useApi } from '../lib/hooks';
import { ReassessDialog, type QueueRow } from './ReassessmentPage';

interface Member {
  id: number;
  learner: { id: number | null; lrn: string | null; name: string };
  entryReason: string | null;
  gap: { id: number; status: string; competency: { code: string; description: string } | null } | null;
  instrument: QueueRow['instrument'];
  pre: { percentage: number | null; tier: Tier | null; band: string | null };
  post: { percentage: number | null; tier: Tier | null; band: string | null; date: string } | null;
  reassessments: { id: number; date: string; percentage: number | null; tier: Tier | null; notes: string | null }[];
  effectiveness: { scoreDifference: number | null; percentImprovement: number | null; levelChange: string; improved: boolean | null; suggestedDecisions: string[]; signal: string } | null;
  decision: string | null;
  progressNote: string | null;
  attendance: { attended: number; sessions: number; rate: number | null };
}
interface Detail {
  id: number; title: string; status: string; tier: Tier; type: string; strategy: string; description: string | null; frequency: string | null; bannerProgram: string | null; remarks: string | null;
  startDate: string | null; targetEndDate: string | null; reassessmentDate: string | null; sectionId: number | null;
  school: { name: string }; section: { id: number; name: string; gradeLevel: { name: string } } | null; learningArea: { name: string }; owner: { fullName: string };
  competencies: { competency: { id: number; code: string; description: string } }[]; sourceAssessment: { id: number; title: string } | null;
  learners: Member[];
  sessions: { id: number; date: string; topic: string; notes: string | null; attendance: { learnerId: number; present: boolean }[]; present?: number; total?: number }[];
  canManage: boolean;
}

const STATUSES = ['IDENTIFIED', 'PLANNED', 'ONGOING', 'FOR_MONITORING', 'REASSESSMENT_REQUIRED', 'COMPLETED'];
const DECISIONS = ['CONTINUE', 'MODIFY', 'COMPLETE', 'REPEAT', 'REFER'];
const CHANGE = { IMPROVED: { g: '▲', c: 'text-emerald-700 dark:text-emerald-300' }, DECLINED: { g: '▼', c: 'text-red-700 dark:text-red-300' }, SAME: { g: '■', c: 'text-ink-3' }, UNKNOWN: { g: '?', c: 'text-ink-3' } } as Record<string, { g: string; c: string }>;

export function InterventionDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const q = useApi<Detail>(`/interventions/${id}`, undefined, { staleTime: 0 });
  const [reassess, setReassess] = useState<Member | null>(null);
  const [decide, setDecide] = useState<Member | null>(null);
  const [session, setSession] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const i = q.data!;
  const reassessed = i.learners.filter((l) => l.post);
  const improved = reassessed.filter((l) => l.effectiveness?.improved).length;
  const met = reassessed.filter((l) => l.post?.tier === 'TIER_1').length;
  const gains = reassessed.map((l) => l.effectiveness?.scoreDifference).filter((x): x is number => x != null);
  const avgAttendance = i.learners.length && i.sessions.length ? Math.round(i.learners.reduce((s, l) => s + (l.attendance.rate ?? 0), 0) / i.learners.length) : null;
  const run = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); q.refetch(); } catch (e) { setError(e); } };

  return (
    <>
      <PageHeader
        crumbs={[{ to: '/interventions', label: 'Interventions' }]}
        title={i.title}
        subtitle={<>{i.school.name}{i.section ? ` · ${i.section.gradeLevel.name} – ${i.section.name}` : ''} · {i.learningArea.name} · Responsible: {i.owner.fullName}</>}
        actions={
          <>
            <TierBadge tier={i.tier} label={humanize(i.type)} />
            {i.canManage ? (
              <Select className="h-8 w-52 text-xs" aria-label="Status" value={i.status} onChange={(e) => run(() => api.put(`/interventions/${i.id}`, { status: e.target.value }))} options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
            ) : <StatusBadge status={i.status} />}
            {i.canManage && <Button variant="ghost" onClick={() => confirm('Delete this intervention? Linked learning gaps return to "open".') && run(async () => { await api.del(`/interventions/${i.id}`); nav('/interventions'); })}>Delete</Button>}
          </>
        }
      />
      <ErrorBox error={error} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Learners" value={i.learners.length} />
        <Kpi label="Sessions held" value={i.sessions.length} hint={avgAttendance != null ? `${avgAttendance}% average attendance` : undefined} />
        <Kpi label="Reassessed" value={`${reassessed.length}/${i.learners.length}`} />
        <Kpi label="Improved" value={reassessed.length ? pct((improved / reassessed.length) * 100, 0) : '—'} hint={gains.length ? `average ${(gains.reduce((a, b) => a + b, 0) / gains.length).toFixed(1)} pts` : undefined} tone={reassessed.length ? (improved / reassessed.length >= 0.6 ? 'good' : 'warn') : undefined} />
        <Kpi label="Now meeting standard" value={met} hint={reassessed.length ? `of ${reassessed.length} reassessed` : undefined} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title="Plan" className="lg:col-span-2">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-ink-3">Strategy</dt><dd>{i.strategy}</dd></div>
            <div><dt className="text-xs text-ink-3">Frequency</dt><dd>{i.frequency ?? '—'}</dd></div>
            <div><dt className="text-xs text-ink-3">Period</dt><dd>{date(i.startDate)} → {date(i.targetEndDate)}</dd></div>
            <div><dt className="text-xs text-ink-3">Reassessment</dt><dd>{date(i.reassessmentDate)}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-ink-3">Targeted competencies</dt><dd>{i.competencies.length ? i.competencies.map((c) => <div key={c.competency.id}><strong>{c.competency.code}</strong> <span className="text-ink-2">{c.competency.description}</span></div>) : '—'}</dd></div>
            {i.description && <div className="sm:col-span-2"><dt className="text-xs text-ink-3">Description</dt><dd className="whitespace-pre-line">{i.description}</dd></div>}
            {i.sourceAssessment && <div className="sm:col-span-2"><dt className="text-xs text-ink-3">Identified from</dt><dd><Link className="text-brand hover:underline" to={`/assessments/${i.sourceAssessment.id}`}>{i.sourceAssessment.title}</Link></dd></div>}
          </dl>
        </Card>
        <Card title="Sessions & attendance" actions={i.canManage && i.learners.length ? <Button size="sm" onClick={() => setSession(true)}>Log session</Button> : null}>
          {!i.sessions.length ? <Empty title="No sessions logged" /> : (
            <ul className="divide-y divide-line text-sm">
              {i.sessions.map((s) => {
                const present = s.present ?? s.attendance.filter((a) => a.present).length;
                const total = s.total ?? s.attendance.length;
                return (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span><span className="text-xs text-ink-3">{date(s.date)}</span><br />{s.topic}</span>
                    <span className="num whitespace-nowrap text-xs text-ink-2">{present}/{total} present</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card pad={false} title="Learners: pre- and post-intervention" subtitle="Baseline comes from the assessment that identified the gap; post from the latest reassessment." actions={i.canManage ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add learners</Button> : null}>
        <Table rows={i.learners} rowKey={(r) => r.id} empty="No learners in this intervention" columns={[
          { key: 'learner', label: 'Learner', render: (r) => <div>{r.learner.id ? <Link className="font-medium hover:text-brand" to={`/learners/${r.learner.id}`}>{r.learner.name}</Link> : r.learner.name}{r.entryReason && <div className="text-[11px] text-ink-3">{r.entryReason}</div>}</div> },
          { key: 'att', label: 'Attendance', align: 'right', render: (r) => r.attendance.sessions ? `${r.attendance.attended}/${r.attendance.sessions}` : '—' },
          { key: 'pre', label: 'Pre', render: (r) => <div className="text-xs"><span className="num">{pct(r.pre.percentage, 0)}</span><br /><TierBadge tier={r.pre.tier} label={r.pre.band} /></div> },
          { key: 'post', label: 'Post', render: (r) => r.post ? <div className="text-xs"><span className="num">{pct(r.post.percentage, 0)}</span><br /><TierBadge tier={r.post.tier} label={r.post.band} /></div> : <span className="text-xs text-ink-3">Not yet</span> },
          { key: 'chg', label: 'Change', render: (r) => r.effectiveness ? (
            <div className={`text-xs ${CHANGE[r.effectiveness.improved ? 'IMPROVED' : r.effectiveness.levelChange].c}`}>
              {CHANGE[r.effectiveness.improved ? 'IMPROVED' : r.effectiveness.levelChange].g} {r.effectiveness.scoreDifference != null ? `${r.effectiveness.scoreDifference > 0 ? '+' : ''}${r.effectiveness.scoreDifference} pts` : humanize(r.effectiveness.levelChange)}
              {r.effectiveness.percentImprovement != null && <span className="text-ink-3"> ({r.effectiveness.percentImprovement > 0 ? '+' : ''}{r.effectiveness.percentImprovement}%)</span>}
            </div>
          ) : '—' },
          { key: 'dec', label: 'Decision', render: (r) => r.decision ? <Badge tone="blue">{humanize(r.decision)}</Badge> : r.effectiveness ? <span className="text-[11px] text-ink-3">Data suggests: {r.effectiveness.suggestedDecisions.map(humanize).join(' / ')}</span> : '—' },
          ...(i.canManage ? [{ key: 'act', label: '', render: (r: Member) => (
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" onClick={() => setReassess(r)}>Reassess</Button>
              <Button size="sm" variant="ghost" onClick={() => setDecide(r)}>Decide</Button>
            </div>
          ) }] : []),
        ]} />
      </Card>
      {reassess && <ReassessDialog row={{ id: reassess.id, interventionId: i.id, competency: reassess.gap?.competency ?? null, instrument: reassess.instrument, pre: reassess.pre, learner: reassess.learner }} onClose={() => setReassess(null)} onSaved={() => q.refetch()} />}
      {decide && <DecisionDialog i={i} m={decide} onClose={() => setDecide(null)} onSaved={() => q.refetch()} />}
      {session && <SessionDialog i={i} onClose={() => setSession(false)} onSaved={() => q.refetch()} />}
      {adding && <AddLearners i={i} onClose={() => setAdding(false)} onSaved={() => q.refetch()} />}
    </>
  );
}

function DecisionDialog({ i, m, onClose, onSaved }: { i: Detail; m: Member; onClose: () => void; onSaved: () => void }) {
  const [decision, setDecision] = useState(m.decision ?? m.effectiveness?.suggestedDecisions[0] ?? '');
  const [note, setNote] = useState(m.progressNote ?? '');
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open onClose={onClose} title={`Decision for ${m.learner.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => {
      try { await api.put(`/interventions/${i.id}/learners/${m.id}`, { decision: decision || null, progressNote: note || null }); onSaved(); onClose(); } catch (e) { setError(e); }
    }}>Save</Button></>}>
      <div className="space-y-3">
        {m.effectiveness ? <Notice>{m.effectiveness.signal} The data points to: <strong>{m.effectiveness.suggestedDecisions.map(humanize).join(', ')}</strong>.</Notice> : <Notice tone="warn">No reassessment yet — record one to base the decision on evidence.</Notice>}
        <Field label="Instructional decision"><Select value={decision} onChange={(e) => setDecision(e.target.value)} options={DECISIONS.map((d) => ({ value: d, label: `${humanize(d)}${m.effectiveness?.suggestedDecisions.includes(d) ? ' (suggested)' : ''}` }))} placeholder="Not decided" /></Field>
        <Field label="Progress notes"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function SessionDialog({ i, onClose, onSaved }: { i: Detail; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ date: new Date().toISOString().slice(0, 10), topic: '', notes: '' });
  const [present, setPresent] = useState<Record<number, boolean>>(() => Object.fromEntries(i.learners.filter((l) => l.learner.id).map((l) => [l.learner.id!, true])));
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open onClose={onClose} title="Log a session" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => {
      try { await api.post(`/interventions/${i.id}/sessions`, { ...v, notes: v.notes || null, attendance: Object.entries(present).map(([k, p]) => ({ learnerId: Number(k), present: p })) }); onSaved(); onClose(); } catch (e) { setError(e); }
    }}>Save session</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label="Topic / activity"><Input value={v.topic} onChange={(e) => setV({ ...v, topic: e.target.value })} /></Field>
        </div>
        <Field label="Notes"><Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
        <div>
          <div className="mb-1 text-xs font-medium text-ink-2">Attendance</div>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {i.learners.filter((l) => l.learner.id).map((l) => (
              <li key={l.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={present[l.learner.id!]} onChange={(e) => setPresent({ ...present, [l.learner.id!]: e.target.checked })} />{l.learner.name}</label></li>
            ))}
          </ul>
        </div>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

function AddLearners({ i, onClose, onSaved }: { i: Detail; onClose: () => void; onSaved: () => void }) {
  const roster = useApi<{ roster: { id: number; lastName: string; firstName: string; isCurrent: boolean }[] | null }>(i.section ? `/sections/${i.section.id}` : null);
  const existing = new Set(i.learners.map((l) => l.learner.id));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const candidates = (roster.data?.roster ?? []).filter((r) => r.isCurrent && !existing.has(r.id));
  return (
    <Modal open onClose={onClose} title="Add learners" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!sel.size} onClick={async () => {
      try { await api.post(`/interventions/${i.id}/learners`, { learners: [...sel].map((learnerId) => ({ learnerId })) }); onSaved(); onClose(); } catch (e) { setError(e); }
    }}>Add {sel.size || ''}</Button></>}>
      {!i.section ? <Notice>This intervention is not tied to a class. Add learners from the Learning gaps page instead.</Notice> : roster.isLoading ? <Spinner /> : (
        <>
          <p className="mb-2 text-xs text-ink-3">Each learner's latest result in {i.learningArea.name} is recorded as their baseline. To link a specific learning gap, plan from the Learning gaps page.</p>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {candidates.map((r) => (
              <li key={r.id}><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.has(r.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />{r.lastName}, {r.firstName}</label></li>
            ))}
          </ul>
        </>
      )}
      <ErrorBox error={error} />
    </Modal>
  );
}
