import { execSync } from 'node:child_process';

/** Apply migrations and seed (which clears) the dedicated test database once per run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'file:./test.db';
  if (!/test/i.test(url)) throw new Error(`Refusing to reset a database whose URL does not mention "test": ${url}`);
  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'pipe' });
}
