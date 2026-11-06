import { TooltipProvider } from '@wbcnc/ui/components/tooltip';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { kDefaultTabs, layoutSummary, type BoardNest, type BoardV1 } from './boards';
import { BoardHeadingFields } from './boards/BoardHeadingFields';
import { BoardInspector } from './boards/BoardInspector';
import { HoldSizesDialog } from './boards/HoldSizesDialog';
import { kDefaultHardware, useHoldHardware } from './holdHardware';
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
  retention: 'tabs',
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
  bit: 3.175,
  holds: [],
  stickout: 20,
  nutAbove: 11,
};

describe('CAM controls explain themselves', () => {
  it('board settings: holding options, tabs and Tighten layout have descriptions', () => {
    render(
      <TooltipProvider>
        <BoardInspector board={board} nest={nest} stock={[]} onChange={() => {}} onRelayout={() => {}} />
      </TooltipProvider>
    );
    expect(description(screen.getByRole('checkbox', { name: 'Tape under the board' }))).toMatch(/Double-sided tape/);
    expect(description(screen.getByRole('radio', { name: 'Tabs' }))).toMatch(/bridges hold each part/);
    expect(description(screen.getByRole('radio', { name: 'Bottom skin' }))).toMatch(/bridges hold each part/);
    expect(description(screen.getByRole('checkbox', { name: 'Stop at each tab at the machine' }))).toMatch(/stops at each tab/);
    expect(description(screen.getByLabelText('Tab W'))).toMatch(/^Tab width/);
    expect(description(screen.getByLabelText('Tab H'))).toMatch(/^Tab height/);
    expect(description(screen.getByLabelText('Min #'))).toMatch(/^Fewest tabs/);
    expect(description(screen.getByRole('button', { name: 'Tighten layout' }))).toMatch(/placed by hand may move/);
  });

  it('clamp and screw sizes: each field is described, and a side view shows what its numbers mean', () => {
    render(
      <TooltipProvider>
        <HoldSizesDialog open onOpenChange={() => {}} bit={3.175} stockTop={8.5} nutAbove={11.5} stickout={20} onStickout={() => {}} />
      </TooltipProvider>
    );
    expect(description(screen.getByLabelText('Screw head ⌀'))).toMatch(/screw head/);
    expect(description(screen.getByLabelText('Clamp reach'))).toMatch(/toe reaches/);
    expect(description(screen.getByLabelText('Bit stick-out'))).toMatch(/below the collet nut/);
    const clamp = within(screen.getByRole('figure', { name: 'What the clamp sizes mean' }));
    expect(clamp.getByText(/^reach /)).toBeTruthy();
    expect(clamp.getByText(/^width /)).toBeTruthy();
    expect(clamp.getByText('stick-out 20')).toBeTruthy();
    expect(within(screen.getByRole('figure', { name: 'What the screw sizes mean' })).getByText(/^⌀\d+\+2$/)).toBeTruthy();
    // The numbers are what's in the fields: a clamp that reaches further is drawn so.
    fireEvent.change(screen.getByLabelText('Clamp reach'), { target: { value: '7.5' } });
    fireEvent.blur(screen.getByLabelText('Clamp reach'));
    expect(clamp.getByText('reach 7.5')).toBeTruthy();
    useHoldHardware.setState({ hardware: kDefaultHardware });
  });

  it('stock thickness on the board’s heading is described', () => {
    render(
      <TooltipProvider>
        <BoardHeadingFields board={board} nest={nest} onChange={() => {}} />
      </TooltipProvider>
    );
    expect(description(screen.getByLabelText('Stock thickness'))).toMatch(/caliper/);
  });

  it('nothing above the settings moves with what is chosen: no warning among them, the note keeps its room', () => {
    const skin = vi.fn();
    render(
      <TooltipProvider>
        <BoardInspector board={{ ...board, retention: 'skin' }} nest={nest} stock={[]} onChange={() => {}} skin={1} onSkin={skin} />
      </TooltipProvider>
    );
    expect(screen.queryByText(/Too tight for tabs/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Stop at each tab at the machine' })).toHaveProperty('disabled', true);
    const field = document.getElementById('skin')!;
    fireEvent.change(field, { target: { value: '0.8' } });
    fireEvent.blur(field);
    expect(skin).toHaveBeenCalledWith(0.8);
  });

  it('a tooltip opens on keyboard focus, with the same text as the description', async () => {
    render(
      <TooltipProvider>
        <BoardInspector board={board} nest={nest} stock={[]} onChange={() => {}} onRelayout={() => {}} />
      </TooltipProvider>
    );
    const button = screen.getByRole('button', { name: 'Tighten layout' });
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
    fireEvent.click(card.getByRole('button', { name: /^Board queue/ }));
    expect(description(screen.getByRole('button', { name: 'Leave the CAM job', hidden: true }))).toMatch(/Closes the queue/);
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
    fireEvent.click(card.getByRole('button', { name: /^Board queue/ }));
    expect(screen.getByText(/1 parts · ≈2 min auto/)).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

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
