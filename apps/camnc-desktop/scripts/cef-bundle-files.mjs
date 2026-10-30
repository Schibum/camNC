#!/usr/bin/env node
// The Linux and Windows bundlers of tauri-cli 3.0.0-alpha.5 copy CEF's ANGLE libraries (libEGL, libGLESv2), which CEF 154
// no longer ships, and fail without them. This puts files there before bundling: on Linux the system's GL dispatch
// libraries, which Chromium uses anyway; on Windows empty placeholders, since nothing loads them.
// Runs as Tauri's beforeBundleCommand, after cargo has downloaded CEF.
import { copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const kFiles = {
  linux: { 'libEGL.so': '/usr/lib/x86_64-linux-gnu/libEGL.so.1', 'libGLESv2.so': '/usr/lib/x86_64-linux-gnu/libGLESv2.so.2' },
  win32: { 'libEGL.dll': null, 'libGLESv2.dll': null },
};

function cefDirs() {
  if (process.env.CEF_PATH) return [process.env.CEF_PATH];
  const cache =
    process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'tauri-cef')
      : join(homedir(), '.cache', 'tauri-cef');
  if (!existsSync(cache)) return [];
  return readdirSync(cache, { withFileTypes: true })
    .filter(version => version.isDirectory())
    .flatMap(version =>
      readdirSync(join(cache, version.name), { withFileTypes: true })
        .filter(dir => dir.isDirectory() && dir.name.startsWith('cef_'))
        .map(dir => join(cache, version.name, dir.name)),
    );
}

const files = kFiles[process.platform] ?? {};
for (const dir of cefDirs()) {
  for (const [name, source] of Object.entries(files)) {
    const dest = join(dir, name);
    if (existsSync(dest)) continue;
    if (source && existsSync(source)) copyFileSync(source, dest);
    else writeFileSync(dest, '');
    console.log(`Added ${dest}${source ? ` from ${source}` : ' (placeholder)'}`);
  }
}
