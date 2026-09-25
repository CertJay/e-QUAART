import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

/**
 * SQLite settings for a small multi-user server: WAL lets readers work while one request
 * writes, and busy_timeout makes a second writer wait instead of failing immediately.
 */
export async function tuneSqlite(client: PrismaClient = prisma) {
  await client.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await client.$queryRawUnsafe('PRAGMA busy_timeout = 10000');
  await client.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
  await client.$queryRawUnsafe('PRAGMA foreign_keys = ON');
}
