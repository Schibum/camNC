import { createJob } from '@/cam/jobDb';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
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

    fireEvent.click(screen.getByRole('button', { name: /Show on machine/ }));
    const [gcode, name] = store.updateToolpath.mock.calls[0];
    expect(name).toBe('kinderregal-eiche board A.gcode');
    expect(gcode).toContain('(Part: Board A)');
    expect(navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });
    // The machine view gets the board's setup: stock top 8 + 0.3 allowance, Z0 at the bottom, the 1/8" flat bit.
    expect(store.setStockHeight).toHaveBeenCalledWith(8.3);
    expect(store.setToolDiameter).toHaveBeenCalledWith(3.175);
    expect(depth.setZeroAt).toHaveBeenCalledWith('bottom');
    expect(depth.setToolShape).toHaveBeenCalledWith('flat');
  }, 90_000);
});
