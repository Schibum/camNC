import { readFileSync } from 'node:fs';
import { defineConfig, mergeConfig } from 'vitest/config';
import config from './vitest.config';

// The 20 slowest files, about 84% of the suite's test time. CI always runs them.
const slowest: string[] = JSON.parse(readFileSync(new URL('./vitest.fast-excludes.json', import.meta.url), 'utf8'));

export default mergeConfig(config, defineConfig({ test: { exclude: slowest } }));
