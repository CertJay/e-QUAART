import type { Me, Role } from '../api/client';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  section?: string;
}

const D = { to: '/', label: 'Dashboard', icon: 'home' };
const P = (view: string, label: string, icon = 'chart') => ({ to: `/performance/${view}`, label, icon });
const I = (label = 'Interventions') => ({ to: '/interventions', label, icon: 'heart' });

const ADMIN: NavItem[] = [
  { to: '/admin/users', label: 'Users & access', icon: 'users', section: 'Administration' },
  { to: '/admin/organization', label: 'Schools & calendar', icon: 'building', section: 'Administration' },
  { to: '/admin/curriculum', label: 'Curriculum', icon: 'book', section: 'Administration' },
  { to: '/admin/assessment-config', label: 'Assessment standards', icon: 'sliders', section: 'Administration' },
  { to: '/admin/settings', label: 'System settings', icon: 'cog', section: 'Administration' },
];
const GOV: NavItem[] = [
  { to: '/governance/audit', label: 'Audit trail', icon: 'shield', section: 'Data privacy' },
  { to: '/governance/retention', label: 'Retention', icon: 'archive', section: 'Data privacy' },
  { to: '/governance/breaches', label: 'Breach register', icon: 'alert', section: 'Data privacy' },
];

export const NAV: Record<Role, NavItem[]> = {
  TEACHER: [
    D,
    { to: '/learners', label: 'Learners', icon: 'user' },
    { to: '/classes', label: 'Classes', icon: 'grid' },
    { to: '/assessments', label: 'Assessments', icon: 'clipboard' },
    P('results', 'Assessment results'),
    { to: '/gaps', label: 'Learning gaps', icon: 'target' },
    I(),
    { to: '/reassessment', label: 'Reassessment', icon: 'repeat' },
    { to: '/reports', label: 'Reports', icon: 'file' },
    { to: '/profile', label: 'Profile', icon: 'user-circle' },
  ],
  MASTER_TEACHER: [
    D,
    { to: '/learners', label: 'Learners', icon: 'user' },
    { to: '/classes', label: 'Classes', icon: 'grid' },
    { to: '/assessments', label: 'Assessments & verification', icon: 'clipboard' },
    P('school', 'School performance'),
    { to: '/gaps', label: 'Learning gaps', icon: 'target' },
    I(),
    { to: '/reassessment', label: 'Reassessment', icon: 'repeat' },
    { to: '/trends', label: 'Trends', icon: 'trend' },
    { to: '/reports', label: 'Reports', icon: 'file' },
  ],
  ASSESSMENT_COORDINATOR: [],
  PRINCIPAL: [
    D,
    P('school', 'School performance'),
    P('grade-levels', 'Grade levels', 'layers'),
    P('learning-areas', 'Learning areas', 'book'),
    { to: '/assessments', label: 'Assessments', icon: 'clipboard' },
    { to: '/gaps', label: 'Learning gaps', icon: 'target' },
    I(),
    { to: '/trends', label: 'Trends', icon: 'trend' },
    { to: '/classes', label: 'Classes', icon: 'grid' },
    { to: '/learners', label: 'Learners', icon: 'user' },
    { to: '/reports', label: 'Reports', icon: 'file' },
  ],
  EPS: [
    D,
    P('learning-areas', 'Learning area performance', 'book'),
    P('schools', 'Schools', 'building'),
    P('grade-levels', 'Grade levels', 'layers'),
    P('key-stages', 'Key stages', 'stairs'),
    P('assessments', 'Assessment results'),
    { to: '/gaps', label: 'Learning gaps', icon: 'target' },
    I('Intervention monitoring'),
    { to: '/trends', label: 'Trends', icon: 'trend' },
    { to: '/reports', label: 'Reports', icon: 'file' },
  ],
  CHIEF_CID: [
    D,
    P('division', 'Division overview', 'globe'),
    P('schools', 'School performance', 'building'),
    P('learning-areas', 'Learning areas', 'book'),
    P('key-stages', 'Key stages', 'stairs'),
    P('grade-levels', 'Grade levels', 'layers'),
    P('assessments', 'Assessment analytics'),
    { to: '/gaps', label: 'Learning gaps', icon: 'target' },
    I('Intervention analytics'),
    { to: '/trends', label: 'Trends', icon: 'trend' },
    { to: '/reports', label: 'Reports', icon: 'file' },
  ],
  PSDS: [],
  DIVISION_ADMIN: [],
  SYSTEM_ADMIN: [D, ADMIN[0], ADMIN[4], GOV[0], { to: '/profile', label: 'Profile', icon: 'user-circle' }],
  DPO: [D, ...GOV, { to: '/profile', label: 'Profile', icon: 'user-circle' }],
};
NAV.ASSESSMENT_COORDINATOR = NAV.MASTER_TEACHER;
NAV.PSDS = NAV.CHIEF_CID.map((n) => (n.to === '/performance/division' ? { ...n, label: 'District overview' } : n));
NAV.DIVISION_ADMIN = [...NAV.CHIEF_CID, ...ADMIN, ...GOV];

export const navFor = (me: Me) => NAV[me.role];

/** Is the user's view a single school (so school-level dims are pointless)? */
export const isSchoolLevel = (me: Me) => ['TEACHER', 'MASTER_TEACHER', 'ASSESSMENT_COORDINATOR', 'PRINCIPAL'].includes(me.role);
export const isLearnerLevel = (me: Me) => me.permissions.includes('learner:read');
