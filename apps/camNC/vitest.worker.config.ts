import { defineWorkersProject, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import path from 'node:path';

export default defineWorkersProject(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  return {
    test: {
      name: 'worker',
      include: ['worker/**/*.test.ts'],
      setupFiles: ['worker/test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          main: './worker/index.ts',
          // Not using wrangler.jsonc, its assets directory only exists after a build.
          miniflare: {
            compatibilityDate: '2026-03-01',
            d1Databases: ['DB'],
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
