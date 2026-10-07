import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { FormModal } from '../components/FormModal';
import { Badge, Button, Card, Empty, ErrorBox, Notice, PageHeader, Select, Spinner, StatusDot } from '../components/ui';
import { useApi, useBootstrap } from '../lib/hooks';

type StepKey = 'validate' | 'closing' | 'prepare' | 'promote' | 'current' | 'close';
interface Step { key: StepKey; title: string; owner: string; done: boolean; detail: string; canAct: boolean }
interface Year { id: number; label: string; status: string; isCurrent: boolean }
interface Checklist { from: Year; to: (Year & { terms: number }) | null; steps: Step[]; nextStep: StepKey | null }
type Outcome = 'PROMOTE' | 'RETAIN' | 'COMPLETE' | 'SKIP';
interface ClassPlan { sectionId: number; section: string; grade: string; gradeCode: string; nextGradeCode: string | null; defaultOutcome: Outcome; learners: { learnerId: number; lrn: string; name: string; alreadyMoved: string | null }[] }

const TERMS = [['BOSY', 'Beginning of School Year'], ['T1', 'Term 1'], ['T2', 'Term 2'], ['T3', 'Term 3'], ['EOSY', 'End of School Year']].map(([code, name], i) => ({ code, name, sortOrder: i }));
const nextLabel = (label: string) => label.split('-').map((y) => Number(y) + 1).join('-');
const gradeName = (code: string | null) => (!code ? '' : code === 'K' ? 'Kindergarten' : `Grade ${code.slice(1)}`);

/** One page for moving to the next school year: what is done, what is next, and who does it. */
export function TransitionPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useApi<Checklist>('/transition', undefined, { staleTime: 0 });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data!;
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ['bootstrap'] }); };
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); refresh(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const actions: Partial<Record<StepKey, React.ReactNode>> = {
    validate: <Link to="/assessments?status=SUBMITTED"><Button size="sm" variant="secondary">Open assessments</Button></Link>,
    closing: <Button size="sm" disabled={busy} onClick={() => act(() => api.post(`/reference/school-years/${c.from.id}/status`, { status: 'CLOSING', note: 'Start of year-end validation' }))}>Start validation window</Button>,
    prepare: <Button size="sm" onClick={() => setPreparing(true)}>Create SY {nextLabel(c.from.label)}</Button>,
    current: c.to && <Button size="sm" disabled={busy} onClick={() => act(() => api.put(`/reference/school-years/${c.to!.id}`, { isCurrent: true }))}>Make SY {c.to.label} current</Button>,
    close: <Button size="sm" disabled={busy} onClick={() => act(() => api.post(`/reference/school-years/${c.from.id}/status`, { status: 'CLOSED', note: 'Year-end transition complete' }))}>Close SY {c.from.label}</Button>,
  };
  const done = c.steps.filter((s) => s.done).length;
  return (
    <>
      <PageHeader
        title="Move to the next school year"
        subtitle={<>From <strong>SY {c.from.label}</strong> to <strong>{c.to ? `SY ${c.to.label}` : 'the next school year'}</strong>. Work through the steps in order; each one says who does it. {done} of {c.steps.length} done.</>}
      />
      <ErrorBox error={error} />
      <Card pad={false}>
        <ol>
          {c.steps.map((s, i) => {
            const isNext = c.nextStep === s.key;
            return (
              <li key={s.key} className={`flex flex-wrap items-start gap-3 border-b border-line p-4 last:border-b-0 ${isNext ? 'bg-brand/5' : ''}`}>
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-semibold">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusDot tone={s.done ? 'good' : isNext ? 'warn' : 'bad'} />
                    <span className="font-medium">{s.title}</span>
                    {isNext && <Badge tone="amber">Next step</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-3">Done by: {s.owner}</div>
                  <div className="mt-1 text-sm text-ink-2">{s.detail}</div>
                </div>
                {s.canAct && !s.done && actions[s.key]}
              </li>
            );
          })}
        </ol>
      </Card>
      {c.to && ['PRINCIPAL', 'ASSESSMENT_COORDINATOR'].includes(user!.role) && (
        <Promotion fromId={c.from.id} to={c.to} onDone={refresh} />
      )}
      {preparing && (
        <FormModal
          title={`Create SY ${nextLabel(c.from.label)}`}
          fields={[{ key: 'label', label: 'Label' }, { key: 'startDate', label: 'First day of classes', type: 'date' }, { key: 'endDate', label: 'Last day of classes', type: 'date' }]}
          initial={{ label: nextLabel(c.from.label) }}
          onClose={() => setPreparing(false)}
          onSubmit={(v) => api.post('/reference/school-years', { ...v, terms: TERMS }).then(refresh)}
        />
      )}
    </>
  );
}

/** Step 4 for a school: every learner, class by class, with a ready-made outcome to confirm. */
function Promotion({ fromId, to, onDone }: { fromId: number; to: Year; onDone: () => void }) {
  const schools = useBootstrap().data?.schools ?? [];
  const [schoolId, setSchoolId] = useState<number | undefined>();
  useEffect(() => { if (!schoolId && schools.length) setSchoolId(schools[0].id); }, [schools, schoolId]);
  const q = useApi<{ classes: ClassPlan[] }>(schoolId ? '/transition/promotion' : null, { schoolId, fromSchoolYearId: fromId, toSchoolYearId: to.id }, { staleTime: 0 });
  const [choice, setChoice] = useState<Record<number, Outcome>>({});
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const classes = q.data?.classes ?? [];
  const pending = useMemo(() => classes.flatMap((c) => c.learners.filter((l) => !l.alreadyMoved).map((l) => ({ learnerId: l.learnerId, outcome: choice[l.learnerId] ?? c.defaultOutcome }))), [classes, choice]);
  const setAll = (c: ClassPlan, o: Outcome) => setChoice((x) => ({ ...x, ...Object.fromEntries(c.learners.map((l) => [l.learnerId, o])) }));
  const options = (c: ClassPlan) => [
    ...(c.nextGradeCode && c.defaultOutcome !== 'COMPLETE' ? [{ value: 'PROMOTE', label: `Promote to ${gradeName(c.nextGradeCode)}` }] : []),
    { value: 'RETAIN', label: `Retain in ${c.grade}` },
    { value: 'COMPLETE', label: `Completed ${c.grade}` },
    { value: 'SKIP', label: 'Decide later' },
  ];
  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<Record<string, number>>('/transition/promotion', { schoolId, fromSchoolYearId: fromId, toSchoolYearId: to.id, decisions: pending });
      setResult(`Moved to SY ${to.label}: ${r.PROMOTE} promoted, ${r.RETAIN} retained, ${r.COMPLETE} completed${r.SKIP ? `, ${r.SKIP} left for later` : ''}${r.classesCreated ? `. ${r.classesCreated} class(es) created for SY ${to.label}; assign their advisers under Classes.` : '.'}`);
      setChoice({});
      await q.refetch();
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const toMove = pending.filter((p) => p.outcome !== 'SKIP').length;
  return (
    <Card
      className="mt-4"
      title="Step 4 · Move learners"
      subtitle={`Each learner is already set to the usual outcome. Change only the exceptions, then confirm. Learners keep their history; next-year classes are created with the same section names.`}
      actions={<Select className="w-auto min-w-56" aria-label="School" value={schoolId ?? ''} onChange={(e) => setSchoolId(Number(e.target.value))} options={schools.map((s) => ({ value: s.id, label: s.name }))} />}
    >
      {result && <div className="mb-3"><Notice>{result}</Notice></div>}
      <ErrorBox error={error} />
      {q.isLoading ? <Spinner /> : !classes.length ? <Empty title="No classes in this school year" /> : (
        <div className="space-y-4">
          {classes.map((c) => (
            <details key={c.sectionId} className="rounded border border-line" open={classes.length <= 3}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 text-sm">
                <span className="font-medium">{c.grade} – {c.section}</span>
                <span className="text-ink-3">{c.learners.length} learners · default: {c.defaultOutcome === 'COMPLETE' ? `completed ${c.grade}` : `promote to ${gradeName(c.nextGradeCode)}`}</span>
                {c.learners.every((l) => l.alreadyMoved) && <Badge tone="green">All moved</Badge>}
              </summary>
              <div className="border-t border-line p-3">
                <div className="mb-2 flex flex-wrap gap-2 text-xs">
                  <span className="text-ink-3">Set whole class:</span>
                  {options(c).filter((o) => o.value !== 'SKIP').map((o) => <button key={o.value} className="text-brand hover:underline" onClick={() => setAll(c, o.value as Outcome)}>{o.label}</button>)}
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {c.learners.map((l) => (
                      <tr key={l.learnerId} className="border-t border-line first:border-t-0">
                        <td className="py-1.5 pr-2"><div>{l.name}</div><div className="font-mono text-[11px] text-ink-3">{l.lrn}</div></td>
                        <td className="py-1.5 text-right">
                          {l.alreadyMoved ? <Badge tone="green">In {l.alreadyMoved}</Badge> : (
                            <Select className="h-8 w-auto min-w-48 text-xs" aria-label={`Outcome for ${l.name}`} value={choice[l.learnerId] ?? c.defaultOutcome} onChange={(e) => setChoice((x) => ({ ...x, [l.learnerId]: e.target.value as Outcome }))} options={options(c)} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-ink-2">{toMove} learner(s) will be moved to SY {to.label}</span>
            <Button disabled={busy || !toMove || to.status !== 'OPEN'} onClick={commit}>{busy ? 'Moving…' : `Move ${toMove} learners`}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
