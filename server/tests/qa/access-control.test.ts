import type { Role } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { app, asUser, currentSchoolYear, prisma, request } from '../helpers.js';
import { ACCOUNTS, BPES, LRN_IN_JSON, OTHER_SCHOOL, ROLES } from '../support/fixtures.js';

/**
 * QA: role-based access (RBAC) for every role against every capability.
 *
 * The expected roles below are written out from the access design (spec §4, §5.3 and the
 * role permission catalogue), independently of the code, so a permission accidentally granted
 * or removed shows up here. Write capabilities are probed with an empty or invalid request:
 * an allowed role gets past authorization and is stopped by validation or lookup (400/404),
 * a denied role is stopped first with 403. Nothing is changed by this suite.
 */
type Cap = { name: string; method: 'get' | 'post' | 'put' | 'delete'; path: string | (() => string); body?: object; allowed: Role[] };

const SCHOOL_STAFF: Role[] = ['TEACHER', 'MASTER_TEACHER', 'ASSESSMENT_COORDINATOR', 'PRINCIPAL'];
const ENCODERS: Role[] = ['TEACHER', 'MASTER_TEACHER', 'ASSESSMENT_COORDINATOR'];
const VALIDATORS: Role[] = ['MASTER_TEACHER', 'ASSESSMENT_COORDINATOR', 'PRINCIPAL'];
const AGGREGATE: Role[] = [...SCHOOL_STAFF, 'PSDS', 'EPS', 'CHIEF_CID', 'DIVISION_ADMIN'];

let syId = 0;
const CAPABILITIES: Cap[] = [
  // Learners and enrollment (§6)
  { name: 'search and view learners', method: 'get', path: '/learners', allowed: SCHOOL_STAFF },
  { name: 'register a learner', method: 'post', path: '/learners', body: {}, allowed: ENCODERS },
  { name: 'enrol an existing learner', method: 'post', path: '/learners/enrol-existing', body: {}, allowed: ENCODERS },
  { name: 'import a class roster', method: 'post', path: '/learners/import', allowed: ENCODERS },
  { name: 'create a class', method: 'post', path: '/sections', body: {}, allowed: ['TEACHER', 'ASSESSMENT_COORDINATOR', 'PRINCIPAL'] },
  { name: 'view classes', method: 'get', path: '/sections', allowed: AGGREGATE },
  // Assessments (§3, §7)
  { name: 'list assessments', method: 'get', path: '/assessments', allowed: AGGREGATE },
  { name: 'create an assessment', method: 'post', path: '/assessments', body: {}, allowed: ENCODERS },
  { name: 'encode results', method: 'put', path: '/assessments/999999/results', body: {}, allowed: ENCODERS },
  { name: 'submit results', method: 'post', path: '/assessments/999999/submit', allowed: ENCODERS },
  { name: 'validate (verify) results', method: 'post', path: '/assessments/999999/verify', allowed: VALIDATORS },
  { name: 'return results for correction', method: 'post', path: '/assessments/999999/return', body: {}, allowed: VALIDATORS },
  { name: 'request a correction', method: 'post', path: '/correction-requests', body: {}, allowed: SCHOOL_STAFF },
  { name: 'decide a correction', method: 'post', path: '/correction-requests/999999/decision', body: {}, allowed: VALIDATORS },
  { name: 'view correction requests', method: 'get', path: '/correction-requests', allowed: SCHOOL_STAFF },
  // Analytics, gaps, interventions, reports (§8, §9)
  { name: 'view aggregated analytics', method: 'get', path: '/analytics/summary', allowed: AGGREGATE },
  { name: 'view learners needing intervention', method: 'get', path: '/analytics/learners-at-risk', allowed: SCHOOL_STAFF },
  { name: 'view intervention groups (lists learners)', method: 'get', path: '/gaps/groups', allowed: SCHOOL_STAFF },
  { name: 'view least-mastered competencies (aggregate)', method: 'get', path: '/analytics/least-mastered', allowed: AGGREGATE },
  { name: 'view individual learning gaps', method: 'get', path: '/gaps', allowed: SCHOOL_STAFF },
  { name: 'view interventions', method: 'get', path: '/interventions', allowed: AGGREGATE },
  { name: 'plan an intervention', method: 'post', path: '/interventions', body: {}, allowed: ENCODERS },
  { name: 'export reports', method: 'get', path: '/reports/no-such-report', allowed: AGGREGATE },
  // Administration (§4, §5.5)
  { name: 'manage curriculum and assessment standards', method: 'post', path: '/reference/learning-areas', body: {}, allowed: ['DIVISION_ADMIN'] },
  { name: 'create a school year', method: 'post', path: '/reference/school-years', body: {}, allowed: ['DIVISION_ADMIN'] },
  { name: 'open/close a school year', method: 'post', path: () => `/reference/school-years/${syId}/status`, body: {}, allowed: ['SYSTEM_ADMIN'] },
  { name: 'manage user accounts', method: 'get', path: '/users', allowed: ['DIVISION_ADMIN', 'SYSTEM_ADMIN'] },
  { name: 'change system settings', method: 'put', path: '/governance/settings/smallCellThreshold', body: {}, allowed: ['DIVISION_ADMIN', 'SYSTEM_ADMIN'] },
  { name: 'view audit logs', method: 'get', path: '/governance/audit-logs', allowed: ['DIVISION_ADMIN', 'SYSTEM_ADMIN', 'DPO'] },
  { name: 'manage retention and breaches', method: 'get', path: '/governance/retention', allowed: ['DIVISION_ADMIN', 'DPO'] },
];

const tokens = new Map<Role, Awaited<ReturnType<typeof asUser>>>();

beforeAll(async () => {
  syId = (await currentSchoolYear()).id;
  for (const r of ROLES) tokens.set(r, await asUser(ACCOUNTS[r]));
});

describe('QA · role permission matrix (RBAC)', () => {
  for (const cap of CAPABILITIES) {
    it(`${cap.name}: only ${cap.allowed.join(', ')}`, async () => {
      const outcome: Record<string, number> = {};
      for (const role of ROLES) {
        const path = typeof cap.path === 'function' ? cap.path() : cap.path;
        const req = tokens.get(role)![cap.method](path);
        const res = cap.body !== undefined ? await req.send(cap.body) : await req;
        outcome[role] = res.status;
      }
      const denied = Object.entries(outcome).filter(([, s]) => s === 403).map(([r]) => r).sort();
      const expectedDenied = ROLES.filter((r) => !cap.allowed.includes(r)).sort();
      expect({ cap: cap.name, denied }).toEqual({ cap: cap.name, denied: expectedDenied });
      for (const r of cap.allowed) expect(outcome[r], `${r} → ${cap.name}`).not.toBe(401);
    });
  }

  it('requires authentication on every protected endpoint', async () => {
    for (const cap of CAPABILITIES) {
      const path = typeof cap.path === 'function' ? cap.path() : cap.path;
      const res = await request(app)[cap.method](`/api/v1${path}`).send(cap.body ?? {});
      expect(res.status, `${cap.method.toUpperCase()} ${path}`).toBe(401);
    }
  });
});

describe('QA · separation of duties (§4, §5.3)', () => {
  it('lets no role delete an assessment result or edit audit logs (no such endpoints)', async () => {
    const result = await prisma.assessmentResult.findFirstOrThrow();
    for (const role of ROLES) {
      const u = tokens.get(role)!;
      expect((await u.delete(`/assessments/${result.assessmentId}/results`)).status).toBe(404);
      expect((await u.delete('/governance/audit-logs')).status).toBe(404);
      expect((await u.put('/governance/audit-logs/1').send({})).status).toBe(404);
    }
  });

  it('keeps administrators and the DPO away from learner records and results', async () => {
    const learner = await prisma.learner.findFirstOrThrow();
    const a = await prisma.assessment.findFirstOrThrow({ where: { school: { schoolIdDeped: BPES } } });
    for (const role of ['SYSTEM_ADMIN', 'DPO'] as Role[]) {
      const u = tokens.get(role)!;
      expect((await u.get(`/learners/${learner.id}`)).status).toBe(403);
      expect((await u.get(`/assessments/${a.id}`)).status).toBe(403);
      expect((await u.put(`/assessments/${a.id}/results`).send({ entries: [] })).status).toBe(403);
    }
  });

  it('lets a principal view but never encode or register learners', async () => {
    const p = tokens.get('PRINCIPAL')!;
    const a = await prisma.assessment.findFirstOrThrow({ where: { school: { schoolIdDeped: BPES } } });
    expect((await p.get(`/assessments/${a.id}`)).status).toBe(200);
    expect((await p.put(`/assessments/${a.id}/results`).send({ entries: [] })).status).toBe(403);
    expect((await p.post('/learners').send({})).status).toBe(403);
  });

  it('only a System Administrator may create System Administrator accounts', async () => {
    const res = await tokens.get('DIVISION_ADMIN')!.post('/users').send({ email: 'qa.sysadmin@deped.gov.ph', fullName: 'Qa Sysadmin', role: 'SYSTEM_ADMIN', scopes: [] });
    expect(res.status).toBe(403);
  });
});

describe('QA · data scope (ABAC, §5.4)', () => {
  it('confines school staff to their own school', async () => {
    const other = await prisma.assessment.findFirstOrThrow({ where: { school: { schoolIdDeped: OTHER_SCHOOL } } });
    const otherLearner = await prisma.learner.findFirstOrThrow({ where: { enrolments: { some: { section: { school: { schoolIdDeped: OTHER_SCHOOL } } } } } });
    for (const role of SCHOOL_STAFF) {
      const u = tokens.get(role)!;
      expect((await u.get(`/assessments/${other.id}`)).status, role).toBe(404);
      expect((await u.get(`/learners/${otherLearner.id}`)).status, role).toBe(404);
      const list = await u.get('/assessments?perPage=200');
      const schools = new Set(list.body.data.map((x: { school: { name: string } }) => x.school.name));
      expect([...schools], role).toEqual(['Bagong Pag-asa Elementary School']);
    }
  });

  it('confines a teacher to their own classes inside the school', async () => {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { email: ACCOUNTS.TEACHER } });
    const sy = await currentSchoolYear();
    const own = await prisma.section.findMany({ where: { OR: [{ adviserId: teacher.id }, { teachers: { some: { userId: teacher.id } } }] }, select: { id: true } });
    const sections = await tokens.get('TEACHER')!.get(`/sections?schoolYearId=${sy.id}`);
    expect(sections.body.length).toBeGreaterThan(0);
    for (const s of sections.body) expect(own.map((o) => o.id)).toContain(s.id);
    const colleague = await prisma.section.findFirstOrThrow({ where: { school: { schoolIdDeped: BPES }, schoolYearId: sy.id, id: { notIn: own.map((o) => o.id) } } });
    expect((await tokens.get('TEACHER')!.get(`/sections/${colleague.id}`)).status).toBe(404);
    expect((await tokens.get('PRINCIPAL')!.get(`/sections/${colleague.id}`)).status).toBe(200);
  });

  it('confines a district supervisor to the district and an EPS to the learning area', async () => {
    const sy = await currentSchoolYear();
    const psds = await tokens.get('PSDS')!.get(`/analytics/breakdown?dim=school&schoolYearId=${sy.id}`);
    const district2 = await prisma.school.findMany({ where: { district: { name: 'District II' } }, select: { id: true } });
    expect(psds.body.length).toBeGreaterThan(0);
    for (const row of psds.body) expect(district2.map((s) => s.id)).toContain(row.key);
    const eps = await tokens.get('EPS')!.get(`/analytics/breakdown?dim=learningArea&schoolYearId=${sy.id}`);
    const math = await prisma.learningArea.findUniqueOrThrow({ where: { code: 'MATH' } });
    expect(eps.body.map((r: { key: number }) => r.key)).toEqual([math.id]);
  });

  it('never sends an LRN to roles without learner-level access', async () => {
    const sy = await currentSchoolYear();
    for (const role of ['PSDS', 'EPS', 'CHIEF_CID', 'DIVISION_ADMIN'] as Role[]) {
      const u = tokens.get(role)!;
      for (const path of [
        `/assessments?perPage=50&schoolYearId=${sy.id}`,
        `/interventions?perPage=50&schoolYearId=${sy.id}`,
        `/analytics/least-mastered?schoolYearId=${sy.id}`,
        `/analytics/breakdown?dim=school&schoolYearId=${sy.id}`,
        `/reports/division?schoolYearId=${sy.id}`,
      ]) {
        const res = await u.get(path);
        expect(res.status, `${role} ${path}`).toBe(200);
        expect(LRN_IN_JSON.test(JSON.stringify(res.body)), `${role} ${path} leaks an LRN`).toBe(false);
      }
    }
  });
});
