#!/usr/bin/env node
// Runs a command while holding a lock in the git common dir, so full test suites from different worktrees of this
// checkout take turns instead of slowing each other into timeouts. CI runners hold one suite each and skip the lock.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const isAlive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

/** The lock's owner is gone. A file with no PID yet belongs to a process between its two writes, unless it is old. */
function isStale(file, now) {
  const pid = Number(readFileSync(file, 'utf8'));
  return pid ? !isAlive(pid) : now - statSync(file).mtimeMs > 60_000;
}

/** Takes the lock if it is free or its owner is gone. Two waiters clearing a stale lock at once can both proceed: only slower. */
export function tryLock(file, pid = process.pid, now = Date.now()) {
  try {
    writeFileSync(file, String(pid), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  try {
    if (!isStale(file, now)) return false;
    rmSync(file, { force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return tryLock(file, pid, now);
}

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function lockFile() {
  if (process.env.CI) return null;
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
    return path.join(common, 'full-test.lock');
  } catch {
    return null; // Not a git checkout: nothing to share a lock with.
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = lockFile();
  if (file) {
    let told = false;
    while (!tryLock(file)) {
      if (!told) console.log(`Another full test run holds ${file}; waiting for it to finish.`);
      told = true;
      sleep(2000);
    }
    process.on('exit', () => rmSync(file, { force: true }));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(1));
  }
  const res = spawnSync(process.argv.slice(2).join(' '), { stdio: 'inherit', shell: true });
  process.exit(res.status ?? 1);
}
