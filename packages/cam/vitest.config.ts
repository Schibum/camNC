import { defineConfig } from 'vitest/config';

// Pure geometry + wasm: runs in Node (and later in a web worker), no browser needed.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 120_000,
  },
});
