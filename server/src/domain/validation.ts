import { z } from 'zod';

/**
 * Shared field rules for people (learners and user accounts): length limits, allowed
 * characters, calendar-correct dates in the Philippine time zone, and boundary checks.
 * Every write endpoint uses these so the same input is judged the same way everywhere.
 */

// ───────────── Boundaries ─────────────
/** Largest id the database layer accepts (Prisma `Int` is 32-bit). Bigger ids are rejected as 400, not a 500. */
export const MAX_ID = 2_147_483_647;
export const LIMITS = {
  learnerName: 80,
  extensionName: 10,
  userFullName: 120,
  position: 120,
  email: 254,
  emailLocalPart: 64,
  search: 100,
  /** Plausible learner age range (completed years, as of today). Inclusive on both ends. */
  learnerMinAge: 5,
  learnerMaxAge: 65,
  minYear: 1900,
  maxYear: 2100,
} as const;

/** Dates are calendar days in the division's time zone (UTC+8, no daylight saving). */
export const APP_TIME_ZONE = process.env.APP_TIME_ZONE ?? 'Asia/Manila';

export const idSchema = z.number().int('Must be a whole number').positive('Must be a positive id').max(MAX_ID, 'Id is out of range');
export const queryId = z.coerce.number().int().positive().max(MAX_ID).optional();

// ───────────── Text ─────────────
/** Unicode-normalize, trim and collapse internal whitespace (including non-breaking spaces). */
export const cleanText = (v: string) => v.normalize('NFC').replace(/[\s ]+/g, ' ').trim();

// Letters from any script (ñ, é, …), combining marks, spaces, hyphen, apostrophes and periods
// ("Ma. Theresa", "Dela Cruz-Santos", "O'Neil"). Must start with a letter and end with a letter or period.
const LEARNER_NAME = /^\p{L}(?:[\p{L}\p{M} .'’-]*[\p{L}\p{M}.])?$/u;
// Account names may also carry commas and parentheses ("Dr. Elena M. Villareal", "Reyes, Ana (ICT)").
const USER_NAME = /^\p{L}[\p{L}\p{M} .,'’()-]*$/u;
const REPEATED_PUNCT = /[.'’-]{2,}|\s[-'’]|[-'’]\s/u;

/** Values that mean "no middle name" in LIS exports and paper forms. */
const NONE_MARKERS = new Set(['', '-', '--', '.', 'n/a', 'na', 'none', 'nmn', 'no middle name']);

export function nameProblems(v: string, label: string, max: number, pattern = LEARNER_NAME): string | null {
  if (!v) return `${label} is required`;
  if (v.length > max) return `${label} must be at most ${max} characters (got ${v.length})`;
  if (/\d/.test(v)) return `${label} cannot contain numbers`;
  if (!pattern.test(v)) return `${label} may contain only letters, spaces, hyphens, apostrophes and periods`;
  if (REPEATED_PUNCT.test(v)) return `${label} has misplaced punctuation`;
  return null;
}

const nameSchema = (label: string, max: number, pattern = LEARNER_NAME) =>
  z.string({ error: `${label} is required` }).transform(cleanText).superRefine((v, ctx) => {
    const p = nameProblems(v, label, max, pattern);
    if (p) ctx.addIssue({ code: 'custom', message: p });
  });

export const learnerNameField = (label: string) => nameSchema(label, LIMITS.learnerName);

/** Optional name: blank and "N/A"-style markers become null. */
export const optionalLearnerName = (label: string) =>
  z.union([z.string(), z.null()]).optional().transform((v, ctx) => {
    if (v === undefined) return undefined;
    const t = v === null ? '' : cleanText(v);
    if (NONE_MARKERS.has(t.toLowerCase())) return null;
    const p = nameProblems(t, label, LIMITS.learnerName);
    if (p) {
      ctx.addIssue({ code: 'custom', message: p });
      return z.NEVER;
    }
    return t;
  });

const EXTENSIONS: Record<string, string> = { jr: 'Jr.', sr: 'Sr.', ii: 'II', iii: 'III', iv: 'IV', v: 'V', vi: 'VI', vii: 'VII', viii: 'VIII', ix: 'IX', x: 'X' };

/** Name extension, normalized to its standard spelling ("jr" → "Jr.", "iii" → "III"). */
export const extensionNameField = z.union([z.string(), z.null()]).optional().transform((v, ctx) => {
  if (v === undefined) return undefined;
  const t = v === null ? '' : cleanText(v).replace(/[.,]/g, '').toLowerCase();
  if (NONE_MARKERS.has(t)) return null;
  const std = EXTENSIONS[t];
  if (!std) {
    ctx.addIssue({ code: 'custom', message: 'Extension must be one of Jr., Sr., II, III, IV, V … X' });
    return z.NEVER;
  }
  return std;
});

export const userFullNameField = nameSchema('Full name', LIMITS.userFullName, USER_NAME).refine((v) => (v.match(/\p{L}/gu) ?? []).length >= 3, 'Full name is too short');

export const positionField = z.union([z.string(), z.null()]).optional().transform((v, ctx) => {
  if (v === undefined) return undefined;
  const t = v === null ? '' : cleanText(v);
  if (!t) return null;
  if (t.length > LIMITS.position) {
    ctx.addIssue({ code: 'custom', message: `Position must be at most ${LIMITS.position} characters` });
    return z.NEVER;
  }
  if (/[<>{}]/.test(t)) {
    ctx.addIssue({ code: 'custom', message: 'Position contains characters that are not allowed' });
    return z.NEVER;
  }
  return t;
});

export const emailField = z
  .string({ error: 'Email is required' })
  .transform((v) => cleanText(v).toLowerCase())
  .pipe(
    z.string()
      .max(LIMITS.email, `Email must be at most ${LIMITS.email} characters`)
      .email('Enter a valid email address')
      .refine((v) => v.split('@')[0].length <= LIMITS.emailLocalPart, `The part before @ must be at most ${LIMITS.emailLocalPart} characters`),
  );

export const searchField = z.string().max(LIMITS.search, `Search text must be at most ${LIMITS.search} characters`).transform(cleanText).optional();

// ───────────── Calendar dates ─────────────
export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y: number, m: number) => [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

export type DateParse = { ok: true; iso: string; date: Date } | { ok: false; message: string };

/**
 * Parse a calendar date strictly. JavaScript's `Date` silently rolls invalid days forward
 * (2023-02-29 becomes 1 March), and parses non-ISO strings in the server's local time zone,
 * so neither is used here. Accepted:
 *   YYYY-MM-DD                      (forms, API)
 *   YYYY-MM-DDT00:00:00(.000)Z      (a date already stored by this system)
 *   MM/DD/YYYY                      (Philippine convention, LIS / spreadsheet exports)
 *   a Date at UTC midnight          (spreadsheet date cells)
 * The result is stored at UTC midnight, so the same calendar day reads back everywhere.
 */
export function parseCalendarDate(v: unknown): DateParse {
  let y: number, m: number, d: number;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { ok: false, message: 'Invalid date' };
    if (v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds() || v.getUTCMilliseconds()) {
      return { ok: false, message: 'Enter a date without a time of day' };
    }
    [y, m, d] = [v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()];
  } else if (typeof v === 'string') {
    const s = v.trim();
    let mt: RegExpExecArray | null;
    if ((mt = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0{1,3})?Z)?$/.exec(s))) [y, m, d] = [+mt[1], +mt[2], +mt[3]];
    else if ((mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) [y, m, d] = [+mt[3], +mt[1], +mt[2]];
    else if (/T\d{2}:\d{2}/.test(s)) return { ok: false, message: 'Enter a date without a time of day (YYYY-MM-DD)' };
    else return { ok: false, message: 'Enter the date as YYYY-MM-DD or MM/DD/YYYY' };
  } else {
    return { ok: false, message: 'Enter the date as YYYY-MM-DD or MM/DD/YYYY' };
  }
  if (y < LIMITS.minYear || y > LIMITS.maxYear) return { ok: false, message: `Year must be between ${LIMITS.minYear} and ${LIMITS.maxYear}` };
  if (m < 1 || m > 12) return { ok: false, message: `Month must be 1–12 (got ${m})` };
  const dim = daysInMonth(y, m);
  if (d < 1 || d > dim) {
    return {
      ok: false,
      message: m === 2 && d === 29 ? `${y} is not a leap year: February ${y} has 28 days` : `${MONTHS[m - 1]} ${y} has ${dim} days (got ${d})`,
    };
  }
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return { ok: true, iso, date: new Date(`${iso}T00:00:00.000Z`) };
}

/** Today's calendar date (YYYY-MM-DD) in the division's time zone, not the server's. */
export function todayIso(now = new Date(), timeZone = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/**
 * Completed years between two calendar dates. A 29 February birthday is reached on
 * 1 March in common years (the learner is not a year older on 28 February).
 */
export function ageOn(birthIso: string, refIso: string): number {
  const [by, bm, bd] = birthIso.split('-').map(Number);
  const [ry, rm, rd] = refIso.split('-').map(Number);
  const [em, ed] = bm === 2 && bd === 29 && !isLeapYear(ry) ? [3, 1] : [bm, bd];
  return ry - by - (rm < em || (rm === em && rd < ed) ? 1 : 0);
}

export function birthdateProblems(iso: string, today = todayIso()): string | null {
  if (iso > today) return 'Birthdate cannot be in the future';
  const age = ageOn(iso, today);
  if (age < LIMITS.learnerMinAge) return `Learner would be ${age} years old; the minimum is ${LIMITS.learnerMinAge}`;
  if (age > LIMITS.learnerMaxAge) return `Learner would be ${age} years old; the maximum is ${LIMITS.learnerMaxAge}. Check the year.`;
  return null;
}

/** A strict calendar date (see parseCalendarDate), returned as a Date at UTC midnight. */
export const calendarDate = z.unknown().transform((v, ctx) => {
  const p = parseCalendarDate(v);
  if (!p.ok) {
    ctx.addIssue({ code: 'custom', message: p.message });
    return z.NEVER;
  }
  return p.date;
});

/** Optional learner birthdate: strict date, not in the future, plausible school age. */
export const birthdateField = z.unknown().optional().transform((v, ctx) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const p = parseCalendarDate(v);
  const problem = p.ok ? birthdateProblems(p.iso) : p.message;
  if (problem || !p.ok) {
    ctx.addIssue({ code: 'custom', message: problem ?? 'Invalid date' });
    return z.NEVER;
  }
  return p.date;
});

// ───────────── Concurrency ─────────────
/**
 * Optimistic concurrency token: the `updatedAt` the client last saw. When present, the update
 * only applies if the record still carries that timestamp; otherwise the API answers 409.
 */
export const expectedUpdatedAtField = z.unknown().optional().transform((v, ctx) => {
  if (v === undefined || v === null || v === '') return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'expectedUpdatedAt must be a timestamp' });
    return z.NEVER;
  }
  return d;
});
