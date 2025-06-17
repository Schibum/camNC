import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: false,
    browser: {
      screenshotFailures: false,
      enabled: true,
      headless: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
  },
});
