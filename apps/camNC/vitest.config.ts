import react from '@vitejs/plugin-react';
import path from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [react(), tsconfigPaths(), nodePolyfills()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    include: [
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
    // These server integrations are mocked in browser tests and require Start's virtual modules.
    exclude: ['@clerk/tanstack-react-start', '@tanstack/react-start'],
  },
  test: {
    globals: false,
    // environment: 'jsdom',
    // opencv tests don't seem to work with jsdom as setup right now.
    browser: {
      screenshotFailures: false,
      enabled: true,
      headless: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
  },

  server: {
    preTransformRequests: false,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
