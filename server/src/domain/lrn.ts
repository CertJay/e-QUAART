/** DepEd Learner Reference Numbers are 12-digit numeric identifiers. */
export const LRN_PATTERN = /^\d{12}$/;
export const normalizeLrn = (v: unknown) => String(v ?? '').replace(/[\s-]/g, '').trim();
export const isValidLrn = (v: unknown) => LRN_PATTERN.test(normalizeLrn(v));
export const maskLrn = (lrn: string) => (lrn.length >= 4 ? `${'•'.repeat(lrn.length - 4)}${lrn.slice(-4)}` : '••••');
export const learnerName = (l: { lastName: string; firstName: string; middleName?: string | null; extensionName?: string | null }) =>
  `${l.lastName}, ${l.firstName}${l.extensionName ? ` ${l.extensionName}` : ''}${l.middleName ? ` ${l.middleName[0]}.` : ''}`;
