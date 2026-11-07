import '@/style.css';
import { createJob, getJob, saveJob } from '@/cam/jobDb';
import { boardLayoutFile } from '@/test/boardLayoutFile';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { page, userEvent } from '@vitest/browser/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

// A usual desktop window.
beforeEach(() => page.viewport(1280, 800));

afterEach(cleanup);

const drawing = (name: string) => screen.queryByRole('region', { name: `${name} drawing` });

async function open(file = boardLayoutFile()) {
  // Keep the real import, nesting and planning path; full STEP models are covered by the Boards and Plan integration suites.
  const job = await createJob(file, {
    parts: ['left', 'right', 'back'].map((name, i) => ({ id: `part-${i}`, name, quantity: 1, milled: true })),
  });
  params.jobId = job.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardsStep />
    </QueryClientProvider>
  );
  await screen.findByRole('region', { name: 'Board A drawing' }, { timeout: 60_000 });
  return job;
}

const suggestHolds = async () => {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Suggest holds' }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Suggest holds' }));
};

const saved = async (id: string, name = 'A') => (await getJob(id))!.boards!.find(b => b.name === name)!;

describe('CAM boards layout', () => {
  it('keeps the tools and the boards list with the drawing on a small screen', async () => {
    await page.viewport(390, 844);
    await open();
    expect(within(document.querySelector('main')!).getByRole('button', { name: 'Clamp' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Board B' }));
    expect(drawing('Board B')).toBeTruthy();
  }, 90_000);

  it('holds the drawing still when stacked: its scale can’t follow a heading that wraps', async () => {
    await page.viewport(750, 1000);
    await open();
    await waitFor(() => expect(document.querySelector('main')!.clientHeight).toBe(700));
    // The status is under the drawing, with or without a message: it covers nothing and takes the same room.
    const scroller = document.querySelector('[data-board-scroller]')!;
    const status = screen.getByLabelText('Board A status');
    expect(status.getBoundingClientRect().top).toBeGreaterThanOrEqual(scroller.getBoundingClientRect().bottom);
    const height = scroller.clientHeight;
    fireEvent.click(screen.getByRole('button', { name: 'Tighten layout' }));
    await within(status).findByText(/laid out again/);
    expect(scroller.clientHeight).toBe(height);
    const frame = () => new Promise(requestAnimationFrame);
    for (let width = 520; width <= 760; width += 40) {
      await page.viewport(width, 1000);
      // Settling after a resize changes it once or twice; a loop keeps changing it.
      let [last, changes] = ['', 0];
      for (let i = 0; i < 40; i++) {
        const box = document.querySelector('[data-board-drawing]')!.getBoundingClientRect();
        const size = `${box.width} ${box.height}`;
        if (size !== last) changes++;
        last = size;
        await frame();
      }
      expect(changes, `at ${width} px`).toBeLessThan(5);
    }
  }, 150_000);

  it('shows every board on one table, with what edits a board on the selected one', async () => {
    await open();
    expect(drawing('Board A')).toBeTruthy();
    expect(drawing('Board B')).toBeTruthy();
    expect(drawing('Board A')!.querySelector('[data-resize]')).toBeTruthy();
    expect(drawing('Board B')!.querySelector('[data-resize]')).toBeNull();
    const list = within(screen.getByRole('navigation', { name: 'Boards' }));
    fireEvent.click(list.getByRole('button', { name: 'Board B' }));
    expect(list.getByRole('button', { name: 'Board B' }).getAttribute('aria-current')).toBe('true');
    expect(drawing('Board A')!.querySelector('[data-resize]')).toBeNull();
    expect(drawing('Board B')!.querySelector('[data-resize]')).toBeTruthy();
    expect(drawing('Board A')).toBeTruthy();

    // All boards: the sidebar is about the job's layout. The tools stay on the board selected.
    fireEvent.click(screen.getByRole('button', { name: 'All boards' }));
    expect(screen.getByRole('button', { name: 'All boards' }).getAttribute('aria-current')).toBe('page');
    expect((screen.getByRole('button', { name: 'Clamp' }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(screen.getByRole('region', { name: 'Stock list' })).getByRole('button', { name: 'Add stock board' })).toBeTruthy();

    fireEvent.click(drawing('Board A')!);
    expect(screen.getByRole('button', { name: 'Board A' }).getAttribute('aria-current')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Stock list' })).toBeNull();
  }, 90_000);

  it('zooms to a board and back to all of them, always at one scale', async () => {
    const job = await open();
    await waitFor(async () => expect((await saved(job.id, 'B')).layout).toBeTruthy(), { timeout: 10_000 });
    const box = (name: string) => drawing(name)!.querySelector('[data-board-frame]')!.closest('svg')!.getBoundingClientRect();
    const scroller = document.querySelector('[data-board-scroller]')!.getBoundingClientRect();
    const allA = box('Board A');
    fireEvent.click(screen.getByRole('button', { name: 'Board B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Board A' }));
    await waitFor(() => expect(box('Board A').height).toBeGreaterThan(allA.height * 0.99));
    // In the middle of the view.
    const a = box('Board A');
    expect(Math.abs(a.x + a.width / 2 - (scroller.x + scroller.width / 2))).toBeLessThan(40);
    fireEvent.click(screen.getByRole('button', { name: 'All boards' }));
    await waitFor(() => expect(box('Board A').x).toBeGreaterThanOrEqual(scroller.x));
    const [nowA, nowB] = [box('Board A'), box('Board B')];
    expect(nowB.right).toBeLessThanOrEqual(scroller.right + 1);
    const [a2, b2] = [await saved(job.id), await saved(job.id, 'B')];
    // 50 mm of table around each drawing.
    expect(nowA.width / (a2.layout!.w + 100)).toBeCloseTo(nowB.width / (b2.layout!.w + 100), 3);
  }, 90_000);

  it('drags an edge through the parts: the board is laid out live, what has no room goes off it, and dragging back undoes that', async () => {
    const job = await open();
    await waitFor(async () => expect((await saved(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
    const was = await saved(job.id);
    const svg = () => drawing('Board A')!.querySelector('[data-board-frame]')!.closest('svg')!;
    const grip = drawing('Board A')!.querySelector('[data-resize="w"]')!;
    const at = grip.getBoundingClientRect();
    const from = { clientX: at.x + 2, clientY: at.y + 10, pointerId: 1, button: 0 };
    const left = svg().getBoundingClientRect().x;
    const pxPerMm = svg().getBoundingClientRect().width / (was.layout!.w + 100);
    fireEvent.pointerDown(grip, from);
    // Narrower than the widest part (560 mm), past where anything could stop it before.
    fireEvent.pointerMove(grip, { ...from, clientX: from.clientX - 300 * pxPerMm });
    await waitFor(() => expect(document.querySelector('[data-off-board]')).toBeTruthy());
    // The upper left corner stays, the green line says where it would all fit.
    expect(svg().getBoundingClientRect().x).toBeCloseTo(left, 0);
    expect(document.querySelector('[data-tight="w"]')!.textContent).toMatch(/Every part fits down to \d+/);
    expect(screen.getByLabelText('Board A status').textContent).toMatch(/^\d+ × \d+ mm · \d\.\d\d m² · \d+ % yield · .+ off the board/);
    // Nothing is saved yet.
    expect((await saved(job.id)).size).toEqual(was.size);

    // Back: all of it on the board again.
    fireEvent.pointerMove(grip, from);
    await waitFor(() => expect(document.querySelector('[data-off-board]')).toBeNull());

    // Again, and let go.
    fireEvent.pointerMove(grip, { ...from, clientX: from.clientX - 300 * pxPerMm });
    fireEvent.pointerUp(grip, from);
    await waitFor(
      async () => {
        const size = (await saved(job.id)).size;
        expect(size.fit).toBe(false);
        if (!size.fit) expect(size.w).toBeLessThan(was.layout!.w);
      },
      { timeout: 10_000 }
    );
    expect(screen.getByLabelText('Board A status').textContent).toMatch(
      /is fixed at \d+ × \d+ mm\. .+ (doesn’t|don’t) fit and moved off it/
    );
    // Still on its list, and it says the job has parts off the boards.
    const now = await saved(job.id);
    expect(now.items).toEqual(was.items);
    expect(screen.getByRole('alert').textContent).toMatch(/off the boards and won’t be cut/);

    fireEvent.click(screen.getByRole('button', { name: 'Undo that' }));
    await waitFor(async () => expect((await saved(job.id)).size).toEqual(was.size), { timeout: 10_000 });
  }, 90_000);

  it('a size typed in does the same as a size dragged to', async () => {
    const job = await open();
    await waitFor(async () => expect((await saved(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
    const width = document.getElementById('board-w') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '300' } });
    fireEvent.blur(width);
    await waitFor(() => expect(document.querySelector('[data-off-board]')).toBeTruthy(), { timeout: 10_000 });
    const { size } = await saved(job.id);
    expect(size).toMatchObject({ fit: false, w: 300 });
  }, 90_000);

  it('lays a part down on the table, off the board, and puts it back on a board from there', async () => {
    const job = await open();
    await waitFor(async () => expect((await saved(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
    const part = () => within(drawing('Board A')!).getByRole('button', { name: /^left: drag, or move/ });
    const start = part().getBoundingClientRect();
    fireEvent.pointerDown(part(), { clientX: start.x + 5, clientY: start.y + 5, button: 0 });
    // The empty table, left of the boards.
    const b = drawing('Board A')!.querySelector('[data-board-frame]')!.closest('svg')!.getBoundingClientRect();
    const away = { clientX: b.x - 8, clientY: b.y + b.height / 2 };
    fireEvent.pointerMove(window, away);
    fireEvent.pointerUp(window, away);
    await waitFor(async () => expect(Object.keys((await saved(job.id)).setAside ?? {})).toHaveLength(1), { timeout: 10_000 });
    const off = await waitFor(() => {
      const el = document.querySelector('[data-unplaced="left"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(within(drawing('Board A')!).queryByRole('button', { name: /^left: drag, or move/ })).toBeNull();
    const a = await saved(job.id);
    const id = Object.keys(a.setAside!)[0];
    expect(a.items).toContain(id);
    expect(a.layout!.at[id]).toBeUndefined();
    expect(screen.getByRole('alert').textContent).toMatch(/^left is off the boards and won’t be cut/);

    // Back with the button: the board has the room it had.
    fireEvent.click(screen.getByRole('button', { name: 'Place on boards' }));
    await waitFor(async () => expect((await saved(job.id)).setAside).toBeUndefined(), { timeout: 10_000 });
    expect(document.querySelector('[data-unplaced="left"]')).toBeNull();
    expect(off.isConnected).toBe(false);
  }, 90_000);

  it('turns a part being dragged with R, and it stays turned where it’s laid down', async () => {
    const job = await open();
    await waitFor(async () => expect((await saved(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
    const part = within(drawing('Board A')!).getByRole('button', { name: /^left: drag, or move/ });
    const start = part.getBoundingClientRect();
    fireEvent.pointerDown(part, { clientX: start.x + 5, clientY: start.y + 5, button: 0 });
    const b = drawing('Board A')!.querySelector('[data-board-frame]')!.closest('svg')!.getBoundingClientRect();
    const away = { clientX: b.x - 8, clientY: b.y + b.height / 2 };
    fireEvent.pointerMove(window, away);
    const ghost = () => document.querySelector('[data-drag-ghost]')!.getBoundingClientRect();
    const was = ghost();
    expect(was.width).toBeGreaterThan(was.height);
    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => expect(ghost().height).toBeGreaterThan(ghost().width));
    fireEvent.pointerUp(window, away);
    await waitFor(async () => expect(Object.values((await saved(job.id)).setAside ?? {})).toMatchObject([{ rotated: true }]), {
      timeout: 10_000,
    });
  }, 90_000);

  it('saves a square part turned with R on a board, where turning it moves nothing', async () => {
    const job = await open(
      boardLayoutFile([
        { x: 0, w: 300, h: 300, t: 8 },
        { x: 400, w: 200, h: 200, t: 8 },
      ])
    );
    await waitFor(async () => expect((await saved(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
    // Room to set it down exactly where it's dropped.
    const width = document.getElementById('board-w') as HTMLInputElement;
    fireEvent.change(width, { target: { value: '1100' } });
    fireEvent.blur(width);
    await waitFor(async () => expect((await saved(job.id)).size).toMatchObject({ fit: false, w: 1100 }), { timeout: 10_000 });
    const part = await within(drawing('Board A')!).findByRole('button', { name: /^left: drag, or move/ });
    const start = part.getBoundingClientRect();
    fireEvent.pointerDown(part, { clientX: start.x + 20, clientY: start.y + 20, button: 0 });
    const frame = drawing('Board A')!.querySelector<SVGGraphicsElement>('[data-board-frame]')!;
    const p = new DOMPoint(800, 400).matrixTransform(frame.getScreenCTM()!);
    const to = { clientX: p.x, clientY: p.y };
    fireEvent.pointerMove(window, to);
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.pointerUp(window, to);
    await waitFor(
      async () => {
        const a = await saved(job.id);
        const id = a.items.find(i => a.layout!.at[i]?.x > 500)!;
        expect(a.layout!.at[id].rotated).toBe(true);
      },
      { timeout: 10_000 }
    );
  }, 90_000);

  it('sizes one selected clamp, then offers the same for the others, with Undo and Redo', async () => {
    const job = await open();
    await waitFor(async () => expect((await saved(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
    await suggestHolds();
    await waitFor(async () => expect((await saved(job.id)).fixtures?.length).toBeGreaterThanOrEqual(3), { timeout: 10_000 });
    const count = (await saved(job.id)).fixtures!.length;

    const hold = () => drawing('Board A')!.querySelector('[data-hold]')!;
    fireEvent.pointerDown(hold(), { button: 0, pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.pointerUp(hold(), { button: 0, pointerId: 1, clientX: 1, clientY: 1 });
    const bar = await screen.findByRole('toolbar', { name: /^Clamp · / });
    const width = within(bar).getByLabelText(/^Width/) as HTMLInputElement;
    fireEvent.change(width, { target: { value: '40' } });
    fireEvent.blur(width);

    // Only that one, until asked for more.
    await waitFor(async () => expect((await saved(job.id)).fixtures!.filter(f => f.kind === 'clamp' && f.w === 40)).toHaveLength(1), {
      timeout: 10_000,
    });
    fireEvent.click(await screen.findByRole('button', { name: `all ${count} on this board` }));
    await waitFor(async () => expect((await saved(job.id)).fixtures!.every(f => f.kind === 'clamp' && f.w === 40)).toBe(true), {
      timeout: 10_000,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await saved(job.id)).fixtures!.filter(f => f.kind === 'clamp' && f.w === 40)).toHaveLength(1), {
      timeout: 10_000,
    });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(async () => expect((await saved(job.id)).fixtures!.every(f => f.kind === 'clamp' && f.w === 40)).toBe(true), {
      timeout: 10_000,
    });

    // Its menu works with a real pointer, not only a click event.
    await userEvent.click(await screen.findByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Clamp and screw sizes…' }));
    await waitFor(() => expect(document.getElementById('hold-stickout')).toBeTruthy(), { timeout: 10_000 });
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(document.getElementById('hold-stickout')).toBeNull(), { timeout: 10_000 });

    // A size being typed counts when the pointer goes elsewhere.
    const height = within(await screen.findByRole('toolbar', { name: /^Clamp · / })).getByLabelText(/^Height/) as HTMLInputElement;
    await userEvent.fill(height, '33');
    await userEvent.click(document.querySelector('[data-board-scroller]')!, { position: { x: 3, y: 3 } });
    await waitFor(async () => expect((await saved(job.id)).fixtures!.filter(f => f.kind === 'clamp' && f.height === 33)).toHaveLength(1), {
      timeout: 10_000,
    });
    expect(screen.queryByRole('toolbar', { name: /^Clamp · / })).toBeNull();
    fireEvent.pointerDown(hold(), { button: 0, pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.pointerUp(hold(), { button: 0, pointerId: 1, clientX: 1, clientY: 1 });

    // Delete, from the bar.
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this clamp' }));
    await waitFor(async () => expect((await saved(job.id)).fixtures).toHaveLength(count - 1), { timeout: 10_000 });
  }, 90_000);

  it('picks up tools with their letters, and not while typing', async () => {
    await open();
    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
    fireEvent.keyDown(document.body, { key: 'c' });
    await waitFor(() => expect(pressed('Clamp')).toBe('true'));
    expect(document.querySelector('[data-armed-bar]')?.textContent).toMatch(/Click near an edge/);
    fireEvent.keyDown(screen.getByLabelText('Board name'), { key: 's' });
    expect(pressed('Clamp')).toBe('true');
    fireEvent.keyDown(document.body, { key: 'v' });
    await waitFor(() => expect(pressed('Select')).toBe('true'));
    expect(document.querySelector('[data-armed-bar]')).toBeNull();
  }, 90_000);

  it('moves a part to a board in the list: into its nest, with the board being edited still selected', async () => {
    const job = await open();
    // Another 8 mm board, empty.
    fireEvent.click(screen.getByRole('button', { name: 'All boards' }));
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
    expect(screen.getByRole('button', { name: 'Board A' }).getAttribute('aria-current')).toBe('true');
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

  it('picks a board in the list, renames it, and refuses a name that can’t be', async () => {
    const job = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Board B' }));
    await screen.findByRole('region', { name: 'Board B drawing' }, { timeout: 10_000 });

    const name = screen.getByLabelText('Board name') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'A' } });
    fireEvent.blur(name);
    expect((await getJob(job.id))!.boards!.filter(b => b.name === 'A')).toHaveLength(1);
    fireEvent.change(name, { target: { value: 'Back panel' } });
    fireEvent.blur(name);
    await waitFor(async () => expect((await getJob(job.id))!.boards!.map(b => b.name)).toEqual(['A', 'Back panel']), { timeout: 10_000 });
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
    expect(screen.getByRole('button', { name: 'Board B' })).toBeTruthy();
  }, 90_000);

  it('a right-click on a clamp only opens its menu, however the mouse drifts', async () => {
    const job = await open();
    await suggestHolds();
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

  it('says nothing under the drawing while all is well, only an issue or what just happened', async () => {
    const job = await open();
    const status = () => screen.getByLabelText('Board A status');
    await waitFor(async () => expect((await saved(job.id)).layout).toBeTruthy(), { timeout: 10_000 });
    expect(status().textContent).toBe('');

    // An issue stays until it's fixed; the sidebar has the verdict either way.
    fireEvent.click(screen.getByRole('button', { name: 'Clamp' }));
    const frame = drawing('Board A')!.querySelector<SVGGraphicsElement>('[data-board-frame]')!;
    const p = new DOMPoint(1, 380).matrixTransform(frame.getScreenCTM()!);
    const svg = frame.closest('svg')!;
    fireEvent.pointerMove(svg, { clientX: p.x, clientY: p.y });
    fireEvent.click(svg, { clientX: p.x, clientY: p.y });
    await waitFor(() => expect(status().textContent).toMatch(/1 clamp: the board can still turn/), { timeout: 10_000 });
    expect(document.querySelector('[data-fixture-count]')!.textContent).toBe('1 clamp');
  }, 90_000);

  it('reaches the clamp sizes from a clamp’s menu, with the side view of what they mean', async () => {
    const job = await open();
    await suggestHolds();
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
