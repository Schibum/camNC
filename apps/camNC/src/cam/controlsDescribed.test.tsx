import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kDefaultTabs, layoutSummary, type BoardNest, type BoardV1 } from './boards';
import { BoardInspector } from './boards/BoardInspector';
import { kCuttingFields, kCuttingHints, kCuttingLabels } from './cuttingData';
import { useCamMachine } from './machine/camMachine';
import { CamQueueCard } from './machine/CamQueueCard';
import { BitChip } from './plan/BitPicker';
import { CuttingDataEditor } from './plan/CuttingDataEditor';
import { kDefaultBit, kDefaultPlan } from './planSettings';
import { loadIntoMachineView } from './showOnMachine';

const queue = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('./machine/useMachineQueue', () => ({ useMachineQueue: () => queue.value }));
vi.mock('./showOnMachine', () => ({ loadIntoMachineView: vi.fn(), clearMachineView: vi.fn() }));

afterEach(() => {
  cleanup();
  useCamMachine.setState(useCamMachine.getInitialState(), true);
});

/** The accessible description: the text of the elements `aria-describedby` points to. */
function description(el: Element) {
  const ids = el.getAttribute('aria-describedby')?.split(/\s+/).filter(Boolean) ?? [];
  return ids
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

const board: BoardV1 = {
  id: 'b1',
  name: 'A',
  thickness: 8,
  material: 'oak',
  size: { fit: true },
  holdDown: 'tabs',
  tabs: kDefaultTabs,
  items: ['p1'],
  pinned: ['p1'],
};
const nest: BoardNest = {
  board: { w: 400, h: 300 },
  placements: [],
  unplaced: [],
  yield: 0,
  gap: 8,
  margin: 6,
  keepOuts: [],
  holds: [],
  frame: 'kept',
  frameWidth: 0,
  stickout: 20,
  nutAbove: 11,
  holdsMoved: false,
};

describe('CAM controls explain themselves', () => {
  it('board settings: hold-down options, spacing, stock thickness, tabs and Re-lay out have descriptions', () => {
    render(
      <TooltipProvider>
        <BoardInspector board={board} nest={nest} stock={[]} bit={3.175} onChange={() => {}} onRelayout={() => {}} />
      </TooltipProvider>
    );
    expect(description(screen.getByRole('radio', { name: 'Tape or fixture' }))).toMatch(/thin bottom skin/);
    expect(description(screen.getByRole('radio', { name: 'Screws or clamps' }))).toMatch(/needs 3 around it/);
    expect(description(screen.getByRole('radio', { name: 'Nothing (I watch them)' }))).toMatch(/free once its outline/);
    expect(description(screen.getByLabelText('Size ⌀'))).toMatch(/screw head/);
    expect(description(screen.getByRole('radio', { name: 'Tabs' }))).toMatch(/bridges hold each part/);
    expect(description(screen.getByRole('radio', { name: 'Tabs + guided removal' }))).toMatch(/stops at each tab/);
    expect(description(screen.getByRole('radio', { name: 'Bottom skin + guided removal' }))).toMatch(/cuts them free one at a time/);
    expect(description(screen.getByLabelText('Edge margin'))).toMatch(/border inside the board edge/);
    expect(description(screen.getByLabelText('Gap between parts'))).toMatch(/outline cuts never meet/);
    expect(description(screen.getByLabelText('Stock thickness'))).toMatch(/caliper/);
    expect(description(screen.getByLabelText('Tab W'))).toMatch(/^Tab width/);
    expect(description(screen.getByLabelText('Tab H'))).toMatch(/^Tab height/);
    expect(description(screen.getByLabelText('Min #'))).toMatch(/^Fewest tabs/);
    expect(description(screen.getByRole('button', { name: 'Re-lay out' }))).toMatch(/unpinned and may move/);
  });

  it('tabs on spacing too tight to hold them: says so, and widens margin and gap for tabs', () => {
    const onChange = vi.fn();
    render(
      <TooltipProvider>
        <BoardInspector board={board} nest={nest} stock={[]} bit={3.175} onChange={onChange} />
      </TooltipProvider>
    );
    expect(screen.getByText(/Too tight for tabs/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Widen for tabs' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ margin: 6.7, gap: 10 }));
  });

  it('the bottom skin hold-down: its thickness is set for the job, and a board can pass its hold-down to all', () => {
    const onTabHold = vi.fn();
    const onHoldDownAll = vi.fn();
    render(
      <TooltipProvider>
        <BoardInspector
          board={{ ...board, holdDown: 'skin' }}
          nest={nest}
          stock={[]}
          bit={3.175}
          onChange={() => {}}
          tabHold={{ skin: 1 }}
          onTabHold={onTabHold}
          onHoldDownAll={onHoldDownAll}
        />
      </TooltipProvider>
    );
    // No tabs on a skin board: no tab fields, no spacing warning.
    expect(screen.queryByLabelText('Tab W')).toBeNull();
    expect(screen.queryByText(/Too tight for tabs/)).toBeNull();
    const skin = screen.getByLabelText('Bottom skin (mm)');
    fireEvent.change(skin, { target: { value: '0.8' } });
    fireEvent.blur(skin);
    expect(onTabHold).toHaveBeenCalledWith({ skin: 0.8 });
    fireEvent.click(screen.getByRole('button', { name: 'Use for all boards' }));
    expect(onHoldDownAll).toHaveBeenCalled();
  });

  it('a tooltip opens on keyboard focus, with the same text as the description', async () => {
    render(
      <TooltipProvider>
        <BoardInspector board={board} nest={nest} stock={[]} bit={3.175} onChange={() => {}} onRelayout={() => {}} />
      </TooltipProvider>
    );
    const button = screen.getByRole('button', { name: 'Re-lay out' });
    // Focus as the keyboard gives it (a headless page may not dispatch focus events for element.focus()).
    act(() => button.focus());
    fireEvent.focus(button);
    expect((await screen.findByRole('tooltip')).textContent).toBe(description(button));
  });

  it('every cutting data field says what it does', () => {
    render(
      <TooltipProvider>
        <CuttingDataEditor bit={kDefaultBit} material="oak" />
      </TooltipProvider>
    );
    for (const field of kCuttingFields) {
      const input = screen.getByRole('textbox', { name: new RegExp(`^${kCuttingLabels[field].label}`) });
      expect(description(input)).toBe(kCuttingHints[field]);
    }
    expect(kCuttingHints.stepdown).toBe('How deep each pass cuts. Less is gentler on the bit and slower.');
  });

  it('the bit chip explains what the bit decides', () => {
    render(
      <TooltipProvider>
        <BitChip value={kDefaultPlan} onChange={() => {}} />
      </TooltipProvider>
    );
    expect(description(screen.getByRole('button', { name: /^Bit: / }))).toMatch(/margin and gap/);
  });

  it('the machine queue: rotation, load, done and leave have names and descriptions', () => {
    const plan = { size: [400, 300, 8.3], bits: [3.175], programs: [{ tool: 1, diameter: 3.175, gcode: 'G0', timeMin: 3 }] };
    const entry = {
      key: 'b1:bit:0',
      board: { board },
      kind: 'bit',
      program: 0,
      firstOfBoard: true,
      plan,
    };
    queue.value = { job: { name: 'job' }, queue: [entry], current: entry, done: [], tabRemoval: undefined, loading: false };
    useCamMachine.setState({ jobId: 'j1' });
    render(
      <TooltipProvider>
        <CamQueueCard />
      </TooltipProvider>
    );
    const card = within(screen.getByRole('region', { name: 'CAM job' }));
    expect(description(card.getByRole('button', { name: 'Leave the CAM job' }))).toMatch(/Closes the queue/);
    expect(description(card.getByRole('button', { name: 'Load program' }))).toMatch(/machine view/);
    expect(description(card.getByRole('button', { name: 'Done, next' }))).toMatch(/loads the next program/);
  });

  it('guided tab removal at the machine: once per part (default) or a pause after each tab, with the legend for the marks', () => {
    const plan = { size: [400, 300, 8.3], bits: [3.175], programs: [{ tool: 1, diameter: 3.175, gcode: 'G0', timeMin: 3 }] };
    const entry = { key: 'b1:tabs', board: { board }, kind: 'tabs', program: 0, firstOfBoard: false, plan };
    queue.value = { job: { name: 'job' }, queue: [entry], current: entry, done: [], tabRemoval: undefined, loading: false };
    useCamMachine.setState({ jobId: 'j1' });
    render(
      <TooltipProvider>
        <CamQueueCard />
      </TooltipProvider>
    );
    const card = within(screen.getByRole('region', { name: 'CAM job' }));
    const box = card.getByRole('checkbox', { name: 'Pause before each tab' });
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(card.getByText(/take out the part marked amber/)).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'How it works' }));
    expect(card.getByText(/cuts all of a part’s tabs in a row/)).toBeTruthy();
    fireEvent.click(box);
    expect(useCamMachine.getState().pauseEachTab).toBe(true);
    expect(card.getByText(/hold the part at the green ring, away from the bit/)).toBeTruthy();
  });

  it('the machine queue runs the guided program from the plan, and not while the board is planned again', () => {
    const plan = { size: [400, 300, 8.3], bits: [3.175], programs: [{ tool: 1, diameter: 3.175, gcode: 'G0', timeMin: 3 }] };
    const release = { kind: 'free', gcode: '(planned)', diameter: 3.175, timeMin: 2, parts: [{ name: 'p', at: { x: 1, y: 2 } }] };
    const entry = {
      key: 'b1:free',
      board: { board, request: { holdDown: 'skin' } },
      kind: 'free',
      program: 0,
      firstOfBoard: false,
      plan,
      release,
    };
    queue.value = { job: { name: 'job' }, queue: [entry], current: entry, done: [], stale: new Set(['b1']), loading: false };
    useCamMachine.setState({ jobId: 'j1' });
    const view = () => (
      <TooltipProvider>
        <CamQueueCard />
      </TooltipProvider>
    );
    const { rerender } = render(view());
    const card = within(screen.getByRole('region', { name: 'CAM job' }));
    expect(card.getByRole('button', { name: 'Load parts freeing' })).toHaveProperty('disabled', true);
    expect(card.getByText(/1 parts · 2 min/)).toBeTruthy();

    queue.value = { ...queue.value, stale: new Set() };
    rerender(view());
    fireEvent.click(card.getByRole('button', { name: 'Load parts freeing' }));
    expect(vi.mocked(loadIntoMachineView).mock.lastCall?.[0]).toMatchObject({ gcode: '(planned)', bits: [3.175] });
    expect(useCamMachine.getState().overlay?.freeParts).toEqual(release.parts);
  });

  it('sums up the layout: boards with parts, and part area over board area', () => {
    const b = (w: number, h: number, y: number, parts = 1) => ({ nest: { board: { w, h }, yield: y, placements: Array(parts).fill({}) } });
    expect(layoutSummary([b(100, 100, 0.9), b(100, 100, 0.7)])).toBe('2 boards, 80 % yield');
    // By area, not the mean of the yields; boards without parts don't count.
    expect(layoutSummary([b(300, 100, 0.9), b(100, 100, 0.5), b(100, 100, 0, 0)])).toBe('2 boards, 80 % yield');
    expect(layoutSummary([b(100, 100, 0.81)])).toBe('1 board, 81 % yield');
    expect(layoutSummary([])).toBe('No part placed yet.');
  });
});
