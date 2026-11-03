import { createJob, getJob, saveJob } from '@/cam/jobDb';
import { camWorker, modelKey } from '@/cam/camQueries';
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
vi.mock('@/store/store', () => ({ useStore: { getState: () => store } }));
vi.mock('@/visualize/depthViewStore', () => ({ useDepthView: { getState: () => depth } }));

const PlanStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

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
    // Oak with the 1/8" bit: no pass deeper than half the diameter, shown per operation.
    const stepdowns = (t: HTMLElement) =>
      within(t)
        .getAllByRole('row')
        .slice(1)
        .map(r => parseFloat(within(r).getAllByRole('cell')[5].textContent!));
    expect(Math.max(...stepdowns(table))).toBeLessThanOrEqual(1.59);

    expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show board A on machine' }));
    const [gcode, name] = store.updateToolpath.mock.calls[0];
    expect(name).toBe('kinderregal-eiche board A.gcode');
    expect(gcode).toContain('(Board A)');
    expect(gcode).toMatch(/\(X0 Y0 = lower left corner of board A, [\d.]+ x [\d.]+ mm\. Z0 = stock bottom\)/);
    expect(navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
    // The machine view gets the board's setup: stock top 8 + 0.3 allowance, Z0 at the bottom, the 1/8" flat bit.
    expect(store.setStockHeight).toHaveBeenCalledWith(8.3);
    expect(store.setToolDiameter).toHaveBeenCalledWith(3.175);
    expect(depth.setZeroAt).toHaveBeenCalledWith('bottom');
    expect(depth.setToolShape).toHaveBeenCalledWith('flat');

    // A max stepdown of 3.5 mm (what the Fusion setups use for the outline) makes fewer, deeper passes: the 7.3 mm of
    // outline roughing in 3 even steps of 2.43 instead of 5 of 1.46.
    fireEvent.change(screen.getByLabelText('Max stepdown (mm)'), { target: { value: '3.5' } });
    await vi.waitFor(
      () => {
        const deeper = stepdowns(screen.getByRole('table', { name: 'Operations for board A' }));
        expect(Math.max(...deeper)).toBeGreaterThan(2.4);
        expect(Math.max(...deeper)).toBeLessThanOrEqual(3.5);
      },
      { timeout: 30_000 }
    );
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

    fireEvent.click(within(alert).getByRole('button', { name: 'Leave them out' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull(), { timeout: 10_000 });
    expect((await getJob(job.id))!.plan!.leaveOut).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toHaveProperty('disabled', false);
    expect(screen.getByText(/Safety checks passed/)).toBeTruthy();
  }, 120_000);
});
