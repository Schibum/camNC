import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '@/store/store';
import { useCamMachine } from '@/cam/machine/camMachine';
import type { ManufacturingSnapshot } from '@/cam/machine/manufacturingSnapshot';
import type { JobRecord } from './jobRecord';
import { uploadAndRun } from './jobs';

const h = vi.hoisted(() => ({
  api: {
    async getCurrentZero() {
      return structuredClone(this.status.value.wco);
    },
    uploadGcode: vi.fn<() => Promise<void>>(),
    runFile: vi.fn<() => Promise<void>>(),
    host: { value: 'controller-a.test' },
    status: { value: { state: 'Idle', mpos: { x: 0, y: 0, z: 10 }, wco: { x: 0, y: 0, z: 0 } } },
    travel: { value: null },
    jobStartedAt: { value: null },
    jobProgress: { value: null },
    homed: { value: true },
    zZeroedAt: { value: 1 },
  },
  records: new Map<string, JobRecord>(),
}));
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
  recordNativeRun: vi.fn().mockRejectedValue(new Error('Physical history could not be saved')),
}));
vi.mock('./jobRecord', async original => ({
  ...(await original<typeof import('./jobRecord')>()),
  loadJobRecord: async (host: string) => structuredClone(h.records.get(host) ?? null),
  saveJobRecord: async (record: JobRecord) => {
    h.records.set(record.host, structuredClone(record));
  },
  clearJobRecord: async (host: string) => {
    h.records.delete(host);
  },
}));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { promise: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  h.records.clear();
  h.api.host.value = 'controller-a.test';
  h.api.runFile.mockClear();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
});
afterEach(() => {
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
});

it('N1 never leaves an unexecuted receipt on a different controller after host changes during upload and physical-history storage fails', async () => {
  const gcode = 'G21\nG1 X10 F300';
  const previous: JobRecord = {
    host: 'controller-a.test',
    sdFile: 'camnc.gcode',
    gcode: 'G21\nG1 X5 F300',
    toolpathName: 'Earlier program',
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    startedAt: 1,
    homed: true,
    zZeroedAt: 1,
  };
  h.records.set(previous.host, structuredClone(previous));
  const snapshot: ManufacturingSnapshot = {
    jobId: 'native-design',
    sourceKey: 'native-design:cad:1',
    designRevision: 1,
    active: 'board:bit:0',
    doneId: 'original-native-program',
    gcode,
    queue: [],
    parts: [],
    instances: [],
    nestBit: 3,
    overlay: null,
  };
  useStore.getState().updateToolpath(gcode, 'New native program');
  useCamMachine.setState({ jobId: snapshot.jobId, active: snapshot.active, loadedSnapshot: snapshot });
  h.api.uploadGcode.mockImplementation(async () => {
    h.api.host.value = 'controller-b.test';
  });
  await expect(uploadAndRun()).rejects.toThrow();
  expect(h.api.runFile).not.toHaveBeenCalled();
  expect(h.records.get(previous.host)).toEqual(previous);
  expect(h.records.get('controller-b.test')).toBeUndefined();
  expect(useCamMachine.getState().preparingRun).toBe(false);
});
