import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Band, type Tier } from '../api/client';
import { DistributionBars, Meter } from '../components/charts';
import { ImportDialog } from '../components/ImportDialog';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Kpi, Modal, Notice, PageHeader, Select, Spinner, StatusBadge, StatusDot, Table, Tabs, Textarea, TierBadge } from '../components/ui';
import { effectiveScore, previewBand, previewPercentage, rowProblems, type GridRow } from '../lib/classify';
import { date, dateTime, humanize, pct } from '../lib/format';
import { useApi } from '../lib/hooks';

interface Result { id: number; learnerId: number; rawScore: number | null; percentage: number | null; profileDescriptor: string | null; tier: Tier | null; isAbsent: boolean; remarks: string | null; band: Band | null; competencyResults: { competencyId: number; itemsCorrect: number; mastered: boolean }[] }
interface Detail {
  id: number; title: string; status: 'DRAFT' | 'SUBMITTED' | 'VERIFIED' | 'RETURNED'; returnReason: string | null; maxScore: number | null; assessmentDate: string | null; windowClose: string | null; submittedAt: string | null; verifiedAt: string | null;
  assessmentType: { name: string; code: string; resultMode: 'PERCENTAGE' | 'PROFILE' };
  model: { name: string; isProvisional: boolean; masteryThreshold: number; bands: Band[] };
  competencies: { competencyId: number; itemsTotal: number; competency: { code: string; description: string } }[];
  gradeLevel: { name: string }; learningArea: { name: string }; section: { id: number; name: string }; school: { name: string }; schoolYear: { label: string }; term: { name: string };
  createdBy: { fullName: string }; verifiedBy: { fullName: string } | null;
  summary: { assessed: number; tier1: number; tier2: number; tier3: number; proficiencyRate: number | null; atRiskRate: number | null; averagePercentage: number | null; absent: number; bands: { id: number; label: string; tier: Tier; color: string; count: number }[]; competencies: { competencyId: number; code: string; description: string; itemsTotal: number; assessed: number; mastered: number; masteryRate: number | null }[] };
  rows: { learner: { id: number; lrn: string; name: string; sex: string }; enrolled: boolean; result: Result | null }[] | null;
  canEncode: boolean;
  canVerify: boolean;
}
interface Qa { checks: { key: string; label: string; status: 'PASS' | 'WARN' | 'FAIL'; blocking: boolean; count: number; details: string[] }[]; blocking: boolean; passed: number; total: number }

export function AssessmentDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const q = useApi<Detail>(`/assessments/${id}`, undefined, { staleTime: 0 });
  const qa = useApi<Qa>(`/assessments/${id}/qa`, undefined, { staleTime: 0 });
  const [tab, setTab] = useState<'encode' | 'results' | 'history'>('encode');
  const [action, setAction] = useState<'return' | 'reopen' | 'import' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const a = q.data!;
  const editable = a.canEncode && (a.status === 'DRAFT' || a.status === 'RETURNED');
  const refresh = () => { q.refetch(); qa.refetch(); };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); refresh(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const activeTab = !a.rows && tab === 'encode' ? 'results' : tab;

  return (
    <>
      <PageHeader
        crumbs={[{ to: '/assessments', label: 'Assessments' }, { to: `/classes/${a.section.id}`, label: `${a.gradeLevel.name} – ${a.section.name}` }]}
        title={a.title}
        subtitle={<>{a.school.name} · {a.term.name}, SY {a.schoolYear.label} · {a.assessmentType.resultMode === 'PERCENTAGE' ? `Max score ${a.maxScore}` : 'Level / profile-based'} · Encoded by {a.createdBy.fullName}{a.assessmentDate ? ` · Given ${date(a.assessmentDate)}` : ''}</>}
        actions={
          <>
            <StatusBadge status={a.status} />
            {editable && <Button variant="secondary" onClick={() => api.download(`/assessments/${a.id}/template`, { format: 'xlsx' })}>Download template</Button>}
            {editable && <Button variant="secondary" onClick={() => setAction('import')}>Import results</Button>}
            {editable && <Button disabled={busy || qa.data?.blocking} title={qa.data?.blocking ? 'Resolve the failing quality checks first' : undefined} onClick={() => run(() => api.post(`/assessments/${a.id}/submit`))}>Submit for verification</Button>}
            {a.status === 'SUBMITTED' && a.canVerify && (
              <>
                <Button variant="secondary" onClick={() => setAction('return')}>Return for correction</Button>
                <Button disabled={busy} onClick={() => run(() => api.post(`/assessments/${a.id}/verify`))}>Verify & lock</Button>
              </>
            )}
            {a.status === 'VERIFIED' && a.canVerify && <Button variant="secondary" onClick={() => setAction('reopen')}>Reopen for correction</Button>}
            {a.status === 'DRAFT' && a.canEncode && <Button variant="ghost" onClick={() => confirm('Delete this draft assessment?') && run(async () => { await api.del(`/assessments/${a.id}`); nav('/assessments'); })}>Delete</Button>}
            {a.status !== 'DRAFT' && <Button variant="secondary" onClick={() => api.download('/reports/assessment', { assessmentId: a.id, format: 'pdf' })}>Report</Button>}
          </>
        }
      />
      <ErrorBox error={error} />
      {a.status === 'RETURNED' && a.returnReason && <div className="mb-3"><Notice tone="warn"><strong>Returned for correction:</strong> {a.returnReason}</Notice></div>}
      {a.status === 'VERIFIED' && <div className="mb-3"><Notice>Verified by {a.verifiedBy?.fullName} on {dateTime(a.verifiedAt)}. Results are locked; a verifier can reopen them for correction (logged in the audit trail).</Notice></div>}
      {a.model.isProvisional && <div className="mb-3"><Notice tone="warn">Performance levels for {a.assessmentType.name} are provisional — confirm cut-offs/descriptors against the current issuance.</Notice></div>}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Learners assessed" value={a.summary.assessed} hint={a.summary.absent ? `${a.summary.absent} absent` : undefined} />
        <Kpi label="Average score" value={pct(a.summary.averagePercentage)} />
        <Kpi label="Meeting standard" value={pct(a.summary.proficiencyRate)} hint={`${a.summary.tier1} learners`} />
        <Kpi label="Requiring intervention" value={pct(a.summary.atRiskRate)} hint={`${a.summary.tier2} Tier 2 · ${a.summary.tier3} Tier 3`} />
        <QaKpi qa={qa.data} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card title="Quality assurance" subtitle="Checks run before submission. Failing checks block submission." className="xl:col-span-1">
          {!qa.data ? <Spinner /> : (
            <ul className="space-y-2 text-sm">
              {qa.data.checks.map((c) => (
                <li key={c.key}>
                  <div className="flex items-start gap-2">
                    <StatusDot tone={c.status === 'PASS' ? 'good' : c.status === 'WARN' ? 'warn' : 'bad'} />
                    <span className="flex-1">{c.label}{c.count > 0 && <span className="text-ink-3"> · {c.count}</span>}</span>
                  </div>
                  {c.count > 0 && c.details.length > 0 && <details className="ml-6 text-xs text-ink-2"><summary className="cursor-pointer text-ink-3">Show</summary>{c.details.join('; ')}</details>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Performance levels" className="xl:col-span-1">
          {a.summary.assessed ? <DistributionBars bands={a.summary.bands} height={200} /> : <Empty title="No results yet" />}
        </Card>
        <Card title="Competency mastery" subtitle={`Mastered = at least ${Math.round(a.model.masteryThreshold * 100)}% of the items.`} className="xl:col-span-1">
          {!a.summary.competencies.length ? <Empty title="Totals only">This assessment is not itemised by competency.</Empty> : (
            <ul className="space-y-2">
              {a.summary.competencies.map((c) => (
                <li key={c.competencyId} className="text-xs">
                  <div className="mb-0.5 flex justify-between gap-2"><span className="font-medium">{c.code}</span><span className="text-ink-3">{c.mastered}/{c.assessed}</span></div>
                  <Meter value={c.masteryRate} tone={c.masteryRate != null && c.masteryRate < 60 ? 'tier-3' : 'tier-1'} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Tabs value={activeTab} onChange={setTab} tabs={[...(a.rows ? [{ value: 'encode' as const, label: editable ? 'Encode results' : 'Learner results' }] : []), { value: 'results', label: 'Summary' }, { value: 'history', label: 'Change history' }]} />
      {activeTab === 'encode' && a.rows && <EncodingGrid a={a} editable={editable} onSaved={refresh} />}
      {activeTab === 'results' && (
        <Card title="Next steps">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
            <li>{a.summary.tier2 + a.summary.tier3} learners need targeted or intensive support. <Link className="text-brand hover:underline" to={`/gaps?assessmentId=${a.id}`}>See their learning gaps and plan interventions →</Link></li>
            <li><Link className="text-brand hover:underline" to={`/performance/results?assessmentId=${a.id}&dim=learner`}>Open this assessment in the performance explorer →</Link></li>
          </ul>
        </Card>
      )}
      {activeTab === 'history' && <History id={a.id} />}

      <ImportDialog
        open={action === 'import'}
        onClose={() => setAction(null)}
        path={`/assessments/${a.id}/results/import`}
        fields={{}}
        title="Import results"
        onDone={refresh}
        help={<>Use the downloaded template (it lists the class roster). Columns: <code>lrn</code>, {a.assessmentType.resultMode === 'PERCENTAGE' ? <code>score</code> : <><code>descriptor</code> ({a.model.bands.map((b) => b.descriptorKey).join(', ')})</>}{a.competencies.length ? <>, one <code>comp:CODE</code> column per competency (items correct)</> : null}, <code>absent</code> (Y), <code>remarks</code>. Invalid LRNs, duplicates, missing or out-of-range scores and learners not in this class are reported before anything is saved.</>}
      />
      {(action === 'return' || action === 'reopen') && <ReasonDialog title={action === 'return' ? 'Return for correction' : 'Reopen verified results'} onClose={() => setAction(null)} onSubmit={(reason) => run(() => api.post(`/assessments/${a.id}/${action}`, { reason })).then(() => setAction(null))} />}
    </>
  );
}

function QaKpi({ qa }: { qa?: Qa }) {
  if (!qa) return <Kpi label="Quality checks" value="…" />;
  const fails = qa.checks.filter((c) => c.status === 'FAIL').length;
  const warns = qa.checks.filter((c) => c.status === 'WARN').length;
  return <Kpi label="Quality checks" value={`${qa.passed}/${qa.total}`} hint={fails ? `${fails} failing` : warns ? `${warns} warning${warns > 1 ? 's' : ''}` : 'All passed'} tone={fails ? 'bad' : warns ? 'warn' : 'good'} />;
}

function ReasonDialog({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (r: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={reason.trim().length < 5} onClick={() => onSubmit(reason)}>Confirm</Button></>}>
      <Field label="Reason (shared with the encoder and recorded in the audit trail)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

function toGrid(rows: NonNullable<Detail['rows']>, scoreFromComps: boolean): Record<number, GridRow> {
  return Object.fromEntries(rows.map((r) => [r.learner.id, {
    learnerId: r.learner.id,
    rawScore: r.result?.rawScore != null && !scoreFromComps ? String(r.result.rawScore) : '',
    descriptor: r.result?.profileDescriptor ?? '',
    isAbsent: r.result?.isAbsent ?? false,
    remarks: r.result?.remarks ?? '',
    comps: Object.fromEntries((r.result?.competencyResults ?? []).map((c) => [c.competencyId, String(c.itemsCorrect)])),
  }]));
}

function EncodingGrid({ a, editable, onSaved }: { a: Detail; editable: boolean; onSaved: () => void }) {
  const rows = a.rows!;
  const scoreFromComps = a.competencies.length > 0 && a.competencies.reduce((s, c) => s + c.itemsTotal, 0) === a.maxScore;
  const [grid, setGrid] = useState<Record<number, GridRow>>(() => toGrid(rows, scoreFromComps));
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setGrid(toGrid(rows, scoreFromComps)); setDirty(new Set()); }, [rows, scoreFromComps]);
  const opts = useMemo(() => ({ mode: a.assessmentType.resultMode, maxScore: a.maxScore, comps: a.competencies.map((c) => ({ competencyId: c.competencyId, itemsTotal: c.itemsTotal })) }), [a]);

  const update = (id: number, patch: Partial<GridRow>) => {
    setGrid((g) => ({ ...g, [id]: { ...g[id], ...patch } }));
    setDirty((d) => new Set(d).add(id));
    setSaved(null);
  };
  const problems = (id: number) => (dirty.has(id) || grid[id].rawScore || grid[id].descriptor || Object.keys(grid[id].comps).length ? rowProblems(grid[id], opts) : []);
  const invalid = [...dirty].filter((id) => rowProblems(grid[id], opts).length);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const entries = [...dirty].map((id) => {
        const r = grid[id];
        return {
          learnerId: id,
          rawScore: r.isAbsent ? null : effectiveScore(r, opts),
          descriptor: r.descriptor || null,
          isAbsent: r.isAbsent,
          remarks: r.remarks || null,
          competencies: r.isAbsent ? [] : a.competencies.map((c) => ({ competencyId: c.competencyId, itemsCorrect: r.comps[c.competencyId] === undefined || r.comps[c.competencyId] === '' ? null : Number(r.comps[c.competencyId]) })),
        };
      });
      const res = await api.put<{ saved: number; changed: number }>(`/assessments/${a.id}/results`, { entries });
      setSaved(`Saved ${res.saved} row${res.saved === 1 ? '' : 's'} (${res.changed} changed).`);
      setDirty(new Set());
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  /** Enter / arrow keys move down the column like a spreadsheet. */
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const el = e.currentTarget;
    const col = el.dataset.col;
    const rowIdx = Number(el.dataset.row);
    const next = document.querySelector<HTMLElement>(`[data-col="${col}"][data-row="${rowIdx + (e.key === 'ArrowUp' ? -1 : 1)}"]`);
    if (next) {
      e.preventDefault();
      next.focus();
      if (next instanceof HTMLInputElement) next.select();
    }
  };

  const cellCls = 'h-8 w-16 rounded border border-line bg-surface-1 px-1.5 text-right text-sm num focus:border-brand focus:outline-none disabled:bg-surface-2';
  return (
    <Card
      pad={false}
      title={editable ? 'Encoding grid' : 'Learner results'}
      subtitle={editable ? (scoreFromComps ? 'Enter items correct per competency; the total score is computed. Use Enter/↓ to move down.' : 'Enter each learner’s result. Use Enter/↓ to move down.') : undefined}
      actions={editable ? (
        <>
          {saved && <span className="text-xs text-emerald-700 dark:text-emerald-300">{saved}</span>}
          {dirty.size > 0 && <span className="text-xs text-ink-3">{dirty.size} unsaved</span>}
          <Button disabled={!dirty.size || saving || invalid.length > 0} onClick={save}>{saving ? 'Saving…' : 'Save results'}</Button>
        </>
      ) : null}
    >
      {error != null && <div className="p-3"><ErrorBox error={error} /></div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-1">
            <tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Learner</th>
              <th className="px-2 py-2 text-center">Absent</th>
              {a.competencies.map((c) => (
                <th key={c.competencyId} className="px-2 py-2 text-right" title={c.competency.description}>{c.competency.code}<div className="font-normal">/{c.itemsTotal}</div></th>
              ))}
              {a.assessmentType.resultMode === 'PROFILE' ? <th className="px-2 py-2">Level</th> : <th className="px-2 py-2 text-right">Score<div className="font-normal">/{a.maxScore}</div></th>}
              {a.assessmentType.resultMode === 'PERCENTAGE' && <th className="px-2 py-2 text-right">%</th>}
              <th className="px-2 py-2">Performance level</th>
              <th className="px-2 py-2">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const g = grid[r.learner.id];
              const score = g.isAbsent ? null : effectiveScore(g, opts);
              const p = a.assessmentType.resultMode === 'PERCENTAGE' ? previewPercentage(score !== null && !Number.isNaN(score) ? score : null, a.maxScore) : null;
              const band = g.isAbsent ? null : previewBand(a.model.bands, a.assessmentType.resultMode, p, g.descriptor || null);
              const probs = problems(r.learner.id);
              const disabled = !editable || g.isAbsent;
              return (
                <tr key={r.learner.id} className={`border-b border-line ${probs.length ? 'bg-red-50 dark:bg-red-950/30' : dirty.has(r.learner.id) ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
                  <td className="num px-3 py-1 text-xs text-ink-3">{i + 1}</td>
                  <td className="px-3 py-1">
                    <Link to={`/learners/${r.learner.id}`} className="font-medium hover:text-brand">{r.learner.name}</Link>
                    <div className="font-mono text-[11px] text-ink-3">{r.learner.lrn}{!r.enrolled && <Badge tone="amber">not enrolled</Badge>}</div>
                    {probs.length > 0 && <div className="text-[11px] text-red-700 dark:text-red-300">{probs.join(' · ')}</div>}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" disabled={!editable} checked={g.isAbsent} onChange={(e) => update(r.learner.id, { isAbsent: e.target.checked })} aria-label={`${r.learner.name} absent`} />
                  </td>
                  {a.competencies.map((c) => (
                    <td key={c.competencyId} className="px-2 py-1 text-right">
                      <input
                        className={cellCls}
                        inputMode="numeric"
                        disabled={disabled}
                        data-col={`c${c.competencyId}`}
                        data-row={i}
                        onKeyDown={onKey}
                        value={g.comps[c.competencyId] ?? ''}
                        onChange={(e) => update(r.learner.id, { comps: { ...g.comps, [c.competencyId]: e.target.value } })}
                        aria-label={`${r.learner.name} ${c.competency.code}`}
                      />
                    </td>
                  ))}
                  {a.assessmentType.resultMode === 'PROFILE' ? (
                    <td className="px-2 py-1">
                      <Select className="h-8 w-44" disabled={disabled} data-col="level" data-row={i} onKeyDown={onKey} value={g.descriptor} onChange={(e) => update(r.learner.id, { descriptor: e.target.value })} options={a.model.bands.map((b) => ({ value: b.descriptorKey ?? '', label: b.label }))} placeholder="—" aria-label={`${r.learner.name} level`} />
                    </td>
                  ) : (
                    <td className="px-2 py-1 text-right">
                      {scoreFromComps ? <span className="num">{score ?? '—'}</span> : (
                        <input className={cellCls} inputMode="decimal" disabled={disabled} data-col="score" data-row={i} onKeyDown={onKey} value={g.rawScore} onChange={(e) => update(r.learner.id, { rawScore: e.target.value })} aria-label={`${r.learner.name} score`} />
                      )}
                    </td>
                  )}
                  {a.assessmentType.resultMode === 'PERCENTAGE' && <td className="num px-2 py-1 text-right text-xs">{pct(p)}</td>}
                  <td className="px-2 py-1">{g.isAbsent ? <Badge>Absent</Badge> : <TierBadge tier={band?.tier} label={band?.label} />}</td>
                  <td className="px-2 py-1">
                    <Input className="h-8 min-w-32" disabled={!editable} value={g.remarks} onChange={(e) => update(r.learner.id, { remarks: e.target.value })} aria-label={`${r.learner.name} remarks`} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && <Empty title="No learners in this class" />}
    </Card>
  );
}

function History({ id }: { id: number }) {
  const q = useApi<{ id: number; action: string; entity: string; entityId: string; userEmail: string | null; at: string; beforeJson: Record<string, unknown> | null; afterJson: Record<string, unknown> | null }[]>(`/assessments/${id}/history`, undefined, { staleTime: 0 });
  const fields = ['rawScore', 'percentage', 'band', 'profileDescriptor', 'isAbsent', 'remarks', 'status', 'reason'];
  return (
    <Card pad={false} title="Change history" subtitle="Who entered or changed what, when, with previous and new values.">
      {q.isLoading ? <Spinner /> : (
        <Table dense rows={q.data ?? []} rowKey={(r) => r.id} empty="No changes recorded" columns={[
          { key: 'at', label: 'When', render: (r) => <span className="whitespace-nowrap text-xs">{dateTime(r.at)}</span> },
          { key: 'user', label: 'By', render: (r) => <span className="text-xs">{r.userEmail ?? 'system'}</span> },
          { key: 'action', label: 'Action', render: (r) => <Badge tone={r.action === 'VERIFY' ? 'green' : r.action === 'RETURN' || r.action === 'REOPEN' ? 'red' : 'slate'}>{humanize(r.action)}</Badge> },
          { key: 'what', label: 'Record', render: (r) => <span className="text-xs">{r.entity === 'AssessmentResult' ? `Result #${r.entityId}${r.afterJson?.learnerId ? ` (learner ${r.afterJson.learnerId})` : ''}` : 'Assessment'}</span> },
          { key: 'diff', label: 'Previous → new', render: (r) => (
            <span className="text-xs">
              {fields.filter((f) => r.afterJson && f in r.afterJson && JSON.stringify(r.beforeJson?.[f]) !== JSON.stringify(r.afterJson[f])).map((f) => (
                <span key={f} className="mr-2 inline-block">{f}: <span className="text-ink-3 line-through">{String(r.beforeJson?.[f] ?? '—')}</span> → <strong>{String(r.afterJson?.[f] ?? '—')}</strong></span>
              ))}
            </span>
          ) },
        ]} />
      )}
    </Card>
  );
}
