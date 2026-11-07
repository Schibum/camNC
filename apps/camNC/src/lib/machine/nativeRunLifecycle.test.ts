import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { signal } from '@preact/signals-react';
import type { CncApi } from '../fluidnc/cnc-api';
import { waitFor } from '@testing-library/react';
import { createPlateDocument, updateDimension } from '@wbcnc/cad';
import { useStore } from '@/store/store';
import { acceptDesign, boardGeometryKey, saveDesignDraft } from '@/cam/cadDesign';
import { instancesOf, isCut, nestBoard, reconcileBoards, withLayout } from '@/cam/boards';
import { createDesignJob, getJob, saveJob } from '@/cam/jobDb';
import { nativeCadModel } from '@/cam/nativeCadModel';
import { isManufacturingLocked, machineQueue, useCamMachine } from '@/cam/machine/camMachine';
import type { JobBoard } from '@/cam/useJobBoards';
import type { PlanResult } from '@/cam/camTypes';
import { clearJobRecord, loadJobProgress, loadJobRecord } from './jobRecord';
import { acknowledgeRunReview, dismissInterruptedJob, interruptedJob, noteJobStopRequested, watchJobRecovery } from './jobRecovery';
import { runResume, uploadAndRun } from './jobs';

const h = vi.hoisted(() => ({
  api: {
    async getCurrentZero() {
      return structuredClone(this.status.value.wco);
    },
    uploadGcode: vi.fn<() => Promise<void>>(),
    runFile: vi.fn<() => Promise<void>>(),
    status: { value: { state: 'Idle', mpos: { x: 0, y: 0, z: 10 }, wco: { x: 0, y: 0, z: 0 } } },
    travel: { value: null },
    host: { value: 'native-lifecycle.test' },
    jobStartedAt: { value: null as number | null },
    jobProgress: { value: null as number | null },
    homed: { value: true },
    zZeroedAt: { value: 1 },
    isConnected: { value: true },
    lastAlarm: { value: null },
  },
}));
vi.mock('@/lib/fluidnc/machine', () => ({ getCncApi: () => h.api, getExistingCncApi: () => h.api }));
vi.mock('@/lib/fluidnc/machineInstance', () => ({ getExistingCncApi: () => h.api }));
vi.mock('@wbcnc/ui/components/sonner', () => ({ toast: { promise: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  h.api.uploadGcode.mockResolvedValue();
  h.api.runFile.mockResolvedValue();
  h.api.jobProgress = signal<number | null>(null);
  h.api.jobStartedAt = signal<number | null>(null);
  h.api.status = signal({ state: 'Idle', mpos: { x: 0, y: 0, z: 10 }, wco: { x: 0, y: 0, z: 0 } });
  h.api.isConnected = signal(true);
  h.api.lastAlarm = signal(null);
  interruptedJob.value = null;
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(useStore.getInitialState(), true);
});
afterEach(async () => {
  await clearJobRecord(h.api.host.value);
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

async function nativeSetup() {
  const empty = await createDesignJob('Physical run provenance');
  const document = { ...createPlateDocument({ width: 100, height: 80, thickness: 18 }), id: empty.design!.draft.id };
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const { model } = await nativeCadModel(accepted.design!.accepted!);
  const instances = instancesOf(model.parts, () => true);
  const boards = reconcileBoards(undefined, instances, 'oak').map(b => withLayout({ ...b, taped: true }, nestBoard(b, instances, 3.175)));
  const job = await saveJob({ ...accepted, boards });
  const board = boards[0];
  const gcode = 'G21 G90\nG0 Z25\nG1 X10 F300\nM30';
  const plan = {
    sourceKey: boardGeometryKey(
      job,
      document.parts.map(p => p.id)
    ),
    programs: [{ tool: 1, diameter: 3.175, gcode, timeMin: 1 }],
    bits: [3.175],
    size: [board.layout!.w, board.layout!.h, 18.3],
    ops: [],
    safety: [],
    warnings: [],
    path: [],
    timeMin: 1,
  } as unknown as PlanResult;
  const entry = machineQueue(
    [{ board, nest: { board: { w: board.layout!.w, h: board.layout!.h } }, request: { parts: [{ id: board.items[0] }] } } as JobBoard],
    [plan]
  )[0];
  const snapshot = {
    boardWasSaved: true,
    jobId: job.id,
    sourceKey: `${job.id}:cad:${job.design!.acceptedRevision}`,
    designRevision: job.design!.acceptedRevision,
    active: entry.key,
    doneId: entry.doneId,
    gcode,
    queue: [entry],
    recordQueue: [entry],
    parts: model.parts,
    instances,
    nestBit: 3.175,
    overlay: { w: plan.size[0], h: plan.size[1], rotationDeg: 0, boardId: board.id },
  };
  useStore.getState().updateToolpath(gcode, 'Original plate');
  useCamMachine.setState({ jobId: job.id, active: entry.key, loadedSnapshot: snapshot, overlay: snapshot.overlay });
  return { job, board, snapshot, document };
}

it('N1 durably records the original physical board before a native run dispatch, without marking it completed', async () => {
  const f = await nativeSetup();
  let atDispatch: Awaited<ReturnType<typeof getJob>>;
  h.api.runFile.mockImplementation(async () => {
    atDispatch = await getJob(f.job.id);
  });
  await uploadAndRun();
  const board = atDispatch!.boards!.find(b => b.id === f.board.id)!;
  expect(isCut(board)).toBe(true);
  expect(board.cut?.sourceKey).toBe(f.snapshot.queue[0].sourceKey);
  expect(board.cut?.keys).not.toContain(f.snapshot.doneId);
  expect((board.cut as unknown as { startedKeys: string[] }).startedKeys).toContain(f.snapshot.doneId);
}, 30_000);

it('N1/N5 protects the executed original after Idle until its explicit run review, before Done is clicked', async () => {
  await nativeSetup();
  await uploadAndRun();
  expect(isManufacturingLocked()).toBe(true);
}, 30_000);

it('N1 does not mark physical history when upload fails before execution is requested', async () => {
  const f = await nativeSetup();
  h.api.uploadGcode.mockRejectedValue(new Error('upload failed'));
  await expect(uploadAndRun()).rejects.toThrow('upload failed');
  expect((await getJob(f.job.id))!.boards!.find(b => b.id === f.board.id)!.cut).toBeUndefined();
  expect(h.api.runFile).not.toHaveBeenCalled();
}, 30_000);

it('N1 records finished original geometry before Done even when a second CAD revision was accepted during the physical run', async () => {
  const f = await nativeSetup();
  await uploadAndRun();
  const base = h.api.status.value;
  const started = (await loadJobRecord(h.api.host.value))!;
  h.api.status.value = { ...base, state: 'Run', job: { file: `/sd/${started.sdFile}`, percent: 40 } } as typeof base;
  const dispose = watchJobRecovery(h.api as unknown as CncApi);
  try {
    await waitFor(async () => expect((await loadJobProgress(h.api.host.value))?.percent).toBe(40));
    const width = f.document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
    const changed = updateDimension(f.document, width.id, 110);
    const current = (await getJob(f.job.id))!;
    const revised = await acceptDesign(await saveDesignDraft(current, changed), changed);
    h.api.jobStartedAt.value = null;
    h.api.status.value = { ...base, state: 'Idle' } as typeof base;
    await waitFor(async () => expect((await loadJobRecord(h.api.host.value))?.execution).toBe('finished'));
    const saved = (await getJob(f.job.id))!;
    expect(saved.design!.acceptedRevision).toBe(revised.design!.acceptedRevision);
    expect(saved.boards![0].cut?.sourceKey).toBe(f.snapshot.queue[0].sourceKey);
    expect(saved.boards![0].cut?.keys).toContain(f.snapshot.doneId);
    expect(useCamMachine.getState().runSnapshot?.designRevision).toBe(f.snapshot.designRevision);
    expect(useCamMachine.getState().runReview).toBe('finished');
    expect(isManufacturingLocked()).toBe(true);
    expect(await acknowledgeRunReview()).toBe(true);
    expect(isManufacturingLocked()).toBe(false);
    expect((await getJob(f.job.id))!.boards![0].cut?.keys).toContain(f.snapshot.doneId);
  } finally {
    dispose();
  }
}, 30_000);

it('N1 keeps stopped physical history after Dismiss without declaring the original program completed', async () => {
  const f = await nativeSetup();
  await uploadAndRun();
  const base = h.api.status.value;
  const started = (await loadJobRecord(h.api.host.value))!;
  h.api.status.value = { ...base, state: 'Run', job: { file: `/sd/${started.sdFile}`, percent: 40 } } as typeof base;
  const dispose = watchJobRecovery(h.api as unknown as CncApi);
  try {
    await waitFor(async () => expect((await loadJobProgress(h.api.host.value))?.percent).toBe(40));
    noteJobStopRequested();
    h.api.jobStartedAt.value = null;
    h.api.status.value = { ...base, state: 'Idle' } as typeof base;
    await waitFor(() => expect(interruptedJob.value).not.toBeNull());
    dismissInterruptedJob();
    expect(useCamMachine.getState().runReview).toBe('stopped');
    expect(isManufacturingLocked()).toBe(true);
    const cut = (await getJob(f.job.id))!.boards![0].cut!;
    expect(cut.startedKeys).toContain(f.snapshot.doneId);
    expect(cut.keys).not.toContain(f.snapshot.doneId);
    await acknowledgeRunReview();
    expect(useCamMachine.getState().done).not.toContain(f.snapshot.doneId);
    expect(isCut((await getJob(f.job.id))!.boards![0])).toBe(true);
  } finally {
    dispose();
  }
}, 30_000);

it('N1 conservatively keeps a requested run receipt when the controller response is uncertain', async () => {
  const f = await nativeSetup();
  h.api.runFile.mockRejectedValue(new Error('connection lost after dispatch'));
  await expect(uploadAndRun()).rejects.toThrow('connection lost');
  expect(isCut((await getJob(f.job.id))!.boards![0])).toBe(true);
  expect(useCamMachine.getState().runReview).toBe('requested');
  expect((await loadJobRecord(h.api.host.value))?.execution).toBe('requested');
}, 30_000);

it('N1 accepts CAD changes during upload yet records and executes the original physical source', async () => {
  const f = await nativeSetup();
  h.api.uploadGcode.mockImplementation(async () => {
    const width = f.document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
    const changed = updateDimension(f.document, width.id, 110);
    const current = (await getJob(f.job.id))!;
    await acceptDesign(await saveDesignDraft(current, changed), changed);
  });
  await uploadAndRun();
  const saved = (await getJob(f.job.id))!;
  expect(saved.design!.acceptedRevision).toBeGreaterThan(f.snapshot.designRevision);
  expect(saved.boards![0].cut?.sourceKey).toBe(f.snapshot.queue[0].sourceKey);
  expect(h.api.runFile).toHaveBeenCalledOnce();
}, 30_000);

it('N1 refuses dispatch if the saved physical board was removed during upload', async () => {
  const f = await nativeSetup();
  h.api.uploadGcode.mockImplementation(async () => {
    const current = (await getJob(f.job.id))!;
    await saveJob({ ...current, boards: [] }, current);
  });
  await expect(uploadAndRun()).rejects.toThrow(/board|sheet/i);
  expect(h.api.runFile).not.toHaveBeenCalled();
  expect((await getJob(f.job.id))!.boards).toEqual([]);
}, 30_000);

it('N3 refuses to resume onto a sheet explicitly started over and preserves the prior durable full program', async () => {
  const f = await nativeSetup();
  await uploadAndRun();
  const record = (await loadJobRecord(h.api.host.value))!;
  const current = (await getJob(f.job.id))!;
  await saveJob({ ...current, boards: current.boards!.map(b => ({ ...b, cut: undefined })) }, current);
  const stopped = {
    record,
    reason: 'Stopped',
    progress: {
      host: record.host,
      file: record.sdFile,
      percent: 40,
      at: record.startedAt + 1,
      mpos: { x: 0, y: 0, z: 0 },
      wco: record.wco,
    },
  };
  interruptedJob.value = stopped;
  h.api.runFile.mockClear();
  await expect(runResume(stopped, 2)).rejects.toThrow(/board|sheet/i);
  expect(h.api.runFile).not.toHaveBeenCalled();
  expect((await getJob(f.job.id))!.boards![0].cut).toBeUndefined();
  expect((await loadJobRecord(record.host))!.gcode).toBe(record.gcode);
}, 30_000);
