import { addRectangle, createCadPart, createPlateDocument, updateDimension } from '@wbcnc/cad';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { acceptDesign, saveDesignDraft } from '../cadDesign';
import { instancesOf, nestBoard, physicalSheetIdOf, reconcileBoards, startOverBoard, withLayout, type BoardV1 } from '../boards';
import { camKeys } from '../camQueries';
import type { ModelImport } from '../camTypes';
import { createDesignJob, getJob, saveJob } from '../jobDb';
import { nativeCadModel } from '../nativeCadModel';
import { useCamMachine } from './camMachine';
import { useMachineQueue } from './useMachineQueue';

const hooks = vi.hoisted(() => ({
  model: { data: undefined as ModelImport | undefined, isError: false, error: null as Error | null },
}));
vi.mock('../camQueries', async original => ({
  ...(await original<typeof import('../camQueries')>()),
  useCamModel: () => hooks.model,
  useBoardPlans: (_job: unknown, boards: unknown[]) => boards.map(() => ({ data: undefined, isPlaceholderData: false, isError: false })),
}));

let latest!: ReturnType<typeof useMachineQueue>;
function Probe() {
  latest = useMachineQueue();
  return null;
}

afterEach(() => {
  cleanup();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

async function fixture(thickness = 12) {
  const empty = await createDesignJob('Direct machine reconciliation');
  const document = { ...createPlateDocument({ width: 100, height: 80, thickness: 18 }), id: empty.design!.draft.id };
  const first = await acceptDesign(await saveDesignDraft(empty, document), document);
  const originalModel = (await nativeCadModel(first.design!.accepted!)).model;
  const instances = instancesOf(originalModel.parts, () => true);
  const originalBoards = reconcileBoards(undefined, instances, 'oak').map(board => {
    const held = { ...board, taped: true, retention: 'none' as const, measuredThickness: 18.5 };
    return withLayout(held, nestBoard(held, instances, 3.175, { preserveLayout: true }));
  });
  const saved = await saveJob({ ...first, boards: originalBoards });
  const added = createCadPart('Added native part', thickness);
  added.sketch = addRectangle(added.sketch, { x: 0, y: 0, width: 60, height: 40, dimensioned: true });
  const changed = { ...document, revision: document.revision + 1, parts: [...document.parts, added] };
  // Accept and enter Machine directly: the Boards route never persists the derived new stock.
  const job = await acceptDesign(await saveDesignDraft(saved, changed), changed);
  const model = (await nativeCadModel(job.design!.accepted!)).model;
  expect(job.boards).toHaveLength(1);
  const addedBoardId = `auto-${added.thickness}mm`;
  expect(job.boards!.flatMap(board => board.items)).not.toContain(`${added.id}#0`);
  hooks.model = { data: model, isError: false, error: null };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(camKeys.job(job.id), job);
  useCamMachine.getState().start(job.id);
  const view = () => (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  return { job, originalBoards, added, addedBoardId, client, view };
}

const patches: [string, Partial<BoardV1>][] = [
  ['measured thickness', { measuredThickness: 12.6 }],
  ['holds', { taped: true, fixtures: [{ kind: 'clamp', side: 'left', at: 20 }] }],
  ['bed placement', { bed: { a: { x: 30, y: 45, deg: 12 } } }],
  ['cut record', { cut: { at: 123, keys: ['native-12mm-completed'], sourceKey: 'native-twelve-millimetre-source' } }],
];

it.each(patches)(
  'N2 persists the first %s write on a new-thickness native board without visiting Boards',
  async (_name, patch) => {
    const f = await fixture();
    render(f.view());
    expect(latest.queue.some(entry => entry.board.board.id === f.addedBoardId)).toBe(true);
    if ('measuredThickness' in patch) latest.setStockThickness(f.addedBoardId, patch.measuredThickness!);
    else latest.patchBoards({ [f.addedBoardId]: patch });
    await waitFor(async () => {
      const saved = (await getJob(f.job.id))!;
      expect(saved.boards).toHaveLength(2);
      expect(saved.boards!.find(board => board.id === f.addedBoardId)).toMatchObject(patch);
      expect(saved.boards!.find(board => board.id === f.addedBoardId)?.items).toEqual([`${f.added.id}#0`]);
      expect(saved.boards!.find(board => board.id === f.addedBoardId)?.layout?.at[`${f.added.id}#0`]).toBeDefined();
      expect(saved.boards!.find(board => board.id === f.originalBoards[0].id)).toEqual(f.originalBoards[0]);
      expect(saved.design).toEqual(f.job.design);
    });
  },
  30_000
);

it('N2 retains rapid independent setup writes on newly reconciled boards and after remount', async () => {
  const f = await fixture();
  const view = render(f.view());
  latest.setStockThickness(f.addedBoardId, 12.6);
  latest.updateBoard(f.addedBoardId, { taped: true, bed: { a: { x: 30, y: 45, deg: 12 } } });
  latest.updateBoard(f.originalBoards[0].id, { measuredThickness: 18.8 });
  await waitFor(async () => {
    const saved = (await getJob(f.job.id))!;
    expect(saved.boards).toHaveLength(2);
    expect(saved.boards!.find(board => board.id === f.addedBoardId)).toMatchObject({
      measuredThickness: 12.6,
      taped: true,
      bed: { a: { x: 30, y: 45, deg: 12 } },
    });
    expect(saved.boards!.find(board => board.id === f.originalBoards[0].id)?.measuredThickness).toBe(18.8);
  });
  view.unmount();
  const saved = (await getJob(f.job.id))!;
  f.client.setQueryData(camKeys.job(f.job.id), saved);
  render(f.view());
  expect(latest.queue.find(entry => entry.board.board.id === f.addedBoardId)?.board.board).toMatchObject({
    measuredThickness: 12.6,
    taped: true,
    bed: { a: { x: 30, y: 45, deg: 12 } },
  });
}, 30_000);

it('N2 persists a ready existing board’s new membership and layout with its first machine edit', async () => {
  const f = await fixture(18);
  render(f.view());
  const at = f.originalBoards[0].layout!.at[f.originalBoards[0].items[0]];
  latest.setStockThickness(f.addedBoardId, 18.8);
  await waitFor(async () => {
    const saved = (await getJob(f.job.id))!;
    expect(saved.boards).toHaveLength(1);
    expect(saved.boards![0].items).toEqual([...f.originalBoards[0].items, `${f.added.id}#0`]);
    expect(saved.boards![0].layout!.at[`${f.added.id}#0`]).toBeDefined();
    expect(saved.boards![0].layout!.at[f.originalBoards[0].items[0]]).toEqual(at);
    expect(saved.boards![0].measuredThickness).toBe(18.8);
    expect(saved.boards![0].taped).toBe(true);
  });
}, 30_000);

it('N2 refuses a delayed machine edit from a previous accepted CAD source', async () => {
  const f = await fixture();
  render(f.view());
  const staleEdit = latest.setStockThickness;
  const document = f.job.design!.accepted!;
  const width = document.parts[0].sketch.constraints.find(c => c.label === 'Width')!;
  const changed = updateDimension(document, width.id, 120);
  const accepted = await acceptDesign(await saveDesignDraft(f.job, changed), changed);
  f.client.setQueryData(camKeys.job(f.job.id), accepted);
  staleEdit(f.addedBoardId, 12.6);
  expect(f.client.getQueryData(camKeys.job(f.job.id))).toEqual(accepted);
  expect(await getJob(f.job.id)).toEqual(accepted);
}, 30_000);

it('N2 does not optimistically restore a job explicitly removed from the query cache', async () => {
  const f = await fixture();
  render(f.view());
  const staleEdit = latest.setStockThickness;
  f.client.setQueryData(camKeys.job(f.job.id), null);
  staleEdit(f.addedBoardId, 12.6);
  expect(f.client.getQueryData(camKeys.job(f.job.id))).toBeNull();
  expect(await getJob(f.job.id)).toEqual(f.job);
}, 30_000);

it('rejects delayed setup and Done writes belonging to a previous physical stock generation', async () => {
  const f = await fixture();
  render(f.view());
  const staleThickness = latest.setStockThickness;
  const stalePatch = latest.patchBoards;
  const before = f.originalBoards[0];
  const expectedSheet = { [before.id]: physicalSheetIdOf(before) };
  const replacement = await saveJob({ ...f.job, boards: [startOverBoard(before)] }, f.job);
  f.client.setQueryData(camKeys.job(f.job.id), replacement);
  staleThickness(before.id, 99);
  stalePatch({ [before.id]: { cut: { at: 1, keys: ['old-done'], startedKeys: ['old-done'] } } });
  expect(f.client.getQueryData(camKeys.job(f.job.id))).toEqual(replacement);
  expect(await getJob(f.job.id)).toEqual(replacement);
  await waitFor(() => expect(latest.job).toEqual(replacement));
  // RecordCuts may render against the new job while retaining the original run's queue.
  latest.patchBoards({ [before.id]: { cut: { at: 1, keys: ['old-done'] } } }, expectedSheet);
  expect(f.client.getQueryData(camKeys.job(f.job.id))).toEqual(replacement);
  expect(await getJob(f.job.id)).toEqual(replacement);
}, 30_000);

it.each(['pending', 'failed'] as const)(
  'N2 preserves all durable setup when the new native model is %s',
  async state => {
    const f = await fixture();
    hooks.model = { data: undefined, isError: state === 'failed', error: state === 'failed' ? new Error('Native import failed') : null };
    render(f.view());
    latest.setStockThickness(f.originalBoards[0].id, 18.8);
    latest.updateBoard(f.originalBoards[0].id, { bed: { a: { x: 30, y: 45, deg: 12 } } });
    // A projected board that has not been derived cannot replace or erase durable stock.
    latest.updateBoard(f.addedBoardId, { measuredThickness: 12.6 });
    await waitFor(async () => {
      const saved = (await getJob(f.job.id))!;
      expect(saved.boards).toHaveLength(1);
      expect(saved.boards![0]).toEqual({
        ...f.originalBoards[0],
        measuredThickness: 18.8,
        bed: { a: { x: 30, y: 45, deg: 12 } },
      });
    });
  },
  30_000
);
