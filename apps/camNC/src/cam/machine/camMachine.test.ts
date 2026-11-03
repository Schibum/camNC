import { describe, expect, it } from 'vitest';
import type { PlanResult } from '../camTypes';
import type { JobBoard } from '../useJobBoards';
import { currentTab, entryTitle, machineQueue, partsTakenOut } from './camMachine';

const plan = (bits: number[]): PlanResult =>
  ({
    gcode: '',
    timeMin: 1,
    warnings: [],
    safety: [],
    ops: [],
    bits,
    programs: bits.map((d, i) => ({ tool: i + 1, diameter: d, gcode: `(T${i + 1})`, timeMin: 1 })),
    size: [100, 100, 8.3],
    path: [],
  }) as PlanResult;

const board = (name: string, holdDown: 'tabs' | 'tabs-guided' = 'tabs'): JobBoard =>
  ({
    board: { id: name, name, holdDown },
    nest: {},
    request: { parts: [{ id: 'p' }] },
  }) as unknown as JobBoard;

describe('machine queue', () => {
  it('orders boards to reuse the bit in the collet, one entry per bit, tab removal last for guided boards', () => {
    const q = machineQueue([board('A'), board('B', 'tabs-guided'), board('C')], [plan([6]), plan([3.175, 6]), plan([3.175])]);
    // 3.175 only, then 3.175 -> 6, then 6 only: no bit swap between boards.
    expect(q.map(entryTitle)).toEqual([
      'Board C · ⌀3.175',
      'Board B · T1 ⌀3.175',
      'Board B · T2 ⌀6',
      'Board B · remove tabs',
      'Board A · ⌀6',
    ]);
    expect(q.map(e => e.firstOfBoard)).toEqual([true, true, false, false, true]);
  });

  it('a board with a second side: its programs, turn over, side B per bit, then tab removal', () => {
    const a = { ...plan([3.175]), sideB: plan([3.175]), flip: { registration: 'dowels' as const, dowelDiameter: 6 } };
    const q = machineQueue([board('A', 'tabs-guided')], [a]);
    expect(q.map(entryTitle)).toEqual(['Board A · ⌀3.175', 'Board A · turn over', 'Board A side B · ⌀3.175', 'Board A · remove tabs']);
    expect(q.map(e => e.kind)).toEqual(['bit', 'flip', 'bit', 'tabs']);
    expect(q[1].flip?.registration).toBe('dowels');
    // Side B runs its own program.
    expect(q[2].plan).toBe(a.sideB);
    expect(q[2].sideB).toBe(true);
  });

  it('bottom-skin parts: a "free parts" step after the board, before the tab removal; which part is next', () => {
    const a = { ...plan([3.175]), holding: [{ name: 'p', how: 'skin' as const, spots: 0 }] };
    const q = machineQueue([board('A', 'tabs-guided')], [a]);
    expect(q.map(entryTitle)).toEqual(['Board A · ⌀3.175', 'Board A · free parts', 'Board A · remove tabs']);
    const g = [
      'G1 X1',
      'G0 Z13',
      'M5',
      'M0 (MSG Take out a, then continue)',
      'M3 S15000',
      'G1 X2',
      'M5',
      'M0 (MSG Take out b, then continue)',
    ].join('\n');
    const at = (text: string) => (100 * (g.indexOf(text) + text.length + 1)) / g.length;
    expect(partsTakenOut(g, 0)).toBe(0);
    expect(partsTakenOut(g, at('Take out a, then continue)'))).toBe(1);
    expect(partsTakenOut(g, at('Take out b, then continue)'))).toBe(2);
  });

  it('knows which tab the removal program is at from the SD progress', () => {
    const g = [
      'G0 Z13',
      'M0 (MSG Spindle starts at 15000 RPM next. Manual spindle: turn it on now)',
      'M3 S15000',
      'M0 (MSG Tab 1 of 2: hold left)',
      'G1 X1',
      'M0 (MSG Tab 2 of 2: hold left)',
      'G1 X2',
    ].join('\n');
    const at = (text: string) => (100 * (g.indexOf(text) + text.length + 1)) / g.length;
    expect(currentTab(g, 0)).toBe(0);
    expect(currentTab(g, at('Tab 1 of 2: hold left)'))).toBe(1);
    expect(currentTab(g, at('G1 X1'))).toBe(1);
    expect(currentTab(g, at('Tab 2 of 2: hold left)'))).toBe(2);
  });
});
