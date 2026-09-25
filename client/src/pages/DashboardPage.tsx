import { Link, useNavigate } from 'react-router-dom';
import type { Paged, PerfRow } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BreakdownCard, DistributionCard, KpiRow, LeastMasteredCard, OutcomesCard, TrendCard, useSummary } from '../components/analytics';
import { Heatmap } from '../components/charts';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, StatusBadge, StatusDot, Table, TierBadge } from '../components/ui';
import { dateTime, pct } from '../lib/format';
import { useApi, useBootstrap, usePeriod } from '../lib/hooks';
import { isLearnerLevel } from '../lib/nav';

export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role === 'TEACHER') return <TeacherDashboard />;
  if (['MASTER_TEACHER', 'ASSESSMENT_COORDINATOR', 'PRINCIPAL'].includes(user.role)) return <SchoolDashboard />;
  if (user.role === 'SYSTEM_ADMIN') return <AdminDashboard />;
  if (user.role === 'DPO') return <DpoDashboard />;
  return <DivisionDashboard />;
}

function usePeriodFilters() {
  const p = usePeriod();
  return { schoolYearId: p.schoolYearId, termId: p.termId };
}

interface SectionRow { id: number; name: string; gradeLevel: { name: string }; school: { name: string }; learnerCount: number; assessmentCount: number }
interface AtRisk { resultId: number; learnerId: number; learner: string; section: string; learningArea: string; assessment: string; tier: 'TIER_1' | 'TIER_2' | 'TIER_3'; band: string; percentage: number | null; inIntervention: boolean }
interface AssessmentRow { id: number; title: string; status: string; completionRate: number | null; returnReason: string | null; updatedAt: string }

function TeacherDashboard() {
  const { user } = useAuth();
  const f = usePeriodFilters();
  const nav = useNavigate();
  const summary = useSummary(f);
  const sections = useApi<SectionRow[]>('/sections', { schoolYearId: f.schoolYearId, mine: 'true' });
  const atRisk = useApi<AtRisk[]>('/analytics/learners-at-risk', { ...f, limit: 60 });
  const pending = useApi<Paged<AssessmentRow>>('/assessments', { schoolYearId: f.schoolYearId, perPage: 50 });
  const todo = (pending.data?.data ?? []).filter((a) => a.status === 'DRAFT' || a.status === 'RETURNED');
  const notCovered = (atRisk.data ?? []).filter((r) => !r.inIntervention);
  return (
    <>
      <PageHeader title={`Good day, ${user!.fullName.split(' ')[0]}`} subtitle="Your classes at a glance: results, learners who need support, and interventions in progress." />
      {summary.error && <ErrorBox error={summary.error} />}
      {summary.data && <KpiRow s={summary.data} learnerLevel links={{ atRisk: '/gaps', interventions: '/interventions', assessments: '/assessments' }} />}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="My classes" className="xl:col-span-1">
          {sections.isLoading ? <Spinner /> : !sections.data?.length ? <Empty title="No classes yet"><Link className="text-brand" to="/classes">Create your class</Link></Empty> : (
            <ul className="divide-y divide-line">
              {sections.data.map((s) => (
                <li key={s.id}>
                  <Link to={`/classes/${s.id}`} className="flex items-center justify-between py-2 text-sm hover:text-brand">
                    <span><span className="font-medium">{s.gradeLevel.name} – {s.name}</span><span className="block text-xs text-ink-3">{s.school.name}</span></span>
                    <span className="text-xs text-ink-2">{s.learnerCount} learners · {s.assessmentCount} assessments</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="To do" subtitle="Assessments still being encoded or returned for correction." className="xl:col-span-2">
          {pending.isLoading ? <Spinner /> : !todo.length ? <Empty title="Nothing pending" icon="check">All your assessments are submitted.</Empty> : (
            <Table dense rows={todo} rowKey={(r) => r.id} onRowClick={(r) => nav(`/assessments/${r.id}`)} columns={[
              { key: 'title', label: 'Assessment', render: (r) => <div><div className="font-medium">{r.title}</div>{r.returnReason && <div className="text-xs text-red-700 dark:text-red-300">Returned: {r.returnReason}</div>}</div> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              { key: 'completionRate', label: 'Encoded', align: 'right', render: (r) => pct(r.completionRate, 0) },
            ]} />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Learners requiring intervention" subtitle={`${notCovered.length} Tier 2–3 results are not yet covered by an intervention.`} actions={<Link to="/gaps" className="text-xs text-brand hover:underline">Plan interventions →</Link>}>
          {atRisk.isLoading ? <Spinner /> : !atRisk.data?.length ? <Empty title="No learners flagged" /> : (
            <Table dense rows={atRisk.data.slice(0, 12)} rowKey={(r) => r.resultId} onRowClick={(r) => nav(`/learners/${r.learnerId}`)} columns={[
              { key: 'learner', label: 'Learner', render: (r) => <span className="font-medium">{r.learner}</span> },
              { key: 'la', label: 'Area', render: (r) => <span className="text-xs">{r.learningArea}<br /><span className="text-ink-3">{r.assessment}</span></span> },
              { key: 'band', label: 'Level', render: (r) => <TierBadge tier={r.tier} label={r.band} /> },
              { key: 'pct', label: '%', align: 'right', render: (r) => pct(r.percentage, 0) },
              { key: 'int', label: 'Intervention', render: (r) => r.inIntervention ? <span className="inline-flex items-center gap-1 text-xs"><StatusDot tone="good" /> Yes</span> : <span className="inline-flex items-center gap-1 text-xs"><StatusDot tone="warn" /> Not yet</span> },
            ]} />
          )}
        </Card>
        <LeastMasteredCard filters={f} learnerLevel title="Class learning gaps (least-mastered competencies)" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <BreakdownCard title="Performance by learning area" dim="learningArea" filters={f} onSelect={(r) => nav(`/performance/results?learningAreaId=${r.key}&dim=assessment`)} />
        {summary.data && <OutcomesCard s={summary.data} />}
      </div>
      <div className="mt-4">
        <TrendCard filters={{ schoolYearId: undefined }} series="learningArea" title="Performance trend across terms" />
      </div>
    </>
  );
}

function SchoolDashboard() {
  const { user } = useAuth();
  const f = usePeriodFilters();
  const nav = useNavigate();
  const boot = useBootstrap();
  const summary = useSummary(f);
  const heat = useApi<{ rows: { key: number; label: string }[]; cols: { key: number; label: string }[]; cells: never[] }>('/analytics/heatmap', { ...f, rows: 'gradeLevel', cols: 'learningArea' });
  const queue = useApi<Paged<AssessmentRow>>('/assessments', { schoolYearId: f.schoolYearId, status: 'SUBMITTED', perPage: 5 });
  const persistent = useApi<{ schoolName: string; gradeLevelName: string; learningAreaName: string; terms: string[]; latestAtRiskRate: number }[]>('/analytics/persistent-gaps', {});
  const school = boot.data?.schools[0];
  const verifier = user!.permissions.includes('assessment:verify');
  return (
    <>
      <PageHeader title={school?.name ?? 'School dashboard'} subtitle="School-wide performance, learning gaps and intervention monitoring. Click any bar or cell to drill down." />
      {summary.data && <KpiRow s={summary.data} learnerLevel={isLearnerLevel(user!)} links={{ atRisk: '/performance/school', interventions: '/interventions', assessments: '/assessments' }} />}
      {verifier && !!queue.data?.meta.total && (
        <Card className="mt-4" title={`Verification queue · ${queue.data.meta.total} submitted`} actions={<Link to="/assessments?status=SUBMITTED" className="text-xs text-brand hover:underline">Review all →</Link>}>
          <Table dense rows={queue.data.data} rowKey={(r) => r.id} onRowClick={(r) => nav(`/assessments/${r.id}`)} columns={[
            { key: 'title', label: 'Assessment' },
            { key: 'updatedAt', label: 'Submitted', render: (r) => dateTime(r.updatedAt) },
          ]} />
        </Card>
      )}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <BreakdownCard title="Performance by grade level" dim="gradeLevel" filters={f} onSelect={(r) => nav(`/performance/school?gradeLevelId=${r.key}&dim=section`)} showTable={false} />
        <BreakdownCard title="Performance by learning area" dim="learningArea" filters={f} onSelect={(r) => nav(`/performance/learning-areas?learningAreaId=${r.key}&dim=gradeLevel`)} showTable={false} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Grade × learning area" subtitle="Share of results meeting the expected standard. Darker is better.">
          {heat.isLoading ? <Spinner /> : heat.data && <Heatmap {...heat.data} metric="proficiencyRate" onSelect={(r, c) => nav(`/performance/school?gradeLevelId=${r}&learningAreaId=${c}&dim=section`)} />}
        </Card>
        <DistributionCard filters={f} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <LeastMasteredCard filters={f} learnerLevel={isLearnerLevel(user!)} title="Common learning gaps in the school" />
        {summary.data && <OutcomesCard s={summary.data} />}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TrendCard filters={{}} series="learningArea" title="Performance trend by learning area" />
        <Card title="Persistent gaps" subtitle="Grade / learning-area combinations above the at-risk alert rate for consecutive terms.">
          {!persistent.data?.length ? <Empty title="No persistent gaps detected" icon="check" /> : (
            <>
              <Table dense rows={[...persistent.data].sort((a, b) => b.terms.length - a.terms.length).slice(0, 8)} rowKey={(r) => `${r.gradeLevelName}${r.learningAreaName}`} columns={[
                { key: 'g', label: 'Grade · area', render: (r) => <span className="whitespace-nowrap">{r.gradeLevelName} · {r.learningAreaName}</span> },
                { key: 't', label: 'Consecutive terms', render: (r) => <span className="text-xs" title={r.terms.join(' → ')}>{r.terms.length} terms, since {r.terms[0]}</span> },
                { key: 'r', label: 'Latest at-risk', align: 'right', render: (r) => pct(r.latestAtRiskRate) },
              ]} />
              {persistent.data.length > 8 && <Link to="/gaps" className="mt-2 block text-xs text-brand hover:underline">All {persistent.data.length} persistent gaps →</Link>}
            </>
          )}
        </Card>
      </div>
    </>
  );
}

interface SupportRow { schoolId: number; school: string; district: string; assessed: number; avgPct: number | null; proficiencyRate: number | null; atRiskRate: number | null; tier3Rate: number | null; completionRate: number | null; coverageRate: number | null; reasons: string[]; needsSupport: boolean }

function DivisionDashboard() {
  const { user } = useAuth();
  const f = usePeriodFilters();
  const nav = useNavigate();
  const boot = useBootstrap();
  const summary = useSummary(f);
  const support = useApi<SupportRow[]>('/analytics/schools-support', f);
  const isEps = user!.role === 'EPS';
  const areas = boot.data?.learningAreas.filter((l) => l.inScope && isEps).map((l) => l.name).join(' & ');
  const flagged = (support.data ?? []).filter((s) => s.needsSupport);
  const title = isEps ? `${areas} across the division` : user!.role === 'PSDS' ? `${user!.scopes[0]?.label ?? 'District'} overview` : 'Division overview';
  return (
    <>
      <PageHeader title={title} subtitle="Aggregated results across schools. Learner identities are not shown at this level; groups with very few learners are suppressed." />
      {summary.data && <KpiRow s={summary.data} learnerLevel={false} links={{ atRisk: '/performance/schools', interventions: '/interventions', assessments: '/performance/schools' }} />}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <BreakdownCard title="Schools (alphabetical — not a ranking)" dim="school" filters={f} onSelect={(r) => nav(`/performance/schools?schoolId=${r.key}&dim=gradeLevel`)} showTable={false} />
        <Card title="Schools requiring technical assistance" subtitle="Flagged against configured alert thresholds. Listed alphabetically.">
          {support.isLoading ? <Spinner /> : !flagged.length ? <Empty title="No school is currently flagged" icon="check" /> : (
            <ul className="divide-y divide-line">
              {flagged.map((s) => (
                <li key={s.schoolId} className="py-2">
                  <button className="text-left" onClick={() => nav(`/performance/schools?schoolId=${s.schoolId}&dim=gradeLevel`)}>
                    <div className="flex items-center gap-2 text-sm font-medium text-ink hover:text-brand"><StatusDot tone="warn" />{s.school} <span className="text-xs font-normal text-ink-3">{s.district}</span></div>
                    <ul className="mt-1 space-y-0.5 pl-6 text-xs text-ink-2">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <BreakdownCard title="Performance by key stage" dim="keyStage" filters={f} onSelect={(r) => nav(`/performance/key-stages?keyStageId=${r.key}&dim=gradeLevel`)} showTable={false} />
        <BreakdownCard title="Performance by learning area" dim="learningArea" filters={f} onSelect={(r) => nav(`/performance/learning-areas?learningAreaId=${r.key}&dim=school`)} showTable={false} />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <LeastMasteredCard filters={f} learnerLevel={false} title="Cross-school learning gaps" />
        {summary.data && <OutcomesCard s={summary.data} />}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TrendCard filters={{}} series="keyStage" title="Historical trend by key stage" metric="proficiencyRate" />
        <Card title="Assessment completion by school">
          {support.isLoading ? <Spinner /> : (
            <Table dense rows={support.data ?? []} rowKey={(r) => r.schoolId} columns={[
              { key: 'school', label: 'School' },
              { key: 'completionRate', label: 'Completion', align: 'right', render: (r) => pct(r.completionRate) },
              { key: 'coverageRate', label: 'Intervention coverage', align: 'right', render: (r) => pct(r.coverageRate) },
              { key: 'flag', label: '', render: (r) => r.needsSupport ? <Badge tone="amber">Needs TA</Badge> : null },
            ]} />
          )}
        </Card>
      </div>
    </>
  );
}

function AdminDashboard() {
  const users = useApi<Paged<{ id: number }>>('/users', { perPage: 1 });
  const locked = useApi<Paged<{ id: number }>>('/users', { perPage: 1, isActive: 'false' });
  const logs = useApi<Paged<{ id: number; action: string; entity: string; userEmail: string | null; at: string }>>('/governance/audit-logs', { perPage: 10 });
  return (
    <>
      <PageHeader title="System administration" subtitle="Accounts, access scopes, configuration and the audit trail. Academic records are not accessible to this role." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card title="Active accounts"><div className="num text-2xl font-semibold">{users.data?.meta.total ?? '—'}</div><Link to="/admin/users" className="text-xs text-brand">Manage users →</Link></Card>
        <Card title="Deactivated accounts"><div className="num text-2xl font-semibold">{locked.data?.meta.total ?? '—'}</div></Card>
        <Card title="Configuration"><Link to="/admin/settings" className="text-sm text-brand">Alert thresholds & privacy settings →</Link></Card>
      </div>
      <Card className="mt-4" title="Recent activity">
        <Table dense rows={logs.data?.data ?? []} rowKey={(r) => r.id} columns={[
          { key: 'at', label: 'When', render: (r) => dateTime(r.at) },
          { key: 'userEmail', label: 'User', render: (r) => r.userEmail ?? 'system' },
          { key: 'action', label: 'Action', render: (r) => <Badge>{r.action}</Badge> },
          { key: 'entity', label: 'Record' },
        ]} />
      </Card>
    </>
  );
}

function DpoDashboard() {
  const exports = useApi<Paged<{ id: number; userEmail: string | null; entityId: string | null; at: string; afterJson: { format?: string; containsPersonalData?: boolean } | null }>>('/governance/audit-logs', { action: 'EXPORT', perPage: 10 });
  const failed = useApi<Paged<{ id: number }>>('/governance/audit-logs', { action: 'LOGIN_FAILED', perPage: 1 });
  const breaches = useApi<{ id: number; title: string; status: string; notificationDeadline: string }[]>('/governance/breaches');
  const open = (breaches.data ?? []).filter((b) => b.status !== 'CLOSED');
  return (
    <>
      <PageHeader title="Data protection overview" subtitle="Monitor exports of learner data, failed sign-ins, retention and breach handling." />
      <div className="grid gap-3 sm:grid-cols-3">
        <Card title="Open breach incidents"><div className="num text-2xl font-semibold">{breaches.data ? open.length : '—'}</div><Link to="/governance/breaches" className="text-xs text-brand">Breach register →</Link></Card>
        <Card title="Failed sign-in attempts"><div className="num text-2xl font-semibold">{failed.data?.meta.total ?? '—'}</div><Link to="/governance/audit?action=LOGIN_FAILED" className="text-xs text-brand">Review →</Link></Card>
        <Card title="Retention"><Link to="/governance/retention" className="text-sm text-brand">Retention & disposal rules →</Link></Card>
      </div>
      <Card className="mt-4" title="Recent exports">
        <Table dense rows={exports.data?.data ?? []} rowKey={(r) => r.id} empty="No exports yet" columns={[
          { key: 'at', label: 'When', render: (r) => dateTime(r.at) },
          { key: 'userEmail', label: 'User', render: (r) => r.userEmail ?? '—' },
          { key: 'entityId', label: 'Report' },
          { key: 'fmt', label: 'Format', render: (r) => r.afterJson?.format?.toUpperCase() ?? '—' },
          { key: 'pd', label: 'Personal data', render: (r) => (r.afterJson?.containsPersonalData ? <Badge tone="amber">Yes</Badge> : <Badge>No</Badge>) },
        ]} />
      </Card>
    </>
  );
}

export type { PerfRow };
