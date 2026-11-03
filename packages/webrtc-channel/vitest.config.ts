/// <reference types="@vitest/browser/providers/playwright" />
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: false,
    // environment: 'jsdom',
    // opencv tests don't seem to work with jsdom as setup right now.
    browser: {
      screenshotFailures: false,
      enabled: true,
      headless: true,
      provider: 'playwright',
      // Mock keychain: otherwise macOS asks for "Chromium Safe Storage" access on every run.
      instances: [{ browser: 'chromium', launch: { args: ['--use-mock-keychain', '--password-store=basic'] } }],
    },
  },
});
