import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Badge, Button, Card, Empty, ErrorBox, Input, Notice, PageHeader, Select, Spinner, Tabs } from '../components/ui';
import { date } from '../lib/format';
import { useApi, usePeriod } from '../lib/hooks';

type Status = 'DRAFT' | 'ACTIVE' | 'COMPLETED';
type Support = 'ENRICHMENT' | 'TARGETED' | 'INTENSIVE';
interface Section { id: number; name: string; gradeLevel: { name: string }; adviser: { id: number; fullName: string } | null }
interface Plan {
  id: number; status: Status; supportLevel: Support | null; identifiedGaps: string; strategies: string; generated: boolean; finalizedAt: string | null;
  learner: { id: number; lrn: string; name: string }; learningArea: { id: number; name: string };
}
interface ListResp { canEdit: boolean; counts: Partial<Record<Status, number>>; data: Plan[] }

const SUPPORT: { value: Support; label: string; hint: string }[] = [
  { value: 'ENRICHMENT', label: 'Enrichment', hint: 'On track; extend learning' },
  { value: 'TARGETED', label: 'Targeted', hint: 'Small-group reteaching' },
  { value: 'INTENSIVE', label: 'Intensive', hint: 'One-on-one or intensive remediation' },
];

/**
 * ILMPs for a class. The system drafts them from validated results; the adviser checks the
 * support level, optionally adds a note, and finalizes — no schedules or session planning.
 */
export function IlmpPage() {
  const me = useAuth().user!;
  const { schoolYearId } = usePeriod();
  const sections = useApi<Section[]>('/sections', { schoolYearId });
  const list = sections.data ?? [];
  const advised = list.filter((s) => s.adviser?.id === me.id);
  const [sectionId, setSectionId] = useState<number | undefined>();
  useEffect(() => {
    if (!sectionId && list.length) setSectionId((advised[0] ?? list[0]).id);
  }, [list, advised, sectionId]);
  const [tab, setTab] = useState<Status>('DRAFT');
  const q = useApi<ListResp>(sectionId ? '/ilmps' : null, { sectionId, status: tab }, { staleTime: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const m = await fn();
      if (m) setMessage(m);
      await q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const generate = () => run(async () => {
    const r = await api.post<{ created: number }>('/ilmps/generate', { sectionId });
    setTab('DRAFT');
    return r.created ? `Drafted ${r.created} plan${r.created === 1 ? '' : 's'} from the latest results. Check each one, then finalize.` : 'Every learner with a learning gap already has a plan.';
  });
  const finalize = (ids: number[]) => run(async () => {
    const r = await api.post<{ finalized: number }>('/ilmps/finalize', { ids });
    return `Finalized ${r.finalized} plan${r.finalized === 1 ? '' : 's'}.`;
  });

  const data = q.data;
  const drafts = data?.data.filter((p) => p.status === 'DRAFT') ?? [];
  return (
    <>
      <PageHeader
        title="Individual Learning Monitoring Plans"
        subtitle="e-QuAART drafts a plan for each learner with learning gaps, from validated results. Check the support level, add a note if you want, and finalize."
        actions={data?.canEdit ? <Button disabled={busy} onClick={generate}>Draft ILMPs from latest results</Button> : null}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select className="w-auto min-w-56" aria-label="Class" value={sectionId ?? ''} onChange={(e) => setSectionId(Number(e.target.value))}
          options={[...advised, ...list.filter((s) => !advised.includes(s))].map((s) => ({ value: s.id, label: `${s.gradeLevel.name} – ${s.name}${s.adviser?.id === me.id ? ' (my class)' : ''}` }))} />
        {data && !data.canEdit && <Badge>View only — the class adviser prepares these plans</Badge>}
      </div>
      {message && <div className="mb-3"><Notice>{message}</Notice></div>}
      <ErrorBox error={error} />
      <Tabs<Status> value={tab} onChange={setTab} tabs={[
        { value: 'DRAFT', label: `To check${data?.counts.DRAFT ? ` (${data.counts.DRAFT})` : ''}` },
        { value: 'ACTIVE', label: `Active${data?.counts.ACTIVE ? ` (${data.counts.ACTIVE})` : ''}` },
        { value: 'COMPLETED', label: 'Completed' },
      ]} />
      {!sectionId || q.isLoading ? <Spinner /> : !data?.data.length ? (
        <Empty title={tab === 'DRAFT' ? 'No plans to check' : tab === 'ACTIVE' ? 'No active plans' : 'No completed plans'}>
          {tab === 'DRAFT' && data?.canEdit ? 'Use “Draft ILMPs from latest results” after results are validated.' : null}
        </Empty>
      ) : (
        <>
          {tab === 'DRAFT' && data.canEdit && drafts.length > 1 && (
            <div className="mb-3 flex justify-end"><Button variant="secondary" disabled={busy} onClick={() => finalize(drafts.map((p) => p.id))}>Finalize all {drafts.length} plans</Button></div>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {data.data.map((p) => <PlanCard key={p.id} plan={p} canEdit={data.canEdit} busy={busy} onChange={(body) => run(async () => { await api.patch(`/ilmps/${p.id}`, body); })} onFinalize={() => finalize([p.id])} />)}
          </div>
        </>
      )}
    </>
  );
}

function PlanCard({ plan, canEdit, busy, onChange, onFinalize }: { plan: Plan; canEdit: boolean; busy: boolean; onChange: (b: Record<string, unknown>) => void; onFinalize: () => void }) {
  const lines = plan.identifiedGaps.split('\n').filter(Boolean);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(plan.strategies);
  useEffect(() => setNote(plan.strategies), [plan.strategies]);
  const editable = canEdit && plan.status !== 'COMPLETED';
  return (
    <Card
      title={<Link className="hover:text-brand" to={`/learners/${plan.learner.id}`}>{plan.learner.name}</Link>}
      subtitle={<>{plan.learningArea.name}{plan.generated && <span className="text-ink-3"> · drafted by e-QuAART</span>}{plan.finalizedAt && <span className="text-ink-3"> · finalized {date(plan.finalizedAt)}</span>}</>}
    >
      <div className="text-xs text-ink-3">Learning gaps found</div>
      <ul className="mt-1 space-y-0.5 text-sm">
        {(open ? lines : lines.slice(0, 3)).map((l, i) => <li key={i}>{l.replace(/^•\s*/, '')}</li>)}
      </ul>
      {lines.length > 3 && <button className="mt-1 text-xs text-brand hover:underline" onClick={() => setOpen(!open)}>{open ? 'Show fewer' : `Show all ${lines.length}`}</button>}

      <div className="mt-3 text-xs text-ink-3">Support needed</div>
      <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Support needed">
        {SUPPORT.map((s) => (
          <button
            key={s.value}
            role="radio"
            aria-checked={plan.supportLevel === s.value}
            disabled={!editable || busy}
            title={s.hint}
            onClick={() => plan.supportLevel !== s.value && onChange({ supportLevel: s.value })}
            className={`rounded-full border px-3 py-1 text-xs ${plan.supportLevel === s.value ? 'border-brand bg-brand text-white' : 'border-line text-ink-2 hover:bg-surface-2'} disabled:opacity-70`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-3 text-xs text-ink-3">Note (optional)</div>
      {editable ? (
        <Input className="mt-1" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== plan.strategies && onChange({ note })} aria-label="Note" />
      ) : <p className="mt-1 text-sm">{plan.strategies}</p>}

      {canEdit && (
        <div className="mt-3 flex justify-end gap-2">
          {plan.status === 'DRAFT' && <Button size="sm" disabled={busy} onClick={onFinalize}>Finalize</Button>}
          {plan.status === 'ACTIVE' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onChange({ status: 'COMPLETED' })}>Mark completed</Button>}
        </div>
      )}
    </Card>
  );
}
