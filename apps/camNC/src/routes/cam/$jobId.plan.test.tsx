import { createJob, getJob } from '@/cam/jobDb';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { Route } from './$jobId.plan';

const params = vi.hoisted(() => ({ jobId: '' }));
const store = vi.hoisted(() => ({ updateToolpath: vi.fn() }));
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

const PlanStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

describe('CAM plan step', () => {
  it('generates safe G-code for the first part and hands it to the machine view', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );

    const table = await screen.findByRole('table', { name: /Operations for left/ }, { timeout: 60_000 });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(r => within(r).getAllByRole('cell')[1].textContent)).toEqual([
      'Pocket 4.2 deep',
      'Pocket 4.5 deep',
      'Outline: rough + final pass',
    ]);
    // The edge groove starts where the 4.2 pocket ended.
    expect(within(rows[1]).getByText('3.8 → 3.5')).toBeTruthy();
    // Final pass through to -0.3 at half feed.
    expect(within(rows[2]).getByText('8 → -0.3')).toBeTruthy();
    expect(within(rows[2]).getByText('1800 / 900')).toBeTruthy();
    expect(screen.getByText(/Safety checks passed/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Show on machine/ }));
    expect(store.updateToolpath).toHaveBeenCalledWith(expect.stringContaining('(OP 3/3 Outline 1'), 'kinderregal-eiche left.gcode');
    expect(navigate).toHaveBeenCalledWith({ to: '/visualize/2DView' });

    // Settings are saved with the job and regenerate the program.
    fireEvent.click(screen.getByLabelText('Holding tabs'));
    await waitFor(async () => expect((await getJob(job.id))?.plan?.tabs).toBe(true));
    store.updateToolpath.mockClear();
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /Show on machine/ }));
      // Tabs lift the outline passes to Z2 over 5mm + bit.
      expect(store.updateToolpath.mock.calls.at(-1)?.[0]).toMatch(/Z2\n/);
    });
  });
});
