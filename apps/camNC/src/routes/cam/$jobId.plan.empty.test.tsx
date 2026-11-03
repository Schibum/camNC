import { createJob } from '@/cam/jobDb';
import type { PlanResult } from '@/cam/camTypes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { Route } from './$jobId.plan';

const params = vi.hoisted(() => ({ jobId: '' }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
// Every board comes back with nothing to cut (e.g. a 3D part milled anyway without flat features).
vi.mock('@/cam/camQueries', async importOriginal => {
  const empty: PlanResult = {
    gcode: '',
    timeMin: 0,
    warnings: [],
    safety: [],
    ops: [],
    bits: [3.175],
    programs: [{ tool: 1, diameter: 3.175, gcode: 'G0 Z13\n', timeMin: 0 }],
    size: [100, 100, 8],
    path: [],
  } as unknown as PlanResult;
  return {
    ...(await importOriginal<typeof import('@/cam/camQueries')>()),
    useBoardPlans: (_job: unknown, boards: unknown[]) => boards.map(() => ({ data: empty, isFetching: false, isPending: false })),
  };
});

const PlanStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

describe('CAM plan step, nothing to cut', () => {
  it('says so instead of passing the safety checks, and offers no program', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );
    expect((await screen.findByRole('status', {}, { timeout: 60_000 })).textContent).toMatch(/^Nothing to cut on board A/);
    expect(screen.queryByText(/Safety checks passed/)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: /Take the job to the machine/ })).toHaveProperty('disabled', true);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More actions' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    expect((await screen.findByRole('menuitem', { name: 'Show board A on machine' })).getAttribute('aria-disabled')).toBe('true');
  }, 90_000);
});
