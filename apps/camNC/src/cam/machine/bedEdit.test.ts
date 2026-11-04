import type { HoldPoint } from '@wbcnc/cam/holdPoints';
import { describe, expect, it } from 'vitest';
import { addHold, bedToBoard, boardToBed, hitsPath, moveHold, onBoard, placeBoard, placeHold, removeHold } from './bedEdit';

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
