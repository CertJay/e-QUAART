// One-step local setup (no admin rights, no database server needed):
//   npm run setup            → create server/.env, create the SQLite database, load demo data
//   npm run setup -- --empty → same, but without demo data (use create-admin afterwards)
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const server = join(process.cwd(), 'server');
const envPath = join(server, '.env');
const run = (cmd) => execSync(cmd, { cwd: server, stdio: 'inherit', shell: true });

if (!existsSync(envPath)) {
  writeFileSync(
    envPath,
    [
      '# Created by npm run setup. The database is a single file: server/prisma/equaart.db',
      'DATABASE_URL="file:./equaart.db"',
      `JWT_SECRET="${randomBytes(48).toString('hex')}"`,
      'PORT=4000',
      'CORS_ORIGIN="http://localhost:5173,http://localhost:4000"',
      'COOKIE_SECURE=false',
      '',
    ].join('\n'),
  );
  console.log('Created server/.env');
} else {
  console.log('server/.env already exists; keeping it');
}
if (!readFileSync(envPath, 'utf8').includes('file:')) {
  console.error('server/.env DATABASE_URL does not point to a SQLite file (file:./something.db). Fix it and re-run.');
  process.exit(1);
}

console.log('\nCreating / updating the database…');
run('npx prisma migrate deploy');
run('npx prisma generate');

if (!process.argv.includes('--empty')) {
  console.log('\nLoading demo data (replaces anything already in the database)…');
  run('npx tsx prisma/seed.ts');
}
console.log('\nDone. Start with:  npm run dev   then open http://localhost:5173');
