import { createPlateDocument } from '@wbcnc/cad';
import { afterEach, expect, it, vi } from 'vitest';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';
import { newBoard } from '../boards';
import { acceptDesign, boardGeometryKey, saveDesignDraft } from '../cadDesign';
import { createDesignJob, getJob, modelKey, saveJob } from '../jobDb';
import type { ManufacturingSnapshot } from './manufacturingSnapshot';
import { NativePreparationFailure, prepareNativeRun, rollbackNativePreparation } from './nativeRunPreparation';

const hook = vi.hoisted(() => ({ afterWrite: 'none' as 'none' | 'throw' | 'mode' }));
vi.mock('../jobDb', async original => {
  const real = await original<typeof import('../jobDb')>();
  return {
    ...real,
    updateJobForModel: async (...args: Parameters<typeof real.updateJobForModel>) => {
      const saved = await real.updateJobForModel(...args);
      if (saved && hook.afterWrite !== 'none') {
        const change = hook.afterWrite;
        hook.afterWrite = 'none';
        if (change === 'mode') setDemoModeForTest(true);
        else throw new Error('Transaction acknowledgement failed after commit');
      }
      return saved;
    },
  };
});
afterEach(() => {
  hook.afterWrite = 'none';
  setDemoModeForTest(false);
});

async function fixture() {
  setDemoModeForTest(false);
  const empty = await createDesignJob('Uncertain native preparation');
  const document = { ...createPlateDocument({ width: 60, height: 40, thickness: 18 }), id: empty.design!.draft.id };
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const board = { ...newBoard([], 18, 'oak', [`${document.parts[0]!.id}#0`]), physicalSheetId: crypto.randomUUID() };
  const job = await saveJob({ ...accepted, boards: [board] }, accepted);
  const snapshot = {
    jobId: job.id,
    runId: 'run',
    designRevision: job.design!.acceptedRevision,
    sourceKey: modelKey(job),
    boardWasSaved: true,
    active: 'program',
    doneId: 'done',
    gcode: 'G21\nM30',
    queue: [{ key: 'program', kind: 'bit', doneId: 'done', sourceKey: boardGeometryKey(job, [document.parts[0]!.id]), board: { board } }],
    parts: [],
    instances: [],
    nestBit: 3.175,
    overlay: null,
  } as unknown as ManufacturingSnapshot;
  return { job, board, snapshot };
}

async function failedPreparation(snapshot: ManufacturingSnapshot) {
  try {
    await prepareNativeRun(snapshot, 'execution-a');
  } catch (error) {
    return error;
  }
  throw new Error('Expected the controlled post-write failure');
}

it('returns committed ownership on an uncertain transaction acknowledgement so the caller can compensate', async () => {
  const { job, board, snapshot } = await fixture();
  hook.afterWrite = 'throw';
  const error = await failedPreparation(snapshot);
  expect(error).toBeInstanceOf(NativePreparationFailure);
  if (!(error instanceof NativePreparationFailure)) throw error;
  expect(error.receipt.executionId).toBe('execution-a');
  expect((await getJob(job.id))!.boards![0]!.cut!.startClaims).toHaveProperty('execution-a');
  expect(await rollbackNativePreparation(error.receipt)).toBe(true);
  expect((await getJob(job.id))!.boards).toEqual([board]);
});

it('retains the exact original receipt on a postcommit namespace change and never compensates another namespace', async () => {
  const { job, board, snapshot } = await fixture();
  setDemoModeForTest(true);
  const otherNamespace = await saveJob({ ...job, name: 'Untouched demo project', boards: [] });
  setDemoModeForTest(false);
  hook.afterWrite = 'mode';
  const error = await failedPreparation(snapshot);
  expect(error).toBeInstanceOf(NativePreparationFailure);
  if (!(error instanceof NativePreparationFailure)) throw error;
  await expect(rollbackNativePreparation(error.receipt)).rejects.toThrow(/storage mode/);
  expect(await getJob(job.id)).toEqual(otherNamespace);
  setDemoModeForTest(false);
  expect((await getJob(job.id))!.boards![0]!.cut!.startClaims).toHaveProperty('execution-a');
  await rollbackNativePreparation(error.receipt);
  expect((await getJob(job.id))!.boards).toEqual([board]);
});

it('keeps known pre-write validation failures distinct from uncertain committed claims', async () => {
  const { job, board, snapshot } = await fixture();
  await saveJob({ ...job, boards: [{ ...board, cut: { at: 1, sourceKey: 'another-source', keys: [], startedKeys: ['physical'] } }] }, job);
  const before = await getJob(job.id);
  const error = await failedPreparation(snapshot);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(NativePreparationFailure);
  expect(await getJob(job.id)).toEqual(before);
});
