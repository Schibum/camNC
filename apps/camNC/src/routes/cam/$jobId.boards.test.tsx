import { createJob, getJob, saveJob } from '@/cam/jobDb';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** HTML5 drag and drop between the board cards. */
function drag(chip: HTMLElement, target: HTMLElement) {
  const dataTransfer = new DataTransfer();
  fireEvent.dragStart(chip, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

/** A part's outline in a board drawing. */
const partIn = (board: string, name: string) =>
  within(screen.getByRole('region', { name: `Board ${board} drawing` })).getByRole('button', { name: new RegExp(`^${name}:`) });

/** Client point of a board point (mm, lower left zero) in a board's drawing. */
function clientOf(board: string, x: number, y: number) {
  const frame = screen.getByRole('region', { name: `Board ${board} drawing` }).querySelector<SVGGraphicsElement>('[data-board-frame]')!;
  const p = new DOMPoint(x, y).matrixTransform(frame.getScreenCTM()!);
  return { clientX: p.x, clientY: p.y };
}

async function openKinderregal() {
  const bytes = await (await fetch(stepUrl)).arrayBuffer();
  const job = await createJob(new File([bytes], 'kinderregal-eiche.step'));
  params.jobId = job.id;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardsStep />
    </QueryClientProvider>
  );
  await screen.findByRole('region', { name: 'Board A' }, { timeout: 60_000 });
  return job;
}

describe('CAM boards step', () => {
  it('auto-fill keeps parts moved by hand, and Undo restores the boards exactly', async () => {
    const job = await openKinderregal();

    // The middle shelf on a board of its own, by hand: pinned there.
    fireEvent.pointerDown(within(screen.getByRole('region', { name: 'Board A' })).getByRole('button', { name: 'Move Part 2' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    const c = await screen.findByRole('region', { name: 'Board C' });
    expect(within(c).getByText('Part 2')).toBeTruthy();
    expect(description(within(c).getByRole('img', { name: 'Placed by hand' }))).toMatch(/^Pinned:/);

    // One 8 mm stock board size, as many as needed.
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
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [message, { action }] = toastSuccess.mock.calls.at(-1)! as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe('Parts placed on 1 board from stock');
    expect(action.label).toBe('Undo');
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

    action.onClick();
    await waitFor(async () => expect((await getJob(job.id))!.boards).toStrictEqual(before));
    expect(screen.getByRole('region', { name: 'Board C' })).toBeTruthy();
    // Undo leaves the stock list alone.
    expect((await getJob(job.id))!.stock).toHaveLength(1);
  }, 90_000);

  it('nests the parts on one board per thickness and regroups them by drag and drop', async () => {
    const job = await openKinderregal();
    const a = screen.getByRole('region', { name: 'Board A' });
    const b = screen.getByRole('region', { name: 'Board B' });
    for (const name of ['left', 'right', 'Part 1a', 'Part 1b', 'Part 2']) expect(within(a).getByText(name)).toBeTruthy();
    expect(within(b).getByText('back')).toBeTruthy();
    expect(screen.getByRole('group', { name: /Board A, .* with 5 parts/ })).toBeTruthy();
    expect(screen.getByRole('group', { name: /Board B, .* with 1 parts/ })).toBeTruthy();

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
    fireEvent.pointerDown(within(screen.getByRole('region', { name: 'Board A' })).getByRole('button', { name: 'Move Part 1b' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Board D' })).getByText('Part 1b')).toBeTruthy());

    // From the board drawing: drag the left side onto board C's card (pointer events, so touch works too).
    const left = partIn('A', 'left');
    const start = left.getBoundingClientRect();
    const target = screen.getByRole('region', { name: 'Board C' }).getBoundingClientRect();
    fireEvent.pointerDown(left, { clientX: start.x + 5, clientY: start.y + 5, button: 0 });
    fireEvent.pointerMove(window, { clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 });
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

  it('drags a part’s outline from one board drawing onto another, where it lands exactly at the drop point', async () => {
    const job = await openKinderregal();
    // Board C: a 1220 × 610 sheet, empty.
    fireEvent.click(screen.getByRole('button', { name: /New 8 mm board/ }));
    await screen.findByRole('region', { name: 'Board C drawing' });
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
    await waitFor(async () =>
      expect((await getJob(job.id))!.boards!.find(b => b.name === 'C')!.size).toEqual({ fit: false, w: 1220, h: 610 })
    );

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
    fireEvent.pointerUp(window, drop);

    await waitFor(async () => {
      const boards = (await getJob(job.id))!.boards!;
      const onC = boards.find(b => b.name === 'C')!;
      expect(onC.items).toHaveLength(1);
      expect(onC.pinned).toEqual(onC.items);
      const at = onC.positions![onC.items[0]];
      expect(Math.abs(at.x - 300)).toBeLessThan(5);
      expect(Math.abs(at.y - 300)).toBeLessThan(5);
      expect(at.rotated).toBe(false);
      expect(boards.find(b => b.name === 'A')!.items).not.toContain(onC.items[0]);
    });
    expect(within(screen.getByRole('region', { name: 'Board C' })).getByText('left')).toBeTruthy();
    expect(document.querySelector('[data-drag-ghost]')).toBeNull();

    // Arrow keys move it on its board, 10 mm with Shift.
    const before = (await getJob(job.id))!.boards!.find(b => b.name === 'C')!;
    const id = before.items[0];
    fireEvent.keyDown(partIn('C', 'left'), { key: 'ArrowRight', shiftKey: true });
    await waitFor(async () => {
      const at = (await getJob(job.id))!.boards!.find(b => b.name === 'C')!.positions![id];
      expect(at.x).toBeCloseTo(before.positions![id].x + 10, 5);
      expect(at.y).toBeCloseTo(before.positions![id].y, 5);
    });
  }, 90_000);

  it('auto-fill optimizes for fewest boards unless the job says least wood', async () => {
    const job = await openKinderregal();
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
    expect(description(group.getByRole('button', { name: 'Least wood' }))).toBe('Least sheet area, may need more boards.');
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
    fireEvent.pointerDown(within(screen.getByRole('region', { name: 'Board A' })).getByRole('button', { name: 'Move Part 2' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /New board/ }));
    await screen.findByRole('region', { name: 'Board C' });
    const pinnedBoards = async () => ((await getJob(job.id))!.boards ?? []).filter(b => b.pinned?.length).map(b => b.name);
    await waitFor(async () => expect(await pinnedBoards()).toEqual(['C']), { timeout: 10_000 });
    const before = (await getJob(job.id))!.boards!;

    // Everything: unpinned (no stock list, so the boards keep their parts and nest afresh).
    toastSuccess.mockClear();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More layout actions' }), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Re-lay out everything (unpin all)' }));
    await waitFor(async () => expect(await pinnedBoards()).toEqual([]), { timeout: 10_000 });
    const [message, { action }] = toastSuccess.mock.calls.at(-1)! as [string, { action: { label: string; onClick: () => void } }];
    expect(message).toBe('All boards laid out again');
    action.onClick();
    await waitFor(async () => expect((await getJob(job.id))!.boards).toStrictEqual(before), { timeout: 10_000 });

    // One board: select C in the list, re-lay it out from its inspector.
    fireEvent.click(within(await screen.findByRole('region', { name: 'Board C' })).getByText(/^C · /));
    fireEvent.click(await screen.findByRole('button', { name: 'Re-lay out' }));
    await waitFor(async () => expect(await pinnedBoards()).toEqual([]), { timeout: 10_000 });
    expect(toastSuccess.mock.calls.at(-1)![0]).toBe('Board C laid out again');
    // Part 2 is still on board C.
    expect((await getJob(job.id))!.boards!.find(b => b.name === 'C')!.items).toHaveLength(1);
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
    // The margin and gap follow the bit: 6 + 2 and 6 + 4.
    await waitFor(() => expect(screen.getByText(/edge margin 8 mm · gap 10 mm/)).toBeTruthy(), { timeout: 10_000 });
  }, 90_000);

  it('labels the stock fields, takes comma decimals, says what is wrong, and shows no size for an empty board', async () => {
    const job = await openKinderregal();
    // Fitted boards are whole mm.
    expect(within(screen.getByRole('region', { name: 'Board A' })).getByText('571 × 739')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /New 8 mm board/ }));
    const c = await screen.findByRole('region', { name: 'Board C' });
    expect(within(c).getByText('–')).toBeTruthy();
    const width = screen.getByLabelText('Width', { selector: '#board-w' }) as HTMLInputElement;
    expect(width.value).toBe('');
    expect(width.placeholder).toBe('–');

    // Out of range: an inline error instead of silently going back, and nothing saved.
    fireEvent.change(width, { target: { value: '5' } });
    fireEvent.blur(width);
    expect(width.getAttribute('aria-invalid')).toBe('true');
    expect(description(width)).toMatch(/^5 is out of range: at least 10 mm\./);
    expect((await getJob(job.id))!.boards!.find(b => b.name === 'C')!.size).toEqual({ fit: true });

    const stockList = within(screen.getByRole('region', { name: 'Stock list' }));
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
    expect(screen.queryByRole('region', { name: 'Board A' })).toBeNull();
  }, 90_000);
});
