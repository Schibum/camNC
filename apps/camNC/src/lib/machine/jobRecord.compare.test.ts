import { afterEach, expect, it } from 'vitest';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import {
  clearJobRecord,
  compareAndSaveJobRecord,
  invalidateJobRecovery,
  loadJobProgress,
  loadJobRecord,
  readJobRecordHead,
  recoveryAction,
  sameJobExecution,
  saveJobProgress,
  saveJobProgressForRecord,
  saveJobRecord,
  saveJobRecordAtHead,
  type JobRecord,
} from './jobRecord';

const hosts = new Set<string>();
const record = (host = `receipt-${crypto.randomUUID()}.test`): JobRecord => {
  hosts.add(host);
  return {
    host,
    executionId: crypto.randomUUID(),
    sdFile: 'camnc.gcode',
    gcode: 'G21\nG1 X10 F300',
    toolpathName: 'Part',
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    startedAt: 1,
    homed: true,
    zZeroedAt: 1,
  };
};
const progress = (receipt: JobRecord, percent = 40) => ({
  host: receipt.host,
  file: '/sd/camnc.gcode',
  percent,
  mpos: receipt.wco,
  wco: receipt.wco,
  at: 2,
});
afterEach(async () => {
  for (const host of hosts) {
    for (const demo of [false, true]) {
      setDemoModeForTest(demo);
      await saveJobRecord(record(host));
      await clearJobRecord(host);
    }
  }
  hosts.clear();
  setDemoModeForTest(false);
});

it.each([false, true])('does not overwrite or delete a newer identical execution in demo=%s', async demo => {
  setDemoModeForTest(demo);
  const old = record();
  const current = { ...old, executionId: crypto.randomUUID() };
  await saveJobRecord(old);
  await saveJobRecord(current);
  await saveJobProgress(progress(current, 23));
  expect(await compareAndSaveJobRecord(old, { ...old, execution: 'finished' })).toBe(false);
  expect(await compareAndSaveJobRecord(old, null)).toBe(false);
  expect(await loadJobRecord(current.host)).toEqual(current);
  expect(await loadJobProgress(current.host)).toEqual(progress(current, 23));
});

it('serializes competing receipt writes in one IndexedDB transaction', async () => {
  const initial = record();
  const a = { ...initial, executionId: crypto.randomUUID() };
  const b = { ...initial, executionId: crypto.randomUUID() };
  await saveJobRecord(initial);
  const outcomes = await Promise.all([compareAndSaveJobRecord(initial, a), compareAndSaveJobRecord(initial, b)]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(await loadJobRecord(initial.host)).toEqual(outcomes[0] ? a : b);
});

it('updates an outcome without losing progress, and deletes progress only with the matching receipt', async () => {
  const initial = record();
  await saveJobRecord(initial);
  await saveJobProgress(progress(initial));
  const finished = { ...initial, execution: 'finished' as const };
  expect(await compareAndSaveJobRecord(initial, finished)).toBe(true);
  expect(await loadJobProgress(initial.host)).toEqual(progress(initial));
  expect(await compareAndSaveJobRecord(finished, null)).toBe(true);
  expect(await loadJobRecord(initial.host)).toBeNull();
  expect(await loadJobProgress(initial.host)).toBeNull();
});

it('retains its storage namespace when demo mode changes during the write', async () => {
  const normal = record();
  await saveJobRecord(normal);
  setDemoModeForTest(true);
  const demo = { ...normal, executionId: crypto.randomUUID(), toolpathName: 'Demo' };
  await saveJobRecord(demo);
  setDemoModeForTest(false);
  const operation = compareAndSaveJobRecord(normal, { ...normal, execution: 'finished' });
  setDemoModeForTest(true);
  expect(await operation).toBe(true);
  expect(await loadJobRecord(demo.host)).toEqual(demo);
  setDemoModeForTest(false);
  expect(await loadJobRecord(normal.host)).toMatchObject({ executionId: normal.executionId, execution: 'finished' });
});

it('cannot re-enable stale recovery after a newer unrecorded execution invalidates it', async () => {
  const old = record();
  await saveJobRecord(old);
  await invalidateJobRecovery(old.host);
  expect(await compareAndSaveJobRecord(old, { ...old, execution: 'finished' })).toBe(false);
  expect(await compareAndSaveJobRecord(old, null)).toBe(false);
  expect(await loadJobRecord(old.host)).toBeNull();
  const later = { ...old, executionId: crypto.randomUUID() };
  await saveJobRecord(later);
  expect(await loadJobRecord(later.host)).toEqual(later);
});

it('never moves a receipt between controllers or equates a legacy record with a new execution', async () => {
  const original = record(),
    other = record();
  await saveJobRecord(original);
  await expect(compareAndSaveJobRecord(original, other)).rejects.toThrow('cannot change controllers');
  expect(await loadJobRecord(original.host)).toEqual(original);
  expect(sameJobExecution({ ...original, executionId: undefined }, original)).toBe(false);
  expect(sameJobExecution({ ...original }, original)).toBe(true);
});

it.each([false, true])('allows exactly one preparation to reserve an empty head in demo=%s', async demo => {
  const a = record(),
    b = { ...a, executionId: crypto.randomUUID() };
  const [first, second] = await Promise.all([readJobRecordHead(a.host, demo), readJobRecordHead(a.host, demo)]);
  const outcomes = await Promise.all([saveJobRecordAtHead(first, a), saveJobRecordAtHead(second, b)]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(await loadJobRecord(a.host, demo)).toEqual(outcomes[0] ? a : b);
});

it.each([false, true])('keeps the prior receipt and progress eligible until preparation is activated in demo=%s', async demo => {
  const original = record();
  await saveJobRecord(original, demo);
  await saveJobProgress(progress(original), demo);
  const prepared = { ...original, executionId: crypto.randomUUID(), execution: 'prepared' as const, previousRecord: original };
  expect(await saveJobRecordAtHead(await readJobRecordHead(original.host, demo), prepared)).toBe(true);
  expect(await loadJobRecord(original.host, demo)).toEqual(original);
  expect(await loadJobProgress(original.host, demo)).toEqual(progress(original));
  const reservation = await readJobRecordHead(original.host, demo);
  const requested: JobRecord = { ...prepared, execution: 'requested' };
  delete requested.previousRecord;
  expect(await saveJobRecordAtHead(reservation, requested)).toBe(true);
  expect(await saveJobRecordAtHead(reservation, original)).toBe(false);
  expect(await loadJobRecord(original.host, demo)).toEqual(requested);
});

it('keeps a prior quarantined receipt ineligible through prepare, activation and rollback', async () => {
  const old = record();
  await saveJobRecord(old);
  await invalidateJobRecovery(old.host);
  const initial = await readJobRecordHead(old.host);
  expect(initial.stored).toEqual(old);
  expect(initial.record).toBeNull();
  const prepared = { ...old, executionId: crypto.randomUUID(), execution: 'prepared' as const, previousRecord: initial.record };
  expect(await saveJobRecordAtHead(initial, prepared)).toBe(true);
  expect(await loadJobRecord(old.host)).toBeNull();
  // A failed preparation still leaves the marker in place, including after a page reload.
  const reserved = await readJobRecordHead(old.host);
  expect(reserved.marker.stored).not.toBeNull();
  const requested = { ...prepared, execution: 'requested' as const, previousRecord: undefined };
  expect(await saveJobRecordAtHead(reserved, requested)).toBe(true);
  expect(await loadJobRecord(old.host)).toEqual(requested);
  expect(await saveJobRecordAtHead(await readJobRecordHead(old.host), initial.record)).toBe(true);
  expect(await loadJobRecord(old.host)).toBeNull();
});

it('rejects a preparation captured before a newer invalidation fence', async () => {
  const old = record();
  await saveJobRecord(old);
  const head = await readJobRecordHead(old.host);
  await invalidateJobRecovery(old.host);
  expect(await saveJobRecordAtHead(head, { ...old, executionId: crypto.randomUUID() })).toBe(false);
  expect(await loadJobRecord(old.host)).toBeNull();
});

it.each([false, true])('writes progress only for the matching active raw receipt in demo=%s', async demo => {
  const a = record(),
    b = { ...a, executionId: crypto.randomUUID() };
  await saveJobRecord(a, demo);
  expect(await saveJobProgressForRecord(progress(a), a, demo)).toBe(true);
  expect(await loadJobProgress(a.host, demo)).toMatchObject({ executionId: a.executionId });
  const prepared = { ...b, execution: 'prepared' as const, previousRecord: a };
  expect(await saveJobRecordAtHead(await readJobRecordHead(a.host, demo), prepared)).toBe(true);
  expect(await saveJobProgressForRecord(progress(a, 90), a, demo)).toBe(false);
  expect(await saveJobProgressForRecord(progress(b, 20), prepared, demo)).toBe(false);
  expect(await loadJobProgress(a.host, demo)).toMatchObject({ executionId: a.executionId, percent: 40 });
  const requested = { ...b, execution: 'requested' as const };
  expect(await saveJobRecordAtHead(await readJobRecordHead(a.host, demo), requested)).toBe(true);
  expect(await saveJobProgressForRecord(progress(a, 90), a, demo)).toBe(false);
  expect(await saveJobProgressForRecord(progress(b, 20), requested, demo)).toBe(true);
  expect(await loadJobProgress(a.host, demo)).toMatchObject({ executionId: b.executionId, percent: 20 });
});

it('pins explicit read/write namespaces rather than consulting a later demo mode', async () => {
  const normal = record(),
    demo = { ...normal, executionId: crypto.randomUUID(), toolpathName: 'Demo' };
  await saveJobRecord(normal, false);
  await saveJobRecord(demo, true);
  setDemoModeForTest(true);
  const head = await readJobRecordHead(normal.host, false);
  expect(head.record).toEqual(normal);
  expect(await saveJobRecordAtHead(head, { ...normal, execution: 'finished' })).toBe(true);
  expect(await loadJobRecord(normal.host, false)).toMatchObject({ execution: 'finished' });
  expect(await loadJobRecord(normal.host, true)).toEqual(demo);
});

it('cannot resume a new dispatch from an earlier same-millisecond progress sample', () => {
  const old = record(),
    next = { ...old, executionId: crypto.randomUUID(), execution: 'requested' as const };
  const status: Parameters<typeof recoveryAction>[0]['status'] = { state: 'Idle', mpos: old.wco, wpos: old.wco, wco: old.wco };
  expect(
    recoveryAction({
      record: next,
      status,
      currentGcode: null,
      lastAlarm: null,
      progress: { ...progress(old), executionId: old.executionId },
    }).kind
  ).toBe('ended');
  expect(
    recoveryAction({
      record: next,
      status,
      currentGcode: null,
      lastAlarm: null,
      progress: { ...progress(next), executionId: next.executionId },
    }).kind
  ).toBe('interrupted');
  expect(
    recoveryAction({ record: { ...next, executionId: undefined }, status, currentGcode: null, lastAlarm: null, progress: progress(old) })
      .kind
  ).toBe('interrupted');
});

it('never treats an uploaded but unactivated preparation as evidence of an execution', () => {
  const uploaded = { ...record(), execution: 'prepared' as const };
  const status: Parameters<typeof recoveryAction>[0]['status'] = {
    state: 'Run',
    mpos: uploaded.wco,
    wpos: uploaded.wco,
    wco: uploaded.wco,
    job: { file: `/sd/${uploaded.sdFile}`, percent: 40 },
  };
  expect(recoveryAction({ record: uploaded, status, currentGcode: null, lastAlarm: null }).kind).toBe('none');
});
