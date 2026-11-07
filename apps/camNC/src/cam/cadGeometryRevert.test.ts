import { createPlateDocument, updateDimension } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { layoutBlock } from './boardBlock';
import { boardRequest, instancesOf, nestBoard, reconcileBoards, withLayout } from './boards';
import { acceptDesign, boardGeometryKey, saveDesignDraft } from './cadDesign';
import type { CamJobV1 } from './jobDb';
import { createDesignJob, getJob, modelKey, saveJob } from './jobDb';
import { nativeCadModel } from './nativeCadModel';
import type { PlanResult } from './camTypes';
import { doneEntries, machineQueue } from './machine/camMachine';
import type { ManufacturingSnapshot } from './machine/manufacturingSnapshot';
import { recordNativeRun } from './machine/nativeRunHistory';
import { missingParts } from './useJobBoards';

async function queueFor(job: CamJobV1) {
  const { model } = await nativeCadModel(job.design!.accepted!);
  const instances = instancesOf(model.parts, () => true);
  const source = job.boards![0]!;
  const nest = nestBoard(source, instances, 3.175, { preserveLayout: true });
  const board = withLayout(source, nest);
  const ready = { board, nest, request: boardRequest(board, nest, instances) };
  const sourceKey = boardGeometryKey(
    job,
    instances.map(part => part.partId)
  );
  const plan = {
    sourceKey,
    programs: [3.175, 6, 8].map((diameter, i) => ({
      tool: i + 1,
      diameter,
      gcode: `G21 G90\nG1 X${model.parts[0]!.size[0]} F${300 + i}\nM30`,
      timeMin: 1,
    })),
    bits: [3.175, 6, 8],
    ops: [],
    safety: [],
    warnings: [],
    path: [],
    timeMin: 3,
    size: [nest.board.w, nest.board.h, 18.3],
  } as unknown as PlanResult;
  return { ready, queue: machineQueue([ready], [plan]), sourceKey, model, instances };
}

it.each([
  { tabbed: false, firstFinished: true },
  { tabbed: true, firstFinished: false },
  { tabbed: true, firstFinished: true },
])(
  'allows original programs after exact geometry reversion with monotonic cache revisions: %j',
  async ({ tabbed, firstFinished }) => {
    const empty = await createDesignJob('Partly cut geometry revert');
    const document = { ...createPlateDocument({ width: 100, height: 80, thickness: 18 }), id: empty.design!.draft.id };
    const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
    const { model } = await nativeCadModel(accepted.design!.accepted!);
    const instances = instancesOf(model.parts, () => true);
    const board = reconcileBoards(undefined, instances, 'oak')[0]!;
    const laidOut = withLayout(board, nestBoard(board, instances, 3.175));
    if (tabbed)
      laidOut.tabsAt = {
        [instances[0]!.id]: [
          { x: 0, y: 40 },
          { x: 100, y: 40 },
          { x: 50, y: 0 },
          { x: 50, y: 80 },
        ],
      };
    const original = await saveJob({ ...accepted, boards: [laidOut] }, accepted);
    const before = await queueFor(original);
    expect(before.queue).toHaveLength(3);
    const first = before.queue[0]!;
    const snapshot: ManufacturingSnapshot = {
      runId: crypto.randomUUID(),
      jobId: original.id,
      sourceKey: modelKey(original),
      designRevision: original.design!.acceptedRevision,
      boardWasSaved: true,
      active: first.key,
      doneId: first.doneId,
      gcode: first.plan!.programs[0]!.gcode,
      queue: before.queue,
      recordQueue: before.queue,
      parts: before.model.parts,
      instances: before.instances,
      nestBit: 3.175,
      overlay: null,
    };
    await recordNativeRun(snapshot);
    if (firstFinished) await recordNativeRun(snapshot, true);
    const cut = (await getJob(original.id))!;
    expect(cut.boards![0]!.cut!.keys).toEqual(firstFinished ? [first.doneId] : []);
    expect(cut.boards![0]!.cut!.startedKeys).toContain(first.doneId);
    const width = cut.design!.draft.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    const changedDocument = updateDimension(cut.design!.draft, width.id, 140);
    const changed = await acceptDesign(await saveDesignDraft(cut, changedDocument), changedDocument);
    const altered = await queueFor(changed);
    expect(
      layoutBlock(altered.ready, { bit: 3.175, missing: missingParts([altered.ready], altered.instances), sourceKey: altered.sourceKey })
    ).toMatch(/earlier design/);
    const restoredDocument = { ...structuredClone(original.design!.accepted!), revision: changed.design!.draft.revision + 1 };
    const reverted = await acceptDesign(await saveDesignDraft(changed, restoredDocument), restoredDocument);
    const after = await queueFor((await getJob(reverted.id))!);
    expect(reverted.design!.acceptedRevision).toBeGreaterThan(changed.design!.acceptedRevision);
    expect(reverted.design!.partRevisions[instances[0]!.partId]).toBeGreaterThan(changed.design!.partRevisions[instances[0]!.partId]);
    expect(modelKey(reverted)).not.toBe(modelKey(original));
    expect(after.sourceKey).toBe(before.sourceKey);
    expect(after.ready.board.designIssues).toBeUndefined();
    expect(after.ready.board.tabsAt).toEqual(original.boards![0]!.tabsAt);
    expect(after.ready.nest.unplaced).toEqual([]);
    expect(after.ready.request.parts).toHaveLength(1);
    expect(
      layoutBlock(after.ready, { bit: 3.175, missing: missingParts([after.ready], after.instances), sourceKey: after.sourceKey })
    ).toBeNull();
    expect(after.queue.map(entry => entry.doneId)).toEqual(before.queue.map(entry => entry.doneId));
    expect(doneEntries(after.queue, [])).toEqual(firstFinished ? [first.doneId] : []);
    const next = {
      ...snapshot,
      runId: crypto.randomUUID(),
      active: after.queue[1]!.key,
      doneId: after.queue[1]!.doneId,
      gcode: after.queue[1]!.plan!.programs[after.queue[1]!.program]!.gcode,
      queue: after.queue,
      recordQueue: after.queue,
    };
    await expect(recordNativeRun(next)).resolves.toBeDefined();
  },
  30_000
);
