import { signal } from '@preact/signals-react';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import type { CncApi } from '../fluidnc/cnc-api';
import type { JobRecord } from './jobRecord';
import { acknowledgeRunReview, interruptedJob, recoveryPending, watchJobRecovery } from './jobRecovery';
import { uploadAndRun } from './jobs';
const h = vi.hoisted(() => ({
  api: null as unknown as CncApi,
  head: null as JobRecord | null,
  load: vi.fn<() => Promise<JobRecord | null>>(),
  history: vi.fn<() => Promise<void>>(),
}));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => h.api }));
// Isolate controller/receipt races from the separately real-IDB-tested physical claim kernel.
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
vi.mock('./jobRecord', async original => {
  const actual = await original<typeof import('./jobRecord')>();
  return {
    ...actual,
    loadJobRecord: h.load,
    readJobRecordHead: async (host: string, demo = false) => {
      const stored = await h.load();
      return {
        host,
        demo,
        stored,
        record: stored?.execution === 'prepared' ? (stored.previousRecord ?? null) : stored,
        marker: { memory: undefined, stored: null, readable: true },
      };
    },
    saveJobRecordAtHead: async (head: import('./jobRecord').JobRecordHead, next: JobRecord | null) => {
      if (head.stored ? !actual.sameJobExecution(h.head, head.stored) || h.head?.execution !== head.stored.execution : h.head !== null)
        return false;
      h.head = structuredClone(next);
      return true;
    },
    saveJobProgressForRecord: vi.fn().mockResolvedValue(true),
    saveJobRecord: async (r: JobRecord) => {
      h.head = structuredClone(r);
    },
    clearJobRecord: async () => {
      h.head = null;
    },
    compareAndSaveJobRecord: async (expected: JobRecord | null, next: JobRecord | null) => {
      if (expected ? !h.head || !actual.sameJobExecution(expected, h.head) : h.head !== null) return false;
      h.head = structuredClone(next);
      return true;
    },
    loadJobProgress: async () => ({
      host: 'receipt-race.test',
      file: 'camnc.gcode',
      percent: 40,
      at: 2,
      mpos: { x: 0, y: 0, z: 0 },
      wco: { x: 0, y: 0, z: 0 },
    }),
    saveJobProgress: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock('@wbcnc/ui/components/sonner', () => ({
  toast: Object.assign(vi.fn(), { promise: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
let dispose: (() => void) | undefined;
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function record(id: string): JobRecord {
  const gcode = 'G21 G90\nG0 Z25\nG1 X10 F300\nM30';
  return {
    executionId: id,
    host: 'receipt-race.test',
    sdFile: 'camnc.gcode',
    gcode,
    toolpathName: id,
    startedAt: 1,
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    homed: true,
    zZeroedAt: 1,
    camSnapshot: {
      jobId: 'native',
      sourceKey: 'native:cad:1',
      designRevision: 1,
      active: 'board:bit:0',
      doneId: 'same-program',
      gcode,
      queue: [],
      parts: [],
      instances: [],
      nestBit: 3,
      overlay: null,
    },
  };
}
function stateFor(r: JobRecord) {
  return {
    jobId: 'native',
    active: r.camSnapshot!.active,
    runSnapshot: r.camSnapshot!,
    loadedSnapshot: r.camSnapshot!,
    runRecord: { host: r.host, startedAt: r.startedAt, executionId: r.executionId },
    runReview: 'requested' as const,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.head = null;
  h.load.mockImplementation(async () => structuredClone(h.head));
  h.history.mockResolvedValue();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  interruptedJob.value = null;
  recoveryPending.value = false;
  h.api = {
    getCurrentZero: async () => structuredClone(h.api.status.value!.wco),
    host: signal('receipt-race.test'),
    isConnected: signal(true),
    status: signal({ state: 'Idle', mpos: { x: 0, y: 0, z: 10 }, wco: { x: 0, y: 0, z: 0 } }),
    jobStartedAt: signal(null),
    jobProgress: signal(null),
    lastAlarm: signal(null),
    homed: signal(true),
    zZeroedAt: signal(1),
    travel: signal(null),
    uploadGcode: vi.fn().mockResolvedValue(undefined),
    runFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as CncApi;
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  interruptedJob.value = null;
  recoveryPending.value = false;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});
it('N1 acknowledging an old receipt cannot clear a newer same-millisecond execution or its setup', async () => {
  const a = record('a'),
    b = record('b');
  h.head = a;
  useCamMachine.setState({ ...stateFor(a), runReview: 'finished' });
  const read = deferred<JobRecord>();
  h.load.mockReturnValue(read.promise);
  const result = acknowledgeRunReview();
  h.head = b;
  useCamMachine.setState(stateFor(b));
  read.resolve(a);
  expect(await result).toBe(false);
  expect(h.head?.executionId).toBe(b.executionId);
  expect(useCamMachine.getState().runRecord).toEqual(stateFor(b).runRecord);
  expect(useCamMachine.getState().runReview).toBe('requested');
});
it('N1 an old completion waiting on board history cannot resurrect its receipt over a newer execution', async () => {
  const a = record('a'),
    b = record('b');
  h.head = a;
  const history = deferred<void>();
  h.history.mockReturnValue(history.promise);
  Object.assign(h.api, {
    status: signal({ state: 'Run', job: { file: '/sd/camnc.gcode', percent: 40 }, mpos: { x: 0, y: 0, z: 0 }, wco: a.wco }),
  });
  dispose = watchJobRecovery(h.api);
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  h.api.status.value = { state: 'Idle', mpos: { x: 0, y: 0, z: 0 }, wco: a.wco } as typeof h.api.status.value;
  await waitFor(() => expect(h.history).toHaveBeenCalled());
  h.head = b;
  useCamMachine.setState(stateFor(b));
  history.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.head?.executionId).toBe(b.executionId);
  expect(useCamMachine.getState().runRecord).toEqual(stateFor(b).runRecord);
  expect(useCamMachine.getState().runReview).toBe('requested');
});
it('N1 an old failed preparation rollback cannot overwrite a newer receipt or clear its preparation lock', async () => {
  const previous = { ...record('previous'), camSnapshot: undefined },
    a = record('a'),
    b = record('b');
  h.head = previous;
  useStore.getState().updateToolpath(a.gcode, a.toolpathName ?? undefined);
  useCamMachine.setState({ jobId: 'native', active: a.camSnapshot!.active, loadedSnapshot: a.camSnapshot! });
  const history = deferred<void>();
  h.history.mockReturnValue(history.promise);
  const operation = uploadAndRun();
  await waitFor(() => expect(h.history).toHaveBeenCalled());
  h.head = b;
  useCamMachine.setState({ ...stateFor(b), preparingRun: true });
  history.reject(new Error('history failed'));
  await expect(operation).rejects.toThrow('history failed');
  expect(h.head?.executionId).toBe(b.executionId);
  expect(useCamMachine.getState().runRecord).toEqual(stateFor(b).runRecord);
  expect(useCamMachine.getState().preparingRun).toBe(true);
});
