/** Kindergarten grade-level code. MFAT and ECCD apply only here (spec §3.5). */
export const KINDERGARTEN = 'K';

/**
 * Whether an assessment type applies to a grade level (spec §3.5). A type lists the grade codes
 * it covers; with no list it covers every grade except Kindergarten, which only gets the
 * instruments explicitly configured for it.
 */
/**
 * Whether a grade takes a learning area (MATATAG subjects differ by grade: Makabansa in G1–3,
 * Music & Arts in G4–6, MAPEH in G7–10, core subjects in SHS). No list = every grade.
 */
export function learningAreaOffered(gradeLevels: unknown, gradeCode: string): boolean {
  return Array.isArray(gradeLevels) && gradeLevels.length > 0 ? gradeLevels.includes(gradeCode) : true;
}

export function assessmentApplies(applicableGrades: unknown, gradeCode: string): boolean {
  if (Array.isArray(applicableGrades) && applicableGrades.length > 0) return applicableGrades.includes(gradeCode);
  return gradeCode !== KINDERGARTEN;
}
