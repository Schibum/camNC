import { describe, expect, it } from 'vitest';
import { addRectangle, createCadPart, createPlateDocument, updateDimension } from '@wbcnc/cad';
import { instancesOf, nestBoard, newBoard, reconcileBoards, withLayout, type BoardV1, type PartInstance } from './boards';
import { acceptDesign, saveDesignDraft } from './cadDesign';
import { createDesignJob, getJob, saveJob, type CamJobV1 } from './jobDb';
import { nativeCadModel } from './nativeCadModel';
import { kDefaultPlan } from './planSettings';

const instance = (id: string, w: number, h: number): PartInstance => ({ id, partId: id, name: id, size: [w, h, 18], thickness: 18 });
const position = { x: 7, y: 7, rotated: true };
const fitted = (): BoardV1 => ({
  ...newBoard([], 18, 'plywood', ['side']),
  margin: 7,
  gap: 7,
  layout: { w: 128, h: 194, at: { side: { ...position } } },
  pinned: ['side'],
  fixtures: [{ kind: 'screw', x: 5, y: 5 }],
  tabsAt: { side: [{ x: 40, y: 0 }] },
  bed: { a: { x: 30, y: 40, deg: 10 } },
});

async function nativeFittedJob(name: string) {
  const empty = await createDesignJob(name);
  const document = {
    ...createPlateDocument({ name, width: 180, height: 100, thickness: 18 }),
    id: empty.design!.draft.id,
  };
  const first = await acceptDesign(await saveDesignDraft(empty, document), document);
  const partId = first.design!.accepted!.parts[0]!.id;
  const instanceId = `${partId}#0`;
  const board: BoardV1 = {
    ...newBoard([], 18, 'plywood', [instanceId]),
    margin: 7,
    gap: 7,
    layout: { w: 128, h: 194, at: { [instanceId]: { ...position } } },
    pinned: [instanceId],
    fixtures: [{ kind: 'screw', x: 5, y: 5 }],
    // This is on the unchanged left edge, so the persistent tab should not move when only Width changes.
    tabsAt: { [instanceId]: [{ x: 0, y: 40 }] },
    tabs: { width: 8, height: 2, minCount: 4 },
    guidedTabs: true,
    measuredThickness: 18.4,
    bed: { a: { x: 30, y: 40, deg: 10 } },
  };
  const job = await saveJob(
    {
      ...first,
      boards: [board],
      plan: {
        ...kDefaultPlan,
        bit: { number: 7, diameter: 6, name: '6 mm flat' },
        material: 'mdf',
        cutBelow: 0.6,
        tabs: true,
        cutting: { feed: 1400, rpm: 14_000 },
      },
      stock: [{ id: 'workshop-stock', thickness: 18, w: 2440, h: 1220, quantity: 2 }],
      nestObjective: 'wood',
    },
    first
  );
  return { job, partId, instanceId, board: structuredClone(board) };
}

function expectRetainedSettings(job: CamJobV1, original: CamJobV1, board: BoardV1, originalBoard: BoardV1, instanceId: string) {
  expect(job.plan).toEqual(original.plan);
  expect(job.stock).toEqual(original.stock);
  expect(job.nestObjective).toBe(original.nestObjective);
  for (const field of [
    'id',
    'name',
    'thickness',
    'material',
    'size',
    'margin',
    'gap',
    'pinned',
    'fixtures',
    'tabs',
    'guidedTabs',
    'measuredThickness',
    'bed',
  ] as const)
    expect(board[field], field).toEqual(originalBoard[field]);
  expect(board.tabsAt?.[instanceId]).toHaveLength(1);
  expect(board.tabsAt?.[instanceId]?.[0]).toMatchObject({ x: expect.closeTo(0, 6), y: expect.closeTo(40, 6) });
  expect(board.designIssues).toBeUndefined();
}

describe('accepted native source through the persisted CAM board pipeline', () => {
  it('accepts a native Width180→500 edit and grows128×194 stock to128×514 while retaining its rotated placement and CAM choices', async () => {
    const initial = await nativeFittedJob('Native width growth');
    const source = initial.job.design!.draft;
    const width = source.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    const changed = updateDimension(source, width.id, 500);
    const drafted = await saveDesignDraft(initial.job, changed);
    expect(drafted.design!.accepted).toEqual(initial.job.design!.accepted);
    const accepted = await acceptDesign(drafted, changed);
    expect(accepted.design!.acceptedRevision).toBe(initial.job.design!.acceptedRevision + 1);
    const { model } = await nativeCadModel(accepted.design!.accepted!);
    expect(model.parts.map(part => ({ id: part.id, size: part.size }))).toEqual([{ id: initial.partId, size: [500, 100, 18] }]);
    const instances = instancesOf(model.parts, id => accepted.parts.find(part => part.id === id)?.milled ?? false);
    expect(instances.map(part => part.id)).toEqual([initial.instanceId]);
    const boards = reconcileBoards(accepted.boards, instances, accepted.plan!.material, { preserveReferences: true });
    expect(boards).toHaveLength(1);
    const nest = nestBoard(boards[0]!, instances, accepted.plan!.bit.diameter, { preserveLayout: true, holds: false });
    expect(nest.board).toEqual({ w: 128, h: 514 });
    expect(nest.placements).toEqual([{ id: initial.instanceId, ...position }]);
    expect(nest.unplaced).toEqual([]);
    expect(nest.margin).toBe(7);
    expect(nest.gap).toBe(7);
    expect(nest.yield).toBeCloseTo(50_000 / (128 * 514));
    expect(nest.yield).toBeGreaterThan(0);
    expect(nest.yield).toBeLessThanOrEqual(1);
    const saved = await saveJob({ ...accepted, boards: [withLayout(boards[0]!, nest)] }, accepted);
    const persisted = (await getJob(saved.id))!;
    expect(persisted.boards![0]!.layout).toEqual({ w: 128, h: 514, at: { [initial.instanceId]: position } });
    expectRetainedSettings(persisted, initial.job, persisted.boards![0]!, initial.board, initial.instanceId);
  }, 20_000);

  it('accepts an added native80×80 part on the same18mm stock and nests it around the unchanged grown part without a false unplaced result', async () => {
    const initial = await nativeFittedJob('Native additional part');
    const width = initial.job.design!.draft.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    const changed = updateDimension(initial.job.design!.draft, width.id, 500);
    const acceptedWidth = await acceptDesign(await saveDesignDraft(initial.job, changed), changed);
    const initialModel = await nativeCadModel(acceptedWidth.design!.accepted!);
    const initialInstances = instancesOf(initialModel.model.parts, () => true);
    const initialBoards = reconcileBoards(acceptedWidth.boards, initialInstances, acceptedWidth.plan!.material, {
      preserveReferences: true,
    });
    const initialNest = nestBoard(initialBoards[0]!, initialInstances, acceptedWidth.plan!.bit.diameter, {
      preserveLayout: true,
      holds: false,
    });
    expect(initialNest.board).toEqual({ w: 128, h: 514 });
    const grown = await saveJob({ ...acceptedWidth, boards: [withLayout(initialBoards[0]!, initialNest)] }, acceptedWidth);
    const added = createCadPart('Added shelf', 18);
    added.sketch = addRectangle(added.sketch, { x: 0, y: 0, width: 80, height: 80, dimensioned: true });
    const document = structuredClone(grown.design!.draft);
    document.parts.push(added);
    document.revision++;
    const accepted = await acceptDesign(await saveDesignDraft(grown, document), document);
    expect(accepted.design!.partRevisions[initial.partId]).toBe(grown.design!.partRevisions[initial.partId]);
    const { model } = await nativeCadModel(accepted.design!.accepted!);
    expect(model.parts.map(part => ({ id: part.id, size: part.size }))).toEqual([
      { id: initial.partId, size: [500, 100, 18] },
      { id: added.id, size: [80, 80, 18] },
    ]);
    const instances = instancesOf(model.parts, id => accepted.parts.find(part => part.id === id)?.milled ?? false);
    const addedInstance = `${added.id}#0`;
    expect(instances.map(part => part.id)).toEqual([initial.instanceId, addedInstance]);
    const boards = reconcileBoards(accepted.boards, instances, accepted.plan!.material, { preserveReferences: true });
    expect(boards).toHaveLength(1);
    expect(boards[0]!.items).toEqual([initial.instanceId, addedInstance]);
    const nest = nestBoard(boards[0]!, instances, accepted.plan!.bit.diameter, { preserveLayout: true, holds: false });
    expect(nest.placements).toHaveLength(2);
    expect(nest.placements.find(part => part.id === initial.instanceId)).toEqual({ id: initial.instanceId, ...position });
    const placed = nest.placements.find(part => part.id === addedInstance)!;
    expect(placed).toBeDefined();
    expect(placed.x).toBeGreaterThanOrEqual(7);
    expect(placed.y).toBeGreaterThanOrEqual(7);
    expect(placed.x >= position.x + 100 + 7 || placed.y >= position.y + 500 + 7).toBe(true);
    expect(nest.unplaced).toEqual([]);
    expect(nest.board.w * nest.board.h).toBeGreaterThan(128 * 514);
    expect(nest.yield).toBeCloseTo((50_000 + 6_400) / (nest.board.w * nest.board.h));
    expect(nest.yield).toBeGreaterThan(0);
    expect(nest.yield).toBeLessThanOrEqual(1);
    const saved = await saveJob({ ...accepted, boards: [withLayout(boards[0]!, nest)] }, accepted);
    const persisted = (await getJob(saved.id))!;
    expect(persisted.boards![0]!.layout!.at[initial.instanceId]).toEqual(position);
    expect(persisted.boards![0]!.layout!.at[addedInstance]).toEqual({ x: placed.x, y: placed.y, rotated: placed.rotated });
    expectRetainedSettings(persisted, initial.job, persisted.boards![0]!, initial.board, initial.instanceId);
  }, 20_000);
});

describe('native CAD edits on fitted boards', () => {
  it('grows the saved 128×194 fitted board for a 180→500 edit without moving or rotating its existing part', () => {
    const board = fitted(),
      before = structuredClone(board);
    const nest = nestBoard(board, [instance('side', 500, 100)], 6, { preserveLayout: true, holds: false });
    expect(nest.board).toEqual({ w: 128, h: 514 });
    expect(nest.placements).toEqual([{ id: 'side', ...position }]);
    expect(nest.unplaced).toEqual([]);
    expect(nest.yield).toBeCloseTo(50_000 / (128 * 514));
    expect(board).toEqual(before);
  });

  it('places an added part around the preserved part and grows without losing board settings', () => {
    const source = fitted(),
      before = structuredClone(source);
    const parts = [instance('side', 500, 100), instance('shelf', 80, 80)];
    const boards = reconcileBoards([source], parts, 'plywood', { preserveReferences: true });
    expect(boards).toHaveLength(1);
    expect(boards[0]!.items).toEqual(['side', 'shelf']);
    const nest = nestBoard(boards[0]!, parts, 6, { preserveLayout: true, holds: false });
    expect(nest.placements).toHaveLength(2);
    expect(nest.placements.find(p => p.id === 'side')).toEqual({ id: 'side', ...position });
    expect(nest.unplaced).toEqual([]);
    expect(nest.board.w * nest.board.h).toBeGreaterThan(128 * 194);
    expect(nest.yield).toBeGreaterThan(0);
    expect(nest.yield).toBeLessThanOrEqual(1);
    expect(boards[0]).toMatchObject({
      pinned: source.pinned,
      fixtures: source.fixtures,
      tabsAt: source.tabsAt,
      bed: source.bed,
      material: source.material,
    });
    expect(source).toEqual(before);
  });

  it('keeps fixed stock its declared size and excludes the oversized retained part from yield', () => {
    const board = { ...fitted(), size: { fit: false as const, w: 128, h: 194 } };
    const nest = nestBoard(board, [instance('side', 500, 100)], 6, { preserveLayout: true, holds: false });
    expect(nest.board).toEqual({ w: 128, h: 194 });
    expect(nest.placements).toEqual([{ id: 'side', ...position }]);
    expect(nest.unplaced).toEqual(['side']);
    expect(nest.yield).toBe(0);
  });

  it('reports machine bounds without discarding the preserved placement', () => {
    const nest = nestBoard(fitted(), [instance('side', 500, 100)], 6, { preserveLayout: true, holds: false, machine: { w: 300, h: 200 } });
    expect((nest.board.w <= 300 && nest.board.h <= 200) || (nest.board.w <= 200 && nest.board.h <= 300)).toBe(true);
    expect(nest.unplaced).toEqual(['side']);
    expect(nest.placements).toEqual([{ id: 'side', ...position }]);
    expect(nest.yield).toBe(0);
  });

  it('does not grow stock that has already been cut', () => {
    const board = { ...fitted(), cut: { at: 1000, keys: ['cut-revision'] } };
    const nest = nestBoard(board, [instance('side', 500, 100)], 6, { preserveLayout: true, holds: false });
    expect(nest.board).toEqual({ w: 128, h: 194 });
    expect(nest.unplaced).toEqual(['side']);
  });

  it('allows fitted stock to grow when the whole board fits turned on the machine', () => {
    const nest = nestBoard(fitted(), [instance('side', 250, 100)], 6, { preserveLayout: true, holds: false, machine: { w: 300, h: 200 } });
    expect(nest.board).toEqual({ w: 128, h: 264 });
    expect(nest.unplaced).toEqual([]);
    expect(nest.placements).toEqual([{ id: 'side', ...position }]);
  });

  it('uses the machine long axis when a wide edited part cannot fit either way', () => {
    const board = { ...fitted(), layout: { w: 194, h: 128, at: { side: { ...position, rotated: false } } } };
    const nest = nestBoard(board, [instance('side', 500, 100)], 6, { preserveLayout: true, holds: false, machine: { w: 300, h: 200 } });
    expect(nest.board).toEqual({ w: 300, h: 128 });
    expect(nest.unplaced).toEqual(['side']);
    expect(nest.placements).toEqual([{ id: 'side', ...position, rotated: false }]);
  });

  it('keeps overlapping edited parts visible and reports the conflict instead of relocating them', () => {
    const board = {
      ...fitted(),
      items: ['side', 'shelf'],
      layout: { w: 300, h: 300, at: { side: { x: 14, y: 14, rotated: false }, shelf: { x: 150, y: 14, rotated: false } } },
    };
    const nest = nestBoard(board, [instance('side', 200, 100), instance('shelf', 80, 80)], 6, { preserveLayout: true, holds: false });
    expect(nest.placements).toEqual([
      { id: 'side', ...board.layout.at.side },
      { id: 'shelf', ...board.layout.at.shelf },
    ]);
    expect(nest.unplaced).toEqual(['shelf']);
    expect(nest.yield).toBeCloseTo(20_000 / (300 * 300));
  });
});
