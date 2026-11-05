import '@/style.css';
import { createJob } from '@/cam/jobDb';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { Route } from './$jobId.boards';

const params = vi.hoisted(() => ({ jobId: '' }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));

const BoardsStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

describe('CAM boards layout', () => {
  it('keeps a narrow board’s drawing where it is when selecting the board shows its offcut', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    params.jobId = (await createJob(new File([bytes], 'kinderregal-eiche.step'))).id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardsStep />
      </QueryClientProvider>
    );
    await screen.findByRole('region', { name: 'Board A drawing' }, { timeout: 60_000 });
    // Whichever board isn't selected, with its drawing there to measure.
    const other = await waitFor(
      () => {
        const found = [...document.querySelectorAll<HTMLElement>('[data-board-drawing]')].find(
          b => !b.querySelector('[data-offcut-label]') && b.querySelector('[data-board-frame]')
        );
        expect(found).toBeDefined();
        return found!;
      },
      { timeout: 30_000 }
    );
    // As narrow as a tall board's drawing, where the header has to wrap.
    other.style.width = '220px';
    const offset = () =>
      other.querySelector('[data-board-frame]')!.closest('svg')!.getBoundingClientRect().top - other.getBoundingClientRect().top;
    const before = offset();
    fireEvent.click(other);
    await waitFor(() => expect(other.querySelector('[data-offcut-label]')).not.toBeNull());
    expect(offset()).toBeCloseTo(before, 1);
  }, 90_000);
});
