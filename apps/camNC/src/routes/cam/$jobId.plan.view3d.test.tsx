import { createJob } from '@/cam/jobDb';
import { usePlan3dView } from '@/cam/plan3d/plan3dViewStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/besteckkasten.step?url';
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

const PlanStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(() => {
  cleanup();
  usePlan3dView.setState(usePlan3dView.getInitialState(), true);
  localStorage.removeItem('camnc-plan-3d-view');
});

/** The accessible description: the text of the elements `aria-describedby` points to. */
const description = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

const pressed = (group: HTMLElement) =>
  within(group)
    .getAllByRole('button')
    .filter(b => b.getAttribute('aria-pressed') === 'true')
    .map(b => b.textContent);

describe('CAM plan step, 3D view', () => {
  it('shows the board in 3D with its op list, and the toggles switch between result and toolpath', async () => {
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'besteckkasten.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );

    const view = await screen.findByRole('region', { name: /^3D view of board/ }, { timeout: 90_000 });
    expect(view.querySelector('canvas')).toBeTruthy();
    expect(view.dataset.mode).toBe('result');
    // Identical ops (the through holes of a part) are one row, with a count.
    const list = within(view).getByRole('list', { name: 'Operations in the 3D view' });
    const rows = within(list).getAllByRole('listitem');
    const table = screen.getByRole('table', { name: /Operations for board/ });
    expect(rows.length).toBe(within(table).getAllByRole('row').length - 1);
    expect(rows.some(r => /×\d/.test(r.textContent!))).toBe(true);
    expect(rows.some(r => r.textContent!.includes('Outline'))).toBe(true);

    // Result: the timeline, with one band per op; selecting an op offers to jump to its start and end.
    const playhead = within(view).getByRole('slider', { name: 'Playhead' });
    expect(Number(playhead.getAttribute('aria-valuenow'))).toBe(Number(playhead.getAttribute('aria-valuemax')));
    const hole = rows.find(r => /×\d/.test(r.textContent!))!;
    fireEvent.click(within(hole).getAllByRole('button')[0]);
    fireEvent.click(within(view).getByRole('button', { name: 'Jump to start' }));
    expect(Number(playhead.getAttribute('aria-valuenow'))).toBeLessThan(Number(playhead.getAttribute('aria-valuemax')));
    expect(within(view).queryByRole('button', { name: /^Hide / })).toBeNull();

    // Every toggle and icon-only button says what it does.
    for (const name of [
      'Result',
      'Toolpath',
      '3D',
      'Top',
      'Perspective',
      'Orthographic',
      'See through',
      'Show the whole board',
      'Play',
      'Pause',
    ])
      for (const b of within(view).queryAllByRole('button', { name })) expect(description(b), name).not.toBe('');
    expect(description(within(view).getByRole('combobox', { name: 'Speed' }))).toMatch(/seconds of cutting/);

    // Toolpath: no timeline, an eye per op, rapids can be hidden.
    const show = within(view).getByRole('group', { name: 'Show' });
    expect(pressed(show)).toEqual(['Result']);
    fireEvent.click(within(show).getByRole('button', { name: 'Toolpath' }));
    expect(view.dataset.mode).toBe('toolpath');
    expect(within(view).queryByRole('slider', { name: 'Playhead' })).toBeNull();
    const eyes = within(view).getAllByRole('button', { name: /^Hide / });
    expect(eyes).toHaveLength(rows.length);
    expect(description(eyes[0])).toMatch(/still cut/);
    expect(description(within(view).getByRole('button', { name: 'Rapids' }))).toMatch(/fast moves/);
    fireEvent.click(eyes[0]);
    expect(within(view).getAllByRole('button', { name: /^Show (?!all$)/ })).toHaveLength(1);
    fireEvent.click(within(view).getByRole('button', { name: 'Rapids' }));
    expect(usePlan3dView.getState().showRapids).toBe(false);

    // Top view: orthographic unless changed; the projection toggle is per view.
    const camera = within(view).getByRole('group', { name: 'View' });
    const projection = within(view).getByRole('group', { name: 'Projection' });
    expect(pressed(projection)).toEqual(['Perspective']);
    fireEvent.click(within(camera).getByRole('button', { name: 'Top' }));
    expect(pressed(projection)).toEqual(['Orthographic']);
    fireEvent.click(within(view).getByRole('button', { name: 'See through' }));
    expect(within(view).getByRole('button', { name: 'See through' }).getAttribute('aria-pressed')).toBe('true');

    // Remembered.
    expect(JSON.parse(localStorage.getItem('camnc-plan-3d-view')!).state).toMatchObject({
      mode: 'toolpath',
      view: 'top',
      seeThrough: true,
      showRapids: false,
    });
  }, 120_000);
});
