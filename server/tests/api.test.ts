import { beforeAll, describe, expect, it } from 'vitest';
import { app, as, asUser, currentSchoolYear, login, prisma, request } from './helpers.js';

const TEACHER = 'teacher@equaart.local'; // adviser, Bagong Pag-asa ES Grade 3 – Sampaguita
const COORD = 'coordinator.bpes@equaart.local';
const PRINCIPAL = 'principal.bpes@equaart.local';

let sy: Awaited<ReturnType<typeof currentSchoolYear>>;
let teacherSection: { id: number; schoolId: number };
let otherSchoolAssessmentId: number;

beforeAll(async () => {
  sy = await currentSchoolYear();
  const teacher = await prisma.user.findUniqueOrThrow({ where: { email: TEACHER } });
  teacherSection = await prisma.section.findFirstOrThrow({ where: { adviserId: teacher.id, schoolYearId: sy.id } });
  otherSchoolAssessmentId = (await prisma.assessment.findFirstOrThrow({ where: { school: { schoolIdDeped: '900201' } } })).id;
});

describe('authentication & sessions', () => {
  it('rejects bad credentials and never reveals which part was wrong', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: TEACHER, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid email or password');
  });

  it('locks an account after repeated failures', async () => {
    const email = 't.mes.g1.ilangilang@equaart.local';
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').send({ email, password: 'nope' });
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Equaart#2026' });
    expect(res.status).toBe(423);
    await prisma.user.update({ where: { email }, data: { lockedUntil: null, failedLoginCount: 0 } });
  });

  it('requires a bearer token and returns the profile with permissions', async () => {
    expect((await request(app).get('/api/v1/me')).status).toBe(401);
    const me = await (await asUser(TEACHER)).get('/me');
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('TEACHER');
    expect(me.body.permissions).toContain('assessment:write');
  });

  it('rotates refresh tokens, requires the CSRF header, and revokes on logout', async () => {
    const agent = request.agent(app);
    const login1 = await agent.post('/api/v1/auth/login').send({ email: PRINCIPAL, password: 'Equaart#2026' });
    expect(login1.status).toBe(200);
    expect((await agent.post('/api/v1/auth/refresh')).status).toBe(403);
    const refreshed = await agent.post('/api/v1/auth/refresh').set('X-Requested-With', 'XMLHttpRequest');
    expect(refreshed.status).toBe(200);
    const out = await agent.post('/api/v1/auth/logout').set('Authorization', `Bearer ${refreshed.body.token}`);
    expect(out.status).toBe(200);
    expect((await agent.get('/api/v1/me').set('Authorization', `Bearer ${refreshed.body.token}`)).status).toBe(401);
    expect((await agent.post('/api/v1/auth/refresh').set('X-Requested-With', 'XMLHttpRequest')).status).toBe(401);
  });

  it('enforces the password policy', async () => {
    const res = await (await asUser(COORD)).post('/auth/change-password').send({ currentPassword: 'Equaart#2026', newPassword: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('scoped access control', () => {
  it('hides assessments outside a teacher’s classes', async () => {
    const t = await asUser(TEACHER);
    expect((await t.get(`/assessments/${otherSchoolAssessmentId}`)).status).toBe(404);
    const list = await t.get('/assessments?perPage=200');
    const ids = new Set(list.body.data.map((a: { school: { id: number } }) => a.school.id));
    expect([...ids]).toEqual([teacherSection.schoolId]);
  });

  it('denies identifiable learner data to division and district roles', async () => {
    for (const email of ['chief.cid@equaart.local', 'eps.math@equaart.local', 'psds.district2@equaart.local']) {
      const u = await asUser(email);
      expect((await u.get('/learners')).status).toBe(403);
      expect((await u.get('/analytics/learners-at-risk')).status).toBe(403);
      expect((await u.get('/analytics/breakdown?dim=learner')).status).toBe(403);
    }
  });

  it('confines an EPS to assigned learning areas', async () => {
    const eps = await asUser('eps.math@equaart.local');
    const res = await eps.get(`/analytics/breakdown?dim=learningArea&schoolYearId=${sy.id}`);
    expect(res.status).toBe(200);
    expect(res.body.map((r: { label: string }) => r.label)).toEqual(['Mathematics']);
  });

  it('confines a district supervisor to their district', async () => {
    const psds = await asUser('psds.district2@equaart.local');
    const res = await psds.get(`/analytics/breakdown?dim=school&schoolYearId=${sy.id}`);
    expect(res.body.map((r: { label: string }) => r.label).sort()).toEqual(['Luntian Elementary School', 'Tanglaw National High School']);
  });

  it('gives the ICT admin and DPO no academic data', async () => {
    for (const email of ['ict@equaart.local', 'dpo@equaart.local']) {
      const u = await asUser(email);
      expect((await u.get('/analytics/summary')).status).toBe(403);
      expect((await u.get('/assessments')).status).toBe(403);
    }
    expect((await (await asUser('dpo@equaart.local')).get('/governance/audit-logs')).status).toBe(200);
  });

  it('prevents a principal from editing encoded scores', async () => {
    const a = await prisma.assessment.findFirstOrThrow({ where: { schoolId: teacherSection.schoolId, status: 'DRAFT' } });
    const res = await (await asUser(PRINCIPAL)).put(`/assessments/${a.id}/results`).send({ entries: [] });
    expect(res.status).toBe(403);
  });

  it('paginates list endpoints', async () => {
    const res = await (await asUser(PRINCIPAL)).get('/learners?perPage=10&page=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta).toMatchObject({ page: 2, perPage: 10 });
    expect(res.body.meta.total).toBeGreaterThan(100);
  });
});

describe('learner master data', () => {
  it('prevents duplicate LRNs', async () => {
    const t = await asUser(TEACHER);
    const existing = await prisma.learner.findFirstOrThrow();
    const res = await t.post('/learners').send({ lrn: existing.lrn, firstName: 'A', lastName: 'B', sex: 'MALE', sectionId: teacherSection.id });
    expect(res.status).toBe(409);
    const bad = await t.post('/learners').send({ lrn: '123', firstName: 'A', lastName: 'B', sex: 'MALE', sectionId: teacherSection.id });
    expect(bad.status).toBe(400);
  });

  it('enrols a transferee only when LRN and last name both match', async () => {
    const t = await asUser(TEACHER);
    const other = await prisma.learner.findFirstOrThrow({ where: { enrolments: { some: { section: { school: { schoolIdDeped: '900201' } } } } } });
    expect((await t.post('/learners/enrol-existing').send({ lrn: other.lrn, lastName: 'Wrongname', sectionId: teacherSection.id })).status).toBe(404);
  });

  it('validates a roster import before writing anything', async () => {
    const t = await asUser(TEACHER);
    const existing = await prisma.learner.findFirstOrThrow();
    const csv = [
      'lrn,last_name,first_name,sex',
      '999999000001,Dela Paz,Ana,F',
      '999999000001,Dela Paz,Ana,F',
      '12345,Short,Lrn,M',
      `${existing.lrn},Differentname,X,M`,
      '999999000002,Ok,Ben,X',
    ].join('\n');
    const res = await t.post('/learners/import').field('sectionId', String(teacherSection.id)).attach('file', Buffer.from(csv), 'roster.csv');
    expect(res.status).toBe(422);
    expect(res.body.committed).toBe(false);
    const msgs = res.body.errors.map((e: { message: string }) => e.message).join(' | ');
    expect(msgs).toContain('Duplicate LRN in file');
    expect(msgs).toContain('12 digits');
    expect(msgs).toContain('different last name');
    expect(await prisma.learner.count({ where: { lrn: '999999000001' } })).toBe(0);
  });
});

describe('assessment workflow (acceptance criteria)', () => {
  let assessmentId: number;
  let roster: { learner: { id: number } }[];

  it('rejects a duplicate assessment for the same class, term and learning area', async () => {
    const t = await asUser(TEACHER);
    const existing = await prisma.assessment.findFirstOrThrow({ where: { sectionId: teacherSection.id, term: { code: 'T1' }, schoolYearId: sy.id } });
    const res = await t.post('/assessments').send({
      assessmentTypeId: existing.assessmentTypeId, schoolYearId: sy.id, termId: existing.termId, sectionId: teacherSection.id, learningAreaId: existing.learningAreaId, maxScore: 40,
    });
    expect(res.status).toBe(409);
  });

  it('lets a teacher encode a full section and computes each tier from the configured bands', async () => {
    const t = await asUser(TEACHER);
    const quarterly = await prisma.assessmentType.findUniqueOrThrow({ where: { code: 'TERM_EXAM' } });
    const eng = await prisma.learningArea.findUniqueOrThrow({ where: { code: 'ENG' } });
    const g3 = await prisma.gradeLevel.findUniqueOrThrow({ where: { code: 'G3' } });
    const comps = await prisma.competency.findMany({ where: { learningAreaId: eng.id, gradeLevelId: g3.id }, take: 2, orderBy: { code: 'asc' } });
    const q2 = sy.terms.find((x) => x.code === 'T2')!;
    const created = await t.post('/assessments').send({
      assessmentTypeId: quarterly.id, schoolYearId: sy.id, termId: q2.id, sectionId: teacherSection.id, learningAreaId: eng.id, maxScore: 20,
      competencies: comps.map((c) => ({ competencyId: c.id, itemsTotal: 10 })),
    });
    expect(created.status).toBe(201);
    assessmentId = created.body.id;

    const detail = await t.get(`/assessments/${assessmentId}`);
    roster = detail.body.rows.filter((r: { enrolled: boolean }) => r.enrolled);
    expect(roster.length).toBeGreaterThan(15);

    // Out-of-range score: nothing is saved.
    const bad = await t.put(`/assessments/${assessmentId}/results`).send({ entries: [{ learnerId: roster[0].learner.id, rawScore: 25 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].message).toContain('exceeds the maximum');

    // Submission is blocked while learners are missing.
    const early = await t.post(`/assessments/${assessmentId}/submit`);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('QA_FAILED');

    const entries = roster.map((r, i) => {
      const a = [10, 7, 4][i % 3];
      const b = [9, 8, 5][i % 3];
      return { learnerId: r.learner.id, competencies: [{ competencyId: comps[0].id, itemsCorrect: a }, { competencyId: comps[1].id, itemsCorrect: b }] };
    });
    const saved = await t.put(`/assessments/${assessmentId}/results`).send({ entries });
    expect(saved.status).toBe(200);

    const results = await prisma.assessmentResult.findMany({ where: { assessmentId }, include: { band: true }, orderBy: { learnerId: 'asc' } });
    const byLearner = new Map(results.map((r) => [r.learnerId, r]));
    const r0 = byLearner.get(roster[0].learner.id)!;
    expect(r0.rawScore).toBe(19); // summed from competency items
    expect(r0.percentage).toBe(95);
    expect(r0.band?.label).toBe('Proficient');
    expect(r0.tier).toBe('TIER_1');
    expect(byLearner.get(roster[1].learner.id)!.tier).toBe('TIER_2'); // 75%
    expect(byLearner.get(roster[2].learner.id)!.tier).toBe('TIER_3'); // 45%
  });

  it('runs quality checks, submits, derives learning gaps, and audit-logs changes', async () => {
    const t = await asUser(TEACHER);
    const qa = await t.get(`/assessments/${assessmentId}/qa`);
    expect(qa.body.blocking).toBe(false);
    const sub = await t.post(`/assessments/${assessmentId}/submit`);
    expect(sub.status).toBe(200);
    expect(sub.body.gaps.created).toBeGreaterThan(0);
    const gaps = await prisma.learningGap.count({ where: { assessmentResult: { assessmentId } } });
    expect(gaps).toBeGreaterThan(0);
    const logs = await prisma.auditLog.count({ where: { entity: 'AssessmentResult', action: 'CREATE' } });
    expect(logs).toBeGreaterThanOrEqual(roster.length);
  });

  it('requires a different person to verify, then locks the results', async () => {
    expect((await (await asUser(TEACHER)).post(`/assessments/${assessmentId}/verify`)).status).toBe(403);
    const v = await (await asUser(COORD)).post(`/assessments/${assessmentId}/verify`);
    expect(v.status).toBe(200);
    expect(v.body.status).toBe('VERIFIED');
    const edit = await (await asUser(TEACHER)).put(`/assessments/${assessmentId}/results`).send({ entries: [{ learnerId: roster[0].learner.id, competencies: [] , rawScore: 1 }] });
    expect(edit.status).toBe(423);
    // The uncontrolled "reopen" shortcut is gone; locked results change only through a correction request.
    expect((await (await asUser(COORD)).post(`/assessments/${assessmentId}/reopen`).send({ reason: 'Correct one learner' })).status).toBe(404);
    const detail = await (await asUser(TEACHER)).get(`/assessments/${assessmentId}`);
    expect(detail.body.canEncode).toBe(true);
    expect(detail.body.canRequestCorrection).toBe(true);
    expect(detail.body.lockReason).toContain('correction request');
  });

  it('corrects a locked result only through an approved correction request (§7.4, AC 14)', async () => {
    const t = await asUser(TEACHER);
    const learnerId = roster[2].learner.id; // 4 + 5 of 20 → 45%, Tier 3
    const result = await prisma.assessmentResult.findFirstOrThrow({ where: { assessmentId, learnerId }, include: { competencyResults: true } });
    expect(result.tier).toBe('TIER_3');
    const [c1] = result.competencyResults.sort((x, y) => x.competencyId - y.competencyId);
    const reason = 'Encoded the wrong column from the answer sheet';

    const tooShort = await t.post('/correction-requests').send({ assessmentResultId: result.id, changes: { competencies: [{ competencyId: c1.competencyId, itemsCorrect: 10 }] }, reason: 'typo' });
    expect(tooShort.status).toBe(400);
    const invalid = await t.post('/correction-requests').send({ assessmentResultId: result.id, changes: { competencies: [{ competencyId: c1.competencyId, itemsCorrect: 11 }] }, reason });
    expect(invalid.status).toBe(400);
    const same = await t.post('/correction-requests').send({ assessmentResultId: result.id, changes: { competencies: [{ competencyId: c1.competencyId, itemsCorrect: c1.itemsCorrect }] }, reason });
    expect(same.status).toBe(400);

    const created = await t.post('/correction-requests').send({
      assessmentResultId: result.id,
      changes: { competencies: [{ competencyId: c1.competencyId, itemsCorrect: 10 }] },
      reason,
      evidence: 'Answer sheet on file, item analysis page 2',
    });
    expect(created.status).toBe(201);
    const fields = created.body.changes.map((c: { field: string; oldValue: unknown; newValue: unknown }) => [c.field, c.oldValue, c.newValue]);
    expect(fields).toEqual(expect.arrayContaining([['rawScore', 9, 15], [`competency:${c1.competencyId}`, 4, 10]]));

    // Still locked, nothing applied yet; one pending request per result.
    expect((await prisma.assessmentResult.findUniqueOrThrow({ where: { id: result.id } })).rawScore).toBe(9);
    const dup = await t.post('/correction-requests').send({ assessmentResultId: result.id, changes: { remarks: 'x' }, reason: 'Another change to the same result' });
    expect(dup.status).toBe(409);
    expect((await t.get(`/assessments/${assessmentId}`)).body.pendingCorrections[result.id]).toBe(created.body.id);

    // Separation of duties: the requester cannot decide; another school cannot even see it.
    expect((await t.post(`/correction-requests/${created.body.id}/decision`).send({ decision: 'APPROVE' })).status).toBe(403);
    expect((await (await asUser('principal.mes@equaart.local')).get(`/correction-requests/${created.body.id}`)).status).toBe(404);
    expect((await (await asUser(PRINCIPAL)).post(`/correction-requests/${created.body.id}/decision`).send({ decision: 'REJECT' })).status).toBe(400);

    const queue = await (await asUser(PRINCIPAL)).get('/correction-requests?status=PENDING');
    expect(queue.body.pendingForMe).toBeGreaterThanOrEqual(1);
    expect(queue.body.data.find((c: { id: number }) => c.id === created.body.id).canReview).toBe(true);

    const approved = await (await asUser(PRINCIPAL)).post(`/correction-requests/${created.body.id}/decision`).send({ decision: 'APPROVE', note: 'Checked against the answer sheet' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
    const after = await prisma.assessmentResult.findUniqueOrThrow({ where: { id: result.id }, include: { assessment: true } });
    expect(after.rawScore).toBe(15);
    expect(after.percentage).toBe(75);
    expect(after.tier).toBe('TIER_2');
    expect(after.assessment.status).toBe('VERIFIED'); // stays locked
    expect(await prisma.learningGap.count({ where: { assessmentResultId: result.id, competencyId: c1.competencyId } })).toBe(0);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'CORRECTION_APPLY', entity: 'AssessmentResult', entityId: String(result.id) } });
    expect(log.beforeJson).toMatchObject({ rawScore: 9, tier: 'TIER_3' });
    expect(log.afterJson).toMatchObject({ rawScore: 15, tier: 'TIER_2', correctionRequestId: created.body.id, reason });
    const history = await t.get(`/assessments/${assessmentId}/history`);
    expect(history.body.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['CORRECTION_APPLY', 'VERIFY', 'SUBMIT', 'CREATE']));
    expect((await (await asUser(PRINCIPAL)).post(`/correction-requests/${created.body.id}/decision`).send({ decision: 'APPROVE' })).status).toBe(409);
  });

  it('lets a reviewer reject and a requester cancel a correction request', async () => {
    const t = await asUser(TEACHER);
    const result = await prisma.assessmentResult.findFirstOrThrow({ where: { assessmentId, learnerId: roster[0].learner.id } });
    const first = await t.post('/correction-requests').send({ assessmentResultId: result.id, changes: { remarks: 'Took the test on make-up day' }, reason: 'Remark was left out during encoding' });
    expect(first.status).toBe(201);
    const rejected = await (await asUser(COORD)).post(`/correction-requests/${first.body.id}/decision`).send({ decision: 'REJECT', note: 'Remarks are not part of the official result' });
    expect(rejected.body.status).toBe('REJECTED');
    expect((await prisma.assessmentResult.findUniqueOrThrow({ where: { id: result.id } })).remarks).toBeNull();

    const second = await t.post('/correction-requests').send({ assessmentResultId: result.id, changes: { remarks: 'Make-up test' }, reason: 'Remark was left out during encoding' });
    expect((await (await asUser(COORD)).post(`/correction-requests/${second.body.id}/cancel`)).status).toBe(403);
    const cancelled = await t.post(`/correction-requests/${second.body.id}/cancel`);
    expect(cancelled.body.status).toBe('CANCELLED');
  });

  it('refuses correction requests for results that are not locked', async () => {
    const draft = await prisma.assessmentResult.findFirstOrThrow({ where: { assessment: { sectionId: teacherSection.id, status: 'DRAFT', schoolYearId: sy.id } } });
    const res = await (await asUser(TEACHER)).post('/correction-requests').send({ assessmentResultId: draft.id, changes: { remarks: 'x' }, reason: 'Trying to correct a draft result' });
    expect(res.status).toBe(409);
  });

  it('classifies a CRLA "Full Refresher" as Tier 3 without any percentage rule', async () => {
    const t = await asUser(TEACHER);
    const crla = await prisma.assessmentType.findUniqueOrThrow({ where: { code: 'CRLA' } });
    const eng = await prisma.learningArea.findUniqueOrThrow({ where: { code: 'ENG' } });
    const eosy = sy.terms.find((x) => x.code === 'EOSY')!;
    const a = await t.post('/assessments').send({ assessmentTypeId: crla.id, schoolYearId: sy.id, termId: eosy.id, sectionId: teacherSection.id, learningAreaId: eng.id });
    expect(a.status).toBe(201);
    const learnerId = roster[0].learner.id;
    const bad = await t.put(`/assessments/${a.body.id}/results`).send({ entries: [{ learnerId, descriptor: 'Proficient' }] });
    expect(bad.status).toBe(400);
    const ok = await t.put(`/assessments/${a.body.id}/results`).send({ entries: [{ learnerId, descriptor: 'FULL_REFRESHER' }] });
    expect(ok.status).toBe(200);
    const r = await prisma.assessmentResult.findFirstOrThrow({ where: { assessmentId: a.body.id, learnerId }, include: { band: true } });
    expect(r.tier).toBe('TIER_3');
    expect(r.percentage).toBeNull();
    expect(r.band?.label).toBe('Full Refresher');
  });

  it('validates a results import (invalid LRN, duplicates, out-of-range, not enrolled)', async () => {
    const t = await asUser(TEACHER);
    const draft = await prisma.assessment.findFirstOrThrow({ where: { sectionId: teacherSection.id, status: 'DRAFT', assessmentType: { code: 'TERM_EXAM' } }, include: { competencies: { include: { competency: true } } } });
    const tpl = await t.get(`/assessments/${draft.id}/template`);
    expect(tpl.status).toBe(200);
    expect(tpl.text.split('\n')[0]).toContain('comp:');
    const lrns = (await prisma.enrolment.findMany({ where: { sectionId: teacherSection.id, isCurrent: true }, include: { learner: true }, take: 2 })).map((e) => e.learner.lrn);
    const outsider = (await prisma.learner.findFirstOrThrow({ where: { enrolments: { none: { sectionId: teacherSection.id } } } })).lrn;
    const csv = ['lrn,score', `${lrns[0]},${(draft.maxScore ?? 0) + 5}`, `${lrns[1]},10`, `${lrns[1]},11`, 'abc,10', `${outsider},10`].join('\n');
    const res = await t.post(`/assessments/${draft.id}/results/import`).field('dryRun', 'true').attach('file', Buffer.from(csv), 'r.csv');
    expect(res.status).toBe(200);
    const msgs = res.body.errors.map((e: { message: string }) => e.message).join(' | ');
    expect(msgs).toContain('exceeds the maximum score');
    expect(msgs).toContain('Duplicate LRN');
    expect(msgs).toContain('not a valid 12-digit LRN');
    expect(msgs).toContain('not enrolled in this class');
  });
});

describe('analytics', () => {
  it('ranks least-mastered competencies for a class with drill-down to learners', async () => {
    const t = await asUser(TEACHER);
    const res = await t.get(`/analytics/least-mastered?sectionId=${teacherSection.id}&schoolYearId=${sy.id}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    const rates = res.body.map((r: { notMasteredRate: number }) => r.notMasteredRate);
    expect([...rates].sort((a, b) => b - a)).toEqual(rates);
    const gaps = await t.get(`/gaps?competencyId=${res.body[0].competencyId}&sectionId=${teacherSection.id}`);
    expect(gaps.status).toBe(200);
    expect(gaps.body.data.length).toBeGreaterThan(0);
  });

  it('surfaces competencies that are difficult across two or more schools at division level', async () => {
    const cid = await asUser('chief.cid@equaart.local');
    const res = await cid.get(`/analytics/least-mastered?schoolYearId=${sy.id}&limit=50`);
    expect(res.status).toBe(200);
    expect(res.body.some((r: { level: string; gapSchools: number }) => r.level === 'DIVISION' && r.gapSchools >= 2)).toBe(true);
  });

  it('keeps metric definitions consistent between summary and breakdown', async () => {
    const p = await asUser(PRINCIPAL);
    const [summary, byGrade] = await Promise.all([p.get(`/analytics/summary?schoolYearId=${sy.id}`), p.get(`/analytics/breakdown?dim=gradeLevel&schoolYearId=${sy.id}`)]);
    const total = byGrade.body.reduce((s: number, r: { assessed: number }) => s + r.assessed, 0);
    expect(total).toBe(summary.body.assessed);
    const t1 = byGrade.body.reduce((s: number, r: { tier1: number }) => s + r.tier1, 0);
    expect(summary.body.proficiencyRate).toBe(Math.round((t1 / total) * 1000) / 10);
  });

  it('suppresses small cells for division roles but not for school roles', async () => {
    const cid = await asUser('chief.cid@equaart.local');
    const a = await prisma.assessment.findFirstOrThrow({ where: { status: 'VERIFIED', sectionId: teacherSection.id } });
    // A single learner's band is a small cell.
    const res = await cid.get(`/analytics/breakdown?dim=section&assessmentId=${a.id}&tier=TIER_3`);
    expect(res.body.every((r: { suppressed: boolean; assessed: number | null }) => r.suppressed ? r.assessed === null : r.assessed! >= 5)).toBe(true);
    const own = await (await asUser(PRINCIPAL)).get(`/analytics/breakdown?dim=section&assessmentId=${a.id}&tier=TIER_3`);
    expect(own.body.every((r: { suppressed: boolean }) => !r.suppressed)).toBe(true);
  });

  it('flags schools needing technical assistance alphabetically, not as a ranking', async () => {
    const res = await (await asUser('chief.cid@equaart.local')).get(`/analytics/schools-support?schoolYearId=${sy.id}`);
    const names = res.body.map((r: { school: string }) => r.school);
    expect(names).toEqual([...names].sort());
    expect(res.body.find((r: { school: string }) => r.school === 'Luntian Elementary School').needsSupport).toBe(true);
  });

  it('computes trends and heatmaps', async () => {
    const p = await asUser(PRINCIPAL);
    const trend = await p.get('/analytics/trend?series=learningArea&assessmentTypeId=' + (await prisma.assessmentType.findUniqueOrThrow({ where: { code: 'TERM_EXAM' } })).id);
    expect(trend.body.terms.length).toBeGreaterThanOrEqual(5);
    const heat = await p.get(`/analytics/heatmap?rows=gradeLevel&cols=learningArea&schoolYearId=${sy.id}`);
    expect(heat.body.rows.length).toBe(6);
    expect(heat.body.cells.length).toBeGreaterThan(10);
  });
});

describe('interventions', () => {
  it('creates an intervention from a learning gap and measures effectiveness after reassessment', async () => {
    const t = await asUser(TEACHER);
    const gap = await prisma.learningGap.findFirstOrThrow({ where: { sectionId: teacherSection.id, status: 'OPEN', competencyId: { not: null }, schoolYearId: sy.id } });
    const created = await t.post('/interventions').send({
      title: 'Targeted remediation', sectionId: teacherSection.id, schoolYearId: sy.id, learningAreaId: gap.learningAreaId, tier: gap.severity,
      strategy: 'Small-group instruction', competencyIds: [gap.competencyId], learners: [{ learnerId: gap.learnerId, learningGapId: gap.id }],
    });
    expect(created.status).toBe(201);
    expect(created.body.learnersAdded).toBe(1);
    expect((await prisma.learningGap.findUniqueOrThrow({ where: { id: gap.id } })).status).toBe('IN_INTERVENTION');

    const detail = await t.get(`/interventions/${created.body.id}`);
    const member = detail.body.learners[0];
    expect(member.pre.percentage).toBe(gap.masteryPct);

    const session = await t.post(`/interventions/${created.body.id}/sessions`).send({ date: '2026-09-20', topic: 'Session 1', attendance: [{ learnerId: gap.learnerId, present: true }] });
    expect(session.status).toBe(201);
    expect((await prisma.intervention.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('ONGOING');

    const re = await t.post(`/interventions/${created.body.id}/learners/${member.id}/reassessments`).send({ date: '2026-10-10', rawScore: 9, maxScore: 10 });
    expect(re.status).toBe(201);
    expect(re.body.effectiveness.improved).toBe(true);
    expect(re.body.effectiveness.post.tier).toBe('TIER_1');
    expect(re.body.effectiveness.suggestedDecisions).toEqual(['COMPLETE']);
    expect((await prisma.learningGap.findUniqueOrThrow({ where: { id: gap.id } })).status).toBe('RESOLVED');

    const dec = await t.put(`/interventions/${created.body.id}/learners/${member.id}`).send({ decision: 'COMPLETE' });
    expect(dec.status).toBe(200);
  });

  it('rejects an intervention whose competencies are from another learning area', async () => {
    const t = await asUser(TEACHER);
    const gap = await prisma.learningGap.findFirstOrThrow({ where: { sectionId: teacherSection.id, competencyId: { not: null }, schoolYearId: sy.id } });
    const otherComp = await prisma.competency.findFirstOrThrow({ where: { learningAreaId: { not: gap.learningAreaId } } });
    const res = await t.post('/interventions').send({
      title: 'Mismatched remediation', sectionId: teacherSection.id, schoolYearId: sy.id, learningAreaId: gap.learningAreaId, tier: 'TIER_2',
      strategy: 'Small-group instruction', competencyIds: [otherComp.id],
    });
    expect(res.status).toBe(400);
  });

  it('shows division roles anonymised intervention learners', async () => {
    const i = await prisma.intervention.findFirstOrThrow({ where: { learners: { some: {} } } });
    const res = await (await asUser('chief.cid@equaart.local')).get(`/interventions/${i.id}`);
    expect(res.status).toBe(200);
    expect(res.body.learners[0].learner.lrn).toBeNull();
    expect(res.body.learners[0].learner.name).toMatch(/^Learner \d+$/);
  });
});

describe('configuration', () => {
  it('re-classifies existing results when an administrator changes performance levels', async () => {
    const admin = await asUser('admin@equaart.local');
    const type = await prisma.assessmentType.findUniqueOrThrow({ where: { code: 'SBA' }, include: { models: { include: { bands: true } } } });
    const model = type.models[0];
    const bad = await admin.put(`/reference/classification-models/${model.id}`).send({ name: model.name, bands: model.bands.slice(0, 2).map((b) => ({ ...b })) });
    expect(bad.status).toBe(400);
    const bands = model.bands.map((b) => ({ id: b.id, label: b.label, tier: b.tier, minPct: b.label === 'Proficient' ? 85 : b.minPct, maxPct: b.label === 'Approaching Proficiency' ? 84.99 : b.maxPct, color: b.color, sortOrder: b.sortOrder }));
    const ok = await admin.put(`/reference/classification-models/${model.id}`).send({ name: model.name, bands });
    expect(ok.status).toBe(200);
    expect(ok.body.bands.find((b: { label: string }) => b.label === 'Proficient').minPct).toBe(85);
    expect(await prisma.auditLog.count({ where: { entity: 'ClassificationModel', action: 'UPDATE' } })).toBe(1);
  });

  it('only lets administrators change reference data', async () => {
    expect((await (await asUser(TEACHER)).post('/reference/learning-areas').send({ code: 'X', name: 'X' })).status).toBe(403);
    expect((await (await asUser('admin@equaart.local')).post('/reference/learning-areas').send({ code: 'ICT', name: 'Information & Communications Technology' })).status).toBe(201);
  });

  it('creates users with scope rules and a temporary password', async () => {
    const admin = await asUser('admin@equaart.local');
    const noScope = await admin.post('/users').send({ email: 'x@equaart.local', fullName: 'Xavier Teacher', role: 'TEACHER', scopes: [] });
    expect(noScope.status).toBe(400);
    const school = await prisma.school.findFirstOrThrow();
    const ok = await admin.post('/users').send({ email: 'new.teacher@equaart.local', fullName: 'New Teacher', role: 'TEACHER', scopes: [{ scopeType: 'SCHOOL', schoolId: school.id }] });
    expect(ok.status).toBe(201);
    const first = await request(app).post('/api/v1/auth/login').send({ email: 'new.teacher@equaart.local', password: ok.body.temporaryPassword });
    expect(first.body.user.mustChangePassword).toBe(true);
    expect((await (await asUser(TEACHER)).get('/users')).status).toBe(403);
  });
});

describe('reports & exports', () => {
  it('exports every format and audit-logs learner-data exports', async () => {
    const p = await asUser(PRINCIPAL);
    const before = await prisma.auditLog.count({ where: { action: 'EXPORT' } });
    const csv = await p.get(`/reports/class?format=csv&sectionId=${teacherSection.id}&schoolYearId=${sy.id}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const xlsx = await p.get(`/reports/school?format=xlsx&schoolYearId=${sy.id}`).buffer(true);
    expect(xlsx.status).toBe(200);
    const pdf = await p.get(`/reports/intervention-effectiveness?format=pdf&schoolYearId=${sy.id}`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(await prisma.auditLog.count({ where: { action: 'EXPORT' } })).toBe(before + 3);
    const after = await prisma.auditLog.findMany({ where: { action: 'EXPORT' }, orderBy: { id: 'desc' }, take: 3 });
    expect(after.some((l) => (l.afterJson as { containsPersonalData: boolean }).containsPersonalData)).toBe(true);
  });

  it('builds the division report for the Chief CID without personal data', async () => {
    const res = await (await asUser('chief.cid@equaart.local')).get(`/reports/division?schoolYearId=${sy.id}`);
    expect(res.status).toBe(200);
    expect(res.body.containsPersonalData).toBe(false);
    expect(res.body.sections.length).toBeGreaterThan(5);
    expect((await (await asUser('chief.cid@equaart.local')).get('/reports/class?sectionId=1')).body.containsPersonalData).toBe(false);
  });

  it('rejects malformed ids with 400', async () => {
    expect((await (await asUser(PRINCIPAL)).get('/assessments/abc')).status).toBe(400);
  });

  it('refuses learner reports for aggregate-only roles', async () => {
    const l = await prisma.learner.findFirstOrThrow();
    expect((await (await asUser('eps.math@equaart.local')).get(`/reports/learner?learnerId=${l.id}`)).status).toBe(403);
  });
});

describe('school-year lifecycle (§7.1, §7.3)', () => {
  const ICT = 'ict@equaart.local'; // System Administrator

  it('treats a closed school year as read-only history, in the API and the database (AC 2, 3)', async () => {
    const teacher = await prisma.user.findUniqueOrThrow({ where: { email: TEACHER } });
    const past = await prisma.assessment.findFirstOrThrow({
      where: { schoolYear: { status: 'CLOSED' }, section: { adviserId: teacher.id }, status: 'VERIFIED', results: { some: {} } },
      include: { results: { take: 1 } },
    });
    const t = await asUser(TEACHER);
    const view = await t.get(`/assessments/${past.id}`);
    expect(view.status).toBe(200);
    expect(view.body.canEncode).toBe(false);
    expect(view.body.canRequestCorrection).toBe(false);
    expect(view.body.lockReason).toContain('read-only');

    const edit = await t.put(`/assessments/${past.id}/results`).send({ entries: [{ learnerId: past.results[0].learnerId, rawScore: 1 }] });
    expect(edit.status).toBe(423);
    expect(edit.body.error.code).toBe('SCHOOL_YEAR_LOCKED');
    const corr = await t.post('/correction-requests').send({ assessmentResultId: past.results[0].id, changes: { remarks: 'x' }, reason: 'Change last year’s result' });
    expect(corr.status).toBe(423);
    const learner = await prisma.learner.findFirstOrThrow({ where: { enrolments: { some: { sectionId: teacherSection.id, isCurrent: true } } } });
    expect((await t.post('/learners/enrol-existing').send({ lrn: learner.lrn, lastName: learner.lastName, sectionId: past.sectionId })).status).toBe(423);

    // Even a direct database write is refused by the closed-year triggers.
    const id = past.results[0].id;
    await expect(prisma.$executeRaw`UPDATE "AssessmentResult" SET "rawScore" = 0 WHERE "id" = ${id}`).rejects.toThrow(/SCHOOL_YEAR_READ_ONLY/);
    await expect(prisma.assessmentResult.update({ where: { id }, data: { rawScore: 0 } })).rejects.toThrow();
    await expect(prisma.assessmentResult.delete({ where: { id } })).rejects.toThrow();
    expect((await prisma.assessmentResult.findUniqueOrThrow({ where: { id } })).rawScore).toBe(past.results[0].rawScore);
  });

  it('lets only the System Administrator change school-year status, along allowed transitions', async () => {
    const past = await prisma.schoolYear.findFirstOrThrow({ where: { status: 'CLOSED' } });
    for (const email of [TEACHER, PRINCIPAL, 'admin@equaart.local']) {
      expect((await (await asUser(email)).post(`/reference/school-years/${sy.id}/status`).send({ status: 'CLOSING' })).status).toBe(403);
    }
    const ict = await asUser(ICT);
    const back = await ict.post(`/reference/school-years/${past.id}/status`).send({ status: 'OPEN' });
    expect(back.status).toBe(409);
    expect(back.body.error.details.allowed).toEqual(['ARCHIVED']);
    expect((await ict.post(`/reference/school-years/${sy.id}/status`).send({ status: 'CLOSED' })).status).toBe(409); // must pass CLOSING
    expect((await (await asUser('admin@equaart.local')).put(`/reference/school-years/${past.id}`).send({ isCurrent: true })).status).toBe(409);
  });

  it('allows only finalization while CLOSING and refuses to close with unfinished records', async () => {
    const ict = await asUser(ICT);
    const t = await asUser(TEACHER);
    const closing = await ict.post(`/reference/school-years/${sy.id}/status`).send({ status: 'CLOSING', note: 'End-of-year validation window' });
    expect(closing.status).toBe(200);
    expect(closing.body.status).toBe('CLOSING');
    try {
      const draft = await prisma.assessment.findFirstOrThrow({ where: { sectionId: teacherSection.id, status: 'DRAFT', schoolYearId: sy.id, results: { some: {} } }, include: { results: { take: 1 } } });
      const enc = await t.put(`/assessments/${draft.id}/results`).send({ entries: [{ learnerId: draft.results[0].learnerId, rawScore: 1 }] });
      expect(enc.status).toBe(423);
      expect(enc.body.error.message).toContain('closing');
      const crla = await prisma.assessmentType.findUniqueOrThrow({ where: { code: 'CRLA' } });
      const fil = await prisma.learningArea.findUniqueOrThrow({ where: { code: 'FIL' } });
      const created = await t.post('/assessments').send({ assessmentTypeId: crla.id, schoolYearId: sy.id, termId: sy.terms.find((x) => x.code === 'BOSY')!.id, sectionId: teacherSection.id, learningAreaId: fil.id });
      expect(created.status).toBe(423);
      // Submitting pending work is still possible (it fails QA here, not the year check).
      expect((await t.post(`/assessments/${draft.id}/submit`)).body.error.code).toBe('QA_FAILED');

      const close = await ict.post(`/reference/school-years/${sy.id}/status`).send({ status: 'CLOSED' });
      expect(close.status).toBe(409);
      expect(close.body.error.code).toBe('UNFINISHED_RECORDS');
      expect(close.body.error.details.assessments.DRAFT).toBeGreaterThan(0);
    } finally {
      expect((await ict.post(`/reference/school-years/${sy.id}/status`).send({ status: 'OPEN' })).status).toBe(200);
    }
    const logs = await prisma.auditLog.findMany({ where: { entity: 'SchoolYear', entityId: String(sy.id), action: 'STATUS_CHANGE' } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });
});

it('keeps the login token helper honest', async () => {
  expect(await login(TEACHER)).toBeTruthy();
  expect(as).toBeTypeOf('function');
});
