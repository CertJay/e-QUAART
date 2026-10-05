import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, currentSchoolYear, prisma } from '../helpers.js';
import { ACCOUNTS, BPES, encodeAndSubmit } from '../support/fixtures.js';

/**
 * Personas: the school's validators and leaders. A colleague teacher submits two assessments;
 * the Master Teacher returns one and validates the other; the Assessment Coordinator manages
 * classes; the Principal monitors the school and decides a correction request.
 */
let sy: Awaited<ReturnType<typeof currentSchoolYear>>;
let colleague: { email: string; sectionId: number };
let toValidate: number;
let toReturn: number;

beforeAll(async () => {
  sy = await currentSchoolYear();
  // A BPES adviser other than the demo teacher, with a current class.
  const sec = await prisma.section.findFirstOrThrow({
    where: { school: { schoolIdDeped: BPES }, schoolYearId: sy.id, adviser: { email: { not: ACCOUNTS.TEACHER }, role: 'TEACHER' } },
    include: { adviser: true },
  });
  colleague = { email: sec.adviser!.email, sectionId: sec.id };
  toValidate = (await encodeAndSubmit(colleague.email, sec.id)).id;
  toReturn = (await encodeAndSubmit(colleague.email, sec.id)).id;
});

describe('Persona · Master Teacher (validator)', () => {
  it('finds school-wide submissions waiting for validation', async () => {
    const mt = await asUser(ACCOUNTS.MASTER_TEACHER);
    const queue = await mt.get(`/assessments?status=SUBMITTED&schoolYearId=${sy.id}&perPage=200`);
    const ids = queue.body.data.map((a: { id: number }) => a.id);
    expect(ids).toEqual(expect.arrayContaining([toValidate, toReturn]));
    const detail = await mt.get(`/assessments/${toValidate}`);
    expect(detail.body.canVerify).toBe(true);
    expect(detail.body.canEncode).toBe(true); // Master Teachers may encode for any class in their school
    expect((await mt.get(`/assessments/${toValidate}/qa`)).body.blocking).toBe(false);
  });

  it('returns an assessment with a reason, which unlocks it for the teacher', async () => {
    const mt = await asUser(ACCOUNTS.MASTER_TEACHER);
    expect((await mt.post(`/assessments/${toReturn}/return`).send({ reason: 'ok' })).status).toBe(400); // reason too short
    const ret = await mt.post(`/assessments/${toReturn}/return`).send({ reason: 'Item 7 key was wrong; please re-check the scores' });
    expect(ret.body.status).toBe('RETURNED');
    const teacher = await asUser(colleague.email);
    const detail = await teacher.get(`/assessments/${toReturn}`);
    expect(detail.body.returnReason).toContain('Item 7');
    expect(detail.body.canSubmit).toBe(true);
  });

  it('validates the other assessment, which locks it', async () => {
    const mt = await asUser(ACCOUNTS.MASTER_TEACHER);
    const v = await mt.post(`/assessments/${toValidate}/verify`);
    expect(v.body.status).toBe('VERIFIED');
    expect((await mt.post(`/assessments/${toValidate}/verify`)).status).toBe(409); // already validated
    const teacher = await asUser(colleague.email);
    expect((await teacher.put(`/assessments/${toValidate}/results`).send({ entries: [] })).status).toBe(423);
  });

  it('cannot create classes (not part of the role)', async () => {
    const mt = await asUser(ACCOUNTS.MASTER_TEACHER);
    expect((await mt.post('/sections').send({})).status).toBe(403);
  });
});

describe('Persona · Assessment Coordinator', () => {
  let sectionId: number;

  it('creates a class for the school year and assigns an adviser and a subject teacher', async () => {
    const ac = await asUser(ACCOUNTS.ASSESSMENT_COORDINATOR);
    const school = await prisma.school.findUniqueOrThrow({ where: { schoolIdDeped: BPES } });
    const g4 = await prisma.gradeLevel.findUniqueOrThrow({ where: { code: 'G4' } });
    const staff = await ac.get(`/sections/staff/${school.id}`);
    expect(staff.body.length).toBeGreaterThan(2);
    const created = await ac.post('/sections').send({ name: 'Persona Dahlia', schoolId: school.id, gradeLevelId: g4.id, schoolYearId: sy.id, adviserId: staff.body[0].id });
    expect(created.status).toBe(201);
    sectionId = created.body.id;
    const math = await prisma.learningArea.findUniqueOrThrow({ where: { code: 'MATH' } });
    expect((await ac.post(`/sections/${sectionId}/teachers`).send({ userId: staff.body[1].id, learningAreaId: math.id })).status).toBe(201);
    const detail = await ac.get(`/sections/${sectionId}`);
    expect(detail.body.adviser.id).toBe(staff.body[0].id);
    expect(detail.body.teachers).toHaveLength(1);
  });

  it('cannot create a class in another school or assign staff from another school', async () => {
    const ac = await asUser(ACCOUNTS.ASSESSMENT_COORDINATOR);
    const other = await prisma.school.findFirstOrThrow({ where: { schoolIdDeped: { not: BPES } } });
    const g4 = await prisma.gradeLevel.findUniqueOrThrow({ where: { code: 'G4' } });
    expect((await ac.post('/sections').send({ name: 'Not mine', schoolId: other.id, gradeLevelId: g4.id, schoolYearId: sy.id })).status).toBe(403);
    const outsider = await prisma.user.findFirstOrThrow({ where: { role: 'TEACHER', scopes: { some: { school: { schoolIdDeped: { not: BPES } } } } } });
    expect((await ac.post(`/sections/${sectionId}/teachers`).send({ userId: outsider.id })).status).toBe(400);
  });

  it('monitors encoding completeness for the school', async () => {
    const ac = await asUser(ACCOUNTS.ASSESSMENT_COORDINATOR);
    const completion = await ac.get(`/analytics/completion?schoolYearId=${sy.id}&dim=section`);
    expect(completion.status).toBe(200);
    expect(completion.body.length).toBeGreaterThan(0);
  });
});

describe('Persona · Principal (school head)', () => {
  it('monitors school performance by grade, class and learning area', async () => {
    const p = await asUser(ACCOUNTS.PRINCIPAL);
    const q = `schoolYearId=${sy.id}`;
    for (const dim of ['gradeLevel', 'section', 'learningArea']) {
      const res = await p.get(`/analytics/breakdown?dim=${dim}&${q}`);
      expect(res.status, dim).toBe(200);
      expect(res.body.length, dim).toBeGreaterThan(0);
    }
    expect((await p.get(`/analytics/summary?${q}`)).body).toBeTruthy();
    expect((await p.get(`/analytics/coverage?${q}`)).status).toBe(200);
    expect((await p.get(`/analytics/trend?series=learningArea`)).status).toBe(200);
  });

  it('sees which learners need intervention, school-wide, and opens any learner in the school', async () => {
    const p = await asUser(ACCOUNTS.PRINCIPAL);
    const atRisk = await p.get(`/analytics/learners-at-risk?schoolYearId=${sy.id}`);
    expect(atRisk.body.length).toBeGreaterThan(0);
    const learnerId = atRisk.body[0].learnerId ?? atRisk.body[0].learner?.id ?? atRisk.body[0].id;
    expect((await p.get(`/learners/${learnerId}`)).status).toBe(200);
  });

  it('approves a correction requested by a teacher, which updates the locked result', async () => {
    const teacher = await asUser(colleague.email);
    const r = await prisma.assessmentResult.findFirstOrThrow({ where: { assessmentId: toValidate, isAbsent: false }, include: { competencyResults: { orderBy: { competencyId: 'asc' } } } });
    const c = r.competencyResults[0];
    const newItems = c.itemsCorrect === 10 ? 9 : c.itemsCorrect + 1;
    const req = await teacher.post('/correction-requests').send({ assessmentResultId: r.id, changes: { competencies: [{ competencyId: c.competencyId, itemsCorrect: newItems }] }, reason: 'Miscounted item 3 when tallying the answer sheet' });
    expect(req.status).toBe(201);
    const p = await asUser(ACCOUNTS.PRINCIPAL);
    const queue = await p.get('/correction-requests?status=PENDING');
    expect(queue.body.data.find((x: { id: number }) => x.id === req.body.id).canReview).toBe(true);
    const decided = await p.post(`/correction-requests/${req.body.id}/decision`).send({ decision: 'APPROVE', note: 'Verified against the answer sheet' });
    expect(decided.body.status).toBe('APPROVED');
    const after = await prisma.competencyResult.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.itemsCorrect).toBe(newItems);
  });

  it('exports the school report as PDF', async () => {
    const p = await asUser(ACCOUNTS.PRINCIPAL);
    const res = await p.get(`/reports/school?schoolYearId=${sy.id}&format=pdf`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  it('views but never encodes results, and cannot manage user accounts', async () => {
    const p = await asUser(ACCOUNTS.PRINCIPAL);
    expect((await p.get(`/assessments/${toValidate}`)).status).toBe(200);
    expect((await p.put(`/assessments/${toReturn}/results`).send({ entries: [] })).status).toBe(403);
    expect((await p.post('/assessments').send({})).status).toBe(403);
    expect((await p.get('/users')).status).toBe(403);
  });
});
