import { signal } from '@preact/signals-react';
import { waitFor } from '@testing-library/react';
import type { MachineStatus } from '@wbcnc/fluidnc';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import type { CncApi } from '../fluidnc/cnc-api';
import type { JobRecord } from './jobRecord';
import { interruptedJob, recoveryPending, watchJobRecovery } from './jobRecovery';
import { uploadAndRun } from './jobs';

const h = vi.hoisted(() => ({
  api: null as unknown as CncApi,
  head: null as JobRecord | null,
  history: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => h.api }));
vi.mock('@/cam/machine/nativeRunPreparation', async () => ({
  NativePreparationFailure: class extends Error {},
  prepareNativeRun: async (snapshot: import('@/cam/machine/manufacturingSnapshot').ManufacturingSnapshot, executionId: string) => {
    await (await import('@/cam/machine/nativeRunHistory')).recordNativeRun(snapshot);
    return { executionId };
  },
  rollbackNativePreparation: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/cam/machine/nativeRunHistory', () => ({
  recordNativeRun: h.history,
}));
vi.mock('./jobRecord', async original => ({
  ...(await original<typeof import('./jobRecord')>()),
  loadJobRecord: async () => h.head,
  readJobRecordHead: async (host: string, demo: boolean) => {
    const stored = structuredClone(h.head);
    return {
      host,
      demo,
      stored,
      record: stored?.execution === 'prepared' ? (stored.previousRecord ?? null) : stored,
      marker: { readable: true, stored: null, memory: undefined },
    };
  },
  saveJobRecordAtHead: async (_head: unknown, next: JobRecord | null) => {
    h.head = structuredClone(next);
    return true;
  },
  saveJobRecord: h.save,
  compareAndSaveJobRecord: async (_expected: JobRecord | null, next: JobRecord | null) => {
    h.head = structuredClone(next);
    return true;
  },
  loadJobProgress: async () => null,
  saveJobProgress: vi.fn().mockResolvedValue(undefined),
  saveJobProgressForRecord: vi.fn().mockResolvedValue(true),
}));
vi.mock('@wbcnc/ui/components/sonner', () => ({
  toast: Object.assign(vi.fn(), { promise: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));

let dispose: (() => void) | undefined;
function machineStatus(state: 'Idle' | 'Run', wcoX = 0): MachineStatus {
  return {
    state,
    wco: { x: wcoX, y: 0, z: 0 },
    mpos: { x: 0, y: 0, z: 10 },
    ...(state === 'Run' && { job: { file: '/sd/external.gcode', percent: 40 } }),
  } as MachineStatus;
}
function original(): JobRecord {
  const gcode = 'G21 G90\nG0 Z5\nG1 X10 F300\nM30';
  return {
    host: 'preflight.test',
    executionId: 'original-execution',
    startedAt: 1,
    sdFile: 'camnc.gcode',
    gcode,
    toolpathName: 'Native original',
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    homed: true,
    zZeroedAt: 1,
    execution: 'requested',
    camSnapshot: {
      jobId: 'native',
      sourceKey: 'native:cad:1',
      designRevision: 1,
      active: 'board:bit:0',
      doneId: 'original-program',
      gcode,
      queue: [],
      parts: [],
      instances: [],
      nestBit: 3,
      overlay: null,
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.head = original();
  h.api = {
    getCurrentZero: async () => structuredClone(h.api.status.value!.wco),
    host: signal('preflight.test'),
    isConnected: signal(true),
    status: signal<MachineStatus | null>(machineStatus('Idle')),
    state: signal('Idle'),
    jobStartedAt: signal<number | null>(null),
    jobProgress: signal<number | null>(null),
    lastAlarm: signal(null),
    homed: signal(true),
    zZeroedAt: signal<number | null>(1),
    travel: signal(null),
    uploadGcode: vi.fn().mockResolvedValue(undefined),
    runFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as CncApi;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  interruptedJob.value = null;
  recoveryPending.value = false;
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  interruptedJob.value = null;
  recoveryPending.value = false;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

it('does not mark an observed native run complete when its ending Idle status has a different WCO', async () => {
  const saved = h.head!;
  h.api.status.value = { ...machineStatus('Run'), job: { file: '/sd/camnc.gcode', percent: 40 } };
  dispose = watchJobRecovery(h.api);
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  h.api.status.value = machineStatus('Idle', 3);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.history.mock.calls.some(([snapshot, finished]) => snapshot === saved.camSnapshot && finished === true)).toBe(false);
  expect(h.head?.execution).not.toBe('finished');
  expect(useCamMachine.getState().runReview).not.toBe('finished');
});

it.each(['WCO changed', 'different SD program active'] as const)(
  'does not dispatch after upload when the latest controller status says %s',
  async changed => {
    const saved = original();
    // The prior run has been reviewed. A fresh start may now reach the upload preflight.
    h.head = null;
    useStore.getState().updateToolpath(saved.gcode, saved.toolpathName ?? undefined);
    useCamMachine.setState({ jobId: saved.camSnapshot!.jobId, active: saved.camSnapshot!.active, loadedSnapshot: saved.camSnapshot! });
    let uploaded!: () => void;
    vi.mocked(h.api.uploadGcode).mockImplementation(
      () =>
        new Promise<void>(resolve => {
          uploaded = resolve;
        })
    );
    const outcome = uploadAndRun().then(
      () => null,
      (error: unknown) => error
    );
    await waitFor(() => expect(h.api.uploadGcode).toHaveBeenCalledTimes(1));
    if (changed === 'WCO changed') h.api.status.value = machineStatus('Idle', 3);
    else {
      h.api.status.value = machineStatus('Run');
      Object.assign(h.api, { jobProgress: signal(40) });
      h.api.jobStartedAt.value = Date.now();
    }
    uploaded();
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/controller position or activity changed/i);
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(h.history).not.toHaveBeenCalled();
    expect(h.head).toBeNull();
    expect(useCamMachine.getState().preparingRun).toBe(false);
  }
);
