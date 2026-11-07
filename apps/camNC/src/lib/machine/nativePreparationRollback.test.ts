import { waitFor } from '@testing-library/react';
import { signal } from '@preact/signals-react';
import { createPlateDocument } from '@wbcnc/cad';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { acceptDesign, saveDesignDraft } from '@/cam/cadDesign';
import { boardRequest, instancesOf, nestBoard, reconcileBoards, withLayout } from '@/cam/boards';
import { createDesignJob, getJob, saveJob } from '@/cam/jobDb';
import { nativeCadModel } from '@/cam/nativeCadModel';
import type { PlanResult } from '@/cam/camTypes';
import { machineQueue, useCamMachine } from '@/cam/machine/camMachine';
import type { ManufacturingSnapshot } from '@/cam/machine/manufacturingSnapshot';
import type { CncApi } from '../fluidnc/cnc-api';
import { useStore } from '@/store/store';
import { uploadAndRun } from './jobs';
import { acknowledgeRunReview, interruptedJob, recoveryPending } from './jobRecovery';
import { clearJobRecord, loadJobRecord, saveJobRecord, type JobRecord } from './jobRecord';
const h = vi.hoisted(() => ({
  api: null as unknown as CncApi,
  failAfterHistory: false,
  throwAfterWrite: false,
  files: new Map<string, string>(),
}));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => h.api }));
vi.mock('@/cam/machine/nativeRunPreparation', async original => ({
  ...(await original<typeof import('@/cam/machine/nativeRunPreparation')>()),
  prepareNativeRun: async (...args: Parameters<typeof import('@/cam/machine/nativeRunPreparation').prepareNativeRun>) => {
    const result = await (await original<typeof import('@/cam/machine/nativeRunPreparation')>()).prepareNativeRun(...args);
    if (h.throwAfterWrite) {
      const { NativePreparationFailure } = await original<typeof import('@/cam/machine/nativeRunPreparation')>();
      throw new NativePreparationFailure('Claim committed but acknowledgement lost', result, new Error('Storage acknowledgement lost'));
    }
    if (h.failAfterHistory) h.api.status.value = { ...h.api.status.value!, wco: { x: 5, y: 0, z: 0 } };
    return result;
  },
}));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: Object.assign(vi.fn(), { promise: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
let host = '';
beforeEach(() => {
  host = `preparation-rollback-${crypto.randomUUID()}.test`;
  h.files.clear();
  h.failAfterHistory = false;
  h.throwAfterWrite = false;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
  interruptedJob.value = null;
  recoveryPending.value = false;
  h.api = {
    getCurrentZero: async () => structuredClone(h.api.status.value!.wco),
    host: signal(host),
    isConnected: signal(true),
    state: signal('Idle'),
    status: signal({ state: 'Idle', mpos: { x: 0, y: 0, z: 10 }, wco: { x: 0, y: 0, z: 0 } }),
    jobStartedAt: signal(null),
    jobProgress: signal(null),
    homed: signal(true),
    zZeroedAt: signal(1),
    travel: signal(null),
    uploadGcode: vi.fn(async (gcode: string, file: string) => {
      h.files.set(file, gcode);
    }),
    deleteFile: vi.fn(async (file: string) => {
      h.files.delete(file);
    }),
    runFile: vi.fn().mockResolvedValue(undefined),
  } as unknown as CncApi;
});
afterEach(async () => {
  await clearJobRecord(host);
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  interruptedJob.value = null;
});
async function nativeSetup() {
  const empty = await createDesignJob('Failed preparation stock');
  const document = { ...createPlateDocument({ width: 100, height: 80, thickness: 18 }), id: empty.design!.draft.id };
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const model = (await nativeCadModel(accepted.design!.accepted!)).model;
  const instances = instancesOf(model.parts, () => true);
  const initial = { ...reconcileBoards(undefined, instances, 'oak')[0], taped: true };
  const board = withLayout(initial, nestBoard(initial, instances, 3.175));
  const job = await saveJob({ ...accepted, boards: [board] });
  const nest = nestBoard(board, instances, 3.175, { preserveLayout: true });
  const gcode = 'G21 G90\nG0 Z25\nG1 X100 F300\nM30';
  const plan = {
    sourceKey: 'source-test',
    programs: [{ tool: 1, diameter: 3.175, gcode, timeMin: 1 }],
    bits: [3.175],
    size: [100, 80, 18],
    ops: [],
    warnings: [],
    safety: [],
    path: [],
    timeMin: 1,
  } as unknown as PlanResult;
  const entry = machineQueue([{ board, nest, request: boardRequest(board, nest, instances) }], [plan])[0];
  const snapshot: ManufacturingSnapshot = {
    jobId: job.id,
    sourceKey: 'source-test',
    designRevision: job.design!.acceptedRevision,
    boardWasSaved: true,
    active: entry.key,
    doneId: entry.doneId,
    gcode,
    queue: [entry],
    recordQueue: [entry],
    parts: model.parts,
    instances,
    nestBit: 3.175,
    overlay: null,
  };
  useStore.getState().updateToolpath(gcode, 'Plate');
  useCamMachine.setState({ jobId: job.id, active: entry.key, loadedSnapshot: snapshot });
  return { job, snapshot };
}
it('P8 compensates its unexecuted physical history when preparation fails after the board marker was saved', async () => {
  const { job } = await nativeSetup();
  h.failAfterHistory = true;
  await expect(uploadAndRun()).rejects.toThrow(/controller position|activity changed/i);
  expect(h.api.runFile).not.toHaveBeenCalled();
  expect((await getJob(job.id))!.boards![0].cut).toBeUndefined();
}, 30_000);
it('P3 a failed native preparation over a completed imported receipt can close without deleting that prior receipt', async () => {
  const { snapshot } = await nativeSetup();
  const prior: JobRecord = {
    host,
    executionId: crypto.randomUUID(),
    execution: 'finished',
    gcode: 'G21\nG1 X4 F300',
    sdFile: 'old-user-import.gcode',
    startedAt: 1,
    toolpathName: 'Imported finished',
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    homed: true,
    zZeroedAt: 1,
  };
  await saveJobRecord(prior);
  useCamMachine.setState({ runRecord: { host: prior.host, startedAt: prior.startedAt, executionId: prior.executionId } });
  h.failAfterHistory = true;
  await expect(uploadAndRun()).rejects.toThrow();
  expect(h.api.runFile).not.toHaveBeenCalled();
  expect(useCamMachine.getState().jobId).toBe(snapshot.jobId);
  expect(await acknowledgeRunReview()).toBe(true);
  expect(useCamMachine.getState().runReview).toBeNull();
  expect(await loadJobRecord(host)).toEqual(prior);
}, 30_000);
it('P5 removes only its failed unexecuted UUID upload while retaining user and prior recovery SD files', async () => {
  await nativeSetup();
  const userFile = 'cabinet-user.gcode';
  const previousFile = `camnc-${crypto.randomUUID()}.gcode`;
  const previous: JobRecord = {
    host,
    executionId: crypto.randomUUID(),
    execution: 'stopped',
    gcode: 'G21\nG1 X4 F300',
    sdFile: previousFile,
    startedAt: 1,
    toolpathName: 'Prior resumable import',
    toolpathOffset: { x: 0, y: 0, z: 0 },
    stockHeight: 18,
    toolDiameter: 3,
    wco: { x: 0, y: 0, z: 0 },
    homed: true,
    zZeroedAt: 1,
  };
  await saveJobRecord(previous);
  h.files.set(userFile, 'user bytes');
  h.files.set(previousFile, previous.gcode);
  h.failAfterHistory = true;
  await expect(uploadAndRun()).rejects.toThrow();
  expect(h.api.runFile).not.toHaveBeenCalled();
  await waitFor(() => expect(new Set(h.files.keys())).toEqual(new Set([userFile, previousFile])));
  expect(await loadJobRecord(host)).toEqual(previous);
}, 30_000);

it('P8 keeps the physical claim and recovery file after runFile was invoked but its transport outcome is uncertain', async () => {
  const { job } = await nativeSetup();
  vi.mocked(h.api.runFile).mockRejectedValue(new Error('Transport disconnected after request'));
  await expect(uploadAndRun()).rejects.toThrow('Transport disconnected');
  expect(h.api.runFile).toHaveBeenCalledOnce();
  const record = await loadJobRecord(host);
  expect(record?.execution).toBe('requested');
  const cut = (await getJob(job.id))!.boards![0].cut;
  expect(cut?.startedKeys).toContain(record!.camSnapshot!.doneId);
  expect(cut?.startClaims?.[record!.executionId!]?.doneId).toBe(record!.camSnapshot!.doneId);
  expect(h.files.has(record!.sdFile)).toBe(true);
  expect(useCamMachine.getState().runReview).toBe('requested');
}, 30_000);

it('P8 compensates a committed claim when the helper rejects before returning its receipt', async () => {
  const { job } = await nativeSetup();
  h.throwAfterWrite = true;
  await expect(uploadAndRun()).rejects.toThrow('Claim committed but acknowledgement lost');
  expect(h.api.runFile).not.toHaveBeenCalled();
  expect((await getJob(job.id))!.boards![0].cut).toBeUndefined();
  expect(await loadJobRecord(host)).toBeNull();
  expect(useCamMachine.getState().runReview).toBeNull();
}, 30_000);
