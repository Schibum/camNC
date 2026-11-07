import { afterEach, expect, it, vi } from 'vitest';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import {
  clearJobRecord,
  invalidateJobRecovery,
  loadJobProgress,
  loadJobRecord,
  saveJobProgress,
  saveJobRecord,
  type JobRecord,
} from './jobRecord';

const hosts: string[] = [];
function record(host = `history-${crypto.randomUUID()}.test`): JobRecord {
  if (!hosts.includes(host)) hosts.push(host);
  return {
    host,
    sdFile: 'camnc.gcode',
    gcode: 'G21\nG1 X10 F300',
    toolpathName: 'Recorded program',
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 12,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    startedAt: 1,
    homed: true,
    zZeroedAt: 1,
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0))
    for (const demo of [false, true]) {
      setDemoModeForTest(demo);
      // A successful save is the only operation that re-enables recovery.
      await saveJobRecord(record(host));
      await clearJobRecord(host);
    }
  hosts.length = 0;
  setDemoModeForTest(false);
});

it('isolates invalidation by host and demo namespace and re-enables only a later successfully saved record', async () => {
  const normal = record(),
    other = record();
  await saveJobRecord(normal);
  await saveJobRecord(other);
  setDemoModeForTest(true);
  const demo = { ...normal, gcode: 'G21\nG1 X20 F300' };
  await saveJobRecord(demo);
  setDemoModeForTest(false);
  await invalidateJobRecovery(normal.host);
  expect(await loadJobRecord(normal.host)).toBeNull();
  expect(await loadJobRecord(other.host)).toEqual(other);
  setDemoModeForTest(true);
  expect(await loadJobRecord(normal.host)).toEqual(demo);
  await invalidateJobRecovery(normal.host);
  expect(await loadJobRecord(normal.host)).toBeNull();
  setDemoModeForTest(false);
  const saved = { ...normal, gcode: 'G21\nG1 X30 F300', startedAt: 3 };
  await saveJobRecord(saved);
  expect(await loadJobRecord(normal.host)).toEqual(saved);
  setDemoModeForTest(true);
  expect(await loadJobRecord(normal.host)).toBeNull();
  await saveJobRecord(demo);
  expect(await loadJobRecord(normal.host)).toEqual(demo);
});

it('does not re-enable stale recovery when a later IndexedDB record transaction aborts', async () => {
  const previous = record();
  await saveJobRecord(previous);
  await invalidateJobRecovery(previous.host);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore['put']>
  ) {
    const request = put.apply(this, args);
    this.transaction.abort();
    return request;
  });
  await expect(saveJobRecord({ ...previous, startedAt: 2 })).rejects.toBeDefined();
  expect(await loadJobRecord(previous.host)).toBeNull();
});

it('does not let a save already in flight clear a newer failed-start invalidation', async () => {
  const previous = record();
  await saveJobRecord(previous);
  const saving = saveJobRecord({ ...previous, startedAt: 2 });
  await invalidateJobRecovery(previous.host);
  await saving;
  expect(await loadJobRecord(previous.host)).toBeNull();
  const newer = { ...previous, startedAt: 3 };
  await saveJobRecord(newer);
  expect(await loadJobRecord(previous.host)).toEqual(newer);
});

it('deletes the old record as a durable fallback when localStorage cannot persist the marker', async () => {
  const previous = record();
  await saveJobRecord(previous);
  await saveJobProgress({ host: previous.host, file: '/sd/camnc.gcode', percent: 40, mpos: previous.wco, wco: previous.wco, at: 2 });
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.startsWith('camnc-job-recovery-invalid:')) throw new Error('Local storage unavailable');
    return setItem.call(this, key, value);
  });
  await expect(invalidateJobRecovery(previous.host)).resolves.toBeUndefined();
  vi.restoreAllMocks();
  vi.resetModules();
  const fresh = await vi.importActual<typeof import('./jobRecord')>('./jobRecord');
  expect(await fresh.loadJobRecord(previous.host)).toBeNull();
  expect(await loadJobProgress(previous.host)).toBeNull();
});

it('keeps deletion fallback in its captured normal namespace when mode changes before IndexedDB opens', async () => {
  const previous = record();
  await saveJobRecord(previous);
  setDemoModeForTest(true);
  const demo = { ...previous, toolpathName: 'Unrelated demo history' };
  await saveJobRecord(demo);
  setDemoModeForTest(false);
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.startsWith('camnc-job-recovery-invalid:')) throw new Error('Local storage unavailable');
    return setItem.call(this, key, value);
  });
  const open = IDBFactory.prototype.open;
  vi.spyOn(IDBFactory.prototype, 'open').mockImplementationOnce(function (this: IDBFactory, name: string, version?: number) {
    const request = open.call(this, name, version);
    request.addEventListener('success', () => setDemoModeForTest(true));
    return request;
  });
  await invalidateJobRecovery(previous.host);
  expect(await loadJobRecord(previous.host)).toEqual(demo);
  setDemoModeForTest(false);
  expect(await loadJobRecord(previous.host)).toBeNull();
});
