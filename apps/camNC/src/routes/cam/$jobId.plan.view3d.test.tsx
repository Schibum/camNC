import { createJob } from '@/cam/jobDb';
import { usePlan3dView } from '@/cam/plan3d/plan3dViewStore';
import { usePlanLayout } from '@/cam/plan/planLayoutStore';
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
  usePlanLayout.setState(usePlanLayout.getInitialState(), true);
  localStorage.removeItem('camnc-plan-layout');
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
  it('draws no frames while nothing changes, and draws again when something does', async () => {
    const draws = vi.spyOn(WebGL2RenderingContext.prototype, 'drawElementsInstanced');
    const bytes = await (await fetch(stepUrl)).arrayBuffer();
    const job = await createJob(new File([bytes], 'besteckkasten.step'));
    params.jobId = job.id;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <PlanStep />
      </QueryClientProvider>
    );
    const view = await screen.findByRole('region', { name: /^3D view of board/ }, { timeout: 90_000 });
    const quiet = () =>
      vi.waitFor(
        async () => {
          const before = draws.mock.calls.length;
          await new Promise(r => setTimeout(r, 1000));
          expect(draws.mock.calls.length).toBe(before);
        },
        { timeout: 30_000, interval: 0 }
      );

    await quiet();
    expect(draws.mock.calls.length).toBeGreaterThan(0);
    for (const change of [
      () => within(within(view).getByRole('group', { name: 'View' })).getByRole('button', { name: 'Top' }),
      () => within(view).getByRole('button', { name: 'Compare to model' }),
      () => within(view).getByRole('button', { name: 'Play' }),
    ]) {
      const before = draws.mock.calls.length;
      fireEvent.click(change());
      await vi.waitFor(() => expect(draws.mock.calls.length).toBeGreaterThan(before), { timeout: 10_000 });
    }
    fireEvent.click(within(view).getByRole('button', { name: 'Pause' }));
    await quiet();
    draws.mockRestore();
  }, 180_000);

  it('shows the board in 3D with its op list beside it, and the toggles switch between result and toolpath', async () => {
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
    // The op list is in the sidebar, beside the view. Identical ops (the through holes of a part) are one row, with a count.
    const sidebar = screen.getByRole('complementary', { name: 'Operations and settings' });
    const list = within(sidebar).getByRole('list', { name: /^Operations for board/ });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.some(r => /×\d/.test(r.textContent!))).toBe(true);
    expect(rows.some(r => r.textContent!.includes('Outline'))).toBe(true);
    expect(within(sidebar).getByText(/smallest bit first, inner features before outlines/)).toBeTruthy();

    // Result: the timeline, with one band per op; selecting an op offers to jump to its start and end.
    const playhead = within(view).getByRole('slider', { name: 'Playhead' });
    expect(Number(playhead.getAttribute('aria-valuenow'))).toBe(Number(playhead.getAttribute('aria-valuemax')));
    const hole = rows.find(r => /×\d/.test(r.textContent!))!;
    const holeName = hole.textContent!.split(' ×')[0];
    const select = within(hole).getAllByRole('button')[0];
    expect(select.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(select);
    // Selected in the list, selected in the view; the row opens with the op's numbers.
    expect(within(view).getByText(`${holeName}: solid where it has cut, a tint where it still cuts`)).toBeTruthy();
    expect(select.getAttribute('aria-expanded')).toBe('true');
    const numbers = hole.querySelector('dl')!;
    const terms = [...numbers.querySelectorAll('dt')].map(t => (t.querySelector('[tabindex]') ?? t).textContent);
    expect(terms).toEqual(['Z from bottom', 'Passes', 'Stepdown', 'Stepover', expect.stringMatching(/^Feed/), 'Time (sim)']);
    const values = [...numbers.querySelectorAll('dd')].map(d => d.textContent!);
    expect(values[0]).toMatch(/^[\d.]+ → -?[\d.]+$/);
    expect(values[1]).toMatch(/^\d+$/);
    expect(values[2]).toMatch(/^[\d.]+ mm$/);
    expect(values[4]).toMatch(/mm\/min$/);
    expect(values[5]).toMatch(/^\d+:\d\d$/);
    // A grouped row says its numbers are each op's; the row itself says its time is the simulated one.
    expect(within(hole).getByText(/^Per op, for each of the \d+ identical ops/)).toBeTruthy();
    expect(hole.textContent).toMatch(/\d+:\d\d sim/);
    expect(description(within(hole).getByText('Stepdown'))).toMatch(/How deep each pass cuts/);
    // A number there is changed where it is, like in the table.
    fireEvent.click(within(hole).getAllByRole('button', { name: /^[\d.]+ mm$/ })[0]);
    const popover = await screen.findByRole('dialog');
    expect(within(popover).getByRole('textbox', { name: /^Stepdown/ })).toBeTruthy();
    // Focused in a real window, the field's tooltip opens too; Escape still closes the popover, not only that.
    fireEvent.focus(document.activeElement!);
    fireEvent.focusIn(document.activeElement!);
    fireEvent.keyDown(popover, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(within(hole).getByRole('button', { name: 'Jump to start' }));
    expect(Number(playhead.getAttribute('aria-valuenow'))).toBeLessThan(Number(playhead.getAttribute('aria-valuemax')));
    expect(screen.queryByRole('button', { name: /^Hide / })).toBeNull();

    // The table: the same ops, every op's numbers side by side; a row selects its op, in the list and the view too.
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Table' }));
    const table = within(sidebar).getByRole('table', { name: /^Operations for board/ });
    const tableRows = within(table).getAllByRole('row').slice(1);
    expect(tableRows.length).toBe(rows.length);
    const outline = tableRows.findIndex(r => r.textContent!.includes('Outline'));
    fireEvent.click(within(tableRows[outline]).getAllByRole('cell')[1]);
    expect(within(view).getByText(/Outline.*: solid where it has cut/)).toBeTruthy();
    fireEvent.click(within(sidebar).getByRole('button', { name: 'List' }));
    const opened = within(within(sidebar).getByRole('list', { name: /^Operations for board/ })).getAllByRole('listitem')[outline];
    expect(within(opened).getAllByRole('button')[0].getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Show all' }));

    // Every toggle and icon-only button says what it does.
    for (const name of [
      'Result',
      'Toolpath',
      '3D',
      'Top',
      'Perspective',
      'Orthographic',
      'See through',
      'Compare to model',
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
    const eyes = within(sidebar).getAllByRole('button', { name: /^Hide / });
    expect(eyes).toHaveLength(rows.length);
    expect(description(eyes[0])).toMatch(/still cut/);
    expect(description(within(view).getByRole('button', { name: 'Rapids' }))).toMatch(/fast moves/);
    fireEvent.click(eyes[0]);
    expect(within(sidebar).getAllByRole('button', { name: /^Show (?!all$)/ })).toHaveLength(1);
    fireEvent.click(within(view).getByRole('button', { name: 'Rapids' }));
    expect(usePlan3dView.getState().showRapids).toBe(false);

    // Top view: orthographic unless changed; the projection toggle is per view.
    const camera = within(view).getByRole('group', { name: 'View' });
    // Result mode: colour the cut against the model, with a legend.
    fireEvent.click(within(view).getByRole('button', { name: 'Result' }));
    const compare = within(view).getByRole('button', { name: 'Compare to model' });
    fireEvent.click(compare);
    expect(within(view).getByRole('note', { name: 'Compared to the model' }).textContent).toMatch(
      /As designed.*Material left.*Cut too deep/
    );
    fireEvent.click(compare);
    fireEvent.click(within(view).getByRole('button', { name: 'Toolpath' }));
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
