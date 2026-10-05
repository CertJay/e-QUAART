import { describe, expect, it } from 'vitest';
import { app, asUser, currentSchoolYear, prisma, request } from '../helpers.js';
import { ACCOUNTS } from '../support/fixtures.js';

/** QA: platform behaviour every feature relies on (spec §11, §12, §13). */
describe('QA · API contract', () => {
  it('reports health without authentication', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('answers every error in the same { error: { code, message } } shape', async () => {
    const t = await asUser(ACCOUNTS.TEACHER);
    const cases = [
      await request(app).get('/api/v1/me'), // 401
      await t.get('/users'), // 403
      await t.get('/no-such-endpoint'), // 404
      await t.post('/learners').send({}), // 400 validation
      await t.post('/learners').set('Content-Type', 'application/json').send('{"lrn": '), // malformed JSON
    ];
    expect(cases.map((r) => r.status)).toEqual([401, 403, 404, 400, 400]);
    for (const r of cases) {
      expect(typeof r.body.error.code).toBe('string');
      expect(typeof r.body.error.message).toBe('string');
      expect(JSON.stringify(r.body)).not.toMatch(/at .+\.ts:\d+|PrismaClient|stack/); // no internals leaked
    }
  });

  it('lists validation problems per field', async () => {
    const res = await (await asUser(ACCOUNTS.TEACHER)).post('/learners').send({ lrn: '1' });
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['lrn', 'firstName', 'lastName', 'sex']));
  });

  it('bounds pagination', async () => {
    const t = await asUser(ACCOUNTS.TEACHER);
    expect((await t.get('/learners?perPage=500')).status).toBe(400);
    expect((await t.get('/learners?page=0')).status).toBe(400);
    const ok = await t.get('/learners?perPage=5');
    expect(ok.body.data.length).toBeLessThanOrEqual(5);
    expect(ok.body.meta).toMatchObject({ page: 1, perPage: 5 });
  });
});

describe('QA · security and privacy (RA 10173)', () => {
  it('sends security headers and forbids caching of API responses', async () => {
    const res = await (await asUser(ACCOUNTS.TEACHER)).get('/me');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('never returns password hashes or session secrets', async () => {
    const admin = await asUser(ACCOUNTS.DIVISION_ADMIN);
    const bodies = [await admin.get('/users?perPage=200'), await admin.get('/me')].map((r) => JSON.stringify(r.body));
    for (const b of bodies) expect(b).not.toMatch(/passwordHash|refreshTokenHash|\$argon2/);
  });

  it('audit-logs sign-ins, failed sign-ins, learner views and exports', async () => {
    const before = new Date(Date.now() - 1000);
    await request(app).post('/api/v1/auth/login').send({ email: ACCOUNTS.PRINCIPAL, password: 'definitely-wrong' });
    const p = await asUser(ACCOUNTS.PRINCIPAL);
    const learner = await prisma.learner.findFirstOrThrow({ where: { enrolments: { some: { section: { school: { schoolIdDeped: '900101' } } } } } });
    await p.get(`/learners/${learner.id}`);
    const sy = await currentSchoolYear();
    expect((await p.get(`/reports/school?schoolYearId=${sy.id}&format=csv`)).status).toBe(200);
    const actions = (await prisma.auditLog.findMany({ where: { at: { gte: before } }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['LOGIN_FAILED', 'VIEW_LEARNER', 'EXPORT']));
  });

  it('keeps the audit trail append-only for every role', async () => {
    const dpo = await asUser(ACCOUNTS.DPO);
    const n = await prisma.auditLog.count();
    expect((await dpo.delete('/governance/audit-logs/1')).status).toBe(404);
    expect(await prisma.auditLog.count()).toBeGreaterThanOrEqual(n);
  });
});
