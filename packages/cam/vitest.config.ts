import { defineConfig } from 'vitest/config';

// Pure geometry + wasm: runs in Node (and later in a web worker), no browser needed.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // Loading a STEP fixture and extracting features in beforeAll takes > 10 s on a busy CI runner.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
