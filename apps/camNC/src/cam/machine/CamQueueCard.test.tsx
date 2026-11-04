import { useStore } from '@/store/store';
import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanResult, ReleaseProgram } from '../camTypes';
import type { JobBoard } from '../useJobBoards';
import { currentEntry, machineQueue, useCamMachine, type QueueContext, type QueueEntry } from './camMachine';
import { CamQueueCard } from './CamQueueCard';

const hook = vi.hoisted(() => ({ value: {} as Record<string, unknown>, use: (): unknown => undefined }));
vi.mock('./useMachineQueue', () => ({ useMachineQueue: () => hook.use() }));
/** What the real hook does with the store. */
function useFromStore() {
  const { active, done } = useCamMachine();
  return { ...hook.value, done, current: currentEntry(hook.value.queue as QueueEntry[], active, done) };
}
hook.use = useFromStore;

const gcodeOf = (name: string) => `(${name})\nG21 G90\nG0 Z10\nG0 X1 Y1\nG1 Z1 F100\nG1 X5 F500\nG0 Z10`;

const plan = (bits: number[], name = 'a', more: Partial<PlanResult> = {}): PlanResult =>
  ({
    gcode: gcodeOf(`${name} all`),
    timeMin: 1,
    warnings: [],
    safety: [],
    ops: [{}],
    bits,
    programs: bits.map((d, i) => ({ tool: i + 1, diameter: d, gcode: gcodeOf(`${name} T${i + 1}`), timeMin: 1 })),
    size: [100, 80, 8.3],
    path: [],
    ...more,
  }) as PlanResult;

const release = (kind: ReleaseProgram['kind'], diameter: number, more: Partial<ReleaseProgram> = {}) =>
  ({ kind, gcode: gcodeOf(kind), timeMin: 1, diameter, turned: false, safety: [], ...more }) as ReleaseProgram;

const board = (name: string, more: object = {}): JobBoard =>
  ({
    board: { id: name, name, thickness: 8, ...more },
    nest: { gap: 10, margin: 5, unplaced: [] },
    request: { parts: [{ id: 'p' }], holdDown: 'tabs' },
  }) as unknown as JobBoard;

const context: QueueContext = { bit: 3.175, missing: [] };

/** The hook's result for these boards, with what it computes from the store. */
function setQueue(boards: JobBoard[], plans: (PlanResult | undefined)[], more: Partial<QueueContext> = {}, stale: string[] = []) {
  const queue = machineQueue(boards, plans, { ...context, ...more });
  hook.value = {
    job: { name: 'job' },
    queue,
    stale: new Set(stale),
    loading: false,
    setStockThickness: vi.fn(),
  };
  return queue;
}

const view = () => (
  <TooltipProvider>
    <CamQueueCard />
  </TooltipProvider>
);
const card = () => within(screen.getByRole('region', { name: 'CAM job' }));
const loadedGcode = () => useStore.getState().toolpath?.gcode;
const entryByKey = (key: string) => (hook.value.queue as QueueEntry[]).find(e => e.key === key)!;

beforeEach(() => {
  useCamMachine.setState({ ...useCamMachine.getInitialState(), jobId: 'j1' }, true);
  useStore.setState(s => {
    s.toolpath = null;
    s.toolpathName = null;
  });
});

afterEach(() => {
  cleanup();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
  useStore.setState(s => {
    s.toolpath = null;
    s.toolpathName = null;
  });
});

describe('the machine queue card', () => {
  it('shows why a board is blocked and refuses to load it', () => {
    const blocked = plan([3.175], 'a', { holdClash: [{ x: 1, y: 1 }] });
    setQueue([board('A')], [blocked]);
    render(view());
    expect(card().getByRole('alert').textContent).toMatch(/screw or clamp is in the bit’s way/);
    expect(card().getByRole('button', { name: 'Load program' })).toHaveProperty('disabled', true);
    expect(card().getByRole('button', { name: 'Done, next' })).toHaveProperty('disabled', true);
    // Picking it from the list doesn't load it either.
    fireEvent.click(card().getByRole('button', { name: /Board A · ⌀3.175/ }));
    expect(loadedGcode()).toBeUndefined();
  });

  it('the loaded program goes away when its board becomes blocked (a screw dragged into a cut path)', () => {
    const fine = plan([3.175]);
    setQueue([board('A')], [fine]);
    const { rerender } = render(view());
    fireEvent.click(card().getByRole('button', { name: 'Load program' }));
    expect(loadedGcode()).toBe(fine.programs[0].gcode);

    setQueue([board('A')], [plan([3.175], 'a', { holdClash: [{ x: 1, y: 1 }] })]);
    rerender(view());
    expect(loadedGcode()).toBeUndefined();
    expect(useStore.getState().toolpathName).toBeNull();
  });

  it('a failed plan is an entry that says so, and nothing stays loaded', () => {
    const fine = plan([3.175]);
    setQueue([board('A')], [fine]);
    const { rerender } = render(view());
    fireEvent.click(card().getByRole('button', { name: 'Load program' }));

    setQueue([board('A')], [undefined], { errors: ['Open the model again'] });
    rerender(view());
    expect(card().getByRole('alert').textContent).toMatch(/Couldn’t be planned: Open the model again/);
    expect(card().getByRole('button', { name: 'Done, next' })).toHaveProperty('disabled', true);
    expect(loadedGcode()).toBeUndefined();
  });

  it('turning the board over: side A’s program is gone from the machine; side B’s comes with the next step', () => {
    const a = plan([3.175], 'a', { sideB: plan([3.175], 'b'), flip: { registration: 'dowels', dowelDiameter: 6 } });
    setQueue([board('A')], [a]);
    const { rerender } = render(view());
    fireEvent.click(card().getByRole('button', { name: 'Load program' }));
    expect(loadedGcode()).toBe(a.programs[0].gcode);

    fireEvent.click(card().getByRole('button', { name: 'Done, next' }));
    setQueue([board('A')], [a]);
    rerender(view());
    expect(useCamMachine.getState().active).toBe('A:flip');
    expect(loadedGcode()).toBeUndefined();
    // The outline stays, to see where the board goes.
    expect(useCamMachine.getState().overlay).toMatchObject({ w: 100, h: 80 });
    expect(useCamMachine.getState().overlay?.tabs).toBeUndefined();

    fireEvent.click(card().getByRole('button', { name: 'Turned over, next' }));
    setQueue([board('A')], [a]);
    rerender(view());
    expect(loadedGcode()).toBe(a.sideB!.programs[0].gcode);
  });

  it('while a board is planned again it stays the current one, with nothing loaded, then its new program loads', () => {
    const old = plan([3.175], 'old');
    setQueue([board('A'), board('B')], [old, plan([3.175], 'other')]);
    const { rerender } = render(view());
    fireEvent.click(card().getByRole('button', { name: 'Load program' }));
    expect(useCamMachine.getState().active).toBe('A:bit:0');

    setQueue([board('A'), board('B')], [old, plan([3.175], 'other')], {}, ['A']);
    rerender(view());
    expect(useCamMachine.getState().active).toBe('A:bit:0');
    expect(loadedGcode()).toBeUndefined();
    expect(card().getByRole('button', { name: 'Done, next' })).toHaveProperty('disabled', true);

    const fresh = plan([3.175], 'new');
    setQueue([board('A'), board('B')], [fresh, plan([3.175], 'other')]);
    rerender(view());
    expect(loadedGcode()).toBe(fresh.programs[0].gcode);
  });

  it('a board not planned yet doesn’t take the active entry with it, and doesn’t load another board', () => {
    useCamMachine.setState({ active: 'A:bit:1' });
    setQueue([board('A'), board('B')], [undefined, plan([3.175], 'other')]);
    const { rerender } = render(view());
    expect(useCamMachine.getState().active).toBe('A:bit:1');
    expect(loadedGcode()).toBeUndefined();
    expect(card().getByRole('status').textContent).toMatch(/Making its programs/);

    const a = plan([3.175, 6]);
    setQueue([board('A'), board('B')], [a, plan([3.175], 'other')]);
    rerender(view());
    expect(loadedGcode()).toBe(a.programs[1].gcode);
  });

  it('nothing loads by itself after taking the job: no older program stays either way', () => {
    setQueue([board('A')], [plan([3.175])]);
    render(view());
    expect(useCamMachine.getState().active).toBeNull();
    expect(loadedGcode()).toBeUndefined();
    expect(card().getByRole('button', { name: 'Load program' })).toHaveProperty('disabled', false);
  });

  it('the last one done: nothing stays loaded to run again', () => {
    setQueue([board('A')], [plan([3.175])]);
    const { rerender } = render(view());
    fireEvent.click(card().getByRole('button', { name: 'Load program' }));
    fireEvent.click(card().getByRole('button', { name: 'Done, next' }));
    setQueue([board('A')], [plan([3.175])]);
    rerender(view());
    expect(loadedGcode()).toBeUndefined();
    expect(card().getByText('All boards are cut.')).toBeTruthy();
  });

  it('asks to swap the bit whenever it differs from the entry before: between boards, and before freeing parts or tabs', () => {
    const a = plan([2, 6], 'a');
    const b = plan([3.175], 'b', { release: [release('free', 3.175), release('tabs', 3.175)] });
    // A ends on ⌀6, B starts on ⌀3.175.
    setQueue([board('A'), board('B')], [a, b]);
    const { rerender } = render(view());
    const open = (key: string) => {
      useCamMachine.setState({ active: key });
      rerender(view());
    };
    // The first board: nothing to compare with, it says which bit goes in, one zero step.
    expect(card().getByRole('region', { name: 'Bit' }).textContent).toMatch(/^Put in the ⌀2 mm bit.*Then zero Z on the spoilboard/);
    open('A:bit:1');
    expect(card().getByText(/Swap the bit to ⌀6 mm/)).toBeTruthy();
    open('B:bit:0');
    expect(card().getByRole('region', { name: 'Bit' }).textContent).toMatch(/^Swap the bit to ⌀3\.175 mm.*Then zero Z on the spoilboard/);
    open('B:free');
    expect(card().queryByText(/Swap the bit/)).toBeNull();

    // Side B ends on the small bit; freeing and tabs are planned for the main one.
    const c = plan([6], 'c', {
      sideB: plan([3.175], 'cb'),
      flip: { registration: 'camera' },
      release: [release('free', 6, { turned: true }), release('tabs', 6, { turned: true })],
    });
    useCamMachine.setState({ active: 'C:free' });
    setQueue([board('C')], [c]);
    rerender(view());
    expect(card().getByText(/Swap the bit to ⌀6 mm/)).toBeTruthy();
    useCamMachine.setState({ active: 'C:tabs' });
    setQueue([board('C')], [c]);
    rerender(view());
    expect(card().queryByText(/Swap the bit/)).toBeNull();
  });

  it('tells the machine view the guided program’s own bit, not the board’s first program’s', () => {
    const a = plan([3.175, 6], 'a', { release: [release('free', 6)] });
    useCamMachine.setState({ active: 'A:free' });
    setQueue([board('A')], [a]);
    render(view());
    expect(useStore.getState().toolDiameter).toBe(6);
  });

  it('marks the program done, not just its place in the queue', () => {
    const a = plan([3.175], 'a');
    const queue = setQueue([board('A')], [a]);
    render(view());
    fireEvent.click(card().getByRole('button', { name: 'Load program' }));
    fireEvent.click(card().getByRole('button', { name: 'Done, next' }));
    expect(useCamMachine.getState().done).toEqual([queue[0].doneId]);
  });

  it('side B turns on its own (camera): from the flip step, with side A’s rotation untouched and the holds mentioned', () => {
    const a = plan([3.175], 'a', { sideB: plan([3.175], 'b'), flip: { registration: 'camera' } });
    useCamMachine.setState({ active: 'A:flip', rotation: { A: 1 } });
    setQueue([board('A')], [a]);
    const { rerender } = render(view());
    expect(card().getByText(/Refit the screws, clamps or tape/).parentElement!.textContent).toMatch(/clear of side B’s cuts/);
    // Until corrected it lies like side A; turned (the knob in the top view), on its own.
    expect(useCamMachine.getState().overlay?.rotationDeg).toBe(1);
    useCamMachine.getState().setRotation('A:b', 1.1);
    expect(useCamMachine.getState().rotation).toEqual({ A: 1, 'A:b': 1.1 });
    setQueue([board('A')], [a]);
    rerender(view());
    expect(useCamMachine.getState().overlay?.rotationDeg).toBe(1.1);

    // Where the outline can be dragged too: on side B's first step, its program loaded.
    useCamMachine.setState({ active: 'A:b:bit:0' });
    setQueue([board('A')], [a]);
    rerender(view());
    expect(useCamMachine.getState().overlay?.rotationDeg).toBe(1.1);
    expect(entryByKey('A:b:bit:0').sideB).toBe(true);
  });

  it('with pins or a fence side B lies where they put it: still the line about the holds', () => {
    const a = plan([3.175], 'a', { sideB: plan([3.175], 'b'), flip: { registration: 'dowels', dowelDiameter: 6 } });
    useCamMachine.setState({ active: 'A:flip' });
    setQueue([board('A')], [a]);
    render(view());
    expect(card().getByText(/Refit the screws, clamps or tape/)).toBeTruthy();
  });

  it('first step of a board: measure the stock, showing what’s assumed, and pass on what was measured', () => {
    setQueue([board('A')], [plan([3.175])]);
    const { rerender } = render(view());
    expect(card().getByText(/1\. Measure its thickness/).parentElement!.textContent).toMatch(/assumed parts \+ 0\.3 mm/);
    const field = card().getByRole('textbox', { name: /Stock thickness of board A/ });
    fireEvent.change(field, { target: { value: '8,6' } });
    fireEvent.blur(field);
    expect(hook.value.setStockThickness).toHaveBeenCalledWith('A', 8.6);

    setQueue([board('A', { measuredThickness: 8.6 })], [plan([3.175])]);
    rerender(view());
    expect(card().getByText(/1\. Measure its thickness/)).toBeTruthy();
    expect(card().getByRole<HTMLInputElement>('textbox', { name: /Stock thickness of board A/ }).value).toBe('8.6');
    // Not again for the next bit of the same board.
    useCamMachine.setState({ active: 'A:bit:1' });
    setQueue([board('A')], [plan([3.175, 6])]);
    rerender(view());
    expect(card().queryByText(/Measure its/)).toBeNull();
  });
});
