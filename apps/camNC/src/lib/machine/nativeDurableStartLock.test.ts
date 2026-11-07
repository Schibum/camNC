import { signal } from '@preact/signals-react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCamMachine } from '@/cam/machine/camMachine';
import { useStore } from '@/store/store';
import type { CncApi } from '../fluidnc/cnc-api';
import { clearJobRecord, loadJobRecord, saveJobRecord, type JobRecord } from './jobRecord';
import { interruptedJob, recoveryPending } from './jobRecovery';
import { uploadAndRun } from './jobs';

const h = vi.hoisted(() => ({ api: null as unknown as CncApi }));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
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
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { promise: vi.fn(), error: vi.fn() } }));
const hosts: string[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await clearJobRecord(host);
  interruptedJob.value = null;
  recoveryPending.value = false;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
});

it.each(['requested', 'finished', 'stopped'] as const)(
  'a stale open view cannot replace another native %s receipt without its explicit review',
  async execution => {
    const host = `durable-start-${crypto.randomUUID()}.test`;
    hosts.push(host);
    const gcode = 'G21 G90\nG0 Z10\nG1 X11 F300\nM30';
    const prior: JobRecord = {
      host,
      executionId: crypto.randomUUID(),
      execution,
      sdFile: 'camnc.gcode',
      gcode,
      toolpathName: 'Original physical run',
      startedAt: 1,
      toolpathOffset: { x: 0, y: 0, z: 0 },
      stockHeight: 18,
      toolDiameter: 3,
      wco: { x: 0, y: 0, z: 0 },
      homed: true,
      zZeroedAt: 1,
      camSnapshot: {
        runId: crypto.randomUUID(),
        jobId: 'original',
        sourceKey: 'original:cad:1',
        designRevision: 1,
        active: 'board:bit:0',
        doneId: 'program-a',
        gcode,
        queue: [],
        parts: [],
        instances: [],
        nestBit: 3,
        overlay: null,
      },
    };
    await saveJobRecord(prior);
    // This tab existed before the original run; its local setup has not discovered the foreign receipt.
    useCamMachine.setState(useCamMachine.getInitialState(), true);
    useStore.setState(useStore.getInitialState(), true);
    interruptedJob.value = null;
    recoveryPending.value = false;
    useStore.getState().updateToolpath('G21 G90\nG0 Z10\nG1 X99 F300\nM30', 'New cached program');
    h.api = {
      getCurrentZero: async () => structuredClone(h.api.status.value!.wco),
      host: signal(host),
      status: signal({ state: 'Idle', mpos: { x: 0, y: 0, z: 10 }, wpos: { x: 0, y: 0, z: 10 }, wco: prior.wco }),
      state: signal('Idle'),
      jobStartedAt: signal(null),
      jobProgress: signal(null),
      homed: signal(true),
      zZeroedAt: signal(1),
      travel: signal(null),
      uploadGcode: vi.fn().mockResolvedValue(undefined),
      runFile: vi.fn().mockResolvedValue(undefined),
    } as unknown as CncApi;
    await expect(uploadAndRun()).rejects.toThrow(/review.*original|original.*review/i);
    expect(h.api.uploadGcode).not.toHaveBeenCalled();
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(await loadJobRecord(host)).toEqual(prior);
    expect(useCamMachine.getState().runSnapshot?.jobId).toBe(prior.camSnapshot!.jobId);
    expect(useCamMachine.getState().runReview).toBe(execution);
    expect(useCamMachine.getState().preparingRun).toBe(false);
    expect(useStore.getState().toolpath?.gcode).toBe(prior.gcode);
  }
);
