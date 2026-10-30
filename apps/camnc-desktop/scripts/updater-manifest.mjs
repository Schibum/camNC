#!/usr/bin/env node
// Writes the updater manifest (`latest.json`) for a release from the signed bundles the release workflow collected.
// Usage: node scripts/updater-manifest.mjs <dir with bundles and .sig files> <version> <download base URL>
// See https://v2.tauri.app/plugin/updater/#static-json-file for the format.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Updater platform key -> the bundle the updater installs on it.
const kPlatforms = {
  'darwin-aarch64': name => name.endsWith('.app.tar.gz'),
  'windows-x86_64': name => name.endsWith('-setup.exe'),
  'linux-x86_64': name => name.endsWith('.AppImage'),
};

export function buildManifest(files, readSignature, version, baseUrl, pubDate = new Date().toISOString()) {
  const platforms = {};
  for (const [platform, matches] of Object.entries(kPlatforms)) {
    const bundle = files.find(name => matches(name) && files.includes(`${name}.sig`));
    if (!bundle) {
      console.warn(`No signed bundle for ${platform}, it gets no update.`);
      continue;
    }
    platforms[platform] = { signature: readSignature(`${bundle}.sig`).trim(), url: `${baseUrl}/${encodeURIComponent(bundle)}` };
  }
  if (Object.keys(platforms).length === 0) throw new Error('No signed bundles found');
  return { version, notes: `camNC desktop ${version}`, pub_date: pubDate, platforms };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, version, baseUrl] = process.argv.slice(2);
  if (!dir || !version || !baseUrl) {
    console.error('Usage: updater-manifest.mjs <dir> <version> <download base URL>');
    process.exit(1);
  }
  const manifest = buildManifest(readdirSync(dir), name => readFileSync(join(dir, name), 'utf8'), version, baseUrl);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
