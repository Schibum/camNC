import { describe, expect, it } from 'vitest';
import type { PlanResult, ReleaseProgram } from '../camTypes';
import type { JobBoard } from '../useJobBoards';
import { boardBlock, planBlock } from '../boardBlock';
import {
  currentEntry,
  cutsToRecord,
  doneEntries,
  currentTab,
  entryProgram,
  entryRotation,
  entryTitle,
  machineQueue,
  nextEntry,
  rotationKey,
  takeOutAt,
  useCamMachine,
} from './camMachine';

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

const release = (kind: ReleaseProgram['kind']) => ({ kind, gcode: `(${kind})`, timeMin: 1, diameter: 3.175 }) as ReleaseProgram;

const board = (name: string, holdDown: 'tabs' | 'tabs-guided' = 'tabs'): JobBoard =>
  ({
    board: { id: name, name, holdDown },
    nest: {},
    request: { parts: [{ id: 'p' }] },
  }) as unknown as JobBoard;

describe('machine queue', () => {
  it('orders boards to reuse the bit in the collet, one entry per bit, tab removal last for guided boards', () => {
    const q = machineQueue(
      [board('A'), board('B', 'tabs-guided'), board('C')],
      [plan([6]), { ...plan([3.175, 6]), release: [release('tabs')] }, plan([3.175])]
    );
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
    const a = {
      ...plan([3.175]),
      sideB: plan([3.175]),
      flip: { registration: 'dowels' as const, dowelDiameter: 6 },
      release: [release('tabs')],
    };
    const q = machineQueue([board('A', 'tabs-guided')], [a]);
    expect(q.map(entryTitle)).toEqual(['Board A · ⌀3.175', 'Board A · turn over', 'Board A side B · ⌀3.175', 'Board A · remove tabs']);
    expect(q.map(e => e.kind)).toEqual(['bit', 'flip', 'bit', 'tabs']);
    expect(q[1].flip?.registration).toBe('dowels');
    // Side B runs its own program.
    expect(q[2].plan).toBe(a.sideB);
    expect(q[2].sideB).toBe(true);
  });

  it('bottom-skin parts: a "free parts" step after the board, before the tab removal; which part is next', () => {
    const a = { ...plan([3.175]), release: [release('free'), release('tabs')] };
    const q = machineQueue([board('A', 'tabs-guided')], [a]);
    expect(q.map(entryTitle)).toEqual(['Board A · ⌀3.175', 'Board A · free parts', 'Board A · remove tabs']);
    // The very programs the plan made, not new ones.
    expect(q[1].release).toBe(a.release[0]);
    expect(q[2].release).toBe(a.release[1]);
    // A guided board without any tabs left to remove: nothing to run.
    expect(machineQueue([board('A', 'tabs-guided')], [plan([3.175])]).map(e => e.kind)).toEqual(['bit']);
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
    // Cutting a, paused to take out a, cutting b (after the spindle starts again), paused to take out b.
    expect(takeOutAt(g, 0)).toEqual({ part: 0, paused: false });
    expect(takeOutAt(g, at('Take out a, then continue)'))).toEqual({ part: 0, paused: true });
    expect(takeOutAt(g, at('G1 X2'))).toEqual({ part: 1, paused: false });
    expect(takeOutAt(g, at('Take out b, then continue)'))).toEqual({ part: 1, paused: true });
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

  const ready = (bits: number[], more: Partial<PlanResult> = {}) => ({ ...plan(bits), ops: [{}], ...more }) as PlanResult;
  const onBoard = (name: string, more: object = {}) =>
    ({ ...board(name), nest: { gap: 10, margin: 5, unplaced: [] }, ...more }) as unknown as JobBoard;
  const context = { bit: 3.175, missing: [] };

  describe('what blocks a board', () => {
    it.each([
      ['a broken safety rule', { safety: ['move leaves the board'] }, /safety check failed: move leaves the board/],
      ['one of side B', { sideB: ready([3.175], { safety: ['too deep'] }) }, /Side B: too deep/],
      [
        'one of a guided program',
        { release: [{ ...release('tabs'), safety: ['Remove the tabs: too deep'] }] },
        /Remove the tabs: too deep/,
      ],
      ['stock that can turn', { timeline: [{ block: true, message: 'a piece can turn' }] }, /a piece can turn/],
      ['a screw in the way', { holdClash: [{ x: 1, y: 1 }] }, /screw or clamp is in the bit’s way/],
      ['a part that comes loose', { hold: [{ part: 'p', ok: false, tabs: [], anchored: 0 }] }, /p would come loose/],
      ['no room for dowels', { flip: { registration: 'dowels', problem: 'No room for two pins' } }, /No room for two pins/],
      ['nothing to cut', { ops: [] }, /Nothing to cut/],
    ] as [string, Partial<PlanResult>, RegExp][])('%s: on every entry of the board in the queue', (_, change, why) => {
      expect(planBlock(ready([3.175], change))).toMatch(why);
      const q = machineQueue([onBoard('A')], [ready([3.175], change)], context);
      expect(q.length).toBeGreaterThan(0);
      for (const e of q) expect(e.blocked).toMatch(why);
    });

    it('a timeline note that doesn’t block, and tabs held anyway, block nothing', () => {
      const fine = ready([3.175], {
        timeline: [{ block: false, message: 'keep an eye on it' }],
        hold: [{ part: 'p', ok: false, tabs: [], anchored: 0 }],
        holding: [{ name: 'p', how: 'tabs', tabs: 3 }],
      } as unknown as Partial<PlanResult>);
      expect(planBlock(fine)).toBeNull();
      expect(machineQueue([onBoard('A')], [fine], context)[0].blocked).toBeUndefined();
    });

    it('layout: parts that don’t fit their board, and spacing too tight for the bit; each on its own board', () => {
      const boards = [onBoard('A'), onBoard('B', { nest: { gap: 1, margin: 5, unplaced: [] } }), onBoard('C')];
      const q = machineQueue(
        boards,
        boards.map(() => ready([3.175])),
        {
          ...context,
          missing: [{ id: 'p#1', name: 'shelf', board: 'A' }],
        }
      );
      const of = (name: string) => q.find(e => e.board.board.name === name)!.blocked;
      expect(of('A')).toMatch(/shelf doesn’t fit on board A/);
      expect(of('B')).toMatch(/gap between parts is too narrow/);
      expect(of('C')).toBeUndefined();
      expect(boardBlock(boards[0], undefined, context)).toBeNull();
    });

    it('a board where nothing fits is in the queue too, saying so; one with no parts and none missing is not', () => {
      const none = { ...onBoard('A'), request: { parts: [] } } as unknown as JobBoard;
      const q = machineQueue([none, { ...none, board: { ...none.board, id: 'B', name: 'B' } }], [undefined, undefined], {
        ...context,
        missing: [{ id: 'p#1', name: 'shelf', board: 'A' }],
      });
      expect(q.map(e => [e.key, e.kind])).toEqual([['A:error', 'error']]);
      expect(q[0].blocked).toMatch(/shelf/);
    });

    it('a plan that failed is an error entry, not gone; one not there yet is pending; neither has a program', () => {
      const q = machineQueue([onBoard('A'), onBoard('B'), onBoard('C')], [undefined, undefined, ready([3.175])], {
        ...context,
        errors: ['Open the model again', undefined, undefined],
      });
      const by = Object.fromEntries(q.map(e => [e.board.board.name, e]));
      expect(by.A.kind).toBe('error');
      expect(by.A.blocked).toMatch(/Couldn’t be planned: Open the model again/);
      expect(by.B.kind).toBe('pending');
      expect(by.C.kind).toBe('bit');
      expect(entryProgram(by.A)).toBeUndefined();
      expect(entryProgram(by.B)).toBeUndefined();
      expect(entryTitle(by.A)).toBe('Board A · can’t be cut');
      expect(entryTitle(by.B)).toBe('Board B · being planned');
    });

    it('a plan with no programs is an error entry', () => {
      const q = machineQueue([onBoard('A')], [ready([], { ops: [] })], context);
      expect(q.map(e => e.kind)).toEqual(['error']);
      expect(q[0].blocked).toMatch(/Nothing to cut/);
    });
  });

  describe('which entry is current', () => {
    const a = ready([3.175, 6], { sideB: ready([3.175]), flip: { registration: 'camera' } });
    const q = machineQueue([onBoard('A'), onBoard('B')], [a, ready([6])], context);
    const key = (e: { key: string } | null) => e?.key;

    it('the active one, else the first to cut', () => {
      expect(key(currentEntry(q, 'A:bit:1', []))).toBe('A:bit:1');
      expect(key(currentEntry(q, null, []))).toBe('A:bit:0');
      expect(key(currentEntry(q, null, [q[0].doneId]))).toBe('A:bit:1');
      expect(
        currentEntry(
          q,
          null,
          q.map(e => e.doneId)
        )
      ).toBeNull();
    });

    it('an active entry that’s gone stays on its board, not the next board', () => {
      const failed = machineQueue([onBoard('A'), onBoard('B')], [undefined, ready([6])], { ...context, errors: ['no', undefined] });
      expect(key(currentEntry(failed, 'A:b:bit:0', []))).toBe('A:error');
      const replanned = machineQueue([onBoard('A'), onBoard('B')], [ready([3.175]), ready([6])], context);
      const done = q.filter(e => e.board.board.name === 'B').map(e => e.doneId);
      expect(key(currentEntry(replanned, 'A:b:bit:0', done))).toBe('A:bit:0');
    });

    it('next: the next one to cut, or an earlier one left out; none when all are cut', () => {
      expect(key(nextEntry(q, q[0], []))).toBe('A:bit:1');
      expect(key(nextEntry(q, q[0], [q[1].doneId]))).toBe('A:flip');
      expect(key(nextEntry(q, q.at(-1)!, []))).toBe('A:bit:0');
      expect(
        nextEntry(
          q,
          q[0],
          q.slice(1).map(e => e.doneId)
        )
      ).toBeNull();
    });
  });

  describe('the bit in the collet', () => {
    it('each entry knows the bit before it, in queue order, over boards and steps without a bit', () => {
      const a = ready([6, 3.175], {
        sideB: ready([3.175, 2]),
        flip: { registration: 'camera' },
        release: [
          { ...release('free'), diameter: 6 },
          { ...release('tabs'), diameter: 6 },
        ],
      });
      const q = machineQueue([onBoard('A'), onBoard('B')], [a, ready([3.175])], context);
      // B needs ⌀3.175 and goes first when the job starts with that bit: follow the order that came out.
      const rows = q.map(e => [e.key, e.bitBefore, entryProgram(e)?.diameter]);
      expect(rows).toEqual([
        ['B:bit:0', undefined, 3.175],
        ['A:bit:0', 3.175, 6],
        ['A:bit:1', 6, 3.175],
        ['A:flip', 3.175, undefined],
        ['A:b:bit:0', 3.175, 3.175],
        ['A:b:bit:1', 3.175, 2],
        ['A:free', 2, 6],
        ['A:tabs', 6, 6],
      ]);
    });

    it('a guided program’s bit is its own, not the board’s first program’s', () => {
      const a = ready([3.175, 6], { release: [{ ...release('free'), diameter: 6 }] });
      const free = machineQueue([onBoard('A')], [a], context).find(e => e.kind === 'free')!;
      expect(entryProgram(free)?.diameter).toBe(6);
    });
  });

  describe('what’s done is the program, not its place', () => {
    const programs = (gcode: string, next = gcode) => {
      const p = ready([3.175]);
      return {
        ...p,
        programs: [{ ...p.programs[0], gcode }],
        release: [{ ...release('tabs'), gcode: next }],
      };
    };

    it('a changed program counts as not done; the same content does, even as a new object', () => {
      const before = machineQueue([onBoard('A')], [programs('G0 X1', '(tabs 1)')], context);
      const done = before.map(e => e.doneId);
      const same = machineQueue([onBoard('A')], [programs('G0 X1', '(tabs 1)')], context);
      expect(same.map(e => e.doneId)).toEqual(done);
      expect(currentEntry(same, null, done)).toBeNull();
      const changed = machineQueue([onBoard('A')], [programs('G0 X2', '(tabs 1)')], context);
      expect(changed[0].key).toBe(before[0].key);
      expect(changed[0].doneId).not.toBe(before[0].doneId);
      expect(changed[1].doneId).toBe(before[1].doneId);
      expect(currentEntry(changed, null, done)?.key).toBe('A:bit:0');
    });

    it('taking the same job again keeps what’s done, forgets what was loaded; another job starts over', () => {
      useCamMachine.setState({ jobId: 'j', done: ['x'], active: 'A:bit:0', rotation: { A: 1 }, overlay: { w: 1, h: 1, rotationDeg: 0 } });
      useCamMachine.getState().start('j');
      expect(useCamMachine.getState()).toMatchObject({ done: ['x'], active: null, overlay: null, rotation: { A: 1 } });
      useCamMachine.getState().start('k');
      expect(useCamMachine.getState()).toMatchObject({ jobId: 'k', done: [], rotation: {} });
      useCamMachine.setState(useCamMachine.getInitialState(), true);
    });

    it('the flip stays done when only side B’s program changes', () => {
      const a = (sideB: string) => {
        const b = ready([3.175]);
        return ready([3.175], {
          gcode: '(side A)',
          sideB: { ...b, programs: [{ ...b.programs[0], gcode: sideB }] },
          flip: { registration: 'camera' },
        });
      };
      const flip = (gcode: string) => machineQueue([onBoard('A')], [a(gcode)], context).find(e => e.kind === 'flip')!;
      expect(flip('G0 X1').doneId).toBe(flip('G0 X2').doneId);
    });
  });

  it('side B has a rotation of its own; until corrected, as side A; a guided program turned over goes with it', () => {
    const a = ready([3.175], { sideB: ready([3.175]), flip: { registration: 'camera' }, release: [{ ...release('tabs'), turned: true }] });
    const [first, flip, sideB, tabs] = machineQueue([onBoard('A')], [a], context);
    expect([first, flip, sideB, tabs].map(rotationKey)).toEqual(['A', 'A:b', 'A:b', 'A:b']);
    expect(entryRotation(sideB, { A: 2 })).toBe(2);
    expect(entryRotation(sideB, { A: 2, 'A:b': -1 })).toBe(-1);
    expect(entryRotation(sideB, { A: 2, 'A:b': 0 })).toBe(0);
    expect(entryRotation(first, { A: 2, 'A:b': -1 })).toBe(2);
    expect(entryRotation(first, {})).toBe(0);
  });

  it('tab removal pauses once per part by default, also in a browser that saved the old default', async () => {
    expect(useCamMachine.getInitialState().pauseEachTab).toBe(false);
    localStorage.setItem('camnc-cam-machine', JSON.stringify({ state: { pauseEachTab: true }, version: 0 }));
    await useCamMachine.persist.rehydrate();
    expect(useCamMachine.getState().pauseEachTab).toBe(false);
    // Once chosen, it stays chosen.
    useCamMachine.getState().setPauseEachTab(true);
    await useCamMachine.persist.rehydrate();
    expect(useCamMachine.getState().pauseEachTab).toBe(true);
    useCamMachine.getState().setPauseEachTab(false);
    localStorage.removeItem('camnc-cam-machine');
  });
});

describe('the job remembers the bed and what’s cut', () => {
  const withBed = (bed: NonNullable<JobBoard['board']['bed']>, cut?: JobBoard['board']['cut']) => {
    const b = board('A');
    return { ...b, board: { ...b.board, bed, cut } } as JobBoard;
  };

  it('a board turned on another visit lies at the angle saved with the job, until turned here', () => {
    const [a] = machineQueue([withBed({ a: { x: 10, y: 20, deg: 2.5 } })], [plan([6])]);
    expect(entryRotation(a, {})).toBe(2.5);
    expect(entryRotation(a, { A: -1 })).toBe(-1);
  });

  it('entries the job records as cut count as done here too; new ones are recorded once', () => {
    const q = machineQueue([withBed({}, { at: 1, keys: [] })], [plan([3.175, 6])]);
    expect(doneEntries(q, [])).toEqual([]);
    const rec = cutsToRecord(q, [q[0].doneId], 5);
    expect(rec).toEqual({ A: { at: 5, keys: [q[0].key] } });

    const after = machineQueue([withBed({}, rec!.A)], [plan([3.175, 6])]);
    expect(doneEntries(after, [])).toEqual([after[0].doneId]);
    // Nothing new: nothing to record.
    expect(cutsToRecord(after, [after[0].doneId], 9)).toBeNull();
    // The last program done: every program is.
    expect(cutsToRecord(after, [after[0].doneId, after[1].doneId], 9)).toEqual({ A: { at: 5, keys: [q[0].key, q[1].key], all: true } });
  });
});
