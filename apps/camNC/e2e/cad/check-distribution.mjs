import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const canonicalDir = fileURLToPath(new URL('../../../../packages/cad/licenses/', import.meta.url));
const noticePath = fileURLToPath(new URL('../../../../packages/cad/THIRD_PARTY_NOTICES.md', import.meta.url));
const applicationLicensePath = fileURLToPath(new URL('../../../../LICENSE', import.meta.url));
const defaultDist = fileURLToPath(new URL('../../dist/', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function archivePaths(bytes) {
  const tar = gunzipSync(bytes);
  const paths = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    paths.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return paths;
}

async function wasmFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? wasmFiles(target) : entry.name.endsWith('.wasm') ? [target] : [];
  }));
  return nested.flat();
}

/** Validate the actual deployable directory, rather than just repository notices. */
export async function verifyDistribution(distDir = defaultDist) {
  const shipped = path.join(distDir, 'licenses/planegcs');
  const manifestBytes = await readFile(path.join(canonicalDir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.deepEqual(await readFile(path.join(distDir, 'licenses/camNC-Apache-2.0.txt')), await readFile(applicationLicensePath), 'Distribution application license is missing or stale');
  assert.deepEqual(await readFile(path.join(shipped, 'manifest.json')), manifestBytes, 'Distribution license manifest is stale');
  assert.deepEqual(await readFile(path.join(shipped, 'THIRD_PARTY_NOTICES.md')), await readFile(noticePath), 'Distribution solver notice is missing or stale');
  for (const [filename, expectedHash] of Object.entries(manifest.files)) {
    assert.equal(sha256(await readFile(path.join(canonicalDir, filename))), expectedHash, `Canonical checksum mismatch: ${filename}`);
    assert.equal(sha256(await readFile(path.join(shipped, filename))), expectedHash, `Distribution checksum mismatch: ${filename}`);
  }
  const source = await readFile(path.join(shipped, manifest.sourceArchive));
  assert.equal(sha256(source), manifest.sourceArchiveSha256, 'Corresponding source archive is stale');
  const members = archivePaths(source);
  for (const required of ['planegcs/GCS.cpp', 'planegcs/Constraints.cpp', 'planegcs/CMakeLists.txt', 'build-bindings/process_all.sh', 'sketch/gcs_wrapper.ts', 'planegcs_dist/gcs_system.ts', 'Dockerfile', 'LICENSE']) {
    assert(members.includes(`planegcs-1.3.0/${required}`), `Corresponding source is incomplete: ${required}`);
  }
  const require = createRequire(new URL('../../../../packages/cad/package.json', import.meta.url));
  const installedWasm = path.join(path.dirname(require.resolve('@salusoft89/planegcs')), 'planegcs_dist/planegcs.wasm');
  assert.equal(sha256(await readFile(installedWasm)), manifest.wasmSha256, 'Installed solver changed: update provenance and licenses');
  const hashes = await Promise.all((await wasmFiles(distDir)).map(async file => sha256(await readFile(file))));
  assert(hashes.includes(manifest.wasmSha256), 'Built distribution is missing the licensed PlaneGCS WASM binary');
  return { version: manifest.version, sourceFiles: members.length, licensedWasm: manifest.wasmSha256 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await verifyDistribution(process.argv[2] ? path.resolve(process.argv[2]) : defaultDist);
  console.log(`Distribution licenses verified: PlaneGCS ${result.version}, ${result.sourceFiles} source files`);
}
