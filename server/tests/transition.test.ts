import { beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/auth/password.js';
import { asUser, currentSchoolYear, PASSWORD, prisma } from './helpers.js';

/**
 * Moving to the next school year. Uses its own small school (Grade 5 and Grade 6) and its own
 * next school year so promoting learners cannot disturb the other test files.
 */
const PRINCIPAL = 'principal.transition@equaart.local';
let fromId: number;
let toId: number;
let schoolId: number;
let g5: number[];
let g6: number[];
const qs = () => `fromSchoolYearId=${fromId}&toSchoolYearId=${toId}`;

beforeAll(async () => {
  const sy = await currentSchoolYear();
  fromId = sy.id;
  const district = await prisma.district.findFirstOrThrow();
  const school = await prisma.school.create({ data: { name: 'Transition Test Elementary School', schoolIdDeped: '900777', districtId: district.id, schoolType: 'ELEMENTARY' } });
  schoolId = school.id;
  await prisma.user.create({
    data: { email: PRINCIPAL, fullName: 'Transition Principal', role: 'PRINCIPAL', passwordHash: await hashPassword(PASSWORD), mustChangePassword: false, scopes: { create: [{ scopeType: 'SCHOOL', schoolId }] } },
  });
  const [grade5, grade6] = await Promise.all([prisma.gradeLevel.findUniqueOrThrow({ where: { code: 'G5' } }), prisma.gradeLevel.findUniqueOrThrow({ where: { code: 'G6' } })]);
  const mk = async (gradeId: number, n: number, base: number) => {
    const sec = await prisma.section.create({ data: { name: 'Acacia', schoolId, gradeLevelId: gradeId, schoolYearId: sy.id } });
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const l = await prisma.learner.create({ data: { lrn: `9997770000${base + i}`, firstName: `Learner${base + i}`, lastName: 'Transition', sex: 'FEMALE' } });
      await prisma.enrolment.create({ data: { learnerId: l.id, sectionId: sec.id, schoolYearId: sy.id } });
      ids.push(l.id);
    }
    return ids;
  };
  g5 = await mk(grade5.id, 3, 10);
  g6 = await mk(grade6.id, 2, 20);
  const next = await prisma.schoolYear.create({
    data: { label: '2030-2031', startDate: new Date('2030-06-17'), endDate: new Date('2031-04-11'), terms: { create: [{ code: 'BOSY', name: 'Beginning of School Year', sortOrder: 0 }, { code: 'T1', name: 'Term 1', sortOrder: 1 }] } },
  });
  toId = next.id;
});

describe('moving to the next school year', () => {
  it('shows the checklist in order, with who does each step and what is left', async () => {
    const p = await asUser(PRINCIPAL);
    const c = await p.get(`/transition?${qs()}`);
    expect(c.status).toBe(200);
    expect(c.body.steps.map((s: { key: string }) => s.key)).toEqual(['validate', 'closing', 'prepare', 'promote', 'current', 'close']);
    const step = (k: string) => c.body.steps.find((s: { key: string }) => s.key === k);
    expect(step('validate').done).toBe(true); // this school has no assessments
    expect(step('prepare')).toMatchObject({ done: true, owner: 'Division Administrator' });
    expect(step('promote')).toMatchObject({ done: false, canAct: true, detail: '5 learner(s) still to move' });
    expect(step('closing').canAct).toBe(false); // that one is the System Administrator's
    const sa = await (await asUser('ict@equaart.local')).get(`/transition?${qs()}`);
    expect(sa.body.steps.find((s: { key: string }) => s.key === 'closing').canAct).toBe(true);
  });

  it('proposes promotion, and completion for the school’s last grade', async () => {
    const plan = await (await asUser(PRINCIPAL)).get(`/transition/promotion?schoolId=${schoolId}&${qs()}`);
    const [c5, c6] = plan.body.classes;
    expect(c5).toMatchObject({ grade: 'Grade 5', nextGradeCode: 'G6', defaultOutcome: 'PROMOTE' });
    expect(c6).toMatchObject({ grade: 'Grade 6', defaultOutcome: 'COMPLETE' }); // the school has no Grade 7
    expect(c5.learners).toHaveLength(3);
  });

  it('moves learners as decided, creates next-year classes, and keeps their history', async () => {
    const p = await asUser(PRINCIPAL);
    const decisions = [
      { learnerId: g5[0], outcome: 'PROMOTE' }, { learnerId: g5[1], outcome: 'PROMOTE' }, { learnerId: g5[2], outcome: 'RETAIN' },
      { learnerId: g6[0], outcome: 'COMPLETE' }, { learnerId: g6[1], outcome: 'SKIP' },
    ];
    const res = await p.post('/transition/promotion').send({ schoolId, fromSchoolYearId: fromId, toSchoolYearId: toId, decisions });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ PROMOTE: 2, RETAIN: 1, COMPLETE: 1, SKIP: 1, classesCreated: 2 });

    const enrol = (learnerId: number) => prisma.enrolment.findMany({ where: { learnerId }, include: { section: { include: { gradeLevel: true } } }, orderBy: { id: 'asc' } });
    const promoted = await enrol(g5[0]);
    expect(promoted).toHaveLength(2);
    expect(promoted[0]).toMatchObject({ isCurrent: false, endReason: 'Promoted to Grade 6' });
    expect(promoted[1]).toMatchObject({ isCurrent: true, schoolYearId: toId, section: { name: 'Acacia', gradeLevel: { code: 'G6' } } });
    expect((await enrol(g5[2]))[1].section.gradeLevel.code).toBe('G5'); // retained
    const completed = await enrol(g6[0]);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ isCurrent: false, endReason: 'Completed Grade 6' });
    expect((await prisma.learner.findUniqueOrThrow({ where: { id: g6[0] } })).status).toBe('ACTIVE'); // continues to Grade 7 elsewhere
    expect((await enrol(g6[1]))[0].isCurrent).toBe(true); // decided later

    // Running it again changes nothing for learners already moved.
    const again = await p.post('/transition/promotion').send({ schoolId, fromSchoolYearId: fromId, toSchoolYearId: toId, decisions: decisions.slice(0, 3) });
    expect(again.body).toMatchObject({ PROMOTE: 0, RETAIN: 0, alreadyMoved: 3 });
    expect(await prisma.enrolment.count({ where: { learnerId: g5[0] } })).toBe(2);
    const c = await p.get(`/transition?${qs()}`);
    expect(c.body.steps.find((s: { key: string }) => s.key === 'promote').detail).toBe('1 learner(s) still to move');
  });

  it('lets only the school’s principal or coordinator move its learners', async () => {
    const body = { schoolId, fromSchoolYearId: fromId, toSchoolYearId: toId, decisions: [{ learnerId: g6[1], outcome: 'COMPLETE' }] };
    for (const email of ['teacher@equaart.local', 'principal.bpes@equaart.local']) {
      expect((await (await asUser(email)).post('/transition/promotion').send(body)).status, email).toBe(403);
    }
    expect((await (await asUser('admin@equaart.local')).post('/transition/promotion').send(body)).status).toBe(403);
  });
});
