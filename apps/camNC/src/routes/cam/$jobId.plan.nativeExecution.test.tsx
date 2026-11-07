import { addRectangle, createCadDocument, createCadPart, createPlateDocument, updateDimension } from '@wbcnc/cad';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { acceptDesign, boardGeometryKey, saveDesignDraft } from '@/cam/cadDesign';
import { camKeys } from '@/cam/camQueries';
import type { BoardRequest, PlanResult } from '@/cam/camTypes';
import { createDesignJob, getJob, saveJob } from '@/cam/jobDb';
import { newBoard } from '@/cam/boards';
import { kDefaultPlan } from '@/cam/planSettings';
import { usePlanLayout } from '@/cam/plan/planLayoutStore';
import { useStore } from '@/store/store';
import { Route } from './$jobId.plan';
import { Route as BoardsRoute } from './$jobId.boards';

const state = vi.hoisted(() => ({ jobId: '', requests: [] as BoardRequest[], plans: [] as (PlanResult | undefined)[] }));
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => ({ jobId: state.jobId }),
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/cam/plan3d/PlanView3D', () => ({ PlanView3D: () => null }));
vi.mock('@/cam/camQueries', async importOriginal => {
  const real = await importOriginal<typeof import('@/cam/camQueries')>();
  return {
    ...real,
    useBoardPlans: (...args: Parameters<typeof real.useBoardPlans>) => {
      state.requests = args[1].map(board => board.request);
      const results = real.useBoardPlans(...args);
      state.plans = results.map(result => result.data);
      return results;
    },
  };
});
afterEach(() => {
  cleanup();
  usePlanLayout.setState(usePlanLayout.getInitialState(), true);
});
const Plan = (Route as unknown as { options: { component: ComponentType } }).options.component;
const Boards = (BoardsRoute as unknown as { options: { component: ComponentType } }).options.component;

async function open(onlyInvalid = false) {
  const empty = await createDesignJob('Native execution');
  const document = { ...createCadDocument(), id: empty.design!.draft.id };
  for (const [name, width] of [
    ['Keep me', 80],
    ['Leave me', 500],
  ] as const) {
    if (onlyInvalid && name === 'Keep me') continue;
    const part = createCadPart(name, 12);
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width, height: 80, positioned: true, dimensioned: true });
    document.parts.push(part);
  }
  const accepted = await acceptDesign(await saveDesignDraft(empty, document), document);
  const keep = document.parts.find(part => part.name === 'Keep me'),
    leave = document.parts.find(part => part.name === 'Leave me')!;
  const keepId = keep ? `${keep.id}#0` : undefined,
    leaveId = `${leave.id}#0`;
  const items = keepId ? [keepId, leaveId] : [leaveId];
  const board = {
    ...newBoard([], 12, 'plywood', items),
    size: { fit: false as const, w: 300, h: 120 },
    margin: 10,
    gap: 10,
    retention: 'skin' as const,
    pinned: items,
    layout: {
      w: 300,
      h: 120,
      at: { ...(keepId && { [keepId]: { x: 10, y: 10, rotated: false } }), [leaveId]: { x: 110, y: 10, rotated: false } },
    },
  };
  const job = await saveJob({ ...accepted, boards: [board], plan: { ...kDefaultPlan } }, accepted);
  state.jobId = job.id;
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Plan />
    </QueryClientProvider>
  );
  return { job, client, leaveId, leavePart: leave, board };
}

it('Leave out excludes invalid geometry from requests/G-code, survives repair explicitly, and Include again cannot suppress a later conflict', async () => {
  const { job, client, leaveId, leavePart, board } = await open();
  fireEvent.click(await screen.findByRole('button', { name: 'Leave it out' }, { timeout: 30_000 }));
  await waitFor(async () => expect((await getJob(job.id))!.plan!.leaveOut).toEqual([leaveId]));
  await waitFor(() => expect(state.requests[0]!.parts.some(part => part.id === leaveId)).toBe(false), { timeout: 2_000 });
  await waitFor(() => expect(state.plans[0]?.gcode).toContain('Keep me'), { timeout: 30_000 });
  expect(state.plans[0]!.gcode).not.toContain('Leave me');
  expect((await getJob(job.id))!.boards![0]!.layout).toEqual(board.layout);
  const width = leavePart.sketch.constraints.find(c => c.label === 'Width')!;
  const current = (await getJob(job.id))!;
  const repairedDocument = updateDimension(current.design!.draft, width.id, 50);
  const repaired = await acceptDesign(await saveDesignDraft(current, repairedDocument), repairedDocument);
  act(() => client.setQueryData(camKeys.job(job.id), repaired));
  expect(await screen.findByText(/Excluded from CAM:.*Leave me/, {}, { timeout: 30_000 })).toBeDefined();
  await waitFor(() => expect(state.requests[0]?.parts.some(part => part.id === leaveId)).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Include again' }));
  await waitFor(() => expect(state.requests[0]!.parts.some(part => part.id === leaveId)).toBe(true), { timeout: 30_000 });
  await waitFor(() => expect(state.plans[0]?.gcode).toContain('Leave me'), { timeout: 30_000 });
  const included = (await getJob(job.id))!;
  const enlargedDocument = updateDimension(included.design!.draft, width.id, 550);
  const enlarged = await acceptDesign(await saveDesignDraft(included, enlargedDocument), enlargedDocument);
  act(() => client.setQueryData(camKeys.job(job.id), enlarged));
  await screen.findByRole('button', { name: 'Leave it out' }, { timeout: 30_000 });
  expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toBeDisabled();
  expect(state.requests[0]!.parts.some(part => part.id === leaveId)).toBe(false);
}, 90_000);

it('keeps repair and Include again reachable when every saved placement is invalid or explicitly excluded', async () => {
  const { job, leaveId } = await open(true);
  const leave = await screen.findByRole('button', { name: 'Leave it out' }, { timeout: 30_000 });
  expect(state.requests[0]!.parts).toEqual([]);
  expect(screen.getByText(/No executable parts on this board/)).toBeDefined();
  fireEvent.click(leave);
  const include = await screen.findByRole('button', { name: 'Include again' });
  await waitFor(async () => expect((await getJob(job.id))!.plan!.leaveOut).toEqual([leaveId]));
  expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toBeDisabled();
  fireEvent.click(include);
  await screen.findByRole('button', { name: 'Leave it out' });
  expect(state.requests[0]!.parts).toEqual([]);
}, 60_000);

it('adds a part to a partly-cut native sheet only after the real Boards Start over action', async () => {
  const empty = await createDesignJob('Partly-cut additions');
  const source = { ...createPlateDocument({ width: 180, height: 100, thickness: 12 }), id: empty.design!.draft.id };
  const initial = await acceptDesign(await saveDesignDraft(empty, source), source);
  const partId = source.parts[0]!.id,
    instanceId = `${partId}#0`;
  const board = {
    ...newBoard([], 12, 'plywood', [instanceId]),
    margin: 10,
    gap: 10,
    retention: 'skin' as const,
    pinned: [instanceId],
    layout: { w: 220, h: 140, at: { [instanceId]: { x: 12, y: 12, rotated: false } } },
    cut: { at: 1, keys: ['ran-first-program'], sourceKey: boardGeometryKey(initial, [partId]) },
  };
  const cut = await saveJob({ ...initial, boards: [board], plan: { ...kDefaultPlan } }, initial);
  const document = structuredClone(cut.design!.draft),
    added = createCadPart('Added panel', 12);
  added.sketch = addRectangle(added.sketch, { x: 0, y: 0, width: 80, height: 80 });
  document.parts.push(added);
  const changed = await acceptDesign(await saveDesignDraft(cut, document), document);
  state.jobId = changed.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Boards />
    </QueryClientProvider>
  );
  const startOver = await screen.findByRole('button', { name: 'Start over' }, { timeout: 30_000 });
  await waitFor(async () => expect((await getJob(changed.id))!.boards![0]!.items).toContain(`${added.id}#0`));
  expect((await getJob(changed.id))!.boards![0]!.cut).toEqual(board.cut);
  expect(state.requests[0]!.parts.some(part => part.partId === added.id)).toBe(false);
  fireEvent.click(startOver);
  await waitFor(async () => expect((await getJob(changed.id))!.boards![0]!.cut).toBeUndefined());
  await waitFor(() => expect(state.requests[0]?.parts.some(part => part.partId === added.id)).toBe(true), { timeout: 30_000 });
  const saved = (await getJob(changed.id))!;
  expect(saved.boards![0]!.layout!.at[instanceId]).toEqual(board.layout.at[instanceId]);
  expect(saved.plan).toEqual(cut.plan);
  expect(saved.design!.accepted!.parts.map(part => part.id)).toEqual([partId, added.id]);
}, 60_000);

it('shows why oversized saved stock cannot run even though its actual part fits the machine', async () => {
  const previousBounds = useStore.getState().machineBounds;
  try {
    useStore.getState().setMachineBounds(0, 0, 600, 400);
    const empty = await createDesignJob('Oversized sheet');
    const source = { ...createPlateDocument({ width: 180, height: 100, thickness: 12 }), id: empty.design!.draft.id };
    const accepted = await acceptDesign(await saveDesignDraft(empty, source), source),
      id = `${source.parts[0]!.id}#0`;
    const board = {
      ...newBoard([], 12, 'plywood', [id]),
      size: { fit: false as const, w: 1000, h: 800 },
      margin: 10,
      layout: { w: 1000, h: 800, at: { [id]: { x: 12, y: 12, rotated: false } } },
    };
    const job = await saveJob({ ...accepted, boards: [board] }, accepted);
    state.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Plan />
      </QueryClientProvider>
    );
    await screen.findByText(/Board A is larger than the machine work area/, {}, { timeout: 30_000 });
    expect(state.requests[0]!.parts).toEqual([]);
    expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Leave it out' })).toBeNull();
  } finally {
    useStore.setState({ machineBounds: previousBounds });
  }
}, 60_000);
