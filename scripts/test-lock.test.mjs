import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { tryLock } from './test-lock.mjs';

const newLock = () => path.join(mkdtempSync(path.join(tmpdir(), 'test-lock-')), 'full-test.lock');
const deadPid = () => spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim();

test('the first caller takes the lock and a second waits while the owner lives', () => {
  const file = newLock();
  assert.equal(tryLock(file), true);
  assert.equal(readFileSync(file, 'utf8'), String(process.pid));
  assert.equal(tryLock(file, 12345), false);
});

test('a lock left by a dead process is taken over', () => {
  const file = newLock();
  writeFileSync(file, deadPid());
  assert.equal(tryLock(file), true);
  assert.equal(readFileSync(file, 'utf8'), String(process.pid));
});

test('a lock with no PID yet is held at first and stale after a minute', () => {
  const file = newLock();
  writeFileSync(file, '');
  assert.equal(tryLock(file), false);
  assert.equal(tryLock(file, process.pid, Date.now() + 61_000), true);
});
