import type { D1Migration } from '@cloudflare/vitest-pool-workers/config';
import type { Env } from '../index';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
