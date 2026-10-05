import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, currentSchoolYear, prisma } from '../helpers.js';
import { ACCOUNTS, LRN_IN_JSON } from '../support/fixtures.js';

/**
 * Personas above the school: district supervisor (PSDS), learning-area supervisor (EPS),
 * Chief of CID, and the Division Administrator. Supervisors work with de-identified aggregates
 * (spec §9 responsible use); the administrator configures the system but sees no learners.
 */
let sy: Awaited<ReturnType<typeof currentSchoolYear>>;
beforeAll(async () => {
  sy = await currentSchoolYear();
});

describe('Persona · Public Schools District Supervisor (PSDS)', () => {
  it('reviews the district’s schools, without other districts', async () => {
    const psds = await asUser(ACCOUNTS.PSDS);
    const rows = await psds.get(`/analytics/breakdown?dim=school&schoolYearId=${sy.id}`);
    const district = await prisma.school.findMany({ where: { district: { name: 'District II' } } });
    expect(rows.body.map((r: { key: number }) => r.key).sort()).toEqual(district.map((s) => s.id).sort());
    expect((await psds.get(`/analytics/schools-support?schoolYearId=${sy.id}`)).status).toBe(200);
    expect((await psds.get(`/analytics/completion?schoolYearId=${sy.id}&dim=school`)).status).toBe(200);
  });

  it('follows interventions in district schools as anonymous learners', async () => {
    const psds = await asUser(ACCOUNTS.PSDS);
    const list = await psds.get(`/interventions?schoolYearId=${sy.id}&perPage=50`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    const detail = await psds.get(`/interventions/${list.body.data[0].id}`);
    expect(detail.body.learners.length).toBeGreaterThan(0);
    for (const l of detail.body.learners) expect(l.learner).toMatchObject({ id: null, lrn: null });
    expect(detail.body.canManage).toBe(false);
  });

  it('cannot open individual learner records or individual gaps', async () => {
    const psds = await asUser(ACCOUNTS.PSDS);
    expect((await psds.get('/learners')).status).toBe(403);
    expect((await psds.get('/gaps')).status).toBe(403);
    expect((await psds.get('/analytics/breakdown?dim=learner')).status).toBe(403);
  });
});

describe('Persona · Education Program Supervisor (EPS, Mathematics)', () => {
  it('sees Mathematics only, across schools', async () => {
    const eps = await asUser(ACCOUNTS.EPS);
    const math = await prisma.learningArea.findUniqueOrThrow({ where: { code: 'MATH' } });
    const byArea = await eps.get(`/analytics/breakdown?dim=learningArea&schoolYearId=${sy.id}`);
    expect(byArea.body.map((r: { key: number }) => r.key)).toEqual([math.id]);
    const bySchool = await eps.get(`/analytics/breakdown?dim=school&schoolYearId=${sy.id}`);
    expect(bySchool.body.length).toBeGreaterThan(1);
    const least = await eps.get(`/analytics/least-mastered?schoolYearId=${sy.id}`);
    const compIds: number[] = least.body.map((c: { competencyId?: number; key?: number; id?: number }) => c.competencyId ?? c.key ?? c.id);
    const comps = await prisma.competency.findMany({ where: { id: { in: compIds } } });
    expect(comps.length).toBeGreaterThan(0);
    for (const c of comps) expect(c.learningAreaId).toBe(math.id);
  });

  it('cannot open an assessment of another learning area', async () => {
    const eps = await asUser(ACCOUNTS.EPS);
    const eng = await prisma.assessment.findFirstOrThrow({ where: { learningArea: { code: 'ENG' } } });
    expect((await eps.get(`/assessments/${eng.id}`)).status).toBe(404);
  });
});

describe('Persona · Chief, Curriculum and Instruction Division', () => {
  it('reviews division-wide performance, priorities and trends', async () => {
    const cid = await asUser(ACCOUNTS.CHIEF_CID);
    const q = `schoolYearId=${sy.id}`;
    for (const path of [`/analytics/summary?${q}`, `/analytics/heatmap?${q}`, `/analytics/schools-support?${q}`, `/analytics/persistent-gaps?${q}`, '/analytics/trend?series=schoolYear', `/analytics/interventions?${q}`]) {
      const res = await cid.get(path);
      expect(res.status, path).toBe(200);
      expect(LRN_IN_JSON.test(JSON.stringify(res.body)), path).toBe(false);
    }
  });

  it('exports the division report without personal data', async () => {
    const cid = await asUser(ACCOUNTS.CHIEF_CID);
    const json = await cid.get(`/reports/division?schoolYearId=${sy.id}`);
    expect(json.body.containsPersonalData).toBe(false);
    const pdf = await cid.get(`/reports/division?schoolYearId=${sy.id}&format=pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });
});

describe('Persona · Division Administrator', () => {
  it('registers a school and adds a competency to the curriculum', async () => {
    const admin = await asUser(ACCOUNTS.DIVISION_ADMIN);
    const district = await prisma.district.findFirstOrThrow();
    const school = await admin.post('/reference/schools').send({ name: 'Persona Integrated School', schoolIdDeped: '900999', districtId: district.id, schoolType: 'INTEGRATED' });
    expect(school.status).toBe(201);
    const sci = await prisma.learningArea.findUniqueOrThrow({ where: { code: 'SCI' } });
    const g5 = await prisma.gradeLevel.findUniqueOrThrow({ where: { code: 'G5' } });
    const comp = await admin.post('/reference/competencies').send({ learningAreaId: sci.id, gradeLevelId: g5.id, code: 'S5-PERSONA-01', description: 'Describe the parts of a flower' });
    expect(comp.status).toBe(201);
    expect((await admin.get(`/reference/competencies?learningAreaId=${sci.id}&gradeLevelId=${g5.id}`)).body.map((c: { code: string }) => c.code)).toContain('S5-PERSONA-01');
  });

  it('prepares next school year with its terms', async () => {
    const admin = await asUser(ACCOUNTS.DIVISION_ADMIN);
    const next = await admin.post('/reference/school-years').send({
      label: '2027-2028', startDate: '2027-06-14', endDate: '2028-04-13',
      terms: [['BOSY', 'Beginning of School Year'], ['T1', 'Term 1'], ['T2', 'Term 2'], ['T3', 'Term 3'], ['EOSY', 'End of School Year']].map(([code, name], i) => ({ code, name, sortOrder: i })),
    });
    expect(next.status).toBe(201);
    expect(next.body.terms).toHaveLength(5);
    expect(next.body.isCurrent).toBe(false); // the current year is untouched
    expect((await currentSchoolYear()).id).toBe(sy.id);
  });

  it('creates a teacher account with a one-time password and tunes a dashboard threshold', async () => {
    const admin = await asUser(ACCOUNTS.DIVISION_ADMIN);
    const school = await prisma.school.findFirstOrThrow({ where: { schoolIdDeped: '900102' } });
    const u = await admin.post('/users').send({ email: 'persona.teacher@deped.gov.ph', fullName: 'Rhea Persona', role: 'TEACHER', scopes: [{ scopeType: 'SCHOOL', schoolId: school.id }] });
    expect(u.status).toBe(201);
    expect(u.body.temporaryPassword).toMatch(/^Eq-/);
    expect(u.body.mustChangePassword).toBe(true);
    const before = (await admin.get('/governance/settings')).body;
    const res = await admin.put('/governance/settings/atRiskAlertRate').send({ value: 45 });
    expect(res.status).toBe(200);
    await admin.put('/governance/settings/atRiskAlertRate').send({ value: before.atRiskAlertRate?.value ?? before.atRiskAlertRate ?? 50 });
  });

  it('reviews the audit trail but cannot read learner records', async () => {
    const admin = await asUser(ACCOUNTS.DIVISION_ADMIN);
    const logs = await admin.get('/governance/audit-logs?entity=User&perPage=20');
    expect(logs.body.data.length).toBeGreaterThan(0);
    expect((await admin.get('/learners')).status).toBe(403);
  });
});
