import { defineConfig, mergeConfig } from 'vitest/config';
import config from './vitest.config';

export default mergeConfig(
  config,
  defineConfig({
    test: {
      include: ['src/cam/boards.test.ts'],
      testNamePattern: /\[performance\]/,
      fileParallelism: false,
    },
  })
);
