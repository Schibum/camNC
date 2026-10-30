#!/usr/bin/env node
// Downloads the pinned go2rtc release into src-tauri/binaries/, named the way Tauri expects sidecars:
// `go2rtc-<target triple>[.exe]`. Usage: `node scripts/fetch-go2rtc.mjs [target triple]` (default: this machine's).
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kVersion = 'v1.9.14';
const kBinaries = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'binaries');

/** Release asset per Rust target triple. Zipped assets contain a single `go2rtc[.exe]`. */
const kAssets = {
  'x86_64-unknown-linux-gnu': 'go2rtc_linux_amd64',
  'aarch64-unknown-linux-gnu': 'go2rtc_linux_arm64',
  'x86_64-apple-darwin': 'go2rtc_mac_amd64.zip',
  'aarch64-apple-darwin': 'go2rtc_mac_arm64.zip',
  'x86_64-pc-windows-msvc': 'go2rtc_win64.zip',
  'aarch64-pc-windows-msvc': 'go2rtc_win_arm64.zip',
};

function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  return /^host: (.+)$/m.exec(out)[1].trim();
}

async function download(asset, dest) {
  const url = `https://github.com/AlexxIT/go2rtc/releases/download/${kVersion}/${asset}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (!asset.endsWith('.zip')) {
    writeFileSync(dest, bytes);
  } else {
    const tmp = mkdtempSync(join(tmpdir(), 'go2rtc-'));
    try {
      const zip = join(tmp, asset);
      writeFileSync(zip, bytes);
      // bsdtar (macOS, Windows 10+) reads zip files. On Windows it is named by path, because Git Bash's GNU tar may come
      // first on the PATH, and it neither reads zip files nor takes `C:` paths.
      const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      execFileSync(tar, ['-xf', zip, '-C', tmp]);
      renameSync(join(tmp, asset.includes('win') ? 'go2rtc.exe' : 'go2rtc'), dest);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  chmodSync(dest, 0o755);
}

async function main() {
  const triple = process.argv[2] ?? hostTriple();
  const dest = join(kBinaries, `go2rtc-${triple}${triple.includes('windows') ? '.exe' : ''}`);
  const stamp = `${dest}.version`;
  if (existsSync(dest) && existsSync(stamp) && readFileSync(stamp, 'utf8') === kVersion) return;
  mkdirSync(kBinaries, { recursive: true });

  if (triple === 'universal-apple-darwin') {
    const parts = ['aarch64-apple-darwin', 'x86_64-apple-darwin'].map(t => join(kBinaries, `go2rtc-${t}.part`));
    await download(kAssets['aarch64-apple-darwin'], parts[0]);
    await download(kAssets['x86_64-apple-darwin'], parts[1]);
    execFileSync('lipo', ['-create', '-output', dest, ...parts]);
    parts.forEach(p => rmSync(p));
  } else {
    const asset = kAssets[triple];
    if (!asset) throw new Error(`No go2rtc build for ${triple}`);
    await download(asset, dest);
  }
  writeFileSync(stamp, kVersion);
  console.log(`go2rtc ${kVersion} -> ${dest}`);
}

await main();
