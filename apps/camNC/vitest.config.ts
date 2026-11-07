import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig, type ViteUserConfig } from 'vitest/config';
export default defineConfig({
  // Vitest 3 still types plugins against Vite 7. Drop the cast with Vitest 4.
  // Tailwind: layout tests import the app's CSS (src/style.css).
  plugins: [react(), tailwindcss(), tsconfigPaths(), nodePolyfills()] as unknown as ViteUserConfig['plugins'],
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
      'react-timeago-i18n',
      '@radix-ui/react-tabs',
      'react-hotkeys-hook',
      '@wbcnc/ui > @radix-ui/react-popover',
      '@wbcnc/ui > @radix-ui/react-dropdown-menu',
      // Include lazy UI and renderer imports before browser test pages begin.
      '@radix-ui/react-dialog',
      '@wbcnc/ui > @radix-ui/react-select',
      '@radix-ui/react-label',
      '@react-three/fiber',
      '@react-three/drei',
      'occt-import-js',
      'three/examples/jsm/utils/BufferGeometryUtils.js',
      // Only a dependency of @wbcnc/cam, so not resolvable from here by its bare name: unresolved, Vite discovers it
      // mid-run and reloads the page, failing whichever test file is running.
      '@wbcnc/cam > clipper2-ts',
    ],
  },
  test: {
    // Root tests run these CPU-sensitive gates afterwards, without competing suites or packages.
    testNamePattern: /^(?!.*\[performance\]).*$/,
    globals: false,
    // CAD WASM workers and WebGL simulations share the GPU/process budget with each browser test page.
    // Keep parallel coverage without flooding the renderer with one page per available CPU thread.
    maxWorkers: 4,
    // Worker tests run in workerd, see vitest.worker.config.ts.
    exclude: ['**/node_modules/**', 'worker/**'],
    setupFiles: ['src/test/isolateIndexedDb.ts'],
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

  server: {
    preTransformRequests: false,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
