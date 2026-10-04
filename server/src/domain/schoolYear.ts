import type { SchoolYearStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { AppError } from '../lib/errors.js';

/**
 * School-year lifecycle (spec §7.1):
 *   OPEN ─► CLOSING ─► CLOSED ─► ARCHIVED
 * CLOSING may go back to OPEN (e.g. the validation window was opened too early).
 * Nothing leaves CLOSED except to ARCHIVED: a closed year is history.
 */
export const SY_TRANSITIONS: Record<SchoolYearStatus, SchoolYearStatus[]> = {
  OPEN: ['CLOSING'],
  CLOSING: ['OPEN', 'CLOSED'],
  CLOSED: ['ARCHIVED'],
  ARCHIVED: [],
};

export const canTransition = (from: SchoolYearStatus, to: SchoolYearStatus) => SY_TRANSITIONS[from].includes(to);

/**
 * What a school year allows (spec §7.1, §7.3):
 *   encode   – create assessments, enter/import/edit results, enrol learners, manage classes
 *   finalize – submit, verify or return pending records, and request/decide corrections
 */
export type YearAction = 'encode' | 'finalize';

export function yearAllows(status: SchoolYearStatus, action: YearAction): boolean {
  if (action === 'encode') return status === 'OPEN';
  return status === 'OPEN' || status === 'CLOSING';
}

const DENIED: Record<YearAction, (label: string, status: SchoolYearStatus) => string> = {
  encode: (label, status) =>
    status === 'CLOSING'
      ? `SY ${label} is closing: only pending records can be submitted and validated. New encoding is no longer allowed.`
      : `SY ${label} is ${status.toLowerCase()} and read-only. Previous school years can be viewed but not changed.`,
  finalize: (label, status) => `SY ${label} is ${status.toLowerCase()} and read-only. Previous school years can be viewed but not changed.`,
};

export function assertYearAllows(sy: { label: string; status: SchoolYearStatus }, action: YearAction) {
  if (!yearAllows(sy.status, action)) {
    throw new AppError(423, 'SCHOOL_YEAR_LOCKED', DENIED[action](sy.label, sy.status), { schoolYearStatus: sy.status });
  }
}

/** Look up a school year by id and assert it allows the action. */
export async function assertYearIdAllows(schoolYearId: number, action: YearAction) {
  assertYearAllows(await prisma.schoolYear.findUniqueOrThrow({ where: { id: schoolYearId } }), action);
}
