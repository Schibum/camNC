#!/usr/bin/env node
// Gives the bundles the release workflow collected names that say which platform they are for, and writes the release
// notes with a download table.
// Usage: node scripts/release-assets.mjs <dir with bundles> <version> <commit> <download base URL> <notes file to write>
//
// The installers have no version in their name, so `releases/latest/download/<name>` always links to the newest one.
// The updater does not care about names: it finds bundles by extension (see updater-manifest.mjs) and installed apps
// download the exact URL in latest.json.
import { readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Bundle name ending -> the name it is released under. The `.sig` next to a bundle is renamed with it.
const kAssets = [
  { ext: '.dmg', name: 'camNC-macOS-AppleSilicon.dmg' },
  { ext: '.app.tar.gz', name: 'camNC-macOS-AppleSilicon-update.app.tar.gz' },
  { ext: '-setup.exe', name: 'camNC-Windows-x64-setup.exe' },
  { ext: '.deb', name: 'camNC-Linux-x64.deb' },
  { ext: '.AppImage', name: 'camNC-Linux-x64.AppImage' },
];

// The installers listed in the release notes, in this order.
const kDownloads = [
  { platform: 'Windows (64-bit)', name: 'camNC-Windows-x64-setup.exe' },
  { platform: 'macOS (Apple silicon)', name: 'camNC-macOS-AppleSilicon.dmg' },
  { platform: 'Linux (Debian, Ubuntu)', name: 'camNC-Linux-x64.deb' },
  { platform: 'Linux (other)', name: 'camNC-Linux-x64.AppImage' },
];

/** Maps each bundle file name to its release name. Files that are not bundles are left out. */
export function releaseNames(files) {
  const renames = {};
  for (const { ext, name } of kAssets) {
    const matches = files.filter(file => file.endsWith(ext));
    if (matches.length > 1) throw new Error(`More than one ${ext} bundle: ${matches.join(', ')}`);
    if (matches.length === 0) continue;
    renames[matches[0]] = name;
    if (files.includes(`${matches[0]}.sig`)) renames[`${matches[0]}.sig`] = `${name}.sig`;
  }
  return renames;
}

export function releaseNotes(names, version, commit, baseUrl) {
  const rows = kDownloads
    .filter(({ name }) => names.includes(name))
    .map(({ platform, name }) => `| ${platform} | [${name}](${baseUrl}/${name}) |`);
  const notes = [
    '## Download',
    '',
    'Pick the installer for your computer. You do not need the other files on this page; installed apps use them to update themselves.',
    '',
    '| Platform | File |',
    '| --- | --- |',
    ...rows,
    '',
  ];
  if (names.includes('camNC-macOS-AppleSilicon.dmg')) {
    notes.push(
      '### macOS: "camNC.app Not Opened"',
      '',
      'The app is not notarized by Apple yet, so macOS blocks it the first time. To open it anyway:',
      '',
      '1. Drag camNC to Applications and open it once. Click **Done** in the warning.',
      '2. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to camNC.',
      '3. Open camNC again and confirm with **Open Anyway**.',
      '',
      'Or run this in Terminal: `xattr -dr com.apple.quarantine /Applications/camNC.app`',
      '',
      'You only need to do this once. Updates install without the warning.',
      ''
    );
  }
  if (names.includes('camNC-Linux-x64.deb')) {
    notes.push(
      '### Linux',
      '',
      'Install with `sudo apt install ./camNC-Linux-x64.deb`. The .deb does not update itself; install new releases the same way.',
      ''
    );
  }
  notes.push('---', '', `camNC desktop ${version}, built from ${commit} on main. Installed apps update to this version on their own.`, '');
  return notes.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, version, commit, baseUrl, notesFile] = process.argv.slice(2);
  if (!dir || !version || !commit || !baseUrl || !notesFile) {
    console.error('Usage: release-assets.mjs <dir> <version> <commit> <download base URL> <notes file>');
    process.exit(1);
  }
  const renames = releaseNames(readdirSync(dir));
  for (const [from, to] of Object.entries(renames)) {
    console.log(`${from} -> ${to}`);
    renameSync(join(dir, from), join(dir, to));
  }
  writeFileSync(notesFile, releaseNotes(Object.values(renames), version, commit, baseUrl));
}
