import { createJob, getJob, saveJob, type CamJobV1 } from '@/cam/jobDb';
// Pointer coordinates and fitted SVG dimensions must use the page's real layout, including the fixed-height status.
import '@/style.css';
import { useStore } from '@/store/store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Box2, Vector2 } from 'three';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import stepUrl from '../../../../../packages/cam/test/fixtures/kinderregal-eiche.step?url';
import { Route } from './$jobId.boards';

const params = vi.hoisted(() => ({ jobId: '' }));
const toastError = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useParams: () => params,
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/page-header', () => ({ PageHeader: () => null }));
vi.mock('@wbcnc/ui/components/sonner', () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: toastSuccess, warning: vi.fn() }),
}));

const BoardsStep = (Route as unknown as { options: { component: ComponentType } }).options.component;

afterEach(cleanup);

/** The accessible description: the text of the elements `aria-describedby` points to. */
const description = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();

/** A board's drawing: its header, the parts on it, the ones that don't fit. */
const drawing = (board: string) => screen.getByRole('region', { name: `Board ${board} drawing` });

/** Every board, with the job-wide layout tools. */
const showAll = () => fireEvent.click(screen.getByRole('button', { name: 'All boards' }));
/** An item of the Suggest holds menu in the tools. */
const holdsMenu = async (name: string) => {
  fireEvent.pointerDown(await screen.findByRole('button', { name: 'Suggest holds' }, { timeout: 10_000 }), { button: 0, ctrlKey: false });
  return (await screen.findByRole('menuitem', { name })) as HTMLElement;
};
const suggestHolds = async () => fireEvent.click(await holdsMenu('Suggest holds'));

/** A board from the list: what edits it is on its drawing and in the sidebar. */
const openBoard = (board: string) => fireEvent.click(screen.getByRole('button', { name: `Board ${board}` }));

/** Pointer drag of a part (its outline, or its chip where it doesn't fit) to the middle of another board's drawing. */
function drag(part: Element, board: string) {
  const start = part.getBoundingClientRect();
  fireEvent.pointerDown(part, { clientX: start.x + 3, clientY: start.y + 3, button: 0 });
  // Once it's moving: its board selected, and the "New board" target showing, things have moved.
  fireEvent.pointerMove(window, { clientX: start.x + 13, clientY: start.y + 13 });
  drawing(board).scrollIntoView({ block: 'center' });
  const frame = drawing(board).querySelector('[data-board-frame]')!.closest('svg')!.getBoundingClientRect();
  const to = { clientX: frame.x + frame.width / 2, clientY: frame.y + frame.height / 2 };
  fireEvent.pointerMove(window, to);
  fireEvent.pointerUp(window, to);
}

/** A part's menu, from the ⋯ that shows on the part last touched. */
async function openMenu(board: string, name: string) {
  fireEvent.focus(partIn(board, name));
  fireEvent.pointerDown(await within(drawing(board)).findByRole('button', { name: `${name} menu` }), { button: 0, ctrlKey: false });
}

/** A part's outline in a board drawing. */
const partIn = (board: string, name: string) =>
  within(screen.getByRole('region', { name: `Board ${board} drawing` })).getByRole('button', {
    name: new RegExp(`^${name}: drag, or move`),
  });

/** Client point of a board point (mm, lower left zero) in a board's drawing. */
function clientOf(board: string, x: number, y: number) {
  const frame = screen.getByRole('region', { name: `Board ${board} drawing` }).querySelector<SVGGraphicsElement>('[data-board-frame]')!;
  const p = new DOMPoint(x, y).matrixTransform(frame.getScreenCTM()!);
  return { clientX: p.x, clientY: p.y };
}

async function openKinderregal(client = new QueryClient()) {
  const bytes = await (await fetch(stepUrl)).arrayBuffer();
  const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
  params.jobId = job.id;
  render(
    <QueryClientProvider client={client}>
      <BoardsStep />
    </QueryClientProvider>
  );
  await screen.findByRole('region', { name: 'Board A drawing' }, { timeout: 60_000 });
  return job;
}

describe('CAM boards step', () => {
  it('auto-fill keeps parts moved by hand, and Undo restores the boards exactly', async () => {
    const job = await openKinderregal();

    // The middle shelf on a board of its own, by hand: pinned there. Enter on a part opens its menu.
    fireEvent.keyDown(partIn('A', 'Part 2'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    const c = await screen.findByRole('region', { name: 'Board C drawing' });
    expect(within(c).getByText('Part 2')).toBeTruthy();
    expect(description(within(c).getByRole('img', { name: 'Placed by hand' }))).toMatch(/^Pinned:/);

    // One 8 mm stock board size, as many as needed: the stock list is next to Auto-fill.
    showAll();
    const stockList = within(screen.getByRole('region', { name: 'Stock list' }));
    fireEvent.change(stockList.getByLabelText('Stock thickness'), { target: { value: '8' } });
    fireEvent.change(stockList.getByLabelText('Stock width'), { target: { value: '1220' } });
    fireEvent.change(stockList.getByLabelText('Stock height'), { target: { value: '610' } });
    fireEvent.click(stockList.getByRole('button', { name: 'Add stock board' }));
    // Both saves (the new board, the stock list) land before auto-fill reads the job.
    await waitFor(
      async () => {
        const saved = (await getJob(job.id))!;
        expect(saved.stock).toHaveLength(1);
        expect(saved.boards?.map(b => b.name)).toContain('C');
      },
      { timeout: 10_000 }
    );
    const before = (await getJob(job.id))!.boards!;
    expect(before.find(b => b.name === 'C')!.pinned).toEqual([before.find(b => b.name === 'C')!.items[0]]);

    fireEvent.click(screen.getByRole('button', { name: 'Auto-fill from stock' }));
    await screen.findByText('Parts placed on 1 board from stock.');
    let after: typeof before = [];
    await waitFor(async () => {
      after = (await getJob(job.id))!.boards!;
      expect(after).not.toEqual(before);
    });
    // The pinned board is still there with its part; the others are on one stock board.
    const pinned = before.find(b => b.name === 'C')!;
    expect(after.find(b => b.id === pinned.id)).toEqual(pinned);
    const stockBoard = after.find(b => !b.size.fit)!;
    expect(stockBoard.size).toEqual({ fit: false, w: 1220, h: 610 });
    expect(stockBoard.items).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Undo that' }));
    await waitFor(async () => expect((await getJob(job.id))!.boards).toStrictEqual(before));
    expect(drawing('C')).toBeTruthy();
    // Undo leaves the stock list alone.
    expect((await getJob(job.id))!.stock).toHaveLength(1);
  }, 90_000);

  it('nests the parts on one board per thickness and regroups them by drag and drop', async () => {
    const job = await openKinderregal();
    showAll();
    const a = drawing('A');
    const b = drawing('B');
    for (const name of ['left', 'right', 'Part 1a', 'Part 1b', 'Part 2']) expect(within(a).getByText(name)).toBeTruthy();
    expect(within(b).getByText('back')).toBeTruthy();
    expect(screen.getByRole('group', { name: /Board A, .* with 5 parts/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Board B, .* with 1 parts/ })).toBeTruthy();

    // A new 8 mm board, and the middle shelf dragged onto it.
    fireEvent.click(screen.getByRole('button', { name: /New 8 mm board/ }));
    await screen.findByRole('region', { name: 'Board C drawing' });
    drag(partIn('A', 'Part 2'), 'C');
    await waitFor(() => expect(within(drawing('C')).getByText('Part 2')).toBeTruthy(), { timeout: 10_000 });
    expect(within(drawing('A')).queryByText('Part 2')).toBeNull();

    // The 3 mm back can't go on an 8 mm board.
    drag(partIn('B', 'back'), 'A');
    await screen.findByText(/3 mm thick/);

    // Without dragging: ⋯ › Move to › New board.
    await openMenu('A', 'Part 1b');
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Board D drawing' })).getByText('Part 1b')).toBeTruthy());

    // The left side onto board C (pointer events, so touch works too).
    const left = partIn('A', 'left');
    const start = left.getBoundingClientRect();
    fireEvent.pointerDown(left, { clientX: start.x + 5, clientY: start.y + 5, button: 0 });
    fireEvent.pointerMove(window, { clientX: start.x + 15, clientY: start.y + 15 });
    drawing('C').scrollIntoView({ block: 'center' });
    const frame = drawing('C').querySelector('[data-board-frame]')!.closest('svg')!.getBoundingClientRect();
    const to = { clientX: frame.x + frame.width / 2, clientY: frame.y + frame.height / 2 };
    fireEvent.pointerMove(window, to);
    // While dragging, the board under the pointer says where it lands; the 3 mm board doesn't take it.
    expect(within(drawing('C')).getByText(/^(Lands where you drop it|Snaps into the nest)$/)).toBeTruthy();
    expect(within(drawing('B')).getByText('Different thickness')).toBeTruthy();
    fireEvent.pointerUp(window, to);
    await waitFor(() => expect(within(drawing('C')).getByText('left')).toBeTruthy(), { timeout: 10_000 });

    await waitFor(async () => {
      const saved = (await getJob(job.id))!.boards!;
      expect(saved.map(x => [x.name, x.items.length])).toEqual([
        ['A', 2],
        ['B', 1],
        ['C', 2],
        ['D', 1],
      ]);
    });

    // The click that ends a drag doesn't open a board, for 50 ms: this one comes later.
    await new Promise(resolve => setTimeout(resolve, 60));
    // No fixtures until they are placed: Suggest holds places some, Undo takes them back.
    fireEvent.click(drawing('A'));
    const holdsOnA = () => screen.getByRole('region', { name: 'Board A drawing' }).querySelectorAll('[data-hold]').length;
    expect(holdsOnA()).toBe(0);
    await suggestHolds();
    await waitFor(() => expect(holdsOnA()).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(holdsOnA()).toBe(0), { timeout: 10_000 });
  }, 90_000);

  it('drags a part’s outline from one board drawing onto another, where it lands exactly at the drop point', async () => {
    const job = await openKinderregal();
    // Board C: a 1220 × 610 sheet, empty.
    showAll();
    fireEvent.click(screen.getByRole('button', { name: /New 8 mm board/ }));
    fireEvent.click(await screen.findByRole('region', { name: 'Board C drawing' }));
    for (const [label, value] of [
      ['Width', '1220'],
      ['Height', '610'],
    ]) {
      // The board's own fields (the stock list has a Width and Height too).
      const field = () => screen.getByLabelText(label, { selector: '[id^="board-"]' }) as HTMLInputElement;
      const input = field();
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
      await waitFor(() => expect(field().value).toBe(value));
    }
    await waitFor(
      async () => expect((await getJob(job.id))!.boards!.find(b => b.name === 'C')!.size).toEqual({ fit: false, w: 1220, h: 610 }),
      { timeout: 10_000 }
    );

    showAll();
    // Grab the left side (560 × 140) at its lower left corner + (20, 10) mm.
    const left = partIn('A', 'left');
    const box = (left as unknown as SVGGElement).getBBox();
    // getBBox is in the drawing's frame (Y up): lower left corner of the outline.
    fireEvent.pointerDown(left, { ...clientOf('A', box.x + 20, box.y + 10), button: 0 });

    // Over board C at (300, 300) + the grab offset: the outline follows the pointer, C is highlighted and shows
    // where it lands.
    const c = screen.getByRole('region', { name: 'Board C drawing' });
    c.scrollIntoView({ block: 'center' });
    const drop = clientOf('C', 320, 310);
    fireEvent.pointerMove(window, drop);
    expect(document.elementFromPoint(drop.clientX, drop.clientY)?.closest('[data-board-drop]')).toBe(c);
    expect(document.querySelector('[data-drag-ghost]')).toBeTruthy();
    expect(c.querySelector('[data-preview="fits"]')).toBeTruthy();
    expect(within(c).getByText('Lands where you drop it')).toBeTruthy();
    // Near the column's edge the drag scrolls it: let go where that point of board C is now.
    fireEvent.pointerUp(window, clientOf('C', 320, 310));

    await waitFor(
      async () => {
        const boards = (await getJob(job.id))!.boards!;
        const onC = boards.find(b => b.name === 'C')!;
        expect(onC.items).toHaveLength(1);
        expect(onC.pinned).toEqual(onC.items);
        const at = onC.layout!.at[onC.items[0]];
        expect(Math.abs(at.x - 300)).toBeLessThan(5);
        expect(Math.abs(at.y - 300)).toBeLessThan(5);
        expect(at.rotated).toBe(false);
        expect(boards.find(b => b.name === 'A')!.items).not.toContain(onC.items[0]);
        // The save takes longer than the default second on a busy CI machine.
      },
      { timeout: 10_000 }
    );
    expect(within(drawing('C')).getByText('left')).toBeTruthy();
    expect(document.querySelector('[data-drag-ghost]')).toBeNull();

    // Arrow keys move it on its board, 10 mm with Shift.
    const before = (await getJob(job.id))!.boards!.find(b => b.name === 'C')!;
    const id = before.items[0];
    fireEvent.keyDown(partIn('C', 'left'), { key: 'ArrowRight', shiftKey: true });
    await waitFor(
      async () => {
        const at = (await getJob(job.id))!.boards!.find(b => b.name === 'C')!.layout!.at[id];
        expect(at.x).toBeCloseTo(before.layout!.at[id].x + 10, 5);
        expect(at.y).toBeCloseTo(before.layout!.at[id].y, 5);
      },
      { timeout: 10_000 }
    );
  }, 90_000);

  it('drags a tab along its part’s outline: saved in the part’s frame, and placed automatically again on request', async () => {
    const client = new QueryClient();
    const job = await openKinderregal(client);
    // Wait for the actual transactions started by this gesture. A busy worker can outlast a polling assertion's
    // default second; an optimistic render is also too early to assert what IndexedDB has committed.
    const commit = async (label: string, action: () => void) => {
      const cache = client.getMutationCache();
      const previous = new Set(cache.getAll().map(mutation => mutation.mutationId));
      action();
      const writes = cache.getAll().filter(mutation => {
        const variables = mutation.state.variables as { job?: CamJobV1 } | undefined;
        return !previous.has(mutation.mutationId) && variables?.job?.id === job.id;
      });
      expect(writes.length, `${label}: starts a save for this job`).toBeGreaterThan(0);
      await act(async () => {
        await Promise.all(
          writes.map(
            mutation =>
              new Promise<void>((resolve, reject) => {
                let unsubscribe = () => {};
                const changed = () => {
                  if (mutation.state.status === 'success') {
                    unsubscribe();
                    resolve();
                  } else if (mutation.state.status === 'error') {
                    unsubscribe();
                    reject(new Error(`${label}: job save failed`, { cause: mutation.state.error }));
                  }
                };
                unsubscribe = cache.subscribe(changed);
                changed();
              })
          )
        );
      });
    };
    const drawingA = () => drawing('A');
    // The board's program comes back with its tabs.
    const tab = await waitFor(
      () => {
        const t = drawingA().querySelector<SVGCircleElement>('[data-tab]');
        expect(t).toBeTruthy();
        return t!;
      },
      { timeout: 60_000 }
    );
    const part = tab.getAttribute('data-tab')!;
    const [cx, cy] = [+tab.getAttribute('cx')!, +tab.getAttribute('cy')!];
    // 30 mm along the board's x, and a little off the outline: it lands on the outline.
    // By the bar, which on a small board reaches past the ring.
    const bar = tab.parentElement!.querySelector<SVGLineElement>('[data-tab-bar]')!;
    const ends = [...tab.parentElement!.querySelectorAll('[data-tab-bar]')].flatMap(l => [
      Math.hypot(+l.getAttribute('x1')! - cx, +l.getAttribute('y1')! - cy),
      Math.hypot(+l.getAttribute('x2')! - cx, +l.getAttribute('y2')! - cy),
    ]);
    expect(Math.max(...ends)).toBeGreaterThan(2);
    fireEvent.pointerDown(bar, { ...clientOf('A', cx, cy), button: 0, pointerId: 1 });
    fireEvent.pointerMove(bar, { ...clientOf('A', cx + 30, cy + 2), pointerId: 1 });
    await commit('drag tab', () => fireEvent.pointerUp(bar, { ...clientOf('A', cx + 30, cy + 2), pointerId: 1 }));
    const saved = async () => (await getJob(job.id))!.boards!.find(b => b.name === 'A')!;
    await waitFor(async () => {
      const b = await saved();
      const item = b.items.find(id => b.tabsAt?.[id]);
      expect(item).toBeTruthy();
      expect(b.tabsAt![item!].length).toBeGreaterThanOrEqual(2);
    });
    // The next program has a tab where it was dropped.
    await waitFor(
      () => {
        const moved = [...drawingA().querySelectorAll<SVGCircleElement>(`[data-tab="${part}"]`)];
        expect(moved.some(t => Math.abs(+t.getAttribute('cx')! - (cx + 30)) < 4)).toBe(true);
      },
      { timeout: 60_000 }
    );
    // A double-click on the part's edge adds one there; one on a tab removes it.
    const count = async () => {
      const b = await saved();
      return b.tabsAt![b.items.find(id => b.tabsAt?.[id])!].length;
    };
    const before = await count();
    const outline = () => drawingA().querySelector<SVGGElement>(`[data-item][data-part="${part}"]`)!;
    const edgePoint = () => {
      const box = outline().getBBox();
      return clientOf('A', box.x + box.width / 2, box.y + 1);
    };
    await commit('add tab', () => fireEvent.doubleClick(outline(), edgePoint()));
    await waitFor(async () => expect(await count()).toBe(before + 1));
    await waitFor(() => expect(drawingA().querySelectorAll(`[data-tab="${part}"]`).length).toBeGreaterThanOrEqual(before + 1), {
      timeout: 60_000,
    });
    await commit('remove tab', () => fireEvent.doubleClick(drawingA().querySelector(`[data-tab="${part}"]`)!));
    await waitFor(async () => expect(await count()).toBe(before));
    // The tab tool adds one with a click on the outline, previewed first; a click on the tab selects it, with its bar.
    // Once the program has caught up: a new tab goes with the ones it has.
    await waitFor(
      () => {
        const spots = [...drawingA().querySelectorAll(`[data-tab="${part}"]`)].map(t => `${t.getAttribute('cx')},${t.getAttribute('cy')}`);
        expect(new Set(spots).size).toBe(before);
      },
      { timeout: 60_000 }
    );
    const svgA = () => drawingA().querySelector('[data-board-frame]')!.closest('svg')!;
    fireEvent.keyDown(document.body, { key: 't' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tab' }).getAttribute('aria-pressed')).toBe('true'));
    // Clear of the one the double-click left there.
    const elsewhere = () => {
      const box = outline().getBBox();
      return clientOf('A', box.x + box.width / 4, box.y + 1);
    };
    fireEvent.pointerMove(svgA(), elsewhere());
    expect(drawingA().querySelector('[data-tab-preview]')).toBeTruthy();
    await commit('tab tool', () => fireEvent.click(svgA(), elsewhere()));
    await waitFor(async () => expect(await count()).toBe(before + 1));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select' }).getAttribute('aria-pressed')).toBe('true'));
    await waitFor(() => expect(drawingA().querySelectorAll(`[data-tab="${part}"]`).length).toBeGreaterThanOrEqual(before + 1), {
      timeout: 60_000,
    });
    const group = drawingA().querySelector(`[data-tab="${part}"]`)!.parentElement!;
    fireEvent.pointerDown(group, { ...edgePoint(), button: 0, pointerId: 1 });
    fireEvent.pointerUp(group, { ...edgePoint(), button: 0, pointerId: 1 });
    const tabBar = await screen.findByRole('toolbar', { name: `Tab · ${part}` });
    await commit('delete tab', () => fireEvent.click(within(tabBar).getByRole('button', { name: 'Delete this tab' })));
    await waitFor(async () => expect(await count()).toBe(before));
    // Back to picked tabs: for the part, from its menu.
    await openMenu('A', part);
    const menu = screen.getByRole('menu');
    const resetPart = await screen.findByRole('menuitem', { name: 'Place its tabs automatically again' });
    await commit('part reset', () => fireEvent.click(resetPart));
    expect((await saved()).tabsAt, 'part reset: persisted tabs use automatic placement').toBeUndefined();
    // Radix retains a closed menu, including its accessibility isolation, until its native exit animation ends.
    // Observe that lifecycle rather than assuming compositor events arrive within waitFor's default second.
    if (menu.isConnected) expect(menu.getAttribute('data-state')).toBe('closed');
    await act(async () => {
      await Promise.allSettled(menu.getAnimations().map(animation => animation.finished));
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(drawingA(), 'part reset: board is accessible after menu dismissal').toBeTruthy();
    // And for the whole board, from its settings.
    await commit('add tab after part reset', () => fireEvent.doubleClick(outline(), edgePoint()));
    expect((await saved()).tabsAt, 'board reset: starts with a saved manual tab').toBeTruthy();
    fireEvent.click(drawingA());
    const resetBoard = await screen.findByRole('button', { name: 'Place tabs automatically again' });
    await commit('board reset', () => fireEvent.click(resetBoard));
    expect(
      screen.queryByRole('button', { name: 'Place tabs automatically again' }),
      'board reset: manual-tab control disappears'
    ).toBeNull();
    expect((await saved()).tabsAt, 'board reset: persisted tabs use automatic placement').toBeUndefined();
  }, 150_000);

  it('places a clamp with the tool: a click on its own preview counts, parts make room, and the status says so', async () => {
    const job = await openKinderregal();
    fireEvent.click(drawing('A'));
    fireEvent.click(screen.getByRole('button', { name: 'Clamp' }));
    const svg = drawing('A').querySelector('[data-board-frame]')!.closest('svg')!;
    // The left edge beside the upper stack: the pointer stays right on the preview under it.
    fireEvent.pointerMove(svg, clientOf('A', 1, 380));
    const preview = await waitFor(() => {
      const g = drawing('A').querySelector('[data-hold-preview="clamp"]');
      expect(g).toBeTruthy();
      return g!;
    });
    // A preview doesn't take the pointer: what's under it gets the click.
    expect(getComputedStyle(preview).pointerEvents).toBe('none');
    expect(screen.getByLabelText('Board A status').textContent).toMatch(
      /Part 1a, Part 1b, Part 2 move \d+ mm right\. Board size unchanged\./
    );
    // ResizeObserver applies the fitted drawing scale after the new status has been laid out.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    // Preview the same integer CSS pixels used by the click rather than assuming their inverse is exactly 380 mm
    // at every fitted drawing scale.
    const click = new MouseEvent('click', { ...clientOf('A', 1, 380), bubbles: true, cancelable: true });
    const at = { clientX: click.clientX, clientY: click.clientY };
    fireEvent.pointerMove(svg, at);
    const frame = drawing('A').querySelector<SVGGraphicsElement>('[data-board-frame]')!;
    const toe = [...drawing('A').querySelector('[data-hold-preview="clamp"]')!.querySelectorAll('rect')].at(-1)!;
    const previewAt = +toe.getAttribute('y')! + +toe.getAttribute('height')! / 2;
    // Capture the delivered click in the current frame: ResizeObserver may apply a final fitted-scale update when
    // React flushes the gesture. The position is still required to match both the target and preview within a pixel.
    let placed!: DOMPoint,
      pixelMm = 0;
    svg.addEventListener(
      'click',
      event => {
        const inverse = frame.getScreenCTM()!.inverse();
        placed = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
        pixelMm = Math.abs(new DOMPoint(0, 1).matrixTransform(inverse).y - new DOMPoint(0, 0).matrixTransform(inverse).y);
      },
      { capture: true, once: true }
    );
    fireEvent(svg, click);
    expect(placed.x).toBeLessThan(10);
    expect(Math.abs(placed.y - 380)).toBeLessThanOrEqual(pixelMm);
    expect(Math.abs(previewAt - Math.round(placed.y))).toBeLessThanOrEqual(pixelMm + 1);
    await waitFor(
      async () => {
        const a = (await getJob(job.id))!.boards!.find(b => b.name === 'A')!;
        expect(a.fixtures).toEqual([{ kind: 'clamp', side: 'left', at: Math.round(placed.y) }]);
        expect(a.layout!.w).toBe(574);
        expect(a.layout!.h).toBe(750);
      },
      { timeout: 10_000 }
    );
    expect(screen.getByLabelText('Board A status').textContent).toMatch(/1 clamp: the board can still turn/);
    // Placed: now a real fixture, with its hand cursor; the tool steps aside over it.
    fireEvent.pointerMove(svg, at);
    expect(drawing('A').querySelector('[data-hold="clamp"]')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Clamp' }).getAttribute('aria-pressed')).toBe('false');
  }, 90_000);

  it('says plainly when holds there don’t surround the work and Suggest can’t fix it', async () => {
    const job = await openKinderregal();
    openBoard('B');
    const boardB = async () => (await getJob(job.id))!.boards!.find(b => b.name === 'B')!;
    await waitFor(async () => expect((await boardB()).layout).toBeTruthy(), { timeout: 10_000 });
    const saved = (await getJob(job.id))!;
    // The back fills its board, and this size is fixed: no edge has room for what's missing.
    const { w, h } = (await boardB()).layout!;
    const hold = { kind: 'clamp' as const, side: 'left' as const, at: h / 2 };
    await saveJob({
      ...saved,
      boards: saved.boards!.map(b => (b.name === 'B' ? { ...b, size: { fit: false as const, w, h }, fixtures: [hold] } : b)),
    });
    cleanup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardsStep />
      </QueryClientProvider>
    );
    await screen.findByRole('button', { name: 'Board B' }, { timeout: 60_000 });
    openBoard('B');
    await suggestHolds();
    await waitFor(() => expect(document.body.textContent).toMatch(/These holds don’t surround the work’s middle/), { timeout: 10_000 });
    expect(document.body.textContent).not.toMatch(/already surround/);
  }, 90_000);

  it('Fewer and More change one clamp and leave the others put', async () => {
    const job = await openKinderregal();
    fireEvent.click(drawing('A'));
    const saved = async () => (await getJob(job.id))!.boards!.find(b => b.name === 'A')!;
    const isOff = (item: HTMLElement) => item.hasAttribute('data-disabled');
    const fewer = () => holdsMenu('One clamp fewer');
    const more_ = () => holdsMenu('One clamp more');
    const closeMenu = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    // Nothing to nudge until there are holds.
    expect(isOff(await fewer())).toBe(true);
    expect(isOff(screen.getByRole('menuitem', { name: 'One clamp more' }))).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Suggest holds' }));
    await waitFor(async () => expect((await saved()).fixtures?.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
    const before = (await saved()).fixtures!;
    fireEvent.click(await more_());
    await waitFor(async () => expect((await saved()).fixtures).toHaveLength(before.length + 1), { timeout: 10_000 });
    expect((await saved()).fixtures!.slice(0, before.length)).toEqual(before);
    // Fewer takes that one back, or a clamp the rest do without: what stays, stays where it was.
    const more = (await saved()).fixtures!;
    const item = await fewer();
    expect(isOff(item)).toBe(more.length <= 3);
    if (isOff(item)) closeMenu();
    else fireEvent.click(item);
    await waitFor(async () => expect((await saved()).fixtures).toHaveLength(more.length - 1), { timeout: 10_000 });
    for (const f of (await saved()).fixtures!) expect(more).toContainEqual(f);
  }, 90_000);

  it('drags a placed clamp: it stays a fixture all the way, lands where dropped, and parts make room', async () => {
    const job = await openKinderregal();
    fireEvent.click(drawing('A'));
    await suggestHolds();
    const saved = async () => (await getJob(job.id))!.boards!.find(b => b.name === 'A')!;
    await waitFor(async () => expect((await saved()).fixtures?.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
    const before = (await saved()).fixtures!;
    const i = before.findIndex(f => f.kind === 'clamp' && f.side === 'right');
    const f = before[i] as { at: number };
    const hold = () => drawing('A').querySelectorAll('[data-hold]')[i];
    fireEvent.pointerDown(hold(), { ...clientOf('A', 574, f.at), button: 0, pointerId: 1 });
    for (const dy of [10, 20, 30]) fireEvent.pointerMove(hold(), { ...clientOf('A', 574, f.at + dy), pointerId: 1 });
    // Mid-drag it's still the real one, not a preview: the pointer stays with it.
    expect(drawing('A').querySelector('[data-hold-preview]')).toBeNull();
    fireEvent.pointerUp(hold(), { ...clientOf('A', 574, f.at + 30), pointerId: 1 });
    await waitFor(async () => expect(((await saved()).fixtures![i] as { at: number }).at).toBeCloseTo(f.at + 30, -1), { timeout: 10_000 });
    expect(((await saved()).fixtures![i] as { at: number }).at).not.toBe(f.at);
    // Delete removes it, and the parts stay.
    fireEvent.keyDown(hold(), { key: 'Delete' });
    await waitFor(async () => expect((await saved()).fixtures).toHaveLength(before.length - 1), { timeout: 10_000 });
  }, 90_000);

  describe('Suggest holds on the back, which fills its fitted board', () => {
    const boardB = async (id: string) => (await getJob(id))!.boards!.find(b => b.name === 'B')!;
    const status = () => screen.getByLabelText('Board B status').textContent;
    const noRoom = /No clamp spot has room on this layout/;

    afterEach(() => useStore.setState({ machineBounds: null }));

    it('grows it and says by how much, moves the holds there with the part, and Undo restores it', async () => {
      const job = await openKinderregal();
      openBoard('B');
      await waitFor(async () => expect((await boardB(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
      // A screw the user put there first: a single clamp would already give the board the room for more.
      cleanup();
      const saved = (await getJob(job.id))!;
      const screw = { kind: 'screw' as const, x: 200, y: 200 };
      await saveJob({ ...saved, boards: saved.boards!.map(b => (b.name === 'B' ? { ...b, fixtures: [screw] } : b)) });
      render(
        <QueryClientProvider client={new QueryClient()}>
          <BoardsStep />
        </QueryClientProvider>
      );
      await screen.findByRole('button', { name: 'Board B' }, { timeout: 60_000 });
      openBoard('B');
      const before = await boardB(job.id);

      await suggestHolds();
      await waitFor(async () => expect((await boardB(job.id)).fixtures!.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
      const after = await boardB(job.id);
      const grew = (after.layout!.w - before.layout!.w) / 2;
      expect(grew).toBeGreaterThan(0);
      expect(after.layout!.h - before.layout!.h).toBe(2 * grew);
      const [id] = after.items;
      expect(after.layout!.at[id].x).toBeCloseTo(before.layout!.at[id].x + grew);
      expect(after.layout!.at[id].y).toBeCloseTo(before.layout!.at[id].y + grew);
      expect(after.fixtures![0]).toEqual({ kind: 'screw', x: 200 + grew, y: 200 + grew });
      expect(status()).toContain(`the board grew ${grew} mm on each side, to ${after.layout!.w} × ${after.layout!.h}`);

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(async () => expect(await boardB(job.id)).toStrictEqual(before), { timeout: 10_000 });
    }, 90_000);

    it('leaves a fixed board its size', async () => {
      const job = await openKinderregal();
      openBoard('B');
      await waitFor(async () => expect((await boardB(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
      const { w } = (await boardB(job.id)).layout!;
      const input = screen.getByLabelText('Width', { selector: '[id^="board-"]' }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: String(w + 1) } });
      fireEvent.blur(input);
      await waitFor(async () => expect((await boardB(job.id)).size.fit).toBe(false), { timeout: 10_000 });
      const before = await boardB(job.id);
      await suggestHolds();
      // One mm over the part's fit: clamps on that side only, if any, and no border for the others.
      await waitFor(() => expect(status()).toMatch(/Suggested|No clamp spot/));
      expect(status()).not.toContain('grew');
      const after = await boardB(job.id);
      expect([after.layout!.w, after.layout!.h]).toEqual([before.layout!.w, before.layout!.h]);
    }, 90_000);

    it('grows it no further than the machine', async () => {
      const job = await openKinderregal();
      openBoard('B');
      await waitFor(async () => expect((await boardB(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
      const before = await boardB(job.id);
      useStore.setState({ machineBounds: new Box2(new Vector2(0, 0), new Vector2(before.layout!.w + 2, before.layout!.h + 2)) });
      // The store's bounds are read as the page renders: selecting the board again brings them in.
      openBoard('A');
      openBoard('B');
      await suggestHolds();
      await waitFor(() => expect(status()).toMatch(noRoom));
      expect(await boardB(job.id)).toStrictEqual(before);
    }, 90_000);
  });

  it('keeps the stick-out with the job’s bit, not the board', async () => {
    const job = await openKinderregal();
    const field = () => document.getElementById('hold-stickout') as HTMLInputElement;
    // With a tool in hand, under its sizes.
    fireEvent.click(screen.getByRole('button', { name: 'Clamp' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clamp and screw sizes…' }));
    await waitFor(() => expect(field()).toBeTruthy(), { timeout: 10_000 });
    fireEvent.change(field(), { target: { value: '42' } });
    fireEvent.blur(field());
    await waitFor(
      async () => {
        const saved = (await getJob(job.id))!;
        expect(saved.plan?.bit.stickout).toBe(42);
      },
      { timeout: 10_000 }
    );
    // Every board of the job shows it: the open dialog follows the selected board.
    fireEvent.click(screen.getByRole('button', { name: 'Board B', hidden: true }));
    await screen.findByRole('region', { name: 'Board B drawing', hidden: true }, { timeout: 10_000 });
    expect(field().value).toBe('42');
  }, 90_000);

  it('auto-fill optimizes for fewest boards unless the job says least wood', async () => {
    const job = await openKinderregal();
    showAll();
    // Tabs only where they hold: no tab marked red on the drawings once the programs are made.
    const tabs = () => document.querySelectorAll('line[class*="stroke-amber"]').length;
    const floating = () => [...document.querySelectorAll('circle > title')].filter(t => /this tab holds nothing/.test(t.textContent ?? ''));
    await waitFor(() => expect(tabs()).toBeGreaterThan(0), { timeout: 60_000 });
    expect(floating()).toHaveLength(0);
    const group = within(screen.getByRole('group', { name: 'Auto-fill optimizes for' }));
    expect(screen.getByText('Auto-fill prefers:')).toBeTruthy();
    expect(description(group.getByRole('button', { name: 'Fewest boards' }))).toBe(
      'Fewer setups at the machine, may waste a bit more wood.'
    );
    expect(description(group.getByRole('button', { name: 'Least wood' }))).toBe('Least board area, may need more boards.');
    expect(description(screen.getByRole('button', { name: 'More layout actions' }))).toMatch(/re-lay out everything/);
    expect(description(screen.getByRole('button', { name: 'Auto-fill from stock' }))).toMatch(/stock list/);
    expect(screen.getByRole('status', { name: 'Layout result' }).textContent).toMatch(/^2 boards, \d+ % yield$/);
    expect(group.getByRole('button', { name: 'Fewest boards' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(group.getByRole('button', { name: 'Least wood' }));
    await waitFor(async () => expect((await getJob(job.id))!.nestObjective).toBe('wood'), { timeout: 10_000 });
    expect(group.getByRole('button', { name: 'Least wood' }).getAttribute('aria-pressed')).toBe('true');
  }, 90_000);

  it('re-lays out one board or everything after moves by hand, with Undo', async () => {
    const job = await openKinderregal();
    // Part 2 by hand onto a board of its own: pinned.
    await openMenu('A', 'Part 2');
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    await screen.findByRole('region', { name: 'Board C drawing' });
    const pinnedBoards = async () => ((await getJob(job.id))!.boards ?? []).filter(b => b.pinned?.length).map(b => b.name);
    await waitFor(async () => expect(await pinnedBoards()).toEqual(['C']), { timeout: 10_000 });
    const before = (await getJob(job.id))!.boards!;

    // Everything: unpinned (no stock list, so the boards keep their parts and nest afresh).
    showAll();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More layout actions' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Re-lay out everything (unpin all)' }));
    await waitFor(async () => expect(await pinnedBoards()).toEqual([]), { timeout: 10_000 });
    await screen.findByText('All boards laid out again.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo that' }));
    await waitFor(async () => expect((await getJob(job.id))!.boards).toStrictEqual(before), { timeout: 10_000 });

    // One board: open C, re-lay it out from its inspector.
    fireEvent.click(await screen.findByRole('region', { name: 'Board C drawing' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tighten layout' }));
    await waitFor(async () => expect(await pinnedBoards()).toEqual([]), { timeout: 10_000 });
    await screen.findByText('Board C laid out again.');
    // Part 2 is still on board C.
    expect((await getJob(job.id))!.boards!.find(b => b.name === 'C')!.items).toHaveLength(1);
  }, 90_000);

  it('shows parts that don’t fit next to their board at their shape, to drag or move from there', async () => {
    const job = await openKinderregal();
    // Part 2 on a board of its own, then that board made too small for it.
    await openMenu('A', 'Part 2');
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    await screen.findByRole('region', { name: 'Board C drawing' });
    for (const id of ['board-w', 'board-h']) {
      const input = () => document.getElementById(id) as HTMLInputElement;
      await waitFor(() => expect(input()).toBeTruthy());
      fireEvent.change(input(), { target: { value: '50' } });
      fireEvent.blur(input());
    }
    const off = () => document.querySelector('[data-unplaced="Part 2"]');
    await waitFor(() => expect(off()).toBeTruthy(), { timeout: 10_000 });
    expect(off()!.querySelector('path')!.getAttribute('d')).toMatch(/^M/);
    expect(within(drawing('C')).getByText('1 off it')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/^Part 2 is off the boards and won’t be cut\./);

    // Dragged from the table back onto board A.
    drag(off()!, 'A');
    await waitFor(
      async () => {
        const boards = (await getJob(job.id))!.boards!;
        expect(boards.find(b => b.name === 'C')!.items).toHaveLength(0);
        expect(boards.find(b => b.name === 'A')!.items).toHaveLength(5);
      },
      { timeout: 10_000 }
    );
    expect(off()).toBeNull();
  }, 90_000);

  it('chooses the bit before nesting, also one that is in no library', async () => {
    const job = await openKinderregal();
    fireEvent.click(screen.getByRole('button', { name: /^Bit: ⌀3.175 1\/8″ flat\. Change the bit$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Custom bit…' }));
    const form = within(screen.getByRole('group', { name: 'Custom bit' }));
    fireEvent.change(form.getByLabelText('Diameter (mm)'), { target: { value: '6' } });
    fireEvent.change(form.getByLabelText('Name'), { target: { value: '6 mm upcut' } });
    fireEvent.click(form.getByRole('button', { name: 'Add bit' }));
    await waitFor(async () => expect((await getJob(job.id))!.plan?.bit).toMatchObject({ diameter: 6, name: '6 mm upcut' }), {
      timeout: 10_000,
    });
    // Margin and gap follow the bit, with room for a strip that holds the tabs: 6 + 3.5 and 2 × 6 + 3.5. Their labels
    // are on the drawing, at the board's own scale on a screen this small.
    openBoard('A');
    await waitFor(
      () => {
        expect((screen.getByLabelText('Edge margin') as HTMLInputElement).value).toBe('9.5');
        expect((screen.getByLabelText('Gap between parts') as HTMLInputElement).value).toBe('16');
      },
      { timeout: 10_000 }
    );
  }, 90_000);

  it('labels the stock fields, takes comma decimals, says what is wrong, and shows no size for an empty board', async () => {
    const job = await openKinderregal();
    // Fitted boards are whole mm.
    showAll();
    expect(within(drawing('A')).getByText('574 × 750')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New 8 mm board/ }));
    const c = await screen.findByRole('region', { name: 'Board C drawing' });
    expect(within(c).getByText('–')).toBeTruthy();
    fireEvent.click(c);
    const width = screen.getByLabelText('Width', { selector: '#board-w' }) as HTMLInputElement;
    expect(width.value).toBe('');
    expect(width.placeholder).toBe('–');

    // Out of range: an inline error instead of silently going back, and nothing saved.
    fireEvent.change(width, { target: { value: '5' } });
    fireEvent.blur(width);
    expect(width.getAttribute('aria-invalid')).toBe('true');
    expect(description(width)).toMatch(/^5 is out of range: at least 10 mm\./);
    expect((await getJob(job.id))!.boards!.find(b => b.name === 'C')!.size).toEqual({ fit: true });

    showAll();
    const stockList = within(await screen.findByRole('region', { name: 'Stock list' }));
    for (const label of ['Thickness', 'Width', 'Height', 'Count']) expect(stockList.getByText(label).tagName).toBe('LABEL');
    fireEvent.change(stockList.getByLabelText('Stock thickness'), { target: { value: '8' } });
    fireEvent.change(stockList.getByLabelText('Stock width'), { target: { value: '600,5' } });
    fireEvent.change(stockList.getByLabelText('Stock height'), { target: { value: '30O' } });
    expect(stockList.getByText(/^Height: Enter a number/)).toBeTruthy();
    expect(stockList.getByRole('button', { name: 'Add stock board' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(stockList.getByLabelText('Stock height'), { target: { value: '300' } });
    fireEvent.click(stockList.getByRole('button', { name: 'Add stock board' }));
    await waitFor(async () => expect((await getJob(job.id))!.stock).toMatchObject([{ thickness: 8, w: 600.5, h: 300 }]));
    expect(stockList.getByText('8 mm · 600.5 × 300')).toBeTruthy();
  }, 90_000);

  it('after every part is unticked in the Model step, no board keeps parts', async () => {
    const job = await openKinderregal();
    await waitFor(async () => expect((await getJob(job.id))!.boards?.length).toBeGreaterThan(0), { timeout: 10_000 });
    cleanup();
    const saved = (await getJob(job.id))!;
    await saveJob({ ...saved, parts: saved.parts.map(p => ({ ...p, milled: false })) });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardsStep />
      </QueryClientProvider>
    );
    const empty = await screen.findByRole('status', {}, { timeout: 60_000 });
    expect(empty.textContent).toMatch(/^No part to mill/);
    // The way back, and no way on.
    expect(within(empty).getByText('Back to the Model step')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next: Plan' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('region', { name: 'Board A drawing' })).toBeNull();
  }, 90_000);
});
