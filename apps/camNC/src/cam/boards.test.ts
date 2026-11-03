import { describe, expect, it } from 'vitest';
import { autoFillFromStock, nestBoard, reconcileBoards, type PartInstance } from './boards';

const inst = (id: string, w: number, h: number, t: number): PartInstance => ({ id, partId: id, name: id, size: [w, h, t], thickness: t });
// The kinderregal bodies.
const parts = [
  inst('left', 560, 140, 8),
  inst('right', 560, 140, 8),
  inst('top', 400, 140, 8),
  inst('bottom', 400, 140, 8),
  inst('middle', 400, 136.5, 8),
  inst('back', 400, 380, 3),
];

describe('boards', () => {
  it('starts with one fitted board per thickness, thickest first', () => {
    const boards = reconcileBoards(undefined, parts, 'oak');
    expect(boards.map(b => [b.name, b.thickness, b.items.length])).toEqual([
      ['A', 8, 5],
      ['B', 3, 1],
    ]);
  });

  it('auto-fills stock boards, overflowing onto more boards, with unique names', () => {
    const boards = reconcileBoards(undefined, parts, 'oak');
    const res = autoFillFromStock(boards, parts, [{ id: 's', thickness: 8, w: 600, h: 400 }], 3.175, 'oak');
    expect(res.tooBig).toEqual([]);
    expect(res.boards.map(b => b.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(
      res.boards
        .filter(b => b.thickness === 8)
        .flatMap(b => b.items)
        .sort()
    ).toEqual(['bottom', 'left', 'middle', 'right', 'top']);
    for (const b of res.boards.filter(b => b.thickness === 8)) expect(nestBoard(b, parts, 3.175).unplaced).toEqual([]);
  });

  it('clamps only: parts stay clear of the clamp corners', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
    const nest = nestBoard({ ...a, holdDown: 'clamps' }, parts, 3.175);
    expect(nest.unplaced).toEqual([]);
    expect(nest.keepOuts).toHaveLength(2);
    const size = new Map(parts.map(p => [p.id, p.size]));
    for (const p of nest.placements)
      for (const k of nest.keepOuts) {
        const [w, h] = size.get(p.id)!;
        const apart = p.x + w <= k.x || k.x + k.w <= p.x || p.y + h <= k.y || k.y + k.h <= p.y;
        expect(apart).toBe(true);
      }
  });
});
