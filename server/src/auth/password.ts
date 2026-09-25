import { hash, verify } from '@node-rs/argon2';

export const hashPassword = (plain: string) => hash(plain, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (hashed: string, plain: string) => verify(hashed, plain).catch(() => false);

/** Returns a list of unmet requirements (empty = acceptable). */
export function passwordProblems(pw: string, email?: string): string[] {
  const problems: string[] = [];
  if (pw.length < 10) problems.push('at least 10 characters');
  if (!/[a-z]/.test(pw)) problems.push('a lowercase letter');
  if (!/[A-Z]/.test(pw)) problems.push('an uppercase letter');
  if (!/[0-9]/.test(pw)) problems.push('a digit');
  if (email && pw.toLowerCase().includes(email.split('@')[0].toLowerCase())) problems.push('must not contain your username');
  return problems;
}
