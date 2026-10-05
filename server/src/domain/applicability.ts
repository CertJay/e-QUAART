/** Kindergarten grade-level code. MFAT and ECCD apply only here (spec §3.5). */
export const KINDERGARTEN = 'K';

/**
 * Whether an assessment type applies to a grade level (spec §3.5). A type lists the grade codes
 * it covers; with no list it covers every grade except Kindergarten, which only gets the
 * instruments explicitly configured for it.
 */
export function assessmentApplies(applicableGrades: unknown, gradeCode: string): boolean {
  if (Array.isArray(applicableGrades) && applicableGrades.length > 0) return applicableGrades.includes(gradeCode);
  return gradeCode !== KINDERGARTEN;
}
