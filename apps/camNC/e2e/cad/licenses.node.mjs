import assert from 'node:assert/strict';
import { cp, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyDistribution } from './check-distribution.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'camnc-licenses-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(fileURLToPath(new URL('../../public/licenses/', import.meta.url)), path.join(dir, 'licenses'), { recursive: true });
  await mkdir(path.join(dir, 'assets'));
  const require = createRequire(new URL('../../../../packages/cad/package.json', import.meta.url));
  const wasm = path.join(path.dirname(require.resolve('@salusoft89/planegcs')), 'planegcs_dist/planegcs.wasm');
  await copyFile(wasm, path.join(dir, 'assets/planegcs-fixture.wasm'));
  return dir;
}

test('the shipped solver assets include exact notices, full licenses, native source and matching WASM', async t => {
  const result = await verifyDistribution(await fixture(t));
  assert.equal(result.version, '1.3.0');
  assert(result.sourceFiles > 50);
});

test('a deployable build cannot silently omit the LGPL notice', async t => {
  const dir = await fixture(t);
  await rm(path.join(dir, 'licenses/planegcs/THIRD_PARTY_NOTICES.md'));
  await assert.rejects(verifyDistribution(dir), /ENOENT/);
});

test('the About page application license cannot be omitted from a deployment', async t => {
  const dir = await fixture(t);
  await rm(path.join(dir, 'licenses/camNC-Apache-2.0.txt'));
  await assert.rejects(verifyDistribution(dir), /ENOENT/);
});

test('a stale license or a replaced unrecorded native binary fails verification', async t => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, 'assets/planegcs-fixture.wasm'), 'unrecorded replacement');
  await assert.rejects(verifyDistribution(dir), /missing the licensed PlaneGCS WASM/);
  await writeFile(path.join(dir, 'licenses/planegcs/PlaneGCS-LGPL-2.1.txt'), 'incomplete license');
  await assert.rejects(verifyDistribution(dir), /Distribution checksum mismatch/);
});
