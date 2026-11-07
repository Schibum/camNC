import { createPlateDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { newBoard, startOverBoard } from '../boards';
import { acceptDesign, boardGeometryKey, saveDesignDraft } from '../cadDesign';
import { createDesignJob, getJob, modelKey, saveJob } from '../jobDb';
import type { ManufacturingSnapshot } from './manufacturingSnapshot';
import { recordNativeRun } from './nativeRunHistory';
import { prepareNativeRun, rollbackNativePreparation } from './nativeRunPreparation';
import { rebaseJob } from '../rebaseJob';

async function fixture() {
  const empty = await createDesignJob('Native preparation rollback');
  const document = { ...createPlateDocument({ width: 100, height: 60, thickness: 18 }), id: empty.design!.draft.id };
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const partId = document.parts[0]!.id;
  const board = {
    ...newBoard([], 18, 'oak', [`${partId}#0`]),
    physicalSheetId: crypto.randomUUID(),
    layout: { w: 150, h: 100, at: { [`${partId}#0`]: { x: 10, y: 10, rotated: false } } },
    taped: true,
    bed: { a: { x: 40, y: 50, deg: 15 } },
    fixtures: [{ kind: 'screw' as const, x: 3, y: 3 }],
  };
  const job = await saveJob({ ...accepted, boards: [board] }, accepted);
  const snapshot = {
    jobId: job.id,
    sourceKey: modelKey(job),
    designRevision: job.design!.acceptedRevision,
    runId: crypto.randomUUID(),
    boardWasSaved: true,
    active: `${board.id}:bit:0`,
    doneId: 'first-program',
    gcode: 'G21\nM30',
    queue: [
      { key: `${board.id}:bit:0`, doneId: 'first-program', kind: 'bit', board: { board }, sourceKey: boardGeometryKey(job, [partId]) },
    ],
    parts: [],
    instances: [],
    nestBit: 3.175,
    overlay: null,
  } as unknown as ManufacturingSnapshot;
  return { job, board, snapshot };
}

function another(snapshot: ManufacturingSnapshot, doneId: string) {
  const next = structuredClone(snapshot);
  next.doneId = doneId;
  next.queue[0]!.doneId = doneId;
  return next;
}

it('releases an unrequested preparation completely while retaining layout, holds and bed placement', async () => {
  const { job, board, snapshot } = await fixture();
  const receipt = await prepareNativeRun(snapshot, 'execution-a');
  expect((await getJob(job.id))!.boards![0]!.cut!.startedKeys).toEqual([snapshot.doneId]);
  expect(await rollbackNativePreparation(receipt)).toBe(true);
  expect((await getJob(job.id))!.boards).toEqual([board]);
  expect(await rollbackNativePreparation(receipt)).toBe(false);
});

it.each([false, true])('keeps concurrent identical preparations independently owned, then returns to uncut (reverse=%s)', async reverse => {
  const { job, board, snapshot } = await fixture();
  const receipts = await Promise.all([prepareNativeRun(snapshot, 'execution-a'), prepareNativeRun(snapshot, 'execution-b')]);
  const stored = (await getJob(job.id))!;
  expect(Object.keys(stored.boards![0]!.cut!.startClaims!)).toHaveLength(2);
  if (reverse) receipts.reverse();
  await rollbackNativePreparation(receipts[0]!);
  const remaining = (await getJob(job.id))!.boards![0]!.cut!;
  expect(remaining.startedKeys).toEqual([snapshot.doneId]);
  expect(Object.keys(remaining.startClaims!)).toEqual([receipts[1]!.executionId]);
  await rollbackNativePreparation(receipts[1]!);
  expect((await getJob(job.id))!.boards).toEqual([board]);
});

it('serializes two simultaneous rollback transactions without leaving an unrequested mark', async () => {
  const { job, board, snapshot } = await fixture();
  const receipts = await Promise.all([prepareNativeRun(snapshot, 'execution-a'), prepareNativeRun(snapshot, 'execution-b')]);
  expect(await Promise.all(receipts.map(rollbackNativePreparation))).toEqual([true, true]);
  expect((await getJob(job.id))!.boards).toEqual([board]);
});

it('refuses to reuse an execution identity for another program', async () => {
  const { job, snapshot } = await fixture();
  await prepareNativeRun(snapshot, 'execution-a');
  const before = (await getJob(job.id))!;
  await expect(prepareNativeRun(another(snapshot, 'second-program'), 'execution-a')).rejects.toThrow(/already owns/);
  expect((await getJob(job.id))!.boards).toEqual(before.boards);
});

it('preserves another pending program when only the first preparation is refused', async () => {
  const { job, snapshot } = await fixture();
  const a = await prepareNativeRun(snapshot, 'execution-a');
  await prepareNativeRun(another(snapshot, 'second-program'), 'execution-b');
  await rollbackNativePreparation(a);
  const cut = (await getJob(job.id))!.boards![0]!.cut!;
  expect(cut.startedKeys).toEqual(['second-program']);
  expect(cut.startClaims!['execution-b']!.doneId).toBe('second-program');
  expect(cut.keys).toEqual([]);
  expect(cut.all).toBeUndefined();
});

it('preserves prior started/completed facts and restores their original complete status', async () => {
  const { job, snapshot } = await fixture();
  await recordNativeRun(snapshot);
  await recordNativeRun(snapshot, true);
  const before = (await getJob(job.id))!;
  expect(before.boards![0]!.cut!.all).toBe(true);
  const same = await prepareNativeRun(snapshot, 'same-program-retry');
  await rollbackNativePreparation(same);
  expect((await getJob(job.id))!.boards).toEqual(before.boards);
  const receipts = await Promise.all([
    prepareNativeRun(another(snapshot, 'second-program'), 'execution-b'),
    prepareNativeRun(another(snapshot, 'third-program'), 'execution-c'),
  ]);
  await rollbackNativePreparation(receipts[0]!);
  await rollbackNativePreparation(receipts[1]!);
  expect((await getJob(job.id))!.boards).toEqual(before.boards);
});

it('cannot erase a completion that arrives after preparation', async () => {
  const { job, snapshot } = await fixture();
  const receipt = await prepareNativeRun(snapshot, 'execution-a');
  await recordNativeRun(snapshot, true);
  await rollbackNativePreparation(receipt);
  const cut = (await getJob(job.id))!.boards![0]!.cut!;
  expect(cut.keys).toEqual([snapshot.doneId]);
  expect(cut.startedKeys).toEqual([snapshot.doneId]);
  expect(cut.all).toBe(true);
});

it.each(['generation', 'source'] as const)('does not roll back a replacement physical %s', async changed => {
  const { job, board, snapshot } = await fixture();
  const receipt = await prepareNativeRun(snapshot, 'execution-a');
  const current = (await getJob(job.id))!;
  const replacement =
    changed === 'generation'
      ? startOverBoard(current.boards![0]!)
      : { ...board, cut: { at: 2, sourceKey: 'another-source', keys: [], startedKeys: ['other-program'] } };
  await saveJob({ ...current, boards: [replacement] }, current);
  expect(await rollbackNativePreparation(receipt)).toBe(false);
  expect((await getJob(job.id))!.boards).toEqual([replacement]);
});

it('rejects preparation on changed-source stock before adding any claim', async () => {
  const { job, board, snapshot } = await fixture();
  const changed = { ...board, cut: { at: 2, sourceKey: 'another-source', keys: [], startedKeys: ['other-program'] } };
  await saveJob({ ...job, boards: [changed] }, job);
  await expect(prepareNativeRun(snapshot, 'execution-a')).rejects.toThrow(/another design/);
  expect((await getJob(job.id))!.boards).toEqual([changed]);
});

it('keeps an execution claim when a concurrent legacy completion is rebased onto it', async () => {
  const { job, snapshot } = await fixture();
  await prepareNativeRun(snapshot, 'execution-a');
  const current = (await getJob(job.id))!;
  const oldCompletion = {
    ...job,
    boards: [{ ...job.boards![0]!, cut: { at: 1, sourceKey: snapshot.queue[0]!.sourceKey, keys: ['older-program'] } }],
  };
  const merged = rebaseJob(job, oldCompletion, current);
  expect(merged.boards![0]!.cut!.startClaims).toEqual(current.boards![0]!.cut!.startClaims);
  expect(merged.boards![0]!.cut!.startedKeys).toEqual([snapshot.doneId]);
  expect(merged.boards![0]!.cut!.keys).toEqual(['older-program']);
});
