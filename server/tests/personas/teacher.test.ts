import { beforeAll, describe, expect, it } from 'vitest';
import { asUser, prisma } from '../helpers.js';
import { ACCOUNTS, BPES, teacherContext } from '../support/fixtures.js';

/**
 * Persona: a class adviser (Teacher) works through a full assessment cycle (spec §2):
 * ENROLL → ASSESS → ENCODE → VALIDATE → ANALYZE → IDENTIFY GAPS → INTERVENE → MONITOR → REASSESS.
 * Each step runs as the teacher through the API exactly as the web client does.
 */
describe('Persona · Teacher (class adviser)', () => {
  let t: Awaited<ReturnType<typeof asUser>>;
  let ctx: Awaited<ReturnType<typeof teacherContext>>;
  let learnerId: number;
  let assessmentId: number;
  let interventionId: number;

  beforeAll(async () => {
    t = await asUser(ACCOUNTS.TEACHER);
    ctx = await teacherContext();
  });

  it('signs in and sees a teacher workspace limited to their own classes', async () => {
    const me = await t.get('/me');
    expect(me.body).toMatchObject({ role: 'TEACHER', email: ACCOUNTS.TEACHER });
    expect(me.body.permissions).toEqual(expect.arrayContaining(['learner:write', 'assessment:write', 'intervention:write', 'correction:request']));
    expect(me.body.permissions).not.toContain('assessment:verify');
    const classes = await t.get(`/sections?schoolYearId=${ctx.sy.id}`);
    expect(classes.body.map((c: { id: number }) => c.id)).toContain(ctx.section.id);
    const roster = await t.get(`/sections/${ctx.section.id}`);
    expect(roster.body.roster.length).toBeGreaterThan(15);
  });

  it('registers a new learner in their class and corrects the profile', async () => {
    const created = await t.post('/learners').set('Idempotency-Key', 'persona-teacher-register-1').send({
      lrn: '999999610001', lastName: 'Bautista', firstName: 'Liza', middleName: 'Reyes', sex: 'FEMALE', birthdate: '2017-03-15', sectionId: ctx.section.id,
    });
    expect(created.status).toBe(201);
    learnerId = created.body.id;
    const fixed = await t.put(`/learners/${learnerId}`).send({ firstName: 'Liza Mae', expectedUpdatedAt: created.body.updatedAt });
    expect(fixed.status).toBe(200);
    const profile = await t.get(`/learners/${learnerId}`);
    expect(profile.body).toMatchObject({ firstName: 'Liza Mae', lrn: '999999610001' });
    expect(profile.body.enrolments[0]).toMatchObject({ isCurrent: true, section: { id: ctx.section.id } });
    expect((await t.put(`/learners/${learnerId}`).send({ lrn: '999999610002' })).status).toBe(409); // LRN is permanent
  });

  it('cannot register a learner into a colleague’s class', async () => {
    const colleague = await prisma.section.findFirstOrThrow({ where: { school: { schoolIdDeped: BPES }, schoolYearId: ctx.sy.id, adviserId: { not: ctx.user.id } } });
    const res = await t.post('/learners').send({ lrn: '999999610003', lastName: 'Ramos', firstName: 'Paolo', sex: 'MALE', sectionId: colleague.id });
    expect(res.status).toBe(403);
  });

  it('records a transfer out, then re-enrols the returning learner by LRN and last name', async () => {
    const profile = await t.get(`/learners/${learnerId}`);
    const enrolmentId = profile.body.enrolments[0].id;
    expect((await t.post(`/learners/enrolments/${enrolmentId}/end`).send({ status: 'TRANSFERRED_OUT', reason: 'Moved to Batangas' })).status).toBe(200);
    expect((await t.post('/learners/enrol-existing').send({ lrn: '999999610001', lastName: 'Wrongname', sectionId: ctx.section.id })).status).toBe(404);
    const back = await t.post('/learners/enrol-existing').send({ lrn: '999999610001', lastName: 'bautista', sectionId: ctx.section.id });
    expect(back.status).toBe(201);
    const after = await t.get(`/learners/${learnerId}`);
    expect(after.body.status).toBe('ACTIVE');
    expect(after.body.enrolments.filter((e: { isCurrent: boolean }) => e.isCurrent)).toHaveLength(1);
  });

  it('creates an end-of-term assessment, downloads the template and encodes the whole class', async () => {
    const type = await prisma.assessmentType.findUniqueOrThrow({ where: { code: 'TERM_EXAM' } });
    const terms = await prisma.term.findMany({ where: { schoolYearId: ctx.sy.id, code: { in: ['T1', 'T2', 'T3'] } } });
    const areas = await prisma.learningArea.findMany();
    let slot: { termId: number; learningAreaId: number; comps: { id: number }[] } | null = null;
    for (const term of terms) for (const la of areas) {
      if (slot) break;
      const taken = await prisma.assessment.count({ where: { sectionId: ctx.section.id, termId: term.id, learningAreaId: la.id, assessmentTypeId: type.id, deletedAt: null } });
      const comps = await prisma.competency.findMany({ where: { learningAreaId: la.id, gradeLevelId: ctx.section.gradeLevelId }, take: 2, orderBy: { code: 'asc' } });
      if (!taken && comps.length === 2) slot = { termId: term.id, learningAreaId: la.id, comps };
    }
    expect(slot).not.toBeNull();

    const created = await t.post('/assessments').send({
      assessmentTypeId: type.id, schoolYearId: ctx.sy.id, termId: slot!.termId, sectionId: ctx.section.id, learningAreaId: slot!.learningAreaId, maxScore: 20,
      assessmentDate: '2026-09-25', competencies: slot!.comps.map((c) => ({ competencyId: c.id, itemsTotal: 10 })),
    });
    expect(created.status).toBe(201);
    assessmentId = created.body.id;

    const tpl = await t.get(`/assessments/${assessmentId}/template`);
    expect(tpl.status).toBe(200);
    expect(tpl.text).toContain('999999610001');

    const detail = await t.get(`/assessments/${assessmentId}`);
    expect(detail.body.canEncode).toBe(true);
    const roster: { learner: { id: number } }[] = detail.body.rows.filter((r: { enrolled: boolean }) => r.enrolled);
    const entries = roster.map((r, i) => i === 1
      ? { learnerId: r.learner.id, isAbsent: true, remarks: 'Sick on test day' }
      : { learnerId: r.learner.id, competencies: [{ competencyId: slot!.comps[0].id, itemsCorrect: [10, 0, 3, 8][i % 4] }, { competencyId: slot!.comps[1].id, itemsCorrect: [9, 0, 4, 7][i % 4] }] });
    const saved = await t.put(`/assessments/${assessmentId}/results`).send({ entries });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toBe(roster.length);
  });

  it('runs the quality checks and submits for validation, which derives learning gaps', async () => {
    const qa = await t.get(`/assessments/${assessmentId}/qa`);
    expect(qa.body.blocking).toBe(false);
    expect(qa.body.checks.find((c: { key: string }) => c.key === 'absences').count).toBe(1);
    const sub = await t.post(`/assessments/${assessmentId}/submit`);
    expect(sub.status).toBe(200);
    expect(sub.body.gaps.created).toBeGreaterThan(0);
    expect((await t.put(`/assessments/${assessmentId}/results`).send({ entries: [] })).status).toBe(423); // locked while awaiting validation
  });

  it('cannot validate their own results; the assessment coordinator does', async () => {
    expect((await t.post(`/assessments/${assessmentId}/verify`)).status).toBe(403);
    const v = await (await asUser(ACCOUNTS.ASSESSMENT_COORDINATOR)).post(`/assessments/${assessmentId}/verify`);
    expect(v.body.status).toBe('VERIFIED');
  });

  it('sees the learning gaps and the suggested intervention groups for the class', async () => {
    const gaps = await t.get(`/gaps?assessmentId=${assessmentId}&perPage=200`);
    expect(gaps.status).toBe(200);
    expect(gaps.body.data.length).toBeGreaterThan(0);
    const groups = await t.get(`/gaps/groups?sectionId=${ctx.section.id}&schoolYearId=${ctx.sy.id}`);
    expect(groups.body.length).toBeGreaterThan(0);
    expect(groups.body[0].learners.length).toBeGreaterThan(0);
  });

  it('plans an intervention for the learners with the gap, holds a session and records attendance', async () => {
    const gaps = await prisma.learningGap.findMany({ where: { assessmentResult: { assessmentId }, competencyId: { not: null } }, take: 4 });
    const a = await prisma.assessment.findUniqueOrThrow({ where: { id: assessmentId } });
    const created = await t.post('/interventions').send({
      title: 'Small-group reteaching', sectionId: ctx.section.id, schoolYearId: ctx.sy.id, termId: a.termId, learningAreaId: a.learningAreaId,
      sourceAssessmentId: assessmentId, tier: 'TIER_3', strategy: 'Small-group reteaching with manipulatives', bannerProgram: 'SPARK', frequency: 'Twice weekly',
      startDate: '2026-10-06', targetEndDate: '2026-11-06', competencyIds: [...new Set(gaps.map((g) => g.competencyId!))],
      learners: gaps.map((g) => ({ learnerId: g.learnerId, learningGapId: g.id })).filter((x, i, arr) => arr.findIndex((y) => y.learnerId === x.learnerId) === i),
    });
    expect(created.status).toBe(201);
    interventionId = created.body.id;
    expect(created.body.learnersAdded).toBeGreaterThan(0);

    const detail = await t.get(`/interventions/${interventionId}`);
    expect(detail.body.canManage).toBe(true);
    const members: { learner: { id: number } }[] = detail.body.learners;
    const session = await t.post(`/interventions/${interventionId}/sessions`).send({
      date: '2026-10-07', topic: 'Session 1: place value', attendance: members.map((m, i) => ({ learnerId: m.learner.id, present: i !== 0 })),
    });
    expect(session.status).toBe(201);
    const after = await t.get(`/interventions/${interventionId}`);
    expect(after.body.sessions).toHaveLength(1);
    expect(after.body.learners[1].attendance).toMatchObject({ attended: 1, sessions: 1 });
  });

  it('records a reassessment and a decision for a learner, and sees the improvement', async () => {
    const detail = await t.get(`/interventions/${interventionId}`);
    const member = detail.body.learners[0];
    const re = await t.post(`/interventions/${interventionId}/learners/${member.id}/reassessments`).send({ date: '2026-11-06', rawScore: 9, maxScore: 10, notes: 'Mastered after 8 sessions' });
    expect(re.status).toBe(201);
    const decided = await t.put(`/interventions/${interventionId}/learners/${member.id}`).send({ decision: 'COMPLETE', progressNote: 'Gap closed' });
    expect(decided.body.decision).toBe('COMPLETE');
    const after = await t.get(`/interventions/${interventionId}`);
    const row = after.body.learners.find((l: { id: number }) => l.id === member.id);
    expect(row.post.percentage).toBe(90);
    expect(row.effectiveness).toBeTruthy();
    expect((await t.get('/interventions/queue/reassessment')).status).toBe(200);
  });

  it('asks for a correction of a validated result instead of editing it', async () => {
    const r = await prisma.assessmentResult.findFirstOrThrow({ where: { assessmentId, isAbsent: true } });
    const req = await t.post('/correction-requests').send({ assessmentResultId: r.id, changes: { isAbsent: false, rawScore: null, competencies: [] , remarks: 'Took make-up test' }, reason: 'Learner took the make-up test on 30 September' });
    // Changing an absence needs scores; the system explains what is missing instead of saving half a result.
    expect(req.status).toBe(400);
    const r2 = await prisma.assessmentResult.findFirstOrThrow({ where: { assessmentId, isAbsent: false }, include: { competencyResults: true } });
    const ok = await t.post('/correction-requests').send({ assessmentResultId: r2.id, changes: { remarks: 'Answer sheet re-checked' }, reason: 'Adding the re-check note to the record' });
    expect(ok.status).toBe(201);
    const mine = await t.get('/correction-requests?mine=true&status=PENDING');
    expect(mine.body.data.map((c: { id: number }) => c.id)).toContain(ok.body.id);
  });

  it('looks up a learner’s previous-year results by LRN, read-only', async () => {
    const pastEnrolment = await prisma.enrolment.findFirstOrThrow({
      where: { isCurrent: false, schoolYear: { status: 'CLOSED' }, learner: { enrolments: { some: { sectionId: ctx.section.id, isCurrent: true } }, results: { some: {} } } },
      include: { learner: true },
    });
    const search = await t.get(`/learners?search=${pastEnrolment.learner.lrn}`);
    expect(search.body.data[0].id).toBe(pastEnrolment.learnerId);
    const profile = await t.get(`/learners/${pastEnrolment.learnerId}`);
    const pastResults = profile.body.history.filter((h: { assessment: { schoolYear: { status: string } } }) => h.assessment.schoolYear.status === 'CLOSED');
    expect(pastResults.length).toBeGreaterThan(0);
    const pastAssessment = await t.get(`/assessments/${pastResults[0].assessmentId}`);
    expect(pastAssessment.body.canEncode).toBe(false);
  });

  it('uses the class dashboard and exports class and learner reports', async () => {
    const q = `schoolYearId=${ctx.sy.id}&sectionId=${ctx.section.id}`;
    expect((await t.get(`/analytics/summary?${q}`)).status).toBe(200);
    const atRisk = await t.get(`/analytics/learners-at-risk?${q}`);
    expect(atRisk.status).toBe(200);
    expect((await t.get(`/analytics/least-mastered?${q}`)).status).toBe(200);
    const xlsx = await t.get(`/reports/class?${q}&format=xlsx`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const pdf = await t.get(`/reports/learner?learnerId=${learnerId}&format=pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('is kept out of school administration and other schools', async () => {
    expect((await t.get('/users')).status).toBe(403);
    expect((await t.get('/governance/audit-logs')).status).toBe(403);
    expect((await t.post(`/reference/school-years/${ctx.sy.id}/status`).send({ status: 'CLOSING' })).status).toBe(403);
    const otherLearner = await prisma.learner.findFirstOrThrow({ where: { enrolments: { some: { section: { school: { schoolIdDeped: { not: BPES } } } } } } });
    expect((await t.get(`/learners/${otherLearner.id}`)).status).toBe(404);
  });
});
