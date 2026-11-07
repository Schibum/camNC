import { createPlateDocument, updateDimension } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { acceptDesign, boardGeometryKey, saveDesignDraft } from '../cadDesign';
import { boardRequest, instancesOf, nestBoard, physicalSheetIdOf, reconcileBoards, withLayout, type BoardV1 } from '../boards';
import { createDesignJob, getJob, modelKey, saveJob, type CamJobV1 } from '../jobDb';
import { nativeCadModel } from '../nativeCadModel';
import type { ModelImport, PlanResult } from '../camTypes';
import { machineQueue } from './camMachine';
import type { ManufacturingSnapshot } from './manufacturingSnapshot';
import { recordNativeRun } from './nativeRunHistory';

function snapshotFor(job: CamJobV1, model: ModelImport, cleanBoard: BoardV1): ManufacturingSnapshot {
  const instances = instancesOf(model.parts, () => true);
  const nest = nestBoard(cleanBoard, instances, 3.175, { preserveLayout: true });
  const board = withLayout(cleanBoard, nest);
  const gcode = `G21 G90\nG0 Z25\nG1 X${model.parts[0].size[0]} F300\nM30`;
  const plan = {
    sourceKey: boardGeometryKey(
      job,
      instances.map(part => part.partId)
    ),
    programs: [{ tool: 1, diameter: 3.175, gcode, timeMin: 1 }],
    bits: [3.175],
    size: [nest.board.w, nest.board.h, 18.3],
    ops: [],
    safety: [],
    warnings: [],
    path: [],
    timeMin: 1,
  } as unknown as PlanResult;
  const entry = machineQueue([{ board, nest, request: boardRequest(board, nest, instances) }], [plan])[0];
  expect(entry.kind).toBe('bit');
  return {
    runId: crypto.randomUUID(),
    jobId: job.id,
    sourceKey: modelKey(job),
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
}

it('rejects a cached clean revision-two program after another view commits revision-one cutting on the same physical sheet', async () => {
  const empty = await createDesignJob('Two native views, one sheet');
  const document = { ...createPlateDocument({ width: 100, height: 80, thickness: 18 }), id: empty.design!.draft.id };
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const modelA = (await nativeCadModel(accepted.design!.accepted!)).model;
  const instances = instancesOf(modelA.parts, () => true);
  const unlaid = { ...reconcileBoards(undefined, instances, 'oak')[0], taped: true };
  const board = withLayout(unlaid, nestBoard(unlaid, instances, 3.175));
  const jobA = await saveJob({ ...accepted, boards: [board] });
  const runA = snapshotFor(jobA, modelA, board);
  // B accepts and caches its clean revision-two board before A's deferred upload marks physical history.
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const changed = updateDimension(document, width.id, 140);
  const jobB = await acceptDesign(await saveDesignDraft(jobA, changed), changed);
  const modelB = (await nativeCadModel(jobB.design!.accepted!)).model;
  const runB = snapshotFor(jobB, modelB, jobB.boards![0]);
  expect(runB.queue[0].board.board.cut).toBeUndefined();
  expect(runB.queue[0].sourceKey).not.toBe(runA.queue[0].sourceKey);
  expect(physicalSheetIdOf(runB.queue[0].board.board)).toBe(physicalSheetIdOf(runA.queue[0].board.board));
  await recordNativeRun(runA);
  const started = (await getJob(jobA.id))!;
  expect(started.boards![0].cut?.sourceKey).toBe(runA.queue[0].sourceKey);
  // Reviewing/removing a host receipt must not erase this durable stock-source guard.
  await expect(recordNativeRun(runB)).rejects.toThrow(/source|design|sheet|revision/i);
  expect((await getJob(jobA.id))!.boards![0].cut?.startedKeys).not.toContain(runB.doneId);
  // Other programs from the original board source remain valid even though the editable CAD document is newer.
  const nextA = structuredClone(runA);
  nextA.doneId = 'next-program-from-original-source';
  nextA.queue[0].doneId = nextA.doneId;
  await recordNativeRun(nextA);
  expect((await getJob(jobA.id))!.boards![0].cut?.startedKeys).toContain(nextA.doneId);
  await recordNativeRun(runA, true);
  const completed = (await getJob(jobA.id))!;
  expect(completed.boards![0].cut?.keys).toContain(runA.doneId);
  expect(completed.boards![0].cut?.sourceKey).toBe(runA.queue[0].sourceKey);
  expect(completed.design!.acceptedRevision).toBe(jobB.design!.acceptedRevision);
  await expect(recordNativeRun(runA, false, true)).resolves.toBeDefined();
}, 30_000);
