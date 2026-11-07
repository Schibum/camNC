import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = new URL('../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
const lock = parse(read('pnpm-lock.yaml'));
const require = createRequire(import.meta.url);

for (const [workflow, job] of [['ci.yml', 'test'], ['setup-smoke.yml', 'setup-smoke']]) {
  test(`${workflow}: preinstalled browsers match the locked and installed Playwright versions`, () => {
    const { container } = parse(read(`.github/workflows/${workflow}`)).jobs[job];
    const version = lock.importers['.'].devDependencies.playwright.version;
    assert.equal(container.image, `mcr.microsoft.com/playwright:v${version}-noble`);
    assert.equal(require('playwright/package.json').version, version);
    // Vitest resolves Playwright from camNC, while smoke imports it from the repo root.
    const appRequire = createRequire(new URL('apps/camNC/package.json', root));
    assert.equal(appRequire('playwright/package.json').version, version);
  });
}

test('the required Run tests check waits for every validation job and cannot hide failures', () => {
  const { jobs } = parse(read('.github/workflows/ci.yml'));
  const required = Object.values(jobs).filter(job => job.name === 'Run tests');
  assert.equal(required.length, 1, 'branch protection must have one unambiguous required check');
  const [gate] = required;
  assert.deepEqual([...gate.needs].sort(), Object.keys(jobs).filter(id => jobs[id] !== gate).sort());
  assert.equal(gate.if, 'always()');
  // An aggregate check must execute a real failure check, even when one of its dependencies fails or skips.
  for (const job of gate.needs) {
    assert(Object.values(gate.steps[0].env).includes('${{ needs.' + job + '.result }}'));
  }
});

test('the required check rejects a failed, cancelled or skipped dependency', () => {
  const gate = parse(read('.github/workflows/ci.yml')).jobs.results.steps[0];
  const allPassed = Object.fromEntries(Object.keys(gate.env).map(key => [key, 'success']));
  const run = statuses => spawnSync('bash', ['-e', '-c', gate.run], { env: { PATH: process.env.PATH, ...statuses } });
  assert.equal(run(allPassed).status, 0);
  for (const key of Object.keys(allPassed)) {
    for (const status of ['failure', 'cancelled', 'skipped']) {
      assert.notEqual(run({ ...allPassed, [key]: status }).status, 0, `${key}=${status} must fail the required check`);
    }
  }
});
