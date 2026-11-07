import { addCircle, createPlateDocument, removeEntity, updateDimension, type CadDocument } from '@wbcnc/cad';
import { afterEach, describe, expect, it } from 'vitest';
import { boardRequest, instancesOf, nestBoard, newBoard, type BoardV1 } from './boards';
import { acceptDesign, saveDesignDraft } from './cadDesign';
import { camWorker } from './camQueries';
import { createDesignJob, getJob, modelKey, saveJob, type CamJobV1 } from './jobDb';
import { nativeCadModel } from './nativeCadModel';
import { holeChoiceKey } from './holeChoices';
import { kDefaultPlan, toCamSettings, withHoleChoice } from './planSettings';
import { cadSession, commitCadSession, endCadSession, undoCadSession } from '../cad/session';

const sessions: string[] = [];
afterEach(() => {
  sessions.forEach(endCadSession);
  sessions.length = 0;
});

async function fixture() {
  const empty = await createDesignJob('Two native holes');
  const source = { ...createPlateDocument({ width: 180, height: 100, thickness: 12 }), id: empty.design!.draft.id };
  const part = source.parts[0]!;
  part.sketch = addCircle(part.sketch, { x: 45, y: 50, radius: 20, dimensioned: true, positioned: true });
  const large = part.sketch.entities.at(-1)!;
  part.sketch = addCircle(part.sketch, { x: 130, y: 50, radius: 10, dimensioned: true, positioned: true });
  const small = part.sketch.entities.at(-1)!;
  const accepted = await acceptDesign(await saveDesignDraft(empty, source), source);
  const { model } = await nativeCadModel(accepted.design!.accepted!);
  const info = model.parts[0]!,
    id = `${part.id}#0`;
  const board: BoardV1 = {
    ...newBoard([], 12, 'plywood', [id]),
    margin: 10,
    gap: 9,
    layout: { w: 210, h: 130, at: { [id]: { x: 12, y: 12, rotated: false } } },
    pinned: [id],
    measuredThickness: 12.4,
    fixtures: [{ kind: 'screw', x: 5, y: 5 }],
  };
  const plan = withHoleChoice(
    withHoleChoice({ ...kDefaultPlan, cutBelow: 0.6 }, part.id, holeChoiceKey(info, 0)!, 'leave'),
    part.id,
    holeChoiceKey(info, 1)!,
    'clear'
  );
  const job = await saveJob({ ...accepted, plan, boards: [board] }, accepted);
  const size = part.sketch.constraints.find(c => c.type === 'diameter' && c.entityId === small.id)!;
  return { job, partId: part.id, largeId: large.id, smallId: small.id, sizeId: size.id, board };
}

async function requestFor(job: CamJobV1) {
  const { model } = await nativeCadModel(job.design!.accepted!);
  const instances = instancesOf(model.parts, () => true),
    board = job.boards![0]!;
  const nest = nestBoard(board, instances, job.plan!.bit.diameter, { preserveLayout: true, holds: false });
  return { info: model.parts[0]!, nest, request: boardRequest(board, nest, instances, { holes: job.plan!.holes }) };
}

async function accept(job: CamJobV1, source: CadDocument) {
  return acceptDesign(await saveDesignDraft(job, source), source);
}

describe('native hole choices across accepted geometry revisions', () => {
  it('keeps choices on the same source circles when dimension edits reverse their area order, including actual generated CAM', async () => {
    const original = await fixture(),
      before = await requestFor(original.job);
    expect(before.info.holeIds).toHaveLength(2);
    expect(before.request.parts[0]!.holes).toEqual({ 0: 'leave', 1: 'clear' });
    const resized = await accept(original.job, updateDimension(original.job.design!.draft, original.sizeId, 50));
    const after = await requestFor(resized);
    expect(after.info.holeIds).toEqual([...before.info.holeIds!].reverse());
    expect(after.request.parts[0]!.holes).toEqual({ 0: 'clear', 1: 'leave' });
    expect(resized.plan).toEqual(original.job.plan);
    expect(resized.boards).toEqual(original.job.boards);
    expect(after.request.parts.map(part => ({ ...part, holes: undefined }))).toEqual(
      before.request.parts.map(part => ({ ...part, holes: undefined }))
    );
    expect(resized.design!.accepted!.parts[0]!.sketch.entities.map(entity => entity.id)).toEqual(
      original.job.design!.draft.parts[0]!.sketch.entities.map(entity => entity.id)
    );
    expect(resized.design!.holeChoiceIssues).toBeUndefined();
    await camWorker().importDesign(resized.design!.accepted!, modelKey(resized));
    const plan = await camWorker().generateBoard(modelKey(resized), after.request, toCamSettings(resized.plan!));
    expect(plan.holeMiddles?.map(hole => ({ hole: hole.hole, choice: hole.choice, state: hole.state }))).toEqual([
      { hole: 0, choice: 'clear', state: 'cleared' },
      { hole: 1, choice: 'leave', state: 'loose' },
    ]);
    expect(plan.gcode).toMatch(/G[123]/);
  }, 60_000);

  it('retains orphan keys without applying them to added holes and restores them through Undo and durable reentry', async () => {
    const initial = await fixture();
    const source = updateDimension(initial.job.design!.draft, initial.sizeId, 50);
    const added = structuredClone(source);
    added.parts[0]!.sketch = addCircle(added.parts[0]!.sketch, { x: 90, y: 20, radius: 6 });
    const withAdded = await accept(initial.job, added),
      before = await requestFor(withAdded);
    expect(before.info.holeIds).toHaveLength(3);
    expect(before.request.parts[0]!.holes).toEqual({ 0: 'clear', 1: 'leave' });
    const session = cadSession(withAdded.design!.draft);
    sessions.push(session.document.id);
    const deleted = structuredClone(session.document);
    deleted.parts[0]!.sketch = removeEntity(deleted.parts[0]!.sketch, initial.smallId);
    const removed = await accept(withAdded, commitCadSession(session, deleted)),
      after = await requestFor(removed);
    expect(after.info.holeIds).toEqual(before.info.holeIds!.slice(1));
    expect(after.request.parts[0]!.holes).toEqual({ 0: 'leave' });
    expect(removed.plan).toEqual(withAdded.plan);
    expect(removed.design!.holeChoiceIssues).toEqual([{ partId: initial.partId, holeId: before.info.holeIds![0], choice: 'clear' }]);
    const reopened = (await getJob(removed.id))!;
    expect(reopened.design!.holeChoiceIssues).toEqual(removed.design!.holeChoiceIssues);
    const restored = await accept(reopened, undoCadSession(session)),
      back = await requestFor(restored);
    expect(back.info.holeIds).toEqual(before.info.holeIds);
    expect(back.request.parts[0]!.holes).toEqual({ 0: 'clear', 1: 'leave' });
    expect(restored.design!.holeChoiceIssues).toBeUndefined();
    expect(restored.boards).toEqual(initial.job.boards);
  }, 60_000);
});
