#!/usr/bin/env node
// Runs turbo with its local cache in the git common dir, so every worktree of this checkout (.claude/worktrees/*)
// shares one cache: a package whose inputs a worktree didn't change replays its result instead of running again.
// An explicit TURBO_CACHE_DIR wins.
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const env = { ...process.env };
if (!env.TURBO_CACHE_DIR) {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    env.TURBO_CACHE_DIR = path.join(common, 'turbo-cache');
  } catch {
    // Not a git checkout: turbo's default .turbo/cache.
  }
}
// turbo's own launcher through node, no shell: arguments such as --filter=...^pkg reach turbo unchanged on Windows too.
const turbo = createRequire(import.meta.url).resolve('turbo/bin/turbo');
const res = spawnSync(process.execPath, [turbo, ...process.argv.slice(2)], { stdio: 'inherit', env });
if (res.error) console.error(`turbo: ${res.error.message}`);
process.exit(res.status ?? 1);
