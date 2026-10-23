import { defineConfig } from 'vitest/config';

// Everything in this package runs without a browser: Node has WebSocket, fetch and TextDecoder.
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
});
