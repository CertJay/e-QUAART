/**
 * Client-side mirrors of the server's field rules (server/src/domain/validation.ts). These only
 * shape the form (maxLength, date picker bounds); the API remains the authority.
 */
export const LIMITS = {
  learnerName: 80,
  extensionName: 10,
  userFullName: 120,
  position: 120,
  email: 254,
  learnerMinAge: 3,
  learnerMaxAge: 25,
} as const;

/** A fresh Idempotency-Key. `crypto.randomUUID` needs a secure context, which a LAN http server is not. */
export function requestKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto && window.isSecureContext) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Today's calendar date in the Philippines (YYYY-MM-DD), whatever the device's time zone. */
export const todayManila = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Shift a YYYY-MM-DD date by whole years; 29 February becomes 28 February in common years. */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const ny = y + years;
  const nd = m === 2 && d === 29 && !isLeap(ny) ? 28 : d;
  return `${ny}-${String(m).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

function addDays(iso: string, days: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Inclusive birthdate range for a learner aged learnerMinAge…learnerMaxAge today. */
export function learnerBirthdateBounds(today = todayManila()) {
  return { min: addDays(addYears(today, -(LIMITS.learnerMaxAge + 1)), 1), max: addYears(today, -LIMITS.learnerMinAge) };
}
