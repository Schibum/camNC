import { signal } from '@preact/signals-react';
import { waitFor } from '@testing-library/react';
import type { MachineStatus } from '@wbcnc/fluidnc';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import type { CncApi } from '../fluidnc/cnc-api';
import type { JobProgressLog, JobRecord } from './jobRecord';
import { interruptedJob, recoveryPending, runningJobName, watchJobRecovery } from './jobRecovery';

const h = vi.hoisted(() => ({
  api: null as unknown as CncApi,
  demo: false,
  load: vi.fn<(host: string) => Promise<JobRecord | null>>(),
  history: vi.fn().mockResolvedValue(undefined),
  progress: vi.fn<(progress: JobProgressLog) => Promise<void>>().mockResolvedValue(undefined),
  receipt: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/fluidnc/machine', () => ({ getExistingCncApi: () => h.api, getCncApi: () => h.api }));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => h.api }));
vi.mock('../demo/demo-mode', () => ({ isDemoMode: () => h.demo }));
vi.mock('@/cam/machine/nativeRunHistory', () => ({
  recordNativeRun: h.history,
}));
vi.mock('./jobRecord', async original => ({
  ...(await original<typeof import('./jobRecord')>()),
  loadJobRecord: h.load,
  readJobRecordHead: async (host: string, demo: boolean) => {
    const record = await h.load(host);
    return { host, demo, stored: record, record, marker: { readable: true, stored: null, memory: undefined } };
  },
  loadJobProgress: async () => null,
  saveJobProgress: h.progress,
  saveJobProgressForRecord: async (progress: JobProgressLog) => {
    await h.progress(progress);
    return true;
  },
  compareAndSaveJobRecord: h.receipt,
}));
vi.mock('@wbcnc/ui/components/sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn() }),
}));

let dispose: (() => void) | undefined;
let clock = 10_000;
beforeEach(() => {
  h.demo = false;
  clock = 10_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  h.load.mockReset();
  h.history.mockClear();
  h.progress.mockClear();
  h.receipt.mockClear();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  interruptedJob.value = null;
  recoveryPending.value = false;
  runningJobName.value = null;
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  interruptedJob.value = null;
  recoveryPending.value = false;
  runningJobName.value = null;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

function status(running: boolean): MachineStatus {
  return {
    state: running ? 'Run' : 'Idle',
    wco: { x: 0, y: 0, z: 0 },
    mpos: { x: 5, y: 5, z: -1 },
    ...(running && { job: { file: '/sd/camnc.gcode', percent: 40 } }),
  } as MachineStatus;
}
function record(host: string): JobRecord {
  const gcode = 'G21\nG1 X10 F300';
  return {
    host,
    executionId: 'execution-A',
    startedAt: 1,
    sdFile: 'camnc.gcode',
    gcode,
    toolpathName: 'Native A',
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    homed: true,
    zZeroedAt: 1,
    execution: 'requested',
    camSnapshot: {
      jobId: 'native-A',
      sourceKey: 'native-A:cad:1',
      designRevision: 1,
      active: 'board:bit:0',
      doneId: 'program-A',
      gcode,
      queue: [],
      parts: [],
      instances: [],
      nestBit: 3,
      overlay: null,
    },
  };
}
async function runningA() {
  const saved = record('controller-A.test');
  h.load.mockImplementation(async host => (host === saved.host && !h.demo ? saved : null));
  h.api = {
    host: signal(saved.host),
    isConnected: signal(true),
    status: signal<MachineStatus | null>(status(true)),
    jobStartedAt: signal<number | null>(1),
    jobProgress: signal<number | null>(40),
    lastAlarm: signal(null),
    homed: signal(true),
    zZeroedAt: signal<number | null>(1),
  } as unknown as CncApi;
  dispose = watchJobRecovery(h.api);
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  await waitFor(() => expect(h.progress).toHaveBeenCalled());
  h.progress.mockClear();
  h.history.mockClear();
  return saved;
}
const settleCallbacks = () => new Promise(resolve => setTimeout(resolve, 0));

it('does not save progress for controller B using controller A’s observed receipt with the same SD file and WCO', async () => {
  await runningA();
  clock += 3_000;
  h.api.host.value = 'controller-B.test';
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  await settleCallbacks();
  expect(h.progress).not.toHaveBeenCalled();
});

it('does not settle controller A’s native execution when controller B reports Idle after the same SD file and WCO', async () => {
  await runningA();
  h.api.host.value = 'controller-B.test';
  h.api.status.value = status(false);
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  await settleCallbacks();
  expect(h.history).not.toHaveBeenCalled();
  expect(h.receipt).not.toHaveBeenCalled();
});

it('rediscovers and discards the old observed execution when the same controller switches from normal storage to demo', async () => {
  await runningA();
  h.load.mockClear();
  h.demo = true;
  clock += 3_000;
  h.api.status.value = status(true);
  await settleCallbacks();
  expect(h.load).toHaveBeenCalledWith('controller-A.test');
  expect(h.progress).not.toHaveBeenCalled();
  h.api.status.value = status(false);
  await settleCallbacks();
  expect(h.history).not.toHaveBeenCalled();
  expect(h.receipt).not.toHaveBeenCalled();
});
