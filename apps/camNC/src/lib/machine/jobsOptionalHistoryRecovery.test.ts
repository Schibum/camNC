import { FakeFluidnc } from '@wbcnc/fluidnc/testing';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CncApi } from '@/lib/fluidnc/cnc-api';
import { useStore } from '@/store/store';
import { useCamMachine } from '@/cam/machine/camMachine';
import { interruptedJob, runningJobName, watchJobRecovery } from '@/lib/machine/jobRecovery';
import { kJobFileName, uploadAndRun } from '@/lib/machine/jobs';
import type { JobRecord } from '@/lib/machine/jobRecord';

const h = vi.hoisted(() => ({
  api: {
    async getCurrentZero() {
      return structuredClone(this.status.value.wco);
    },
    uploadGcode: vi.fn<(...args: [string, string]) => Promise<void>>(),
    runFile: vi.fn<(...args: [string]) => Promise<void>>(),
    status: { value: { state: 'Idle', mpos: { x: 12, y: 34, z: 10 }, wco: { x: 12, y: 34, z: 0 } } },
    travel: { value: null },
    host: { value: `optional-stale-${crypto.randomUUID()}.test` },
    jobStartedAt: { value: null },
    jobProgress: { value: null },
    homed: { value: true },
    zZeroedAt: { value: 1 },
  },
  saveRecord: vi.fn<(record: JobRecord) => Promise<void>>(),
  recordReads: vi.fn(),
  progressReads: vi.fn(),
}));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/machine/jobRecord', async original => {
  const actual = await original<typeof import('@/lib/machine/jobRecord')>();
  return {
    ...actual,
    saveJobRecord: h.saveRecord,
    readJobRecordHead: async (host: string, demo?: boolean) => {
      const result = await actual.readJobRecordHead(host, demo);
      h.recordReads();
      return result;
    },
    saveJobRecordAtHead: async (head: import('./jobRecord').JobRecordHead, next: JobRecord | null) => {
      if (next) await h.saveRecord(next);
      return actual.saveJobRecordAtHead(head, next);
    },
    loadJobRecord: async (host: string) => {
      const result = await actual.loadJobRecord(host);
      h.recordReads();
      return result;
    },
    loadJobProgress: async (host: string) => {
      const result = await actual.loadJobProgress(host);
      h.progressReads();
      return result;
    },
  };
});
vi.mock('@wbcnc/ui/components/sonner', () => ({
  toast: Object.assign(vi.fn(), { promise: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() }),
}));

const oldProgram = 'G21 G90\nG0 Z5\nG1 X10 F300\nM30\n';
const newProgram = 'G21 G90\nG0 Z5\nG1 X80 F300\nM30\n';
const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  h.api.uploadGcode.mockResolvedValue();
  h.api.runFile.mockResolvedValue();
  h.saveRecord.mockRejectedValue(new Error('Transient recovery-storage failure'));
  interruptedJob.value = null;
  runningJobName.value = null;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
});
afterEach(async () => {
  cleanups.splice(0).forEach(fn => fn());
  interruptedJob.value = null;
  runningJobName.value = null;
  const actual = await vi.importActual<typeof import('@/lib/machine/jobRecord')>('@/lib/machine/jobRecord');
  await actual.clearJobRecord(h.api.host.value);
});

it.each(['running', 'stopped'] as const)(
  'does not recover an older program after a newer imported start lost its optional history (%s)',
  async phase => {
    const durable = await vi.importActual<typeof import('@/lib/machine/jobRecord')>('@/lib/machine/jobRecord');
    const oldRecord: JobRecord = {
      host: h.api.host.value,
      sdFile: kJobFileName,
      gcode: oldProgram,
      toolpathName: 'Older program',
      toolpathOffset: { x: 12, y: 34, z: 0 },
      stockHeight: 12,
      toolDiameter: 3,
      wco: h.api.status.value.wco,
      startedAt: Date.now() - 60_000,
      homed: true,
      zZeroedAt: 1,
    };
    await durable.saveJobRecord(oldRecord);
    useStore.getState().updateToolpath(newProgram, 'Newer program');
    useStore.getState().setToolpathOffset(useStore.getState().toolpathOffset.clone().set(12, 34, 0));
    await expect(uploadAndRun()).resolves.toBeUndefined();
    expect(h.api.runFile).toHaveBeenCalledWith(h.api.uploadGcode.mock.calls[0][1]);
    // Simulate the view being empty after a reload. Browser storage is real and retained.
    useStore.setState(state => {
      state.toolpath = null;
      state.toolpathName = null;
    });
    runningJobName.value = null;
    if (phase === 'stopped')
      await durable.saveJobProgress({
        host: h.api.host.value,
        file: `/sd/${kJobFileName}`,
        percent: 40,
        mpos: h.api.status.value.mpos,
        wco: oldRecord.wco,
        at: Date.now(),
      });
    const fake = new FakeFluidnc('v3-81');
    fake.host = h.api.host.value;
    fake.wco = oldRecord.wco;
    fake.state = phase === 'running' ? 'Run' : 'Idle';
    fake.job = phase === 'running' ? { file: `/sd/${h.api.runFile.mock.calls.at(-1)![0]}`, percent: 40 } : null;
    const api = new CncApi(fake.WebSocket);
    cleanups.push(watchJobRecovery(api), () => api.disconnect());
    api.connect(fake.host);
    await expect.poll(() => h.recordReads.mock.calls.length).toBeGreaterThan(0);
    await expect.poll(() => h.progressReads.mock.calls.length).toBeGreaterThan(0);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    expect(useStore.getState().toolpath?.gcode ?? null).toBeNull();
    expect(interruptedJob.value).toBeNull();
    expect(runningJobName.value).toBeNull();
  }
);

it('keeps failed-write invalidation effective after the recovery storage module reloads', async () => {
  const durable = await vi.importActual<typeof import('@/lib/machine/jobRecord')>('@/lib/machine/jobRecord');
  await durable.saveJobRecord({
    host: h.api.host.value,
    sdFile: kJobFileName,
    gcode: oldProgram,
    toolpathName: 'Older program',
    toolpathOffset: { x: 12, y: 34, z: 0 },
    stockHeight: 12,
    toolDiameter: 3,
    wco: h.api.status.value.wco,
    startedAt: Date.now() - 60_000,
    homed: true,
    zZeroedAt: 1,
  });
  useStore.getState().updateToolpath(newProgram, 'Newer program');
  await expect(uploadAndRun()).resolves.toBeUndefined();
  vi.resetModules();
  const fresh = await vi.importActual<typeof import('@/lib/machine/jobRecord')>('@/lib/machine/jobRecord');
  expect(await fresh.loadJobRecord(h.api.host.value)).toBeNull();
});

it('does not invalidate existing recovery when upload fails before a new execution', async () => {
  const durable = await vi.importActual<typeof import('@/lib/machine/jobRecord')>('@/lib/machine/jobRecord');
  const previous: JobRecord = {
    host: h.api.host.value,
    sdFile: kJobFileName,
    gcode: oldProgram,
    toolpathName: 'Older program',
    toolpathOffset: { x: 12, y: 34, z: 0 },
    stockHeight: 12,
    toolDiameter: 3,
    wco: h.api.status.value.wco,
    startedAt: Date.now() - 60_000,
    homed: true,
    zZeroedAt: 1,
  };
  await durable.saveJobRecord(previous);
  useStore.getState().updateToolpath(newProgram, 'Newer program');
  h.api.uploadGcode.mockRejectedValueOnce(new Error('Upload rejected'));
  await expect(uploadAndRun()).rejects.toThrow('Upload rejected');
  expect(h.saveRecord).not.toHaveBeenCalled();
  expect(h.api.runFile).not.toHaveBeenCalled();
  expect(await durable.loadJobRecord(h.api.host.value)).toEqual(previous);
});

it('refuses execution if neither a persistent invalidation marker nor old-record deletion is available', async () => {
  useStore.getState().updateToolpath(newProgram, 'Newer program');
  const setItem = Storage.prototype.setItem;
  const marker = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.startsWith('camnc-job-recovery-invalid:')) throw new Error('Local storage unavailable');
    return setItem.call(this, key, value);
  });
  const open = vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(() => {
    throw new Error('IndexedDB unavailable');
  });
  try {
    await expect(uploadAndRun()).rejects.toThrow('Cannot start: browser storage could not safely discard');
    expect(h.api.uploadGcode).toHaveBeenCalledWith(newProgram, expect.stringMatching(/^camnc-[0-9a-f-]{36}\.gcode$/), { fresh: true });
    expect(h.api.runFile).not.toHaveBeenCalled();
  } finally {
    marker.mockRestore();
    open.mockRestore();
  }
});
