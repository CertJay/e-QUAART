/**
 * Bootstrap the first Division Administrator on an empty production database.
 *   npm run create-admin -- --email admin@deped.gov.ph --name "Juan Dela Cruz" --division "SDO Cavite Province" --code SDO-CAV
 * Prints a one-time temporary password that must be changed at first sign-in.
 */
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.js';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const prisma = new PrismaClient();
const email = arg('email')?.toLowerCase();
const name = arg('name');
if (!email || !name) {
  console.error('Usage: npm run create-admin -- --email <email> --name "<full name>" [--division "<name>" --code <code> --region "<region>"]');
  process.exit(1);
}
let division = await prisma.division.findFirst();
if (!division) {
  const dName = arg('division');
  const code = arg('code');
  if (!dName || !code) {
    console.error('No division exists yet: pass --division and --code to create it.');
    process.exit(1);
  }
  division = await prisma.division.create({ data: { name: dName, code, regionName: arg('region') ?? null } });
}
const temporaryPassword = `Eq-${crypto.randomBytes(8).toString('base64url')}9a`;
const user = await prisma.user.create({
  data: {
    email,
    fullName: name,
    role: 'DIVISION_ADMIN',
    passwordHash: await hashPassword(temporaryPassword),
    mustChangePassword: true,
    scopes: { create: [{ scopeType: 'DIVISION', divisionId: division.id }] },
  },
});
await prisma.auditLog.create({ data: { action: 'CREATE', entity: 'User', entityId: String(user.id), afterJson: { email, role: 'DIVISION_ADMIN', via: 'create-admin script' } } });
console.log(`Created ${email} (Division Administrator, ${division.name}).`);
console.log(`Temporary password: ${temporaryPassword}`);
await prisma.$disconnect();
