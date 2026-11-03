import { createJob, getJob } from '@/cam/jobDb';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { Route } from './$jobId.boards';

const params = vi.hoisted(() => ({ jobId: '' }));
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@wbcnc/ui/components/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn(), warning: vi.fn() }),
}));

const BoardsStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

/** HTML5 drag and drop between the board cards. */
function drag(chip: HTMLElement, target: HTMLElement) {
  const dataTransfer = new DataTransfer();
  fireEvent.dragStart(chip, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

describe('CAM boards step', () => {
  it('nests the parts on one board per thickness and regroups them by drag and drop', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardsStep />
      </QueryClientProvider>
    );

    const a = await screen.findByRole('region', { name: 'Board A' }, { timeout: 60_000 });
    const b = screen.getByRole('region', { name: 'Board B' });
    for (const name of ['left', 'right', 'Part 1', 'Part 3', 'Part 2']) expect(within(a).getByText(name)).toBeTruthy();
    expect(within(b).getByText('back')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Board .* with 5 parts/ })).toBeTruthy();

    // A new 8 mm board, and the middle shelf dragged onto it.
    fireEvent.click(screen.getByRole('button', { name: /New 8 mm board/ }));
    const c = await screen.findByRole('region', { name: 'Board C' });
    drag(within(a).getByText('Part 2'), c);
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Board C' })).getByText('Part 2')).toBeTruthy());
    expect(within(screen.getByRole('region', { name: 'Board A' })).queryByText('Part 2')).toBeNull();

    // The 3 mm back can't go on an 8 mm board.
    drag(within(screen.getByRole('region', { name: 'Board B' })).getByText('back'), screen.getByRole('region', { name: 'Board A' }));
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('3 mm thick'));

    // Without dragging: ⋯ › Move to › New board.
    fireEvent.pointerDown(within(screen.getByRole('region', { name: 'Board A' })).getByRole('button', { name: 'Move Part 3' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Board D' })).getByText('Part 3')).toBeTruthy());

    // From the board view: drag the left side onto board C (pointer events, so touch works too).
    fireEvent.click(screen.getByRole('region', { name: 'Board A' }));
    const left = await waitFor(() => document.querySelector<SVGGElement>('[data-part="left"]')!);
    const target = screen.getByRole('region', { name: 'Board C' }).getBoundingClientRect();
    fireEvent.pointerDown(left, { clientX: 10, clientY: 10, button: 0 });
    // While dragging, compatible boards say so; the 3 mm board doesn't take it.
    expect(within(screen.getByRole('region', { name: 'Board C' })).getByText('Drop here')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Board B' })).getByText('different thickness')).toBeTruthy();
    fireEvent.pointerUp(window, { clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 });
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Board C' })).getByText('left')).toBeTruthy());

    await waitFor(async () => {
      const saved = (await getJob(job.id))!.boards!;
      expect(saved.map(x => [x.name, x.items.length])).toEqual([
        ['A', 2],
        ['B', 1],
        ['C', 2],
        ['D', 1],
      ]);
    });

    // Clamps keep two corners free.
    fireEvent.click(screen.getByRole('region', { name: 'Board A' }));
    fireEvent.click(screen.getByLabelText('Clamps only'));
    expect(await screen.findByText('clamp keep-out')).toBeTruthy();
  }, 90_000);
});
