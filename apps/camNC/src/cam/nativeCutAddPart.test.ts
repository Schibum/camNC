import { createPlateDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { layoutBlock } from './boardBlock';
import { boardRequest, instancesOf, nestBoard, newBoard, reconcileBoards, type BoardV1, type PartInstance } from './boards';
import { acceptDesign, boardGeometryKey, saveDesignDraft } from './cadDesign';
import { camWorker } from './camQueries';
import { createDesignJob, modelKey, saveJob, type CamJobV1 } from './jobDb';
import { doneEntries, machineQueue } from './machine/camMachine';
import { kDefaultPlan, toCamSettings } from './planSettings';

const bit = kDefaultPlan.bit.diameter;
const settings = toCamSettings(kDefaultPlan);
function readyBoard(board: BoardV1, instances: PartInstance[]) {
  const nest = nestBoard(board, instances, bit, { preserveLayout: true });
  return { board, nest, request: boardRequest(board, nest, instances, { skin: kDefaultPlan.skin }) };
}
async function planBoard(job: CamJobV1, board: ReturnType<typeof readyBoard>) {
  return {
    ...(await camWorker().generateBoard(modelKey(job), board.request, settings)),
    sourceKey: boardGeometryKey(
      job,
      board.request.parts.map(part => part.partId)
    ),
  };
}
async function cutFixture() {
  const empty = await createDesignJob('Cut board addition');
  const document = { ...createPlateDocument({ width: 100, height: 60, thickness: 12 }), id: empty.design!.draft.id };
  document.parts[0]!.name = 'Existing panel';
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const model = await camWorker().importDesign(accepted.design!.accepted!, modelKey(accepted));
  const instances = instancesOf(model.parts, () => true);
  const instanceId = instances[0]!.id;
  const board: BoardV1 = {
    ...newBoard([], 12, 'plywood', [instanceId]),
    size: { fit: true },
    layout: { w: 300, h: 180, at: { [instanceId]: { x: 10, y: 10, rotated: false } } },
    margin: 10,
    gap: 10,
    taped: true,
    retention: 'skin',
  };
  const original = readyBoard(board, instances);
  const plan = await planBoard(accepted, original);
  const queue = machineQueue([original], [plan]);
  const doneId = queue.find(entry => entry.kind === 'bit')!.doneId;
  const cut = { ...board, cut: { at: 1, keys: [doneId], sourceKey: plan.sourceKey } };
  const job = await saveJob({ ...accepted, boards: [cut] });
  return { job, board: cut, original, plan, doneId };
}

async function addPart(job: CamJobV1, thickness: number) {
  const document = structuredClone(job.design!.draft);
  const addition = createPlateDocument({ width: 40, height: 30, thickness }).parts[0]!;
  addition.name = 'Added panel';
  document.parts.push(addition);
  document.revision++;
  const accepted = await acceptDesign(await saveDesignDraft(job, document), document);
  const model = await camWorker().importDesign(accepted.design!.accepted!, modelKey(accepted));
  const instances = instancesOf(model.parts, () => true);
  const boards = reconcileBoards(accepted.boards, instances, 'plywood', { preserveReferences: true });
  return { job: accepted, instances, boards };
}

describe('adding parts after cutting a native fitted board', () => {
  it('requires Start over when a new part fits spare room because replanning also cuts the existing panel again', async () => {
    const before = await cutFixture();
    const after = await addPart(before.job, 12);
    const board = readyBoard(after.boards.find(board => board.id === before.board.id)!, after.instances);
    expect(board.nest.board).toEqual({ w: 300, h: 180 });
    expect(board.nest.unplaced).toEqual([]);
    expect(board.request.parts.map(part => part.name)).toEqual(['Existing panel', 'Added panel']);
    expect(board.nest.placements[0]).toEqual(before.original.nest.placements[0]);
    const key = boardGeometryKey(
      after.job,
      board.request.parts.map(part => part.partId)
    );
    expect(key).not.toBe(before.plan.sourceKey);
    expect(layoutBlock(board, { bit, missing: [], sourceKey: key })).toMatch(/earlier design.*Start over/);

    // Characterize why the guard is needed: the real planner receives the entire board,
    // including the original outline; it does not produce an incremental unused-stock job.
    const plan = await planBoard(after.job, board);
    expect(plan.ops.some(op => op.kind === 'profile' && op.name.startsWith('Existing panel:'))).toBe(true);
    expect(plan.ops.some(op => op.kind === 'profile' && op.name.startsWith('Added panel:'))).toBe(true);
    const queue = machineQueue([board], [plan]);
    expect(queue.find(entry => entry.kind === 'bit')!.doneId).not.toBe(before.doneId);
    expect(doneEntries(queue, [before.doneId])).not.toContain(queue.find(entry => entry.kind === 'bit')!.doneId);
  }, 30_000);

  it('keeps a cut board valid when the added part belongs on a different thickness board', async () => {
    const before = await cutFixture();
    const after = await addPart(before.job, 8);
    expect(after.boards).toHaveLength(2);
    const board = readyBoard(after.boards.find(board => board.id === before.board.id)!, after.instances);
    expect(board.request).toEqual(before.original.request);
    const key = boardGeometryKey(
      after.job,
      board.request.parts.map(part => part.partId)
    );
    expect(key).toBe(before.plan.sourceKey);
    expect(layoutBlock(board, { bit, missing: [], sourceKey: key })).toBeNull();
    const plan = await planBoard(after.job, board);
    expect(plan.gcode).toBe(before.plan.gcode);
    const queue = machineQueue([board], [plan]);
    expect(queue.find(entry => entry.kind === 'bit')!.doneId).toBe(before.doneId);
    expect(doneEntries(queue, [])).toContain(before.doneId);
  }, 30_000);
});
