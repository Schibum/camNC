#!/usr/bin/env node
// Claude Code PostToolUse hook: auto-format files the agent edits with Prettier.
//
// This is the "agent hook" half of the formatting automation (the git
// pre-commit hook via simple-git-hooks + nano-staged is the other half). It
// keeps the working tree formatted as the agent works so unformatted code can
// never reach a commit / CI, without relying on instructions in AGENTS.md.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let filePath;
try {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  filePath = payload?.tool_input?.file_path;
} catch {
  // No / invalid hook payload on stdin — nothing to do.
}

// Only format file types covered by the repo's Prettier config.
if (filePath && /\.(ts|tsx|md)$/.test(filePath)) {
  try {
    // --ignore-unknown + .prettierignore keep generated files (e.g. routeTree.gen.ts) untouched.
    execFileSync('pnpm', ['exec', 'prettier', '--write', '--ignore-unknown', filePath], { stdio: 'ignore' });
  } catch {
    // Never block the agent on a formatting failure.
  }
}
