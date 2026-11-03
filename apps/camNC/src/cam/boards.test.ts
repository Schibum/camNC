import { describe, expect, it } from 'vitest';
import {
  autoFillFromStock,
  freezeSpacing,
  nestBoard,
  reconcileBoards,
  spacingProblem,
  stockTopOf,
  type BoardV1,
  type PartInstance,
} from './boards';
import { missingParts } from './useJobBoards';

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

  it('fitted boards keep a small edge margin (bit + 2) and gap (bit + 4), both editable', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
    const nest = nestBoard(a, parts, 3.175);
    expect(nest.margin).toBe(5.2);
    expect(nest.gap).toBe(8);
    const inside = (n: ReturnType<typeof nestBoard>, m: number) =>
      n.placements.every(p => {
        const [w, h] = parts.find(i => i.id === p.id)!.size;
        return p.x >= m - 1e-6 && p.y >= m - 1e-6 && p.x + w <= n.board.w - m + 1e-6 && p.y + h <= n.board.h - m + 1e-6;
      });
    expect(inside(nest, 5.2)).toBe(true);
    const wider = nestBoard({ ...a, margin: 15, gap: 12 }, parts, 3.175);
    expect(wider.margin).toBe(15);
    expect(inside(wider, 15)).toBe(true);
    // Not a strip: fitted boards stay within 2.5:1.
    for (const n of [nest, wider]) expect(Math.max(n.board.w, n.board.h) / Math.min(n.board.w, n.board.h)).toBeLessThanOrEqual(2.5);
  });

  it('stock top: parts thickness + 0.3 unless measured', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
    expect(stockTopOf(a)).toBe(8.3);
    expect(stockTopOf({ ...a, measuredThickness: 8.12 })).toBe(8.12);
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

  describe('changing the bit', () => {
    // Two 560 x 140 sides on a 600 x 300 stock board: they fit with the 1/8" bit's spacing, not with the 6 mm one's.
    const sides = parts.slice(0, 2);
    const stock: BoardV1 = { ...reconcileBoards(undefined, sides, 'oak')[0], size: { fit: false, w: 600, h: 300 } };
    const job = (board: BoardV1, bit: number) => {
      const nest = nestBoard(board, sides, bit);
      return [{ board, nest, request: {} as never }];
    };

    it('names the parts that no longer fit', () => {
      expect(missingParts(job(stock, 3.175), sides)).toEqual([]);
      expect(missingParts(job(stock, 6), sides)).toEqual([{ id: 'right', name: 'right', board: 'A' }]);
    });

    it('keeps the nest when the spacing is frozen at the old bit, and says when it gets too tight', () => {
      const [frozen] = freezeSpacing([stock], 3.175);
      expect([frozen.margin, frozen.gap]).toEqual([5.2, 8]);
      expect(missingParts(job(frozen, 6), sides)).toEqual([]);
      expect(spacingProblem(frozen, nestBoard(frozen, sides, 6), 6)).toBeNull();
      expect(spacingProblem(frozen, nestBoard(frozen, sides, 8), 8)).toMatch(/8 mm gap between parts is too narrow for the ⌀8 bit/);
      // Values the user set stay.
      expect(freezeSpacing([{ ...stock, gap: 12 }], 3.175)[0].gap).toBe(12);
    });
  });
});
