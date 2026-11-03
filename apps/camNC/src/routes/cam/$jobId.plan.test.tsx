import { createJob, getJob, saveJob } from '@/cam/jobDb';
import { camWorker, modelKey } from '@/cam/camQueries';
import { useCuttingData } from '@/cam/cuttingData';
import { instancesOf, reconcileBoards } from '@/cam/boards';
import * as Comlink from 'comlink';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import messerUrl from '../../../../../packages/cam/test/fixtures/messerblock-klein.step?url';
import { Route } from './$jobId.plan';

const params = vi.hoisted(() => ({ jobId: '' }));
const bed = vi.hoisted(() => ({ bounds: {} as object | null }));
const store = vi.hoisted(() => ({ updateToolpath: vi.fn(), setStockHeight: vi.fn(), setToolDiameter: vi.fn() }));
const depth = vi.hoisted(() => ({ setZeroAt: vi.fn(), setToolShape: vi.fn() }));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  useSearch: () => ({}),
  useNavigate: () => navigate,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@/store/store', () => ({ useStore: { getState: () => store }, selectMachineBounds: () => bed.bounds }));
vi.mock('@/visualize/depthViewStore', () => ({ useDepthView: { getState: () => depth } }));

const PlanStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

/** The accessible description: the text of the elements `aria-describedby` points to. */
const description = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

describe('CAM plan step', () => {
  it('makes one safe program per board, inner features before outlines, and hands it to the machine view', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );

    const table = await screen.findByRole('table', { name: 'Operations for board A' }, { timeout: 60_000 });
    // One board per thickness: A has the five 8 mm bodies, B the 3 mm back.
    expect(
      within(screen.getByRole('tablist', { name: /Boards/ }))
        .getAllByRole('tab')
        .map(t => t.textContent)
    ).toEqual(['1 · A 8 mm', '2 · B 3 mm']);
    const labels = within(table)
      .getAllByRole('row')
      .slice(1)
      .map(r => within(r).getAllByRole('cell')[1].textContent!);
    const firstOutline = labels.findIndex(l => l.includes('Outline'));
    expect(firstOutline).toBeGreaterThan(0);
    expect(labels.slice(firstOutline).every(l => l.includes('Outline'))).toBe(true);
    expect(labels.filter(l => l.includes('Outline'))).toHaveLength(5);
    expect(screen.getByText(/Safety checks passed/)).toBeTruthy();
    // What the CAM core notes in the G-code shows here too, in plain words: the mortises' corners stay round.
    expect(screen.getByText(/Inside corners stay rounded to the bit radius \(1\.59 mm\)/)).toBeTruthy();
    // The default layout (tabs, 8 mm gaps, 5.2 mm edge): tabs only where they hold, every part held.
    expect(screen.queryByText(/tabs would hold it/)).toBeNull();
    expect(screen.queryByText(/bottom skin/)).toBeNull();
    // Oak with the 1/8" bit: no pass deeper than half the diameter, shown per operation.
    const stepdowns = (t: HTMLElement) =>
      within(t)
        .getAllByRole('row')
        .slice(1)
        .map(r => parseFloat(within(r).getAllByRole('cell')[5].textContent!));
    expect(Math.max(...stepdowns(table))).toBeLessThanOrEqual(1.59);

    // The job goes to the machine once every board's program is ready (board B's may still be computing).
    await waitFor(() => expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toHaveProperty('disabled', false), {
      timeout: 60_000,
    });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show board A on machine' }));
    const [gcode, name] = store.updateToolpath.mock.calls[0];
    expect(name).toBe('kinderregal-eiche board A.gcode');
    expect(gcode).toContain('(Board A)');
    expect(gcode).toMatch(/\(X0 Y0 = lower left corner of board A, [\d.]+ x [\d.]+ mm\. Z0 = stock bottom\)/);
    expect(navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
    // No bed yet (no machine connected, no size picked): pick one first, then the program shows on it.
    bed.bounds = null;
    fireEvent.click(screen.getByRole('button', { name: 'Show board A on machine' }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/start', search: { for: 'cam' } });
    bed.bounds = {};
    // The machine view gets the board's setup: stock top 8 + 0.3 allowance, Z0 at the bottom, the 1/8" flat bit.
    expect(store.setStockHeight).toHaveBeenCalledWith(8.3);
    expect(store.setToolDiameter).toHaveBeenCalledWith(3.175);
    expect(depth.setZeroAt).toHaveBeenCalledWith('bottom');
    expect(depth.setToolShape).toHaveBeenCalledWith('flat');

    // This job only: 3.5 mm per pass (what the Fusion setups use for the outline) makes fewer, deeper passes: the
    // 7.3 mm of outline roughing in 3 even steps of 2.43 instead of 5 of 1.46.
    const panel = screen.getByRole('region', { name: 'Cutting data' });
    fireEvent.change(within(panel).getByRole('spinbutton', { name: /^Stepdown/ }), { target: { value: '3.5' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Only this job' }));
    const deepest = () => Math.max(...stepdowns(screen.getByRole('table', { name: 'Operations for board A' })));
    await vi.waitFor(() => expect(deepest()).toBeGreaterThan(2.4), { timeout: 30_000 });
    expect(deepest()).toBeLessThanOrEqual(3.5);
    expect((await getJob(job.id))!.plan!.cutting).toEqual({ stepdown: 3.5 });
    expect(within(panel).getByText(/mm · this job/)).toBeTruthy();

    // From the table: 1 mm, saved for the bit + oak (every job); it replaces this job's 3.5.
    const firstStepdown = within(screen.getByRole('table', { name: 'Operations for board A' })).getAllByRole('row')[1];
    fireEvent.click(within(firstStepdown).getAllByRole('cell')[5].querySelector('button')!);
    const popover = await screen.findByRole('dialog');
    fireEvent.change(within(popover).getByRole('spinbutton', { name: /^Stepdown/ }), { target: { value: '1' } });
    fireEvent.click(within(popover).getByRole('button', { name: /^Save for ⌀3.175 .* \+ oak$/ }));
    // Every pass at most 1 mm, except the outline's final pass: from 1 mm above the bottom through to -0.3.
    await vi.waitFor(() => expect(deepest()).toBeLessThanOrEqual(1.3), { timeout: 30_000 });
    expect(Object.values(useCuttingData.getState().saved)).toEqual([{ stepdown: 1 }]);
    await vi.waitFor(async () => expect((await getJob(job.id))!.plan!.cutting).toEqual({}));
  }, 120_000);

  it('mills a 3D part as a flat board when asked: its outline at least', async () => {
    const bytes = await (await fetch(messerUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'messerblock-klein.step'));
    await saveJob({ ...job, parts: [{ id: 'part-0', name: 'messerblock', quantity: 1, milled: true }] });
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );
    // The knife slots are not 2.5D (~30 s to analyse): the outline is cut, the slots are left.
    const table = await screen.findByRole('table', { name: 'Operations for board A' }, { timeout: 150_000 });
    const labels = within(table)
      .getAllByRole('row')
      .slice(1)
      .map(r => within(r).getAllByRole('cell')[1].textContent!);
    expect(labels.some(l => l.includes('Outline'))).toBe(true);
  }, 180_000);

  it('names parts that don\u2019t fit their board and blocks the job until they fit or are left out', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    // Board A as a 600 x 300 stock board: room for two of its five 8 mm bodies.
    const copy = new Uint8Array(bytes.slice(0));
    const model = await camWorker().importModel(Comlink.transfer(copy, [copy.buffer]), job.fileName, modelKey(job));
    const boards = reconcileBoards(
      undefined,
      instancesOf(model.parts, () => true),
      'oak'
    ).map(b => (b.name === 'A' ? { ...b, size: { fit: false as const, w: 600, h: 300 } } : b));
    await saveJob({ ...job, boards });
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );

    const alert = await screen.findByRole('alert', {}, { timeout: 60_000 });
    expect(alert.textContent).toMatch(/3 parts don’t fit on their boards and would not be cut: .+ \(A\)/);
    await screen.findByRole('table', { name: 'Operations for board A' }, { timeout: 60_000 });
    expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Show board A on machine' })).toHaveProperty('disabled', true);
    expect(screen.queryByText(/Safety checks passed/)).toBeNull();
    // What each action does, also while it can't be used yet.
    expect(description(screen.getByRole('button', { name: /Take the job to the machine/ }))).toMatch(/every board in cutting order/);
    expect(description(screen.getByRole('button', { name: 'Show board A on machine' }))).toMatch(/^Loads only board A/);
    expect(description(screen.getByRole('button', { name: 'More actions' }))).toMatch(/G-code/);
    expect(description(screen.getByRole('button', { name: /^Bit: / }))).toMatch(/whole job/);
    expect(description(within(alert).getByRole('button', { name: 'Leave them out' }))).toMatch(/without these parts/);
    const table = screen.getByRole('table', { name: 'Operations for board A' });
    for (const [header, hint] of [
      ['Passes', /depths/],
      ['Stepdown', /How deep each pass cuts/],
      ['Stepover', /sideways/],
      ['Feed', /mm\/min/],
    ] as const)
      expect(description(within(within(table).getByRole('columnheader', { name: header })).getByText(header))).toMatch(hint);

    fireEvent.click(within(alert).getByRole('button', { name: 'Leave them out' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull(), { timeout: 10_000 });
    expect((await getJob(job.id))!.plan!.leaveOut).toHaveLength(3);
    await waitFor(() => expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toHaveProperty('disabled', false), {
      timeout: 60_000,
    });
    expect(screen.getByText(/Safety checks passed/)).toBeTruthy();
  }, 120_000);

  it('parts with no edge where tabs would hold keep a bottom skin, freed at the machine', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    const copy = new Uint8Array(bytes.slice(0));
    const model = await camWorker().importModel(Comlink.transfer(copy, [copy.buffer]), job.fileName, modelKey(job));
    // Only the back, alone on its board with a 4 mm margin: after its cut, nothing beyond a tab is wide enough to hold it.
    const parts = model.parts.map(p => ({ id: p.id, name: p.name, quantity: p.names.length, milled: p.name === 'back' }));
    const boards = reconcileBoards(
      undefined,
      instancesOf(model.parts, id => parts.find(p => p.id === id)!.milled),
      'oak'
    ).map(b => ({ ...b, margin: 4 }));
    await saveJob({ ...job, parts, boards });
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );
    expect((await screen.findByText(/1 mm bottom skin/, {}, { timeout: 60_000 })).textContent).toMatch(/^back: .*Free parts/);
    // Held by the skin: nothing comes loose, nothing blocks.
    expect(screen.queryByText(/tabs would hold it/)).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toHaveProperty('disabled', false), {
      timeout: 60_000,
    });
  }, 120_000);
});
