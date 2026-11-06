import '@/style.css';
import { useBoardsLayout } from '@/cam/boards/boardsLayoutStore';
import { createJob, getJob, saveJob } from '@/cam/jobDb';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { page } from '@vitest/browser/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// The width the rail and the sidebar's tools are for.
beforeEach(() => page.viewport(1280, 800));

afterEach(() => {
  cleanup();
  useBoardsLayout.setState({ railClosed: false });
});

const drawing = (name: string) => screen.queryByRole('region', { name: `${name} drawing` });

async function open() {
  const bytes = await (await fetch(stepUrl)).arrayBuffer();
  const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
  params.jobId = job.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardsStep />
    </QueryClientProvider>
  );
  await screen.findByRole('region', { name: 'Board A drawing' }, { timeout: 60_000 });
  return job;
}

const saved = async (id: string, name = 'A') => (await getJob(id))!.boards!.find(b => b.name === name)!;

describe('CAM boards layout', () => {
  it('keeps the tools with the drawing on a small screen, and the rail a strip', async () => {
    await page.viewport(390, 844);
    await open();
    expect(within(document.querySelector('main')!).getByRole('button', { name: 'Clamp' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show board list' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Board B' }));
    expect(drawing('Board B')).toBeTruthy();
  }, 90_000);

  it('edits one board at a time, with every board as an overview that leads back to it', async () => {
    await open();
    expect(drawing('Board B')).toBeNull();
    const rail = within(screen.getByRole('navigation', { name: 'Boards' }));
    fireEvent.click(rail.getByRole('button', { name: 'Board B' }));
    expect(drawing('Board A')).toBeNull();
    expect(drawing('Board B')).toBeTruthy();

    // All boards: the same scale for all, and none of what edits a board.
    fireEvent.click(screen.getByRole('tab', { name: 'All boards' }));
    expect(screen.queryByRole('navigation', { name: 'Boards' })).toBeNull();
    expect(drawing('Board A')!.querySelector('[data-resize]')).toBeNull();
    expect(document.getElementById('board-w')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Stock list' })).getByRole('button', { name: 'Add stock board' })).toBeTruthy();

    fireEvent.click(drawing('Board A')!);
    expect(screen.getByRole('tab', { name: 'Board A' }).getAttribute('aria-selected')).toBe('true');
    expect(drawing('Board B')).toBeNull();
  }, 90_000);

  it('resizes the board by dragging: the drawing holds still until the drop, and the new room is at the bottom', async () => {
    const job = await open();
    const svg = () => drawing('Board A')!.querySelector('[data-board-frame]')!.closest('svg')!;
    await waitFor(async () => expect((await saved(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
    const before = svg().getBoundingClientRect();
    const was = await saved(job.id);
    const grip = drawing('Board A')!.querySelector('[data-resize="wh"]')!;
    const at = grip.getBoundingClientRect();
    const from = { clientX: at.x + 4, clientY: at.y + 4, pointerId: 1, button: 0 };
    fireEvent.pointerDown(grip, from);
    fireEvent.pointerMove(grip, { ...from, clientX: from.clientX + 80, clientY: from.clientY + 40 });

    // The new outline, and what it would give, while nothing else moves.
    expect(drawing('Board A')!.querySelector('[data-resize-outline]')).toBeTruthy();
    expect(svg().getBoundingClientRect()).toEqual(before);
    expect(screen.getByLabelText('Board A status').textContent).toMatch(/^\d+ × \d+ mm · \d\.\d\d m² · \d+ % yield/);
    const moved = grip.getBoundingClientRect();
    expect(moved.x - at.x).toBeCloseTo(80, -1);
    expect(moved.y - at.y).toBeCloseTo(40, -1);
    expect(at.x).toBeGreaterThan(before.x + before.width / 2);
    expect(at.y).toBeGreaterThan(before.y + before.height / 2);

    fireEvent.pointerUp(grip, from);
    await waitFor(
      async () => {
        const size = (await saved(job.id)).size;
        expect(size.fit).toBe(false);
        // Whole 10 mm, bigger both ways.
        if (size.fit) return;
        expect(size.w % 10).toBe(0);
        expect(size.h % 10).toBe(0);
        expect(size.w).toBeGreaterThan(574);
        expect(size.h).toBeGreaterThan(750);
      },
      { timeout: 10_000 }
    );
    // What's on it kept its distance to the top edge; XY zero went down with the bottom one.
    const now = await saved(job.id);
    const item = now.items[0];
    expect(now.layout!.h - now.layout!.at[item].y).toBeCloseTo(was.layout!.h - was.layout!.at[item].y, 3);
    expect(drawing('Board A')!.querySelector('[data-resize-outline]')).toBeNull();
  }, 90_000);

  it('moves a part to a board in the rail: into its nest, with the board being edited still open', async () => {
    const job = await open();
    // Another 8 mm board, empty.
    fireEvent.click(screen.getByRole('tab', { name: 'All boards' }));
    fireEvent.click(screen.getByRole('button', { name: /New 8 mm board/ }));
    await screen.findByRole('region', { name: 'Board C drawing' });
    fireEvent.click(drawing('Board A')!);

    const part = within(drawing('Board A')!).getByRole('button', { name: /^left: drag, or move/ });
    const start = part.getBoundingClientRect();
    fireEvent.pointerDown(part, { clientX: start.x + 5, clientY: start.y + 5, button: 0 });
    const target = screen.getByRole('button', { name: 'Board C' });
    const to = target.getBoundingClientRect();
    const over = { clientX: to.x + to.width / 2, clientY: to.y + to.height / 2 };
    fireEvent.pointerMove(window, over);
    expect(document.querySelector('[data-new-board-drop]')).toBeTruthy();
    fireEvent.pointerMove(window, { ...over, clientX: over.clientX + 1 });
    fireEvent.pointerUp(window, over);
    await waitFor(
      async () => {
        const onC = await saved(job.id, 'C');
        expect(onC.items).toHaveLength(1);
        expect((await saved(job.id)).items).not.toContain(onC.items[0]);
      },
      { timeout: 10_000 }
    );
    expect(drawing('Board A')).toBeTruthy();
    expect(drawing('Board C')).toBeNull();
  }, 90_000);

  it('sets margin and gap on the drawing, with what they mean as their description', async () => {
    const job = await open();
    const margin = (await screen.findByLabelText('Edge margin')) as HTMLInputElement;
    const hint = (el: Element) => document.getElementById(el.getAttribute('aria-describedby')!)?.textContent;
    expect(hint(margin)).toMatch(/border inside the board edge/);
    const gap = screen.getByLabelText('Gap between parts') as HTMLInputElement;
    expect(hint(gap)).toMatch(/outline cuts never meet/);
    fireEvent.change(gap, { target: { value: '20' } });
    fireEvent.blur(gap);
    await waitFor(async () => expect((await saved(job.id)).gap).toBe(20), { timeout: 10_000 });
  }, 90_000);

  it('picks and renames a board from its tab, and refuses a name that can’t be', async () => {
    const job = await open();
    const menu = () =>
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Choose or rename a board' }), { button: 0, ctrlKey: false });
    menu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Board B' }));
    await screen.findByRole('region', { name: 'Board B drawing' }, { timeout: 10_000 });

    menu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename this board…' }));
    const name = screen.getByLabelText('Board name') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(name), { timeout: 10_000 });
    fireEvent.change(name, { target: { value: 'A' } });
    fireEvent.blur(name);
    expect((await getJob(job.id))!.boards!.filter(b => b.name === 'A')).toHaveLength(1);
    fireEvent.change(name, { target: { value: 'Back panel' } });
    fireEvent.blur(name);
    await waitFor(async () => expect((await getJob(job.id))!.boards!.map(b => b.name)).toEqual(['A', 'Back panel']), { timeout: 10_000 });
    expect(await screen.findByRole('tab', { name: 'Back panel' }, { timeout: 10_000 })).toBeTruthy();
    expect(drawing('Back panel')).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Boards' })).getByRole('button', { name: 'Back panel' })).toBeTruthy();
  }, 90_000);

  it('doesn’t rename a cut board: its name is in its programs, which would count as not cut any more', async () => {
    const job = await open();
    await waitFor(async () => expect((await getJob(job.id))!.boards?.length).toBe(2), { timeout: 10_000 });
    const before = (await getJob(job.id))!;
    cleanup();
    await saveJob({ ...before, boards: before.boards!.map(b => (b.name === 'A' ? { ...b, cut: { at: 1, keys: ['k'] } } : b)) });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardsStep />
      </QueryClientProvider>
    );
    await screen.findByRole('region', { name: 'Board A drawing' }, { timeout: 60_000 });
    expect(screen.queryByLabelText('Board name')).toBeNull();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Choose a board' }), { button: 0, ctrlKey: false });
    expect(await screen.findByRole('menuitem', { name: 'Board B' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Rename this board…' })).toBeNull();
  }, 90_000);

  it('a right-click on a clamp only opens its menu, however the mouse drifts', async () => {
    const job = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest holds' }));
    await waitFor(async () => expect((await saved(job.id)).fixtures?.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
    const before = await saved(job.id);
    const clamp = await waitFor(() => {
      const c = drawing('Board A')!.querySelector('[data-hold="clamp"]');
      expect(c).toBeTruthy();
      return c!;
    });
    const at = clamp.getBoundingClientRect();
    fireEvent.pointerDown(clamp, { clientX: at.x, clientY: at.y, button: 2, pointerId: 1 });
    fireEvent.pointerMove(clamp, { clientX: at.x + 30, clientY: at.y + 30, button: 2, pointerId: 1 });
    expect(drawing('Board A')!.querySelector('[data-hold-preview]')).toBeNull();
    fireEvent.pointerUp(clamp, { clientX: at.x + 30, clientY: at.y + 30, button: 2, pointerId: 1 });
    fireEvent.contextMenu(clamp);
    expect(await screen.findByRole('menuitem', { name: 'Remove this clamp' })).toBeTruthy();
    expect(await saved(job.id)).toEqual(before);
  }, 90_000);

  it('keeps the gap between parts within reach on a board with one part', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Board B' }));
    expect(document.querySelector('[data-board-overlay] #board-gap')).toBeNull();
    expect(document.querySelector('aside #board-gap')).toBeTruthy();
  }, 90_000);

  it('a collapsed rail stays out of the way of a part moved on its board, and opens when it’s dragged there', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse board list' }));
    const part = within(drawing('Board A')!).getByRole('button', { name: /^left: drag, or move/ });
    const start = part.getBoundingClientRect();
    fireEvent.pointerDown(part, { clientX: start.x + 5, clientY: start.y + 5, button: 0 });
    fireEvent.pointerMove(window, { clientX: start.x + 25, clientY: start.y + 25 });
    expect(document.querySelector('[data-rail-drop]')).toBeNull();
    fireEvent.pointerMove(window, { clientX: 10, clientY: start.y + 25 });
    expect(document.querySelector('[data-rail-drop]')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
  }, 90_000);

  it('collapses the rail to a strip that still switches boards, and remembers it', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse board list' }));
    expect(useBoardsLayout.getState().railClosed).toBe(true);
    const strip = within(screen.getByRole('navigation', { name: 'Boards' }));
    expect(strip.getByRole('button', { name: 'Show board list' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(strip.getByRole('button', { name: 'Board B' }));
    expect(drawing('Board B')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Collapse board list' })).toBeNull();
    fireEvent.click(strip.getByRole('button', { name: 'Show board list' }));
    expect(useBoardsLayout.getState().railClosed).toBe(false);
  }, 90_000);

  it('says nothing over the drawing while all is well, only an issue or what just happened', async () => {
    const job = await open();
    const status = () => screen.getByLabelText('Board A status');
    await waitFor(async () => expect((await saved(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
    expect(status().hidden).toBe(true);

    // An issue stays until it's fixed; the sidebar has the verdict either way.
    fireEvent.click(screen.getByRole('button', { name: 'Clamp' }));
    const frame = drawing('Board A')!.querySelector<SVGGraphicsElement>('[data-board-frame]')!;
    const p = new DOMPoint(1, 380).matrixTransform(frame.getScreenCTM()!);
    const svg = frame.closest('svg')!;
    fireEvent.pointerMove(svg, { clientX: p.x, clientY: p.y });
    fireEvent.click(svg, { clientX: p.x, clientY: p.y });
    await waitFor(() => expect(status().textContent).toMatch(/1 clamp: the board can still turn/), { timeout: 10_000 });
    expect(status().hidden).toBe(false);
    expect(document.querySelector('[data-fixture-count]')!.textContent).toBe('1 clamp');
  }, 90_000);

  it('reaches the clamp sizes from a clamp’s menu, with the side view of what they mean', async () => {
    const job = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Suggest holds' }));
    await waitFor(async () => expect((await saved(job.id)).fixtures?.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
    const clamp = await waitFor(() => {
      const c = drawing('Board A')!.querySelector('[data-hold="clamp"]');
      expect(c).toBeTruthy();
      return c!;
    });
    fireEvent.contextMenu(clamp);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clamp and screw sizes…' }));
    expect(await screen.findByRole('figure', { name: 'What the clamp sizes mean' }, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByRole('figure', { name: 'What the screw sizes mean' })).toBeTruthy();
  }, 90_000);
});
