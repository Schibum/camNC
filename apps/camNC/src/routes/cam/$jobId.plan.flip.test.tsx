import { createJob, saveJob } from '@/cam/jobDb';
import { camWorker, modelKey } from '@/cam/camQueries';
import { instancesOf, reconcileBoards } from '@/cam/boards';
import * as Comlink from 'comlink';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/besteckkasten.step?url';
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

/** The besteckkasten job with its 8 mm board as a big sheet (room for dowel pins), the second side as given. */
async function openBesteck(flip?: 'camera' | 'dowels') {
  const bytes = await (await fetch(stepUrl)).arrayBuffer();
  const job = await createJob(new File([bytes], 'besteckkasten.step'));
  const copy = new Uint8Array(bytes.slice(0));
  const model = await camWorker().importModel(Comlink.transfer(copy, [copy.buffer]), job.fileName, modelKey(job));
  const boards = reconcileBoards(
    undefined,
    instancesOf(model.parts, () => true),
    'oak'
  ).map(b => (b.name === 'A' ? { ...b, size: { fit: false as const, w: 1220, h: 610 }, ...(flip && { flip }) } : b));
  await saveJob({ ...job, boards });
  params.jobId = job.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PlanStep />
    </QueryClientProvider>
  );
  return job;
}

const rows = () =>
  within(screen.getByRole('table', { name: 'Operations for board A' }))
    .getAllByRole('row')
    .slice(1)
    .map(r =>
      within(r)
        .getAllByRole('cell')
        .map(c => c.textContent!)
    );

describe('CAM plan step, second side', () => {
  it('turns the board over for the parts’ undersides: side B pockets measured from the new top', async () => {
    await openBesteck();
    const sides = await screen.findByRole('group', { name: 'Board side' }, { timeout: 90_000 });
    expect(within(sides).getByRole('button', { name: 'Side A' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/drag its outline onto it in the camera view again/)).toBeTruthy();
    // Side A cuts no underside, and no longer warns about it.
    expect(rows().some(r => r[1].includes('vert1'))).toBe(true);
    expect(screen.queryByText(/need a second, flipped setup/)).toBeNull();

    fireEvent.click(within(sides).getByRole('button', { name: 'Side B (turned over)' }));
    await waitFor(() => expect(rows().every(r => !r[1].includes('Outline'))).toBe(true));
    const vert1 = rows().find(r => r[1].includes('vert1') && r[1].includes('Pocket'))!;
    // Fusion's flipped setup: 4.2 deep from the top. Stock 8 + 0.3: down to 4.1.
    expect(vert1[3]).toBe('8.3 → 4.1');
  }, 150_000);

  it('on dowel pins: side A drills the pin holes first', async () => {
    await openBesteck('dowels');
    await screen.findByRole('group', { name: 'Board side' }, { timeout: 90_000 });
    expect(screen.getByText(/Pins ⌀6 at X\d+ Y\d+ and X\d+ Y\d+/)).toBeTruthy();
    expect(rows()[0][1]).toMatch(/^Dowel pin hole/);
    expect(screen.getByText(/Safety checks passed/)).toBeTruthy();
  }, 150_000);
});
