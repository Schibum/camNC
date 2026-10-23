import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // Open WebSockets keep Durable Objects alive past a test; every test uses its own room anyway.
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { ALLOWED_ORIGINS: 'https://run.camnc.app,https://*.workers.dev' },
        },
      },
    },
  },
});
