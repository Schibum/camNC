import { signal } from '@preact/signals-react';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MachineStatus } from '@wbcnc/fluidnc';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import type { CncApi } from '../fluidnc/cnc-api';
import type { JobRecord } from './jobRecord';
import { interruptedJob, recoveryPending, runningJobName, watchJobRecovery } from './jobRecovery';

const h = vi.hoisted(() => ({
  api: null as unknown as CncApi,
  load: vi.fn<() => Promise<JobRecord | null>>(),
  history: vi.fn().mockResolvedValue(undefined),
  savedReceipt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/fluidnc/machine', () => ({ getExistingCncApi: () => h.api, getCncApi: () => h.api }));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => h.api }));
vi.mock('@/cam/machine/nativeRunHistory', () => ({
  recordNativeRun: h.history,
}));
vi.mock('./jobRecord', async original => ({
  ...(await original<typeof import('./jobRecord')>()),
  loadJobRecord: h.load,
  readJobRecordHead: async (host: string, demo = false) => {
    const stored = await h.load();
    return { host, demo, stored, record: stored, marker: { memory: undefined, stored: null, readable: true } };
  },
  saveJobRecord: h.savedReceipt,
  loadJobProgress: async () => ({
    host: 'status-race.test',
    file: 'camnc.gcode',
    percent: 40,
    at: 2,
    mpos: { x: 0, y: 0, z: 0 },
    wco: { x: 0, y: 0, z: 0 },
  }),
  saveJobProgress: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@wbcnc/ui/components/sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn() }),
}));

let dispose: (() => void) | undefined;
beforeEach(() => {
  h.history.mockClear();
  h.savedReceipt.mockClear();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  interruptedJob.value = null;
  runningJobName.value = null;
  recoveryPending.value = false;
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  interruptedJob.value = null;
  runningJobName.value = null;
  recoveryPending.value = false;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

const status = (state: 'Idle' | 'Run', file = '/sd/camnc.gcode') =>
  ({
    state,
    wco: { x: 0, y: 0, z: 0 },
    mpos: { x: 0, y: 0, z: 0 },
    ...(state === 'Run' && { job: { file, percent: 40 } }),
  }) as MachineStatus;

it.each(['Idle', 'Run'] as const)(
  'N3 uses the latest controller identity when recovery started at %s but the saved receipt resolves during a different SD program',
  async initial => {
    let resolve!: (record: JobRecord) => void;
    h.load.mockReturnValue(
      new Promise(yes => {
        resolve = yes;
      })
    );
    const currentStatus = signal<MachineStatus | null>(status(initial));
    const startedAt = signal<number | null>(null);
    h.api = {
      host: signal('status-race.test'),
      isConnected: signal(true),
      status: currentStatus,
      jobStartedAt: startedAt,
      jobProgress: signal<number | null>(null),
      lastAlarm: signal(null),
      homed: signal(false),
      zZeroedAt: signal<number | null>(null),
    } as unknown as CncApi;
    dispose = watchJobRecovery(h.api);
    expect(recoveryPending.value).toBe(true);
    currentStatus.value = status('Run', '/sd/different-program.gcode');
    const gcode = 'G21\nG1 X10 F300';
    resolve({
      host: 'status-race.test',
      sdFile: 'camnc.gcode',
      gcode,
      toolpathName: 'Original native program',
      startedAt: 1,
      toolpathOffset: { x: 0, y: 0, z: 0 },
      stockHeight: 18,
      toolDiameter: 3,
      wco: { x: 0, y: 0, z: 0 },
      homed: true,
      zZeroedAt: 1,
      execution: 'requested',
      camSnapshot: {
        jobId: 'original',
        sourceKey: 'original:cad:1',
        designRevision: 1,
        active: 'board:bit:0',
        doneId: 'old-program',
        gcode,
        queue: [],
        parts: [],
        instances: [],
        nestBit: 3,
        overlay: null,
      },
    });
    await waitFor(() => expect(recoveryPending.value).toBe(false));
    expect(useStore.getState().toolpath).toBeNull();
    expect(startedAt.value).toBeNull();
    expect(h.api.homed.value).toBe(false);
    expect(runningJobName.value).toBeNull();
  }
);

it('N1 does not declare the recorded native program finished when a different SD program ends', async () => {
  const gcode = 'G21\nG1 X10 F300';
  h.load.mockResolvedValue({
    host: 'status-race.test',
    sdFile: 'camnc.gcode',
    gcode,
    toolpathName: 'Original native program',
    startedAt: 1,
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    homed: true,
    zZeroedAt: 1,
    execution: 'requested',
    camSnapshot: {
      jobId: 'original',
      sourceKey: 'original:cad:1',
      designRevision: 1,
      active: 'board:bit:0',
      doneId: 'old-program',
      gcode,
      queue: [],
      parts: [],
      instances: [],
      nestBit: 3,
      overlay: null,
    },
  });
  const currentStatus = signal<MachineStatus | null>(status('Run', '/sd/different-program.gcode'));
  h.api = {
    host: signal('status-race.test'),
    isConnected: signal(true),
    status: currentStatus,
    jobStartedAt: signal<number | null>(null),
    jobProgress: signal<number | null>(null),
    lastAlarm: signal(null),
    homed: signal(false),
    zZeroedAt: signal<number | null>(null),
  } as unknown as CncApi;
  dispose = watchJobRecovery(h.api);
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  expect(useStore.getState().toolpath).toBeNull();
  currentStatus.value = status('Idle');
  // The mocked receipt/history promises settle before the next browser task.
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.history).not.toHaveBeenCalled();
  expect(h.savedReceipt).not.toHaveBeenCalled();
});
