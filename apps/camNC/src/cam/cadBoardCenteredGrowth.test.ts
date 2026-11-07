import { addConstraint, addRectangle, updateDimension } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { instancesOf, nestBoard, newBoard, reconcileBoards, withLayout } from './boards';
import { acceptDesign, saveDesignDraft } from './cadDesign';
import { createDesignJob, getJob, saveJob } from './jobDb';
import { nativeCadModel } from './nativeCadModel';
import { kDefaultPlan } from './planSettings';

const setups = [false, true].flatMap(rotated => ['fitted', 'fixed', 'cut'].map(kind => ({ rotated, kind })));

it.each(setups)(
  'keeps saved CAM placement and settings when a freely positioned rectangle grows Width140→180 ($kind, rotated=$rotated)',
  async ({ rotated, kind }) => {
    const empty = await createDesignJob('Free rectangle fitted growth');
    const document = structuredClone(empty.design!.draft);
    const part = document.parts[0]!;
    part.sketch = addRectangle(part.sketch, { x: 24, y: 7, width: 152, height: 91 });
    const edge = part.sketch.entities.filter(entity => entity.type === 'line')[2]!;
    if (edge.type !== 'line') throw new Error('Missing rectangle line');
    part.sketch = addConstraint(part.sketch, {
      id: 'width',
      type: 'distanceX',
      pointAId: edge.endId,
      pointBId: edge.startId,
      sourceEntityId: edge.id,
      value: 140,
      label: 'Horizontal distance',
    });
    document.revision++;
    const initial = await acceptDesign(await saveDesignDraft(empty, document), document);
    const firstModel = await nativeCadModel(initial.design!.accepted!);
    const firstInstances = instancesOf(firstModel.model.parts, () => true);
    const instanceId = firstInstances[0]!.id;
    const stock = { w: rotated ? 105 : 154, h: rotated ? 154 : 105 };
    const board = {
      ...newBoard([], 18, 'oak', [instanceId]),
      margin: 6.7,
      ...(kind === 'fixed' && { size: { fit: false as const, ...stock } }),
      ...(kind === 'cut' && { cut: { at: 1000, keys: ['original-source-program'], sourceKey: 'original-source' } }),
      layout: { ...stock, at: { [instanceId]: { x: 6.7, y: 6.7, rotated } } },
      pinned: [instanceId],
      fixtures: [{ kind: 'screw' as const, x: 3, y: 3 }],
      taped: true,
      guidedTabs: true,
      tabs: { width: 8, height: 2.5, minCount: 4 },
      measuredThickness: 18.4,
      bed: { a: { x: 30, y: 40, deg: 10 }, b: { x: 50, y: 60, deg: 180 } },
    };
    const plan = { ...kDefaultPlan, material: 'oak' as const };
    expect(nestBoard(board, firstInstances, plan.bit.diameter, { preserveLayout: true, holds: false }).unplaced).toEqual([]);
    const saved = await saveJob({ ...initial, boards: [board], plan }, initial);
    const changed = updateDimension(saved.design!.draft, 'width', 180);
    const accepted = await acceptDesign(await saveDesignDraft(saved, changed), changed);
    const reloaded = (await getJob(accepted.id))!;
    expect(reloaded.boards).toEqual(saved.boards);
    expect(reloaded.plan).toEqual(saved.plan);
    const { model } = await nativeCadModel(reloaded.design!.accepted!);
    const instances = instancesOf(model.parts, () => true);
    const reconciled = reconcileBoards(reloaded.boards, instances, plan.material, { preserveReferences: true });
    const nest = nestBoard(reconciled[0]!, instances, plan.bit.diameter, { preserveLayout: true, holds: false });
    expect(
      nest.unplaced,
      JSON.stringify({
        before: firstModel.model.parts[0]!.sourceOrigin,
        after: model.parts[0]!.sourceOrigin,
        layout: reloaded.boards![0]!.layout,
        out: nest.board,
      })
    ).toEqual(kind === 'fitted' ? [] : [instanceId]);
    if (kind === 'fitted') {
      expect(nest.yield).toBeGreaterThan(0);
      expect(nest.board).toEqual(rotated ? { w: 105, h: 194 } : { w: 194, h: 105 });
    } else {
      expect(nest.yield).toBe(0);
      expect(nest.board).toEqual(stock);
    }
    expect(nest.placements).toHaveLength(1);
    expect(nest.placements[0]).toEqual({ id: instanceId, ...board.layout.at[instanceId] });
    const persisted = await saveJob({ ...reloaded, boards: [withLayout(reconciled[0]!, nest)] }, reloaded);
    expect((await getJob(persisted.id))!.boards![0]!.items).toEqual([instanceId]);
  },
  20_000
);
