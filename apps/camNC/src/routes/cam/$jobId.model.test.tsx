import { getJob, createJob } from '@/cam/jobDb';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { Route } from './$jobId.model';

const params = vi.hoisted(() => ({ jobId: '' }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
// WebGL is not what this test is about.
vi.mock('@/cam/model/ModelViewport', () => ({ ModelViewport: () => <div data-testid="viewport" /> }));

const ModelStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

describe('CAM model step', () => {
  it('lists the parts of a STEP model grouped by thickness, and saves "Mill this part"', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModelStep />
      </QueryClientProvider>
    );

    const thick = await screen.findByRole('region', { name: '8 mm boards' }, { timeout: 60_000 });
    expect(within(thick).getByText('8 mm · 5 parts')).toBeTruthy();
    for (const name of ['left', 'right', 'Part 1', 'Part 2']) expect(within(thick).getByText(name)).toBeTruthy();
    expect(within(thick).getByText('× 2')).toBeTruthy();
    expect(within(thick).getAllByText('9 pockets 4.2 deep')).toHaveLength(2);
    const thin = screen.getByRole('region', { name: '3 mm boards' });
    expect(within(thin).getByText('back')).toBeTruthy();

    fireEvent.click(within(thin).getByRole('button', { name: /back/ }));
    expect(screen.getByRole('heading', { name: 'back' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Mill this part'));
    const notMilled = screen.getByRole('region', { name: 'Not milled' });
    await waitFor(() => expect(within(notMilled).getByText('back')).toBeTruthy());
    await waitFor(async () => expect((await getJob(job.id))?.parts.find(p => p.name === 'back')?.milled).toBe(false));
  });
});
