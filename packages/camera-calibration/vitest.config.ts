/// <reference types="@vitest/browser/providers/playwright" />
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: false,
    // OpenCV work is CPU-bound and shares CI's small runner with the other packages' suites.
    testTimeout: 60_000,
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
  // Pre-bundled up front: optimizing these on the fly reloads the test page mid-run (flaky CI timeouts).
  optimizeDeps: { include: ['@wbcnc/video-worker-utils > three', 'react-device-detect'] },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
