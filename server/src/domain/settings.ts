import { prisma } from '../db.js';

export const SETTING_DEFAULTS = {
  smallCellThreshold: { value: 5, description: 'Aggregates covering fewer learners than this are suppressed for roles without learner-level access.' },
  atRiskAlertRate: { value: 50, description: 'At-risk rate (%) at or above which a school / grade / learning area is flagged for attention.' },
  tier3AlertRate: { value: 25, description: 'Tier 3 rate (%) at or above which a school is flagged for technical assistance.' },
  completionAlertRate: { value: 80, description: 'Assessment completion (%) below which a school is flagged.' },
  coverageAlertRate: { value: 60, description: 'Intervention coverage (%) below which a school is flagged.' },
  classGapRate: { value: 40, description: 'Share of a class (%) not mastering a competency for it to count as a class-level learning gap.' },
  schoolGapSections: { value: 2, description: 'Number of classes sharing a competency gap for it to count as a school-level gap.' },
  divisionGapSchools: { value: 2, description: 'Number of schools sharing a competency gap for it to count as a division-level gap.' },
  persistentTerms: { value: 2, description: 'Consecutive terms a grade/learning-area stays above the at-risk alert rate to be flagged as persistent.' },
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = { [K in SettingKey]: number };

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.systemSetting.findMany();
  const out = Object.fromEntries(Object.entries(SETTING_DEFAULTS).map(([k, v]) => [k, v.value])) as Settings;
  for (const r of rows) if (r.key in out && typeof r.value === 'number') out[r.key as SettingKey] = r.value;
  return out;
}
