import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Tier } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { LearnerForm } from '../components/LearnerForm';
import { TrendLines } from '../components/charts';
import { Badge, Button, Card, Empty, ErrorBox, Field, Modal, PageHeader, Select, Spinner, StatusBadge, Table, Tabs, Textarea, TierBadge } from '../components/ui';
import { date, humanize, pct } from '../lib/format';
import { useApi, useBootstrap } from '../lib/hooks';

interface Profile {
  id: number; lrn: string; firstName: string; middleName: string | null; lastName: string; extensionName: string | null; sex: 'MALE' | 'FEMALE'; birthdate: string | null; status: string;
  enrolments: { id: number; isCurrent: boolean; endReason: string | null; section: { id: number; name: string; gradeLevel: { name: string; keyStage: { name: string } }; school: { name: string } }; schoolYear: { label: string } }[];
  history: {
    id: number; rawScore: number | null; percentage: number | null; tier: Tier | null; isAbsent: boolean; profileDescriptor: string | null; remarks: string | null; deltaVsPrevious: number | null; trend: 'UP' | 'DOWN' | 'SAME' | null;
    band: { label: string; color: string } | null;
    competencyResults: { competencyId: number; itemsCorrect: number; itemsTotal: number; mastered: boolean; competency: { code: string; description: string } }[];
    assessment: { id: number; title: string; maxScore: number | null; status: string; assessmentType: { id: number; name: string; code: string }; learningArea: { id: number; name: string }; term: { id: number; name: string; sortOrder: number }; schoolYear: { label: string }; gradeLevel: { name: string } };
  }[];
  gaps: { id: number; status: string; severity: Tier; masteryPct: number | null; competency: { code: string; description: string } | null; assessmentResult: { assessment: { learningArea: { name: string }; term: { name: string }; schoolYear: { label: string }; assessmentType: { name: string } } } }[];
  interventions: { id: number; decision: string | null; prePercentage: number | null; preTier: Tier | null; intervention: { id: number; title: string; status: string; strategy: string; learningArea: { name: string }; owner: { fullName: string } }; reassessments: { percentage: number | null; tier: Tier | null; date: string; band: { label: string } | null }[]; effectiveness: { scoreDifference: number | null; levelChange: string; signal: string } | null }[];
  ilmps: { id: number; status: string; identifiedGaps: string; strategies: string; monitoringNotes: string | null; learningArea: { name: string }; createdAt: string }[];
}

const TREND = { UP: { g: '▲', c: 'text-emerald-700 dark:text-emerald-300', t: 'improved' }, DOWN: { g: '▼', c: 'text-red-700 dark:text-red-300', t: 'declined' }, SAME: { g: '■', c: 'text-ink-3', t: 'no change' } };

export function LearnerProfilePage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useApi<Profile>(`/learners/${id}`);
  const [tab, setTab] = useState<'history' | 'competencies' | 'gaps' | 'interventions' | 'ilmp'>('history');
  const [editing, setEditing] = useState(false);
  const [ilmp, setIlmp] = useState(false);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const l = q.data!;
  const current = l.enrolments.find((e) => e.isCurrent);
  const name = `${l.lastName}, ${l.firstName}${l.extensionName ? ` ${l.extensionName}` : ''} ${l.middleName ?? ''}`;

  // Trend: percentage results per term by learning area.
  const pctResults = l.history.filter((h) => h.percentage != null && !h.isAbsent);
  const termsSeen = [...new Map(pctResults.map((h) => [`${h.assessment.schoolYear.label}|${h.assessment.term.sortOrder}`, `${h.assessment.term.name.replace('Quarter ', 'Q')} ${h.assessment.schoolYear.label}`])).entries()];
  const las = [...new Map(pctResults.map((h) => [h.assessment.learningArea.id, h.assessment.learningArea.name])).entries()];
  const trend = {
    terms: termsSeen.map(([k, label], i) => ({ key: i, label, k })),
    series: las.map(([key, label]) => ({ key, label })),
    points: pctResults.map((h) => ({ term: termsSeen.findIndex(([k]) => k === `${h.assessment.schoolYear.label}|${h.assessment.term.sortOrder}`), series: h.assessment.learningArea.id, avgPct: h.percentage, proficiencyRate: null, atRiskRate: null, assessed: 1 })),
  };

  return (
    <>
      <PageHeader
        crumbs={[{ to: '/learners', label: 'Learners' }]}
        title={name}
        subtitle={<>LRN <span className="font-mono">{l.lrn}</span> · {humanize(l.sex)} · Born {date(l.birthdate)} · {current ? `${current.section.school.name}, ${current.section.gradeLevel.name} – ${current.section.name} (SY ${current.schoolYear.label})` : 'Not currently enrolled'}</>}
        actions={
          <>
            <Button variant="secondary" onClick={() => api.download('/reports/learner', { learnerId: l.id, format: 'pdf' })}>Download report (PDF)</Button>
            {can('learner:write') && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
          </>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Card><div className="text-xs text-ink-3">Status</div><div className="mt-1"><StatusBadge status={l.status === 'ACTIVE' ? 'VERIFIED' : 'DRAFT'} /> <span className="text-sm">{humanize(l.status)}</span></div></Card>
        <Card><div className="text-xs text-ink-3">Assessments on record</div><div className="num mt-1 text-xl font-semibold">{l.history.length}</div></Card>
        <Card><div className="text-xs text-ink-3">Open learning gaps</div><div className="num mt-1 text-xl font-semibold">{l.gaps.filter((g) => g.status !== 'RESOLVED').length}</div></Card>
        <Card><div className="text-xs text-ink-3">Interventions</div><div className="num mt-1 text-xl font-semibold">{l.interventions.length}</div></Card>
      </div>
      {trend.terms.length > 1 && (
        <Card className="mb-4" title="Score trend by learning area" subtitle="Percentage-based assessments only.">
          <TrendLines data={trend} metric="avgPct" height={220} />
        </Card>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'history', label: 'Assessment history' }, { value: 'competencies', label: 'Competencies' }, { value: 'gaps', label: 'Learning gaps' }, { value: 'interventions', label: 'Interventions' }, { value: 'ilmp', label: 'ILMP' }]} />
      {tab === 'history' && (
        <Card pad={false}>
          <Table rows={[...l.history].reverse()} rowKey={(r) => r.id} empty="No assessments yet" columns={[
            { key: 'term', label: 'Term', render: (r) => <span className="whitespace-nowrap text-xs">{r.assessment.term.name}<br /><span className="text-ink-3">SY {r.assessment.schoolYear.label}</span></span> },
            { key: 'type', label: 'Assessment', render: (r) => <Link className="text-brand hover:underline" to={`/assessments/${r.assessment.id}`}>{r.assessment.assessmentType.name}</Link> },
            { key: 'la', label: 'Learning area', render: (r) => r.assessment.learningArea.name },
            { key: 'score', label: 'Score', align: 'right', render: (r) => r.isAbsent ? <Badge>Absent</Badge> : r.rawScore != null ? `${r.rawScore}${r.assessment.maxScore ? `/${r.assessment.maxScore}` : ''}` : '—' },
            { key: 'pct', label: '%', align: 'right', render: (r) => pct(r.percentage) },
            { key: 'level', label: 'Level', render: (r) => <TierBadge tier={r.tier} label={r.band?.label} /> },
            { key: 'trend', label: 'vs previous', render: (r) => r.trend ? <span className={`text-xs ${TREND[r.trend].c}`}>{TREND[r.trend].g} {r.deltaVsPrevious != null ? `${r.deltaVsPrevious > 0 ? '+' : ''}${r.deltaVsPrevious} pts` : TREND[r.trend].t}</span> : <span className="text-ink-3">—</span> },
          ]} />
        </Card>
      )}
      {tab === 'competencies' && (
        <Card pad={false}>
          <Table rows={[...l.history].reverse().flatMap((h) => h.competencyResults.map((c) => ({ ...c, h })))} rowKey={(r) => `${r.h.id}-${r.competencyId}`} empty="No competency-level results" columns={[
            { key: 'term', label: 'Term', render: (r) => <span className="text-xs">{r.h.assessment.term.name} {r.h.assessment.schoolYear.label}</span> },
            { key: 'la', label: 'Area', render: (r) => r.h.assessment.learningArea.name },
            { key: 'comp', label: 'Competency', render: (r) => <span><span className="font-medium">{r.competency.code}</span> <span className="text-xs text-ink-2">{r.competency.description}</span></span> },
            { key: 'items', label: 'Items', align: 'right', render: (r) => `${r.itemsCorrect}/${r.itemsTotal}` },
            { key: 'mastered', label: 'Mastered', render: (r) => r.mastered ? <Badge tone="green">Mastered</Badge> : <Badge tone="red">Not yet</Badge> },
          ]} />
        </Card>
      )}
      {tab === 'gaps' && (
        <Card pad={false}>
          <Table rows={l.gaps} rowKey={(r) => r.id} empty="No learning gaps recorded" columns={[
            { key: 'term', label: 'Identified', render: (r) => <span className="text-xs">{r.assessmentResult.assessment.assessmentType.name} · {r.assessmentResult.assessment.term.name} {r.assessmentResult.assessment.schoolYear.label}</span> },
            { key: 'la', label: 'Area', render: (r) => r.assessmentResult.assessment.learningArea.name },
            { key: 'gap', label: 'Gap', render: (r) => r.competency ? <span><span className="font-medium">{r.competency.code}</span> <span className="text-xs text-ink-2">{r.competency.description}</span></span> : 'Overall level below standard' },
            { key: 'm', label: 'Mastery', align: 'right', render: (r) => pct(r.masteryPct, 0) },
            { key: 'sev', label: 'Severity', render: (r) => <TierBadge tier={r.severity} /> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        </Card>
      )}
      {tab === 'interventions' && (
        <Card pad={false}>
          <Table rows={l.interventions} rowKey={(r) => r.id} empty="No interventions yet" columns={[
            { key: 'title', label: 'Intervention', render: (r) => <Link className="font-medium text-brand hover:underline" to={`/interventions/${r.intervention.id}`}>{r.intervention.title}</Link> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.intervention.status} /> },
            { key: 'pre', label: 'Pre', render: (r) => <span className="text-xs">{pct(r.prePercentage, 0)} <TierBadge tier={r.preTier} /></span> },
            { key: 'post', label: 'Post', render: (r) => r.reassessments[0] ? <span className="text-xs">{pct(r.reassessments[0].percentage, 0)} <TierBadge tier={r.reassessments[0].tier} label={r.reassessments[0].band?.label} /></span> : <span className="text-xs text-ink-3">Not yet reassessed</span> },
            { key: 'eff', label: 'Result', render: (r) => r.effectiveness ? <span className="text-xs">{humanize(r.effectiveness.levelChange)}{r.effectiveness.scoreDifference != null ? ` (${r.effectiveness.scoreDifference > 0 ? '+' : ''}${r.effectiveness.scoreDifference} pts)` : ''}</span> : '—' },
            { key: 'decision', label: 'Decision', render: (r) => r.decision ? <Badge tone="blue">{humanize(r.decision)}</Badge> : '—' },
          ]} />
        </Card>
      )}
      {tab === 'ilmp' && (
        <Card title="Individual Learning Monitoring Plans" subtitle="Typically prepared for Tier 3 learners." actions={can('intervention:write') ? <Button size="sm" onClick={() => setIlmp(true)}>New ILMP</Button> : null}>
          {!l.ilmps.length ? <Empty title="No ILMP yet" /> : (
            <div className="space-y-3">
              {l.ilmps.map((p) => (
                <div key={p.id} className="rounded border border-line p-3 text-sm">
                  <div className="mb-1 flex items-center gap-2"><span className="font-medium">{p.learningArea.name}</span><Badge>{humanize(p.status)}</Badge><span className="text-xs text-ink-3">{date(p.createdAt)}</span></div>
                  <div className="text-xs text-ink-3">Identified gaps</div><p className="whitespace-pre-line">{p.identifiedGaps}</p>
                  <div className="mt-2 text-xs text-ink-3">Strategies</div><p className="whitespace-pre-line">{p.strategies}</p>
                  {p.monitoringNotes && <><div className="mt-2 text-xs text-ink-3">Monitoring notes</div><p className="whitespace-pre-line">{p.monitoringNotes}</p></>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      {editing && <LearnerForm open onClose={() => setEditing(false)} initial={{ ...l, birthdate: l.birthdate }} onSaved={() => q.refetch()} />}
      {ilmp && <IlmpForm learnerId={l.id} gaps={l.gaps.filter((g) => g.status !== 'RESOLVED').map((g) => g.competency ? `${g.competency.code} ${g.competency.description}` : `${g.assessmentResult.assessment.learningArea.name}: below standard`)} onClose={() => setIlmp(false)} onSaved={() => q.refetch()} />}
    </>
  );
}

function IlmpForm({ learnerId, gaps, onClose, onSaved }: { learnerId: number; gaps: string[]; onClose: () => void; onSaved: () => void }) {
  const boot = useBootstrap().data;
  const sy = boot?.schoolYears.find((s) => s.isCurrent);
  const [la, setLa] = useState('');
  const [identifiedGaps, setGaps] = useState(gaps.slice(0, 6).join('\n'));
  const [strategies, setStrategies] = useState('');
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal open onClose={onClose} title="New ILMP" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => {
      try {
        await api.post(`/learners/${learnerId}/ilmps`, { learningAreaId: Number(la), schoolYearId: sy?.id, identifiedGaps, strategies, status: 'ACTIVE' });
        onSaved();
        onClose();
      } catch (e) { setError(e); }
    }}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Learning area"><Select value={la} onChange={(e) => setLa(e.target.value)} options={(boot?.learningAreas ?? []).map((l) => ({ value: l.id, label: l.name }))} placeholder="Select…" /></Field>
        <Field label="Identified learning gaps"><Textarea rows={5} value={identifiedGaps} onChange={(e) => setGaps(e.target.value)} /></Field>
        <Field label="Strategies and support"><Textarea rows={4} value={strategies} onChange={(e) => setStrategies(e.target.value)} /></Field>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
