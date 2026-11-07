import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { useStore } from '@/store/store';
import { useCamMachine } from '@/cam/machine/camMachine';
import type { JobRecord } from './jobRecord';
import { interruptedJob, runningJobName } from './jobRecovery';
import { kJobFileName, runResume, uploadAndRun } from './jobs';

const h = vi.hoisted(() => ({
  api: {
    async getCurrentZero() {
      return structuredClone(this.status.value.wco);
    },
    uploadGcode: vi.fn<(...args: [string, string]) => Promise<void>>(),
    runFile: vi.fn<(...args: [string]) => Promise<void>>(),
    status: { value: { state: 'Idle', mpos: { x: 12, y: 34, z: 10 }, wco: { x: 12, y: 34, z: 0 } } },
    travel: { value: null },
    host: { value: 'optional-history.test' },
    jobStartedAt: { value: null },
    jobProgress: { value: null },
    homed: { value: true },
    zZeroedAt: { value: 1 },
  },
  saveRecord: vi.fn<(record: JobRecord) => Promise<void>>(),
}));

// These mocks cannot contact a controller; only storage and controller completion are deferred.
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('./jobRecord', async original => ({
  ...(await original<typeof import('./jobRecord')>()),
  saveJobRecord: h.saveRecord,
  saveJobRecordAtHead: async (head: import('./jobRecord').JobRecordHead, next: JobRecord | null) => {
    if (next) await h.saveRecord(next);
    return (await original<typeof import('./jobRecord')>()).saveJobRecordAtHead(head, next);
  },
}));
vi.mock('@wbcnc/ui/components/sonner', () => ({
  toast: { promise: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const gcode = 'G21 G90 G17\nG0 X0 Y0 Z5\nG1 Z-1 F300\nG1 X20 F1200\nM30\n';

beforeEach(() => {
  vi.resetAllMocks();
  h.api.uploadGcode.mockResolvedValue();
  h.api.runFile.mockResolvedValue();
  h.saveRecord.mockResolvedValue();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().updateToolpath(gcode, 'Imported program');
  useStore.getState().setToolpathOffset(new Vector3(12, 34, 0));
  useStore.getState().setStockHeight(18);
  useStore.getState().setToolDiameter(3);
});

afterEach(async () => {
  await (await vi.importActual<typeof import('./jobRecord')>('./jobRecord')).clearJobRecord(h.api.host.value);
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  interruptedJob.value = null;
  runningJobName.value = null;
});

describe('imported G-code with unavailable optional recovery storage', () => {
  it('still starts the uploaded program when recording recovery history fails', async () => {
    h.saveRecord.mockRejectedValue(new Error('IndexedDB unavailable'));
    expect(useCamMachine.getState().loadedSnapshot).toBeNull();
    await expect(uploadAndRun()).resolves.toBeUndefined();
    expect(h.api.uploadGcode).toHaveBeenCalledWith(gcode, h.saveRecord.mock.calls[0][0].sdFile, { fresh: true });
    expect(h.saveRecord).toHaveBeenCalledOnce();
    expect(h.saveRecord.mock.calls[0][0]).toMatchObject({ gcode, camSnapshot: undefined });
    expect(h.api.runFile).toHaveBeenCalledWith(h.api.uploadGcode.mock.calls[0][1]);
    expect(runningJobName.value).toBe('Imported program');
    expect(useCamMachine.getState().runSnapshot).toBeNull();
    expect(useCamMachine.getState().preparingRun).toBe(false);
  });

  it('can resume an imported file when optional recovery history is unavailable', async () => {
    await uploadAndRun();
    const record = h.saveRecord.mock.calls.at(-1)![0];
    h.saveRecord.mockRejectedValue(new Error('IndexedDB unavailable'));
    h.api.runFile.mockClear();
    await expect(
      runResume(
        {
          record,
          reason: 'Stopped',
          progress: {
            host: record.host,
            file: `/sd/${kJobFileName}`,
            percent: 40,
            mpos: { x: 20, y: 0, z: -1 },
            wco: record.wco,
            at: record.startedAt + 1,
          },
        },
        3
      )
    ).resolves.toBeUndefined();
    expect(h.api.runFile).toHaveBeenCalledWith(h.api.uploadGcode.mock.calls.at(-1)![1]);
    expect(useStore.getState().toolpath?.gcode).toContain('(camNC resume of Imported program from line 4)');
    expect(useCamMachine.getState().runSnapshot).toBeNull();
    expect(useCamMachine.getState().preparingRun).toBe(false);
  });
});
