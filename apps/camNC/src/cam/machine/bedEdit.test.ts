import type { HoldPoint } from '@wbcnc/cam/holdPoints';
import { describe, expect, it } from 'vitest';
import { newBoard, nestBoard, type BoardV1, type PartInstance } from '../boards';
import {
  addHold,
  pickAt,
  turnAboutMiddle,
  lockAxis,
  nearestAxis,
  nudgeStep,
  bedToBoard,
  boardToBed,
  hitsPath,
  moveHold,
  movePart,
  onBoard,
  placeBoard,
  placeHold,
  removeHold,
  snapAngle,
  turnBoard,
} from './bedEdit';

const board = { w: 600, h: 400 };
const clamp = (x: number, y: number): HoldPoint => ({ x, y, kind: 'clamp', d: 2, w: 20, height: 30, dir: { x: 0, y: 1 } });
const screw = (x: number, y: number): HoldPoint => ({ x, y, kind: 'screw', d: 10, height: 3 });

describe('bed edit', () => {
  it('maps between the bed and a turned board and back', () => {
    const at = { x: 312, y: 188 };
    const p = { x: 100, y: 50 };
    const bed = boardToBed(p, at, -2);
    const back = bedToBoard(bed, at, -2);
    expect(back.x).toBeCloseTo(100, 6);
    expect(back.y).toBeCloseTo(50, 6);
    // Not turned: just shifted.
    expect(boardToBed(p, at, 0)).toEqual({ x: 412, y: 238 });
  });

  it('a clamp dropped near an edge grips that edge; a screw stays where it is dropped', () => {
    expect(placeHold(clamp(0, 0), { x: 300, y: 12 }, board)).toMatchObject({ x: 300, y: 1, dir: { x: 0, y: 1 } });
    expect(placeHold(clamp(0, 0), { x: 590, y: 200 }, board)).toMatchObject({ x: 599, y: 200, dir: { x: -1, y: 0 } });
    expect(placeHold(screw(0, 0), { x: 120, y: 80 }, board)).toMatchObject({ x: 120, y: 80 });
  });

  it('moving, adding and removing save all of the board’s holds, on the size they were placed on', () => {
    const holds = [clamp(100, 1), clamp(500, 1)];
    const moved = moveHold(holds, 1, { x: 450, y: 20 }, board, 'A');
    expect(moved).toEqual({
      boardId: 'A',
      what: 'Clamp 2 moved',
      patch: {
        holdPoints: [
          { x: 100, y: 1 },
          { x: 450, y: 1 },
        ],
        holdPointsOn: board,
      },
    });
    const added = addHold(holds, holds[0], { x: 300, y: 395 }, board, 'A');
    expect(added.what).toBe('Clamp 3 added');
    expect(added.patch.holdPoints).toEqual([
      { x: 100, y: 1 },
      { x: 500, y: 1 },
      { x: 300, y: 399 },
    ]);
    const removed = removeHold(holds, 0, board, 'A');
    expect(removed).toMatchObject({ what: 'Clamp 1 removed', patch: { holdPoints: [{ x: 500, y: 1 }] } });
    expect(removeHold([screw(10, 10)], 0, board, 'A').patch.holdPoints).toEqual([]);
  });

  it('counts a spot just past the edge as on the board, for a clamp gripping it', () => {
    expect(onBoard({ x: -10, y: 50 }, board, 40)).toBe(true);
    expect(onBoard({ x: -50, y: 50 }, board, 40)).toBe(false);
  });

  it('saves the board’s spot for one side and keeps the other', () => {
    const b = { id: 'A', bed: { b: { x: 1, y: 2 } } };
    expect(placeBoard(b, 'a', { x: 312.04, y: 188.26 })).toEqual({
      boardId: 'A',
      what: 'Board placed',
      patch: { bed: { b: { x: 1, y: 2 }, a: { x: 312, y: 188.3 } } },
    });
  });

  it('tells at once whether the bit would hit a dragged hold, on a turned board too', () => {
    // A cut along y = 10, 5 mm deep into 20 mm stock, with a ⌀6 bit.
    const path: [number, number, number][][] = [
      [
        [0, 10, 15],
        [600, 10, 15],
      ],
    ];
    expect(hitsPath(clamp(300, 1), 0, path, 6, 20)).toBe(true);
    expect(hitsPath(clamp(300, 399), 0, path, 6, 20)).toBe(false);
    // Turned a quarter: the path lies along x = -10 then.
    const turned: [number, number, number][][] = [
      [
        [-10, 0, 15],
        [-10, 600, 15],
      ],
    ];
    expect(hitsPath(clamp(300, 1), 90, turned, 6, 20)).toBe(true);
    expect(hitsPath(clamp(300, 1), 0, undefined, 6, 20)).toBe(false);
  });
});

describe('the whole bed', () => {
  const part = (id: string, w: number, h: number): PartInstance => ({ id, partId: id, name: id, size: [w, h, 18], thickness: 18 });
  const instances = [part('p1', 100, 100), part('p2', 100, 100)];
  const fitBoard = (): BoardV1 => ({ ...newBoard([], 18, 'oak', ['p1', 'p2']), boardHold: 'tape' });

  it('turning snaps onto quarter turns and keeps the spot', () => {
    expect(snapAngle(1.2)).toBe(0);
    expect(snapAngle(3.14)).toBe(3.1);
    expect(snapAngle(91)).toBe(90);
    expect(snapAngle(-181)).toBe(180);
    expect(snapAngle(-185)).toBe(175);
    const b = { id: 'A', bed: { a: { x: 1, y: 2, deg: 1 } } };
    expect(turnBoard(b, 'a', 4, { x: 5.04, y: 6 }).patch).toEqual({ bed: { a: { x: 5, y: 6, deg: 4 } } });
    // Moving the board keeps its angle.
    expect(placeBoard(b, 'a', { x: 9, y: 9 }).patch).toEqual({ bed: { a: { x: 9, y: 9, deg: 1 } } });
  });

  it('a part dragged to a free spot stays exactly there; the board keeps its size and the other part stays put', () => {
    const b = fitBoard();
    const nest = nestBoard(b, instances, 6);
    const other = nest.placements.find(p => p.id === 'p2')!;
    const free = { x: nest.board.w - nest.margin - 100, y: nest.board.h - nest.margin - 100, rotated: false };
    // Somewhere the other part isn't.
    const edit = movePart(b, nest, instances, 6, 'p1', free)!;
    if (edit.exact) {
      expect(edit.patch.positions!.p1).toEqual(free);
      expect(edit.patch.positions!.p2).toEqual({ x: other.x, y: other.y, rotated: other.rotated });
    }
    expect(edit.patch.size).toEqual({ fit: false, w: nest.board.w, h: nest.board.h });
    const after = nestBoard({ ...b, ...edit.patch }, instances, 6);
    expect(after.unplaced).toEqual([]);
    expect(after.board).toEqual(nest.board);
  });

  it('a part dropped on the other one goes to a free spot, or nowhere when there is none', () => {
    const b = fitBoard();
    const nest = nestBoard(b, instances, 6);
    const other = nest.placements.find(p => p.id === 'p2')!;
    const edit = movePart(b, nest, instances, 6, 'p1', { x: other.x, y: other.y, rotated: false });
    // A board fitted to two parts has no other free spot than the one p1 had.
    if (edit) {
      expect(edit.exact).toBe(false);
      expect(nestBoard({ ...b, ...edit.patch }, instances, 6).unplaced).toEqual([]);
    }
  });
});

describe('fine moves', () => {
  it('Shift locks a drag to the axis moved along first, until it is let go', () => {
    expect(lockAxis({ x: 1, y: 1 }, true, null)).toEqual({ d: { x: 0, y: 0 }, axis: null });
    expect(lockAxis({ x: 5, y: 2 }, true, null)).toEqual({ d: { x: 5, y: 0 }, axis: 'x' });
    // Locked: stays on X even when the pointer drifts more along Y.
    expect(lockAxis({ x: 5, y: 20 }, true, 'x')).toEqual({ d: { x: 5, y: 0 }, axis: 'x' });
    expect(lockAxis({ x: 5, y: 20 }, false, 'x')).toEqual({ d: { x: 5, y: 20 }, axis: null });
  });

  it('an arrow key moves along the machine axis that points its way on screen', () => {
    // Machine X points up on screen, Y points left (a turned camera).
    const screen = { x: { x: 0, y: -1 }, y: { x: -1, y: 0 } };
    expect(nearestAxis(screen, { x: 0, y: -1 })).toEqual({ x: 1, y: 0 });
    expect(nearestAxis(screen, { x: 1, y: 0 })).toEqual({ x: 0, y: -1 });
    expect(nudgeStep({ shiftKey: false, altKey: false })).toBe(1);
    expect(nudgeStep({ shiftKey: true, altKey: false })).toBe(10);
    expect(nudgeStep({ shiftKey: false, altKey: true })).toBe(0.1);
  });
});

describe('turning about the middle', () => {
  it('keeps the board’s middle where it is', () => {
    const size = { w: 200, h: 100 };
    const at = turnAboutMiddle({ x: 50, y: 60 }, size, 0, 90);
    const mid = boardToBed({ x: 100, y: 50 }, at, 90);
    expect(mid.x).toBeCloseTo(150, 6);
    expect(mid.y).toBeCloseTo(110, 6);
  });
});

describe('a tap on the board', () => {
  it('selects the hold within reach, else the part under it, else nothing (the board)', () => {
    const holds = [screw(10, 10), screw(100, 10)];
    const parts = [{ id: 'p1', x: 30, y: 30, w: 50, h: 50 }];
    expect(pickAt({ x: 12, y: 14 }, holds, parts)).toEqual({ kind: 'hold', i: 0 });
    expect(pickAt({ x: 98, y: 8 }, holds, parts)).toEqual({ kind: 'hold', i: 1 });
    expect(pickAt({ x: 50, y: 50 }, holds, parts)).toEqual({ kind: 'part', id: 'p1' });
    expect(pickAt({ x: 200, y: 200 }, holds, parts)).toBeNull();
  });
});
