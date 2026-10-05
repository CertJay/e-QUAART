import { describe, expect, it } from 'vitest';
import {
  ageOn, birthdateField, birthdateProblems, emailField, extensionNameField, idSchema, isLeapYear, learnerNameField, LIMITS,
  MAX_ID, optionalLearnerName, parseCalendarDate, todayIso, userFullNameField,
} from '../src/domain/validation.js';

const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message;

describe('calendar dates (leap years, invalid days)', () => {
  it('applies the Gregorian leap-year rule', () => {
    expect([2024, 2000, 2400].map(isLeapYear)).toEqual([true, true, true]);
    expect([2023, 1900, 2100].map(isLeapYear)).toEqual([false, false, false]);
  });

  it('accepts 29 February only in leap years instead of rolling over to 1 March', () => {
    expect(parseCalendarDate('2024-02-29')).toMatchObject({ ok: true, iso: '2024-02-29' });
    expect(parseCalendarDate('2000-02-29')).toMatchObject({ ok: true });
    expect(parseCalendarDate('2023-02-29')).toEqual({ ok: false, message: '2023 is not a leap year: February 2023 has 28 days' });
    expect(parseCalendarDate('1900-02-29').ok).toBe(false);
  });

  it('rejects impossible days and months at each boundary', () => {
    expect(parseCalendarDate('2023-04-31')).toEqual({ ok: false, message: 'April 2023 has 30 days (got 31)' });
    expect(parseCalendarDate('2023-12-31').ok).toBe(true);
    expect(parseCalendarDate('2023-13-01').ok).toBe(false);
    expect(parseCalendarDate('2023-00-10').ok).toBe(false);
    expect(parseCalendarDate('2023-01-00').ok).toBe(false);
    expect(parseCalendarDate('1899-12-31').ok).toBe(false);
    expect(parseCalendarDate('1900-01-01').ok).toBe(true);
  });

  it('accepts MM/DD/YYYY (Philippine convention) and stored timestamps, but not other times of day', () => {
    expect(parseCalendarDate('06/10/2015')).toMatchObject({ ok: true, iso: '2015-06-10' });
    expect(parseCalendarDate('2/29/2024')).toMatchObject({ ok: true, iso: '2024-02-29' });
    expect(parseCalendarDate('2015-06-10T00:00:00.000Z')).toMatchObject({ ok: true, iso: '2015-06-10' });
    expect(parseCalendarDate('2015-06-10T00:00:00+08:00').ok).toBe(false); // would shift to 9 June in UTC
    expect(parseCalendarDate('June 10, 2015').ok).toBe(false);
    expect(parseCalendarDate(new Date('2015-06-10T00:00:00Z'))).toMatchObject({ ok: true, iso: '2015-06-10' });
    expect(parseCalendarDate(new Date('2015-06-09T16:00:00Z')).ok).toBe(false);
  });

  it('stores the calendar day at UTC midnight so it reads back the same everywhere', () => {
    const p = parseCalendarDate('2015-06-10');
    expect(p.ok && p.date.toISOString()).toBe('2015-06-10T00:00:00.000Z');
  });
});

describe('time zone', () => {
  it('uses the Philippine calendar day, not the server’s UTC day', () => {
    // 4 Oct 2026 17:30 UTC is already 5 Oct 01:30 in Manila (UTC+8).
    expect(todayIso(new Date('2026-10-04T17:30:00Z'))).toBe('2026-10-05');
    expect(todayIso(new Date('2026-10-04T15:59:59Z'))).toBe('2026-10-04');
    expect(todayIso(new Date('2026-10-04T16:00:00Z'))).toBe('2026-10-05');
  });

  it('judges "in the future" by the Manila date', () => {
    expect(birthdateProblems('2026-10-05', '2026-10-05')).not.toBe('Birthdate cannot be in the future');
    expect(birthdateProblems('2026-10-06', '2026-10-05')).toBe('Birthdate cannot be in the future');
  });
});

describe('age boundaries', () => {
  it('counts completed years, with 29 February birthdays reached on 1 March in common years', () => {
    expect(ageOn('2016-02-29', '2023-02-28')).toBe(6);
    expect(ageOn('2016-02-29', '2023-03-01')).toBe(7);
    expect(ageOn('2016-02-29', '2024-02-29')).toBe(8);
    expect(ageOn('2015-06-10', '2026-06-09')).toBe(10);
    expect(ageOn('2015-06-10', '2026-06-10')).toBe(11);
  });

  it('accepts learners exactly at the minimum and maximum age and rejects one day outside', () => {
    const today = '2026-10-05';
    expect(birthdateProblems('2023-10-05', today)).toBeNull(); // exactly 3
    expect(birthdateProblems('2023-10-06', today)).toMatch(/minimum is 3/); // 2 years, 364 days
    expect(birthdateProblems('2000-10-06', today)).toBeNull(); // 25, a day before turning 26
    expect(birthdateProblems('2000-10-05', today)).toMatch(/maximum is 25/); // turns 26 today
  });

  it('treats blank as "no birthdate" and reports the precise problem otherwise', () => {
    expect(birthdateField.parse('')).toBeNull();
    expect(birthdateField.parse(null)).toBeNull();
    expect(birthdateField.parse(undefined)).toBeUndefined();
    expect(msg(birthdateField.safeParse('2019-02-29'))).toBe('2019 is not a leap year: February 2019 has 28 days');
  });
});

describe('names and length limits', () => {
  const first = learnerNameField('First name');
  it('accepts real Filipino names and normalizes whitespace', () => {
    for (const n of ['Ma. Theresa', 'Dela Cruz-Santos', "O'Neil", 'Niño', 'José Rizal', 'Mary Grace']) expect(first.safeParse(n).success).toBe(true);
    expect(first.parse('  Juan    Carlos ')).toBe('Juan Carlos');
  });

  it('rejects numbers, symbols, stray punctuation and blanks', () => {
    expect(msg(first.safeParse('Juan2'))).toBe('First name cannot contain numbers');
    expect(msg(first.safeParse('<script>'))).toMatch(/only letters/);
    expect(msg(first.safeParse('Juan--Carlos'))).toMatch(/punctuation/);
    expect(msg(first.safeParse('-Juan'))).toMatch(/only letters/);
    expect(msg(first.safeParse('   '))).toBe('First name is required');
  });

  it('enforces the maximum length at the boundary', () => {
    expect(first.safeParse('A'.repeat(LIMITS.learnerName)).success).toBe(true);
    expect(msg(first.safeParse('A'.repeat(LIMITS.learnerName + 1)))).toBe(`First name must be at most ${LIMITS.learnerName} characters (got ${LIMITS.learnerName + 1})`);
  });

  it('treats N/A-style middle names as none and normalizes extensions', () => {
    const middle = optionalLearnerName('Middle name');
    expect(['', 'N/A', 'na', '-', null].map((v) => middle.parse(v))).toEqual([null, null, null, null, null]);
    expect(middle.parse('santos')).toBe('santos');
    expect(['jr', 'JR.', 'Sr', 'iii', 'IV'].map((v) => extensionNameField.parse(v))).toEqual(['Jr.', 'Jr.', 'Sr.', 'III', 'IV']);
    expect(extensionNameField.safeParse('Esq').success).toBe(false);
  });

  it('validates account names and emails', () => {
    expect(userFullNameField.safeParse('Dr. Elena M. Villareal').success).toBe(true);
    expect(userFullNameField.safeParse('Principal, Bagong Pag-asa Elementary School').success).toBe(true);
    expect(userFullNameField.safeParse('Al').success).toBe(false);
    expect(emailField.parse('  Juan.Cruz@DepEd.gov.ph ')).toBe('juan.cruz@deped.gov.ph');
    expect(emailField.safeParse(`${'a'.repeat(65)}@deped.gov.ph`).success).toBe(false);
    expect(emailField.safeParse(`a@${'b'.repeat(250)}.ph`).success).toBe(false);
    expect(emailField.safeParse('not-an-email').success).toBe(false);
  });

  it('rejects ids outside the 32-bit range', () => {
    expect(idSchema.safeParse(MAX_ID).success).toBe(true);
    expect(idSchema.safeParse(MAX_ID + 1).success).toBe(false);
    expect(idSchema.safeParse(0).success).toBe(false);
    expect(idSchema.safeParse(1.5).success).toBe(false);
  });
});
