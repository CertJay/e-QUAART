import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'file:./test.db';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './tests/globalSetup.ts',
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 180000,
    env: { DATABASE_URL: TEST_DB, NODE_ENV: 'test' },
  },
});
