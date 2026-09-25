import type { Role } from '@prisma/client';

/**
 * Permission catalogue. The API enforces these on every route; the client only uses them
 * to decide what to render.
 */
export const PERMISSIONS = [
  'learner:read', // identifiable learner records within scope
  'learner:write',
  'section:write',
  'assessment:read',
  'assessment:write', // create, encode, import, submit
  'assessment:verify', // verify, return, reopen
  'analytics:read', // aggregated analytics within scope
  'gap:read',
  'intervention:read',
  'intervention:write',
  'report:export',
  'reference:write', // schools, curriculum, assessment types & classification models
  'user:manage',
  'settings:write',
  'audit:read',
  'governance:manage', // retention policies, breach register
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const schoolStaffRead: Permission[] = ['learner:read', 'assessment:read', 'analytics:read', 'gap:read', 'intervention:read', 'report:export'];
const divisionRead: Permission[] = ['analytics:read', 'gap:read', 'intervention:read', 'report:export', 'assessment:read'];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  TEACHER: [...schoolStaffRead, 'learner:write', 'section:write', 'assessment:write', 'intervention:write'],
  MASTER_TEACHER: [...schoolStaffRead, 'learner:write', 'assessment:write', 'assessment:verify', 'intervention:write'],
  ASSESSMENT_COORDINATOR: [...schoolStaffRead, 'learner:write', 'section:write', 'assessment:write', 'assessment:verify', 'intervention:write'],
  // School heads approve/verify but keep read-only access to encoded scores.
  PRINCIPAL: [...schoolStaffRead, 'section:write', 'assessment:verify'],
  PSDS: [...divisionRead],
  EPS: [...divisionRead],
  CHIEF_CID: [...divisionRead],
  DIVISION_ADMIN: [...divisionRead, 'reference:write', 'user:manage', 'settings:write', 'audit:read', 'governance:manage'],
  // ICT admin: accounts & configuration, no academic data.
  SYSTEM_ADMIN: ['user:manage', 'settings:write', 'audit:read'],
  DPO: ['audit:read', 'governance:manage'],
};

export const ROLE_LABELS: Record<Role, string> = {
  TEACHER: 'Teacher',
  MASTER_TEACHER: 'Master Teacher',
  ASSESSMENT_COORDINATOR: 'Assessment Coordinator',
  PRINCIPAL: 'School Head / Principal',
  PSDS: 'Public Schools District Supervisor',
  EPS: 'Education Program Supervisor',
  CHIEF_CID: 'Chief, Curriculum and Instruction Division',
  DIVISION_ADMIN: 'Division Administrator',
  SYSTEM_ADMIN: 'ICT / System Administrator',
  DPO: 'Data Protection Officer',
};

export const hasPermission = (role: Role, p: Permission) => ROLE_PERMISSIONS[role].includes(p);
