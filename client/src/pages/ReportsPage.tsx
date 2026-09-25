import { useState } from 'react';
import { api, type Paged, type Query } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Button, Card, Empty, ErrorBox, Field, Input, Notice, PageHeader, Select, Spinner, Table } from '../components/ui';
import { useApi, useBootstrap, usePeriod } from '../lib/hooks';
import { isLearnerLevel, isSchoolLevel } from '../lib/nav';

type Need = 'section' | 'gradeLevel' | 'school' | 'learningArea' | 'assessment' | 'learner';
interface ReportDef { type: string; label: string; description: string; needs?: Need; learnerOnly?: boolean; divisionOnly?: boolean }

const REPORTS: ReportDef[] = [
  { type: 'learner', label: 'Learner assessment report', description: 'All assessments, competencies, gaps and interventions for one learner.', needs: 'learner', learnerOnly: true },
  { type: 'class', label: 'Class assessment report', description: 'Class performance by learning area and assessment, with learners requiring intervention.', needs: 'section' },
  { type: 'grade-level', label: 'Grade-level report', description: 'Performance of a grade level by class and learning area.', needs: 'gradeLevel' },
  { type: 'school', label: 'School assessment report', description: 'Overall school performance, completion and common gaps.', needs: 'school' },
  { type: 'learning-area', label: 'Learning area report', description: 'Performance for one learning area across grades/schools and terms.', needs: 'learningArea' },
  { type: 'assessment', label: 'Assessment report', description: 'Results and competency mastery for one assessment.', needs: 'assessment' },
  { type: 'learning-gaps', label: 'Learning gap report', description: 'Competencies requiring intervention, persistent gaps, and (for school staff) learners.' },
  { type: 'interventions', label: 'Intervention report', description: 'Interventions, their status and reach.' },
  { type: 'intervention-effectiveness', label: 'Intervention effectiveness report', description: 'Pre- vs post-intervention results and decisions.' },
  { type: 'division', label: 'Division report', description: 'Consolidated division-level performance, completion and technical-assistance flags.', divisionOnly: true },
];

interface Report { title: string; subtitle?: string; containsPersonalData: boolean; sections: { heading: string; note?: string; columns: { key: string; label: string; type?: string }[]; rows: Record<string, unknown>[] }[] }

export function ReportsPage() {
  const { user } = useAuth();
  const period = usePeriod();
  const boot = useBootstrap().data;
  const learnerLevel = isLearnerLevel(user!);
  const schoolLevel = isSchoolLevel(user!);
  const available = REPORTS.filter((r) => (!r.learnerOnly || learnerLevel) && (!r.divisionOnly || !schoolLevel));
  const [type, setType] = useState(available[1]?.type ?? available[0].type);
  const def = REPORTS.find((r) => r.type === type)!;
  const [param, setParam] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const sections = useApi<{ id: number; name: string; gradeLevel: { name: string }; school: { name: string } }[]>(def.needs === 'section' ? '/sections' : null, { schoolYearId: period.schoolYearId });
  const assessments = useApi<Paged<{ id: number; title: string }>>(def.needs === 'assessment' ? '/assessments' : null, { schoolYearId: period.schoolYearId, perPage: 200 });
  const learners = useApi<Paged<{ id: number; lrn: string; lastName: string; firstName: string }>>(def.needs === 'learner' && (param.search?.length ?? 0) >= 2 ? '/learners' : null, { search: param.search, perPage: 20 });

  const query: Query = {
    schoolYearId: period.schoolYearId,
    termId: period.termId,
    sectionId: param.sectionId,
    gradeLevelId: param.gradeLevelId,
    schoolId: param.schoolId ?? (def.needs === 'school' && schoolLevel ? boot?.schools[0]?.id : undefined),
    learningAreaId: param.learningAreaId,
    assessmentId: param.assessmentId,
    learnerId: param.learnerId,
  };
  const missing = def.needs && !(def.needs === 'school' && schoolLevel) && !query[`${def.needs}Id`];
  const load = async () => {
    setBusy(true); setError(null);
    try { setPreview(await api.get<Report>(`/reports/${type}`, query)); } catch (e) { setError(e); setPreview(null); } finally { setBusy(false); }
  };
  const download = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setError(null);
    try { await api.download(`/reports/${type}`, { ...query, format }); } catch (e) { setError(e); }
  };

  return (
    <>
      <PageHeader title="Reports" subtitle="Generate reports for the selected school year and term. Downloads are recorded in the audit trail; reports with learner details are marked confidential." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Report" className="lg:col-span-1">
          <ul className="space-y-1">
            {available.map((r) => (
              <li key={r.type}>
                <button className={`w-full rounded-md px-3 py-2 text-left text-sm ${type === r.type ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2'}`} onClick={() => { setType(r.type); setPreview(null); setParam({}); }}>
                  <div className="font-medium">{r.label}</div>
                  <div className="text-xs text-ink-3">{r.description}</div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card title={def.label} subtitle={def.description}>
            <div className="grid gap-3 md:grid-cols-2">
              {def.needs === 'section' && <Field label="Class"><Select value={param.sectionId ?? ''} onChange={(e) => setParam({ sectionId: e.target.value })} options={(sections.data ?? []).map((s) => ({ value: s.id, label: `${s.gradeLevel.name} – ${s.name}${schoolLevel ? '' : ` (${s.school.name})`}` }))} placeholder="Select…" /></Field>}
              {def.needs === 'gradeLevel' && <Field label="Grade level"><Select value={param.gradeLevelId ?? ''} onChange={(e) => setParam({ ...param, gradeLevelId: e.target.value })} options={(boot?.gradeLevels ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder="Select…" /></Field>}
              {(def.needs === 'school' || def.needs === 'gradeLevel') && !schoolLevel && <Field label="School"><Select value={param.schoolId ?? ''} onChange={(e) => setParam({ ...param, schoolId: e.target.value })} options={(boot?.schools ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder={def.needs === 'school' ? 'Select…' : 'All schools'} /></Field>}
              {def.needs === 'learningArea' && <Field label="Learning area"><Select value={param.learningAreaId ?? ''} onChange={(e) => setParam({ learningAreaId: e.target.value })} options={(boot?.learningAreas ?? []).filter((l) => l.inScope).map((s) => ({ value: s.id, label: s.name }))} placeholder="Select…" /></Field>}
              {def.needs === 'assessment' && <Field label="Assessment" className="md:col-span-2"><Select value={param.assessmentId ?? ''} onChange={(e) => setParam({ assessmentId: e.target.value })} options={(assessments.data?.data ?? []).map((s) => ({ value: s.id, label: s.title }))} placeholder="Select…" /></Field>}
              {def.needs === 'learner' && (
                <Field label="Learner" hint="Type at least 2 letters of the name or LRN" className="md:col-span-2">
                  <Input value={param.search ?? ''} onChange={(e) => setParam({ search: e.target.value })} />
                  {!!learners.data?.data.length && !param.learnerId && (
                    <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-line">
                      {learners.data.data.map((l) => <li key={l.id}><button className="w-full px-2 py-1 text-left text-sm hover:bg-surface-2" onClick={() => setParam({ search: `${l.lastName}, ${l.firstName}`, learnerId: String(l.id) })}>{l.lastName}, {l.firstName} <span className="text-xs text-ink-3">{l.lrn}</span></button></li>)}
                    </ul>
                  )}
                </Field>
              )}
              {!def.needs && <p className="text-sm text-ink-2 md:col-span-2">Uses the school year and term selected at the top of the page.</p>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" disabled={!!missing || busy} onClick={load}>Preview</Button>
              <Button disabled={!!missing} onClick={() => download('pdf')}>PDF</Button>
              <Button disabled={!!missing} onClick={() => download('xlsx')}>Excel</Button>
              <Button disabled={!!missing} onClick={() => download('csv')}>CSV</Button>
            </div>
            <div className="mt-3"><ErrorBox error={error} /></div>
          </Card>
          {busy && <Spinner />}
          {preview && (
            <Card title={preview.title} subtitle={preview.subtitle}>
              {preview.containsPersonalData && <div className="mb-3"><Notice tone="warn">Contains personal information. Handle downloads according to RA 10173 and DepEd data-privacy policy.</Notice></div>}
              <div className="space-y-6">
                {preview.sections.map((s) => (
                  <section key={s.heading}>
                    <h3 className="mb-1 text-sm font-semibold">{s.heading}</h3>
                    {s.note && <p className="mb-1 text-xs text-ink-3">{s.note}</p>}
                    {!s.rows.length ? <Empty title="No data" /> : (
                      <div className="max-h-96 overflow-y-auto rounded border border-line">
                        <Table dense rows={s.rows.slice(0, 200).map((r, i) => ({ ...r, __i: i }))} rowKey={(r) => r.__i as number} columns={s.columns.map((c) => ({
                          key: c.key, label: c.label, align: c.type ? 'right' as const : undefined,
                          render: (r: Record<string, unknown>) => (r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? '—' : c.type === 'percent' && typeof r[c.key] === 'number' ? `${(r[c.key] as number).toFixed(1)}%` : String(r[c.key])),
                        }))} />
                      </div>
                    )}
                    {s.rows.length > 200 && <p className="mt-1 text-xs text-ink-3">Showing 200 of {s.rows.length} rows; download for the full report.</p>}
                  </section>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
