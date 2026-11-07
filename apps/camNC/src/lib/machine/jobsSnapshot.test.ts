import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { useStore } from '@/store/store';
import { isManufacturingLocked, useCamMachine } from '@/cam/machine/camMachine';
import type { ManufacturingSnapshot } from '@/cam/machine/manufacturingSnapshot';
import { recordNativeRun } from '@/cam/machine/nativeRunHistory';
import { openAtMachine } from '@/cam/machine/openAtMachine';
import type { JobRecord } from './jobRecord';
import type { InterruptedJob } from './jobRecovery';
import { applyRecord, interruptedJob, runningJobName } from './jobRecovery';
import { isJobOfToolpath, kJobFileName, executionJobFileName, runResume, uploadAndRun, zeroAndRun } from './jobs';

const h = vi.hoisted(() => ({
  api: {
    async getCurrentZero() {
      return structuredClone(this.status.value.wco);
    },
    setWorkspaceXYZero: vi.fn<(x: number, y: number) => Promise<void>>(),
    uploadGcode: vi.fn<(...args: [string, string]) => Promise<void>>(),
    runFile: vi.fn<(...args: [string]) => Promise<void>>(),
    status: { value: { state: 'Idle', mpos: { x: 12, y: 34, z: 10 }, wco: { x: 12, y: 34, z: 0 } } },
    travel: { value: null },
    host: { value: 'snapshot-controller.test' },
    jobStartedAt: { value: null as number | null },
    jobProgress: { value: null as number | null },
    homed: { value: true },
    zZeroedAt: { value: 1 as number | null },
  },
  saveRecord: vi.fn<(record: JobRecord) => Promise<void>>(),
  loadRecord: vi.fn<() => Promise<JobRecord | null>>(),
  clearRecord: vi.fn<() => Promise<void>>(),
  stored: null as JobRecord | null,
}));

// No transports are created: only deferred controller responses and a durable-storage boundary are mocked.
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
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => h.api }));
vi.mock('./jobRecord', async importOriginal => ({
  ...(await importOriginal<typeof import('./jobRecord')>()),
  readJobRecordHead: async (host: string, demo = false) => ({
    host,
    demo,
    stored: structuredClone(h.stored),
    record: structuredClone(h.stored?.execution === 'prepared' ? (h.stored.previousRecord ?? null) : h.stored),
    marker: { memory: undefined, stored: null, readable: true },
  }),
  saveJobRecordAtHead: async (head: import('./jobRecord').JobRecordHead, next: JobRecord | null) => {
    const actual = await importOriginal<typeof import('./jobRecord')>();
    if (head.stored ? !actual.sameJobExecution(h.stored, head.stored) || h.stored?.execution !== head.stored.execution : h.stored !== null)
      return false;
    if (next) {
      await h.saveRecord(next);
      h.stored = structuredClone(next);
    } else await h.clearRecord();
    return true;
  },
  compareAndSaveJobRecord: async (expected: JobRecord, next: JobRecord | null) => {
    const actual = await importOriginal<typeof import('./jobRecord')>();
    if (!actual.sameJobExecution(h.stored, expected)) return false;
    if (next) {
      await h.saveRecord(next);
      h.stored = structuredClone(next);
    } else await h.clearRecord();
    return true;
  },
  saveJobRecord: h.saveRecord,
  loadJobRecord: h.loadRecord,
  clearJobRecord: h.clearRecord,
}));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { promise: vi.fn(), error: vi.fn() } }));

let lastStartedFile = kJobFileName;
const lastRequestedFile = () => h.api.runFile.mock.calls.at(-1)?.[0] ?? lastStartedFile;
const gcode = 'G21 G90 G17\nG0 X0 Y0 Z5\nG1 Z-1 F300\nG1 X20 F1200\nG1 Y10\nM30\n';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function snapshot(): ManufacturingSnapshot {
  return {
    jobId: 'native-design',
    sourceKey: 'native-design:cad:3',
    designRevision: 3,
    active: 'board:bit:0',
    doneId: 'board:bit:0:original-program',
    gcode,
    queue: [],
    parts: [],
    instances: [],
    nestBit: 3,
    overlay: { w: 100, h: 60, rotationDeg: 0, boardId: 'board' },
  };
}

function interrupted(): InterruptedJob {
  const interrupted: InterruptedJob = {
    reason: 'Controller was reset.',
    record: {
      host: h.api.host.value,
      sdFile: kJobFileName,
      gcode,
      toolpathName: 'Plate',
      toolpathOffset: { x: 12, y: 34, z: 0 },
      stockHeight: 18,
      toolDiameter: 3,
      wco: { x: 12, y: 34, z: 0 },
      startedAt: 1,
      homed: true,
      zZeroedAt: 1,
      executionId: h.stored?.gcode === gcode ? h.stored.executionId : crypto.randomUUID(),
      camSnapshot:
        useCamMachine.getState().runSnapshot?.gcode === gcode ? structuredClone(useCamMachine.getState().runSnapshot!) : snapshot(),
    },
    progress: {
      host: h.api.host.value,
      file: `/sd/${kJobFileName}`,
      percent: 40,
      mpos: { x: 22, y: 34, z: -1 },
      wco: { x: 12, y: 34, z: 0 },
      at: 2,
    },
  };
  h.stored = structuredClone(interrupted.record);
  return interrupted;
}

beforeEach(() => {
  vi.resetAllMocks();
  h.api.setWorkspaceXYZero.mockImplementation(async (x, y) => {
    h.api.status.value.wco = { ...h.api.status.value.wco, x, y };
  });
  h.api.status.value = { state: 'Idle', mpos: { x: 12, y: 34, z: 10 }, wco: { x: 12, y: 34, z: 0 } };
  h.api.uploadGcode.mockResolvedValue();
  h.api.runFile.mockImplementation(async file => {
    lastStartedFile = file;
  });
  h.stored = null;
  h.loadRecord.mockImplementation(async () => h.stored);
  h.clearRecord.mockImplementation(async () => {
    h.stored = null;
  });
  h.saveRecord.mockImplementation(async record => {
    h.stored = structuredClone(record);
  });
  h.api.jobStartedAt.value = null;
  h.api.jobProgress.value = null;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  useStore.getState().updateToolpath(gcode, 'Plate');
  useStore.getState().setToolpathOffset(new Vector3(12, 34, 0));
  useStore.getState().setStockHeight(18);
  useStore.getState().setToolDiameter(3);
  const loaded = snapshot();
  useCamMachine.setState({ jobId: loaded.jobId, active: loaded.active, loadedSnapshot: loaded, overlay: loaded.overlay });
});

afterEach(() => {
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  interruptedJob.value = null;
  runningJobName.value = null;
});

describe('manufacturing start durability and upload isolation', () => {
  it('records the confirmed new XY zero with the frozen CAM program and unique file before starting', async () => {
    h.api.status.value.wco = { x: 0, y: 0, z: 0 };
    h.api.runFile.mockImplementation(async file => {
      expect(h.stored).toMatchObject({ execution: 'requested', sdFile: file, wco: { x: 12, y: 34, z: 0 } });
      expect(h.stored?.camSnapshot?.gcode).toBe(gcode);
    });
    await zeroAndRun();
    expect(h.api.setWorkspaceXYZero).toHaveBeenCalledWith(12, 34);
    expect(h.api.setWorkspaceXYZero.mock.invocationCallOrder[0]).toBeLessThan(h.api.uploadGcode.mock.invocationCallOrder[0]!);
    expect(h.stored!.sdFile).toMatch(/^camnc-[0-9a-f-]+\.gcode$/);
    expect(useCamMachine.getState().runSnapshot?.gcode).toBe(gcode);
  });

  it('finds an unreviewed durable native receipt before changing the controller zero', async () => {
    await uploadAndRun();
    useCamMachine.setState({ runSnapshot: null, runReview: null, runRecord: null });
    h.api.uploadGcode.mockClear();
    await expect(zeroAndRun()).rejects.toThrow('Review the original machine setup');
    expect(h.api.setWorkspaceXYZero).not.toHaveBeenCalled();
    expect(h.api.uploadGcode).not.toHaveBeenCalled();
  });

  it('keeps the full ordinary queue program after resuming and recovering its execution tail', async () => {
    const stopped = interrupted();
    await runResume(stopped, 3);
    const resumedRecord = h.saveRecord.mock.calls.at(-1)![0];
    expect(resumedRecord.gcode).not.toBe(gcode);
    expect(useStore.getState().toolpath?.gcode).toBe(resumedRecord.gcode);
    expect(useCamMachine.getState().runSnapshot?.gcode).toBe(gcode);
    expect(useCamMachine.getState().loadedSnapshot?.gcode).toBe(gcode);
    expect(stopped.record.camSnapshot?.gcode).toBe(gcode);

    useCamMachine.setState(useCamMachine.getInitialState(), true);
    applyRecord(h.api as unknown as Parameters<typeof applyRecord>[0], resumedRecord, { machineState: false });
    expect(useStore.getState().toolpath?.gcode).toBe(resumedRecord.gcode);
    expect(useCamMachine.getState().runSnapshot?.gcode).toBe(gcode);
    expect(useCamMachine.getState().loadedSnapshot?.gcode).toBe(gcode);
  });

  it.each(['upload', 'storage'] as const)('restores the previous loaded setup if resume %s fails before execution', async failureAt => {
    await uploadAndRun();
    h.api.runFile.mockClear();
    h.saveRecord.mockClear();
    const stopped = interrupted();
    interruptedJob.value = stopped;
    useStore.getState().setToolpathOffset(new Vector3(70, 80, 2));
    useStore.getState().setStockHeight(22);
    useStore.getState().setToolDiameter(6);
    const previousStore = useStore.getState();
    const previousMachine = useCamMachine.getState();
    const previousName = runningJobName.value;
    if (failureAt === 'upload') h.api.uploadGcode.mockRejectedValueOnce(new Error('Resume upload rejected'));
    else h.saveRecord.mockRejectedValueOnce(new Error('Resume storage rejected'));

    await expect(runResume(stopped, 3)).rejects.toThrow(`Resume ${failureAt} rejected`);
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(useStore.getState()).toMatchObject({
      toolpath: previousStore.toolpath,
      toolpathName: previousStore.toolpathName,
      toolpathOffset: previousStore.toolpathOffset,
      stockHeight: previousStore.stockHeight,
      toolDiameter: previousStore.toolDiameter,
    });
    expect(useCamMachine.getState()).toMatchObject({
      jobId: previousMachine.jobId,
      active: previousMachine.active,
      loadedSnapshot: previousMachine.loadedSnapshot,
      runSnapshot: previousMachine.runSnapshot,
      overlay: previousMachine.overlay,
      preparingRun: false,
    });
    expect(interruptedJob.value).toBe(stopped);
    expect(runningJobName.value).toBe(previousName);
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, gcode)).toBe(true);
  });

  it('retains the execution context when the controller start response is uncertain', async () => {
    const stopped = interrupted();
    interruptedJob.value = stopped;
    h.api.runFile.mockRejectedValueOnce(new Error('Controller disconnected after start request'));
    await expect(runResume(stopped, 3)).rejects.toThrow('Controller disconnected after start request');
    const executing = h.api.uploadGcode.mock.calls[0][0];
    expect(h.saveRecord.mock.calls[0][0]).toMatchObject({ gcode: executing, camSnapshot: { gcode } });
    expect(useStore.getState().toolpath?.gcode).toBe(executing);
    expect(useCamMachine.getState().runSnapshot?.gcode).toBe(gcode);
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, executing)).toBe(true);
    expect(interruptedJob.value).toBe(stopped);
    expect(useCamMachine.getState().preparingRun).toBe(false);
  });

  it('attributes an actual start to its program only after the record is durable and keeps that identity when another file opens', async () => {
    const previous = gcode.replace('X20', 'X17');
    useStore.getState().updateToolpath(previous, 'Previous plate');
    await uploadAndRun();
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, previous)).toBe(true);
    h.api.uploadGcode.mockClear();
    h.api.runFile.mockClear();
    h.saveRecord.mockClear();
    useStore.getState().updateToolpath(gcode, 'Plate');
    const persisted = deferred();
    h.saveRecord.mockReturnValue(persisted.promise);
    h.api.runFile.mockImplementation(async () => {
      expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, gcode)).toBe(true);
      expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, previous)).toBe(false);
    });
    const operation = uploadAndRun();
    await expect.poll(() => h.saveRecord.mock.calls.length).toBe(1);
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, gcode)).toBe(false);
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, previous)).toBe(true);
    persisted.resolve();
    await operation;
    const another = gcode.replace('X20', 'X35');
    useStore.getState().updateToolpath(another, 'Another plate');
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, gcode)).toBe(true);
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, another)).toBe(false);
    expect(isJobOfToolpath('/sd/unrelated.gcode', gcode)).toBe(false);
  });

  it('attributes the real resume request to its resumed program after durable storage, rather than the original or a newly opened file', async () => {
    await uploadAndRun();
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, gcode)).toBe(true);
    h.api.uploadGcode.mockClear();
    h.api.runFile.mockClear();
    h.saveRecord.mockClear();
    const persisted = deferred();
    h.saveRecord.mockReturnValue(persisted.promise);
    let resumed = '';
    h.api.runFile.mockImplementation(async () => {
      expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, resumed)).toBe(true);
      expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, gcode)).toBe(false);
    });
    const operation = runResume(interrupted(), 3);
    await expect.poll(() => h.api.uploadGcode.mock.calls.length).toBe(1);
    resumed = h.api.uploadGcode.mock.calls[0][0];
    await expect.poll(() => h.saveRecord.mock.calls.length).toBe(1);
    expect(h.saveRecord.mock.calls[0][0]).toMatchObject({
      gcode: resumed,
      sdFile: h.api.uploadGcode.mock.calls[0][1],
      camSnapshot: { designRevision: 3 },
    });
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(isManufacturingLocked()).toBe(true);
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, resumed)).toBe(false);
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, gcode)).toBe(true);
    persisted.resolve();
    await operation;
    useStore.getState().updateToolpath(gcode, 'Original plate opened again');
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, resumed)).toBe(true);
    expect(isJobOfToolpath(`/sd/${lastRequestedFile()}`, gcode)).toBe(false);
    expect(isJobOfToolpath('/sd/unrelated.gcode', resumed)).toBe(false);
  });

  it('awaits saving the pinned revision before requesting controller execution', async () => {
    const uploaded = deferred(),
      persisted = deferred(),
      started = deferred();
    h.api.uploadGcode.mockReturnValue(uploaded.promise);
    h.saveRecord.mockReturnValue(persisted.promise);
    h.api.runFile.mockReturnValue(started.promise);
    const operation = uploadAndRun();
    expect(useCamMachine.getState().preparingRun).toBe(true);
    await vi.waitFor(() =>
      expect(h.api.uploadGcode).toHaveBeenCalledWith(gcode, executionJobFileName(useCamMachine.getState().preparingExecutionId!), {
        fresh: true,
      })
    );
    expect(h.saveRecord).not.toHaveBeenCalled();
    expect(h.api.runFile).not.toHaveBeenCalled();

    uploaded.resolve();
    await expect.poll(() => h.saveRecord.mock.calls.length).toBe(1);
    expect(h.saveRecord.mock.calls[0][0]).toMatchObject({
      gcode,
      camSnapshot: { sourceKey: 'native-design:cad:3', designRevision: 3 },
      toolpathOffset: { x: 12, y: 34, z: 0 },
    });
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(useCamMachine.getState().preparingRun).toBe(true);

    persisted.resolve();
    await expect.poll(() => h.api.runFile.mock.calls.length).toBe(1);
    expect(h.api.runFile).toHaveBeenCalledWith(h.api.uploadGcode.mock.calls[0][1]);
    expect(useCamMachine.getState().preparingRun).toBe(true);
    started.resolve();
    await operation;
    expect(useCamMachine.getState().preparingRun).toBe(false);
    expect(useCamMachine.getState().runSnapshot?.designRevision).toBe(3);
  });

  it('releases an unstarted snapshot and preparation lock when upload fails', async () => {
    const uploaded = deferred();
    h.api.uploadGcode.mockReturnValue(uploaded.promise);
    const operation = uploadAndRun();
    const failure = expect(operation).rejects.toThrow('Upload rejected');
    expect(useCamMachine.getState().runSnapshot).not.toBeNull();
    expect(isManufacturingLocked()).toBe(true);
    uploaded.reject(new Error('Upload rejected'));
    await failure;
    expect(h.saveRecord).not.toHaveBeenCalled();
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(useCamMachine.getState().runSnapshot).toBeNull();
    expect(useCamMachine.getState().preparingRun).toBe(false);
    expect(isManufacturingLocked()).toBe(false);
    expect(useCamMachine.getState().loadedSnapshot?.designRevision).toBe(3);
  });

  it('refuses execution and releases the new pin when durable storage fails', async () => {
    const persisted = deferred();
    h.saveRecord.mockReturnValue(persisted.promise);
    const operation = uploadAndRun();
    const failure = expect(operation).rejects.toThrow('Storage unavailable');
    await expect.poll(() => h.saveRecord.mock.calls.length).toBe(1);
    persisted.reject(new Error('Storage unavailable'));
    await failure;
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(useCamMachine.getState().runSnapshot).toBeNull();
    expect(useCamMachine.getState().preparingRun).toBe(false);
  });

  it('keeps resume G-code and its manufacturing revision locked through upload and storage', async () => {
    const uploaded = deferred(),
      persisted = deferred(),
      started = deferred();
    h.api.uploadGcode.mockReturnValue(uploaded.promise);
    h.saveRecord.mockReturnValue(persisted.promise);
    h.api.runFile.mockReturnValue(started.promise);
    const stopped = interrupted();
    interruptedJob.value = stopped;
    const operation = runResume(stopped, 3);
    await expect.poll(() => h.api.uploadGcode.mock.calls.length).toBe(1);
    const resumeGcode = h.api.uploadGcode.mock.calls[0][0];
    expect(resumeGcode).toContain('(camNC resume of Plate from line 4)');
    expect(resumeGcode).not.toBe(gcode);
    expect(h.api.uploadGcode).toHaveBeenCalledWith(
      resumeGcode,
      executionJobFileName(useCamMachine.getState().preparingExecutionId!, true),
      { fresh: true }
    );
    expect(useStore.getState().toolpath?.gcode).toBe(resumeGcode);
    expect(isManufacturingLocked()).toBe(true);

    // These real setup-replacement commands must preserve the resumed program while the upload is pending.
    useCamMachine.getState().leave();
    openAtMachine('another-design');
    expect(useCamMachine.getState().jobId).toBe('native-design');
    expect(useStore.getState().toolpath?.gcode).toBe(resumeGcode);
    expect(useCamMachine.getState().runSnapshot?.sourceKey).toBe('native-design:cad:3');

    uploaded.resolve();
    await expect.poll(() => h.saveRecord.mock.calls.length).toBe(1);
    expect(h.api.runFile).not.toHaveBeenCalled();
    expect(isManufacturingLocked()).toBe(true);
    expect(h.saveRecord.mock.calls[0][0]).toMatchObject({
      gcode: resumeGcode,
      sdFile: h.api.uploadGcode.mock.calls[0][1],
      camSnapshot: { designRevision: 3 },
    });
    persisted.resolve();
    await expect.poll(() => h.api.runFile.mock.calls.length).toBe(1);
    expect(h.api.runFile).toHaveBeenCalledWith(h.api.uploadGcode.mock.calls[0][1]);
    expect(useCamMachine.getState().preparingRun).toBe(true);
    started.resolve();
    await operation;
    expect(useCamMachine.getState().preparingRun).toBe(false);
    expect(useStore.getState().toolpath?.gcode).toBe(resumeGcode);
    expect(interruptedJob.value).toBeNull();
  });
});

it('N1 restores durable pre-start history when physical-board history cannot be saved before dispatch', async () => {
  const previous = { ...interrupted().record, camSnapshot: undefined };
  h.stored = structuredClone(previous);
  vi.mocked(recordNativeRun).mockRejectedValue(new Error('physical history unavailable'));
  await expect(uploadAndRun()).rejects.toThrow('physical history unavailable');
  expect(h.api.runFile).not.toHaveBeenCalled();
  expect(h.stored).toEqual(previous);
  expect(useCamMachine.getState().runReview).toBeNull();
});

it('N3/M5 restores the durable full resume record when physical-board history fails after storing an unexecuted resume tail', async () => {
  const stopped = interrupted();
  h.stored = structuredClone(stopped.record);
  interruptedJob.value = stopped;
  vi.mocked(recordNativeRun).mockRejectedValue(new Error('physical history unavailable'));
  await expect(runResume(stopped, 3)).rejects.toThrow('physical history unavailable');
  expect(h.api.runFile).not.toHaveBeenCalled();
  expect(h.stored).toEqual(stopped.record);
  expect(h.stored!.gcode).toBe(gcode);
  expect(interruptedJob.value).toBe(stopped);
  expect(useStore.getState().toolpath!.gcode).toBe(gcode);
});

it('N4 a stale Resume action cannot replace a preparing or physically executing setup', async () => {
  const stopped = interrupted();
  h.api.jobStartedAt.value = 123;
  const previous = useStore.getState().toolpath;
  await expect(runResume(stopped, 3)).rejects.toThrow(/running|prepar|review/i);
  expect(h.api.uploadGcode).not.toHaveBeenCalled();
  expect(h.api.runFile).not.toHaveBeenCalled();
  expect(useStore.getState().toolpath).toBe(previous);
});
