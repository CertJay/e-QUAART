import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../db.js';
import { forbidden } from '../lib/errors.js';

export type ScopeLevel = 'SECTION' | 'SCHOOL' | 'DISTRICT' | 'DIVISION' | 'NONE';

/**
 * The data a user may see. `null` means "no restriction on this axis".
 * Every data-returning query must be filtered through one of the helpers below.
 */
export interface DataScope {
  userId: number;
  role: Role;
  level: ScopeLevel;
  schoolIds: number[] | null;
  sectionIds: number[] | null;
  learningAreaIds: number[] | null;
  /** May see identifiable learner-level information (names, LRN, individual scores). */
  learnerLevel: boolean;
}

const SCHOOL_ROLES: Role[] = ['MASTER_TEACHER', 'ASSESSMENT_COORDINATOR', 'PRINCIPAL'];
const DIVISION_ROLES: Role[] = ['EPS', 'CHIEF_CID', 'DIVISION_ADMIN'];

export async function resolveScope(userId: number, role: Role): Promise<DataScope> {
  const scopes = await prisma.userScope.findMany({ where: { userId } });
  const base = { userId, role };

  if (role === 'SYSTEM_ADMIN' || role === 'DPO') {
    return { ...base, level: 'NONE', schoolIds: [], sectionIds: [], learningAreaIds: [], learnerLevel: false };
  }

  if (role === 'TEACHER') {
    const [advised, assigned] = await Promise.all([
      prisma.section.findMany({ where: { adviserId: userId }, select: { id: true, schoolId: true } }),
      prisma.sectionTeacher.findMany({ where: { userId }, select: { section: { select: { id: true, schoolId: true } } } }),
    ]);
    const sections = [...advised, ...assigned.map((a) => a.section)];
    const explicitSections = scopes.filter((s) => s.scopeType === 'SECTION' && s.sectionId).map((s) => s.sectionId!);
    const sectionIds = [...new Set([...sections.map((s) => s.id), ...explicitSections])];
    const schoolIds = [
      ...new Set([...sections.map((s) => s.schoolId), ...scopes.filter((s) => s.schoolId).map((s) => s.schoolId!)]),
    ];
    return { ...base, level: 'SECTION', schoolIds, sectionIds, learningAreaIds: null, learnerLevel: true };
  }

  if (SCHOOL_ROLES.includes(role)) {
    const schoolIds = scopes.filter((s) => s.scopeType === 'SCHOOL' && s.schoolId).map((s) => s.schoolId!);
    return { ...base, level: 'SCHOOL', schoolIds, sectionIds: null, learningAreaIds: null, learnerLevel: true };
  }

  if (role === 'PSDS') {
    const districtIds = scopes.filter((s) => s.districtId).map((s) => s.districtId!);
    const schools = await prisma.school.findMany({ where: { districtId: { in: districtIds } }, select: { id: true } });
    return { ...base, level: 'DISTRICT', schoolIds: schools.map((s) => s.id), sectionIds: null, learningAreaIds: null, learnerLevel: false };
  }

  if (DIVISION_ROLES.includes(role)) {
    const las = scopes.filter((s) => s.scopeType === 'LEARNING_AREA' && s.learningAreaId).map((s) => s.learningAreaId!);
    return {
      ...base,
      level: 'DIVISION',
      schoolIds: null,
      sectionIds: null,
      // EPS are confined to their assigned learning areas; other division roles see all.
      learningAreaIds: role === 'EPS' ? las : null,
      learnerLevel: false,
    };
  }
  return { ...base, level: 'NONE', schoolIds: [], sectionIds: [], learningAreaIds: [], learnerLevel: false };
}

export const hasAcademicAccess = (s: DataScope) => s.level !== 'NONE';

export function assertAcademic(s: DataScope) {
  if (!hasAcademicAccess(s)) throw forbidden('Your role does not have access to academic data');
}

export function assertLearnerLevel(s: DataScope) {
  if (!s.learnerLevel) throw forbidden('Learner-level information is not available to your role; use aggregated views');
}

/** Prisma filter for assessments inside scope. */
export function assessmentWhere(s: DataScope): Prisma.AssessmentWhereInput {
  assertAcademic(s);
  const w: Prisma.AssessmentWhereInput = { deletedAt: null };
  if (s.schoolIds) w.schoolId = { in: s.schoolIds };
  if (s.sectionIds) w.sectionId = { in: s.sectionIds };
  if (s.learningAreaIds) w.learningAreaId = { in: s.learningAreaIds };
  return w;
}

export function sectionWhere(s: DataScope): Prisma.SectionWhereInput {
  assertAcademic(s);
  const w: Prisma.SectionWhereInput = {};
  if (s.schoolIds) w.schoolId = { in: s.schoolIds };
  if (s.sectionIds) w.id = { in: s.sectionIds };
  return w;
}

/** Learners visible to the user: enrolled (at any time) in a section inside scope. */
export function learnerWhere(s: DataScope): Prisma.LearnerWhereInput {
  assertLearnerLevel(s);
  return { deletedAt: null, enrolments: { some: { section: sectionWhere(s) } } };
}

export function interventionWhere(s: DataScope): Prisma.InterventionWhereInput {
  assertAcademic(s);
  const w: Prisma.InterventionWhereInput = { deletedAt: null };
  if (s.schoolIds) w.schoolId = { in: s.schoolIds };
  if (s.sectionIds) w.OR = [{ sectionId: { in: s.sectionIds } }, { learners: { some: { learner: { enrolments: { some: { sectionId: { in: s.sectionIds }, isCurrent: true } } } } } }];
  if (s.learningAreaIds) w.learningAreaId = { in: s.learningAreaIds };
  return w;
}

export function schoolInScope(s: DataScope, schoolId: number) {
  return s.level !== 'NONE' && (s.schoolIds === null || s.schoolIds.includes(schoolId));
}

export function sectionInScope(s: DataScope, section: { id: number; schoolId: number }) {
  if (!schoolInScope(s, section.schoolId)) return false;
  return s.sectionIds === null || s.sectionIds.includes(section.id);
}

export function learningAreaInScope(s: DataScope, learningAreaId: number) {
  return s.learningAreaIds === null || s.learningAreaIds.includes(learningAreaId);
}

/** Raw-SQL conditions on an "Assessment" alias `a`. */
export function assessmentScopeSql(s: DataScope, alias = 'a'): Prisma.Sql[] {
  assertAcademic(s);
  const col = (c: string) => Prisma.raw(`${alias}."${c}"`);
  const out: Prisma.Sql[] = [Prisma.sql`${col('deletedAt')} IS NULL`];
  const inList = (c: string, ids: number[]) =>
    ids.length ? Prisma.sql`${col(c)} IN (${Prisma.join(ids)})` : Prisma.sql`FALSE`;
  if (s.schoolIds) out.push(inList('schoolId', s.schoolIds));
  if (s.sectionIds) out.push(inList('sectionId', s.sectionIds));
  if (s.learningAreaIds) out.push(inList('learningAreaId', s.learningAreaIds));
  return out;
}
