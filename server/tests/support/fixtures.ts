import type { Role } from '@prisma/client';
import { asUser, currentSchoolYear, prisma } from '../helpers.js';

/** One seeded account per role. School-based roles all belong to Bagong Pag-asa ES (BPES). */
export const ACCOUNTS: Record<Role, string> = {
  TEACHER: 'teacher@equaart.local', // adviser, BPES Grade 3 – Sampaguita
  MASTER_TEACHER: 'mt.bpes@equaart.local',
  ASSESSMENT_COORDINATOR: 'coordinator.bpes@equaart.local',
  PRINCIPAL: 'principal.bpes@equaart.local',
  PSDS: 'psds.district2@equaart.local', // District II
  EPS: 'eps.math@equaart.local', // Mathematics only
  CHIEF_CID: 'chief.cid@equaart.local',
  DIVISION_ADMIN: 'admin@equaart.local',
  SYSTEM_ADMIN: 'ict@equaart.local',
  DPO: 'dpo@equaart.local',
};
export const ROLES = Object.keys(ACCOUNTS) as Role[];

export const BPES = '900101';
export const OTHER_SCHOOL = '900102'; // Malinis ES, District I

/** The teacher's current class and school year. */
export async function teacherContext(email = ACCOUNTS.TEACHER) {
  const sy = await currentSchoolYear();
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const section = await prisma.section.findFirstOrThrow({ where: { adviserId: user.id, schoolYearId: sy.id }, include: { gradeLevel: true } });
  return { sy, user, section };
}

/**
 * A TERM_EXAM slot (term × learning area) this class has no assessment for yet, with two
 * competencies of that grade and learning area, so a journey can create a fresh assessment.
 */
export async function freeTermExamSlot(sectionId: number) {
  const section = await prisma.section.findUniqueOrThrow({ where: { id: sectionId } });
  const type = await prisma.assessmentType.findUniqueOrThrow({ where: { code: 'TERM_EXAM' } });
  const terms = await prisma.term.findMany({ where: { schoolYearId: section.schoolYearId, code: { in: ['T1', 'T2', 'T3'] } }, orderBy: { sortOrder: 'asc' } });
  const areas = await prisma.learningArea.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  for (const term of terms) {
    for (const la of areas) {
      const taken = await prisma.assessment.count({ where: { sectionId, termId: term.id, learningAreaId: la.id, assessmentTypeId: type.id, deletedAt: null } });
      if (taken) continue;
      const comps = await prisma.competency.findMany({ where: { learningAreaId: la.id, gradeLevelId: section.gradeLevelId, isActive: true }, take: 2, orderBy: { code: 'asc' } });
      if (comps.length < 2) continue;
      return { type, term, la, comps };
    }
  }
  throw new Error(`No free TERM_EXAM slot left for section ${sectionId}`);
}

/**
 * Create a TERM_EXAM for a class, encode every enrolled learner (a third each at 95%, 75% and
 * 45%), and submit it. Returns the assessment id and the encoded roster.
 */
export async function encodeAndSubmit(teacherEmail: string, sectionId: number) {
  const t = await asUser(teacherEmail);
  const sy = await currentSchoolYear();
  const slot = await freeTermExamSlot(sectionId);
  const created = await t.post('/assessments').send({
    assessmentTypeId: slot.type.id, schoolYearId: sy.id, termId: slot.term.id, sectionId, learningAreaId: slot.la.id, maxScore: 20,
    competencies: slot.comps.map((c) => ({ competencyId: c.id, itemsTotal: 10 })),
  });
  if (created.status !== 201) throw new Error(`create assessment: ${created.status} ${JSON.stringify(created.body)}`);
  const id: number = created.body.id;
  const detail = await t.get(`/assessments/${id}`);
  const roster: { learner: { id: number } }[] = detail.body.rows.filter((r: { enrolled: boolean }) => r.enrolled);
  const entries = roster.map((r, i) => ({
    learnerId: r.learner.id,
    competencies: [
      { competencyId: slot.comps[0].id, itemsCorrect: [10, 7, 4][i % 3] },
      { competencyId: slot.comps[1].id, itemsCorrect: [9, 8, 5][i % 3] },
    ],
  }));
  const saved = await t.put(`/assessments/${id}/results`).send({ entries });
  if (saved.status !== 200) throw new Error(`encode: ${saved.status} ${JSON.stringify(saved.body)}`);
  const submitted = await t.post(`/assessments/${id}/submit`);
  if (submitted.status !== 200) throw new Error(`submit: ${submitted.status} ${JSON.stringify(submitted.body)}`);
  return { id, roster, slot };
}

/** Matches a 12-digit LRN anywhere in a JSON payload (used to prove de-identification). */
export const LRN_IN_JSON = /"\d{12}"/;
