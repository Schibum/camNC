import { signal } from '@preact/signals-react';
import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isManufacturingLocked, useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import type { CncApi } from '../fluidnc/cnc-api';
import { acknowledgeRunReview, interruptedJob, recoveryPending, watchJobRecovery } from './jobRecovery';
import {
  clearJobRecord,
  loadJobRecord,
  readJobRecordHead,
  saveJobProgress,
  saveJobRecord,
  type JobRecord,
  type JobRecordHead,
} from './jobRecord';
import { uploadAndRun } from './jobs';
const h = vi.hoisted(() => ({ api: null as unknown as CncApi, failPromotion: false, failRollback: false }));
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
  recordNativeRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./jobRecord', async original => ({
  ...(await original<typeof import('./jobRecord')>()),
  saveJobRecordAtHead: async (head: JobRecordHead, next: JobRecord | null) => {
    if (h.failPromotion && next?.execution === 'requested' && next.executionId === head.stored?.executionId)
      throw new Error('promotion storage failed');
    if (h.failRollback && head.stored?.execution === 'prepared' && next?.executionId !== head.stored.executionId)
      throw new Error('rollback storage failed');
    return (await original<typeof import('./jobRecord')>()).saveJobRecordAtHead(head, next);
  },
}));
vi.mock('@wbcnc/ui/components/sonner', () => ({
  toast: Object.assign(vi.fn(), { promise: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() }),
}));
let host = '',
  dispose: (() => void) | undefined;
function record(id: string): JobRecord {
  const gcode = 'G21 G90\nG0 Z25\nG1 X10 F300\nM30';
  return {
    executionId: id,
    execution: 'stopped',
    host,
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
      runId: `run-${id}`,
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
beforeEach(() => {
  host = `preparation-${crypto.randomUUID()}.test`;
  h.failPromotion = false;
  h.failRollback = false;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  interruptedJob.value = null;
  recoveryPending.value = false;
  h.api = {
    getCurrentZero: async () => structuredClone(h.api.status.value!.wco),
    host: signal(host),
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
afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await clearJobRecord(host);
  interruptedJob.value = null;
  recoveryPending.value = false;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

it.each([false, true])(
  'native promotion failure releases compensated preparation and retains review only when receipt rollback fails, rollback failure=%s',
  async failRollback => {
    const previous = { ...record('safe-a'), camSnapshot: undefined },
      candidate = record('candidate-c');
    await saveJobRecord(previous);
    useStore.getState().updateToolpath(candidate.gcode, candidate.toolpathName ?? undefined);
    useCamMachine.setState({ jobId: 'native', active: candidate.camSnapshot!.active, loadedSnapshot: candidate.camSnapshot! });
    h.failPromotion = true;
    h.failRollback = failRollback;
    await expect(uploadAndRun()).rejects.toThrow('promotion storage failed');
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(isManufacturingLocked()).toBe(failRollback);
    if (failRollback) expect(useCamMachine.getState().runPreparationError).toContain('Execution was not requested');
    else expect(useCamMachine.getState().runPreparationError).toBeNull();
    expect((await loadJobRecord(host))?.executionId).toBe(previous.executionId);
    const head = await readJobRecordHead(host);
    expect(head.stored?.execution).toBe(failRollback ? 'prepared' : 'stopped');
  }
);

it('closing a reloaded failed preparation makes its prior stopped execution resumable again in this session', async () => {
  const previous = record('safe-a'),
    failed = { ...record('candidate-c'), execution: 'prepared' as const, previousRecord: previous };
  await saveJobRecord(failed);
  await saveJobProgress({
    host,
    file: previous.sdFile,
    executionId: previous.executionId,
    percent: 40,
    at: 2,
    mpos: { x: 0, y: 0, z: 0 },
    wco: previous.wco,
  });
  dispose = watchJobRecovery(h.api);
  await waitFor(() => expect(recoveryPending.value).toBe(false));
  expect(useCamMachine.getState().runRecord?.executionId).toBe(failed.executionId);
  expect(interruptedJob.value).toBeNull();
  expect(await acknowledgeRunReview()).toBe(true);
  await waitFor(() => expect(interruptedJob.value?.record.executionId).toBe(previous.executionId));
  expect(useCamMachine.getState().runRecord?.executionId).toBe(previous.executionId);
  expect(useCamMachine.getState().runSnapshot?.runId).toBe(previous.camSnapshot!.runId);
});

it.each(['foreign preparation', 'deleted modern receipt'] as const)(
  'stale Resume cannot bypass a %s through an eligible fallback',
  async kind => {
    const previous = record('safe-a'),
      foreign = { ...record('candidate-c'), execution: 'prepared' as const, previousRecord: previous };
    await saveJobRecord(kind === 'foreign preparation' ? foreign : previous);
    const { applyRecord } = await import('./jobRecovery');
    applyRecord(h.api, previous, { machineState: false });
    const stopped = {
      record: previous,
      reason: 'Stopped',
      progress: {
        host,
        file: previous.sdFile,
        executionId: previous.executionId,
        percent: 40,
        at: 2,
        mpos: { x: 0, y: 0, z: 0 },
        wco: previous.wco,
      },
    };
    interruptedJob.value = stopped;
    if (kind === 'deleted modern receipt') await clearJobRecord(host);
    const { runResume } = await import('./jobs');
    await expect(runResume(stopped, 2)).rejects.toThrow(/receipt|preparation|review|execution/i);
    expect(h.api.uploadGcode).not.toHaveBeenCalled();
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect((await readJobRecordHead(host)).stored?.executionId ?? null).toBe(kind === 'foreign preparation' ? foreign.executionId : null);
  }
);
