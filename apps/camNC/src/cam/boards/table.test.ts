import { describe, expect, it } from 'vitest';
import { bestColumns, fitScale, kTableGap, layoutTable, type TableBoard } from './table';

const board = (id: string, w: number, h: number, off: TableBoard['off'] = []): TableBoard => ({ id, w, h, off });
const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('layoutTable', () => {
  it('lines boards up in rows, each row under the tallest of the one before', () => {
    const t = layoutTable([board('a', 100, 300), board('b', 200, 100), board('c', 100, 100)], 2);
    expect(t.boards.get('a')).toEqual({ x: 0, y: 0 });
    expect(t.boards.get('b')).toEqual({ x: 100 + kTableGap, y: 0 });
    expect(t.boards.get('c')).toEqual({ x: 0, y: 300 + kTableGap });
  });

  it('a board growing moves only what is to its right and below', () => {
    const before = layoutTable([board('a', 100, 100), board('b', 100, 100)], 2);
    const after = layoutTable([board('a', 400, 100), board('b', 100, 100)], 2);
    expect(after.boards.get('a')).toEqual(before.boards.get('a'));
    expect(after.boards.get('b')!.x).toBe(before.boards.get('b')!.x + 300);
  });

  it('leaves a part where it was dropped', () => {
    const t = layoutTable([board('a', 100, 100, [{ id: 'p', w: 50, h: 50, at: { x: -300, y: 500 } }])], 1);
    expect(t.off.get('p')).toEqual({ x: -300, y: 500 });
    expect(t.bounds.x).toBe(-300);
  });

  it('moves a part aside when a board has grown over where it lay, without storing that', () => {
    const t = layoutTable([board('a', 800, 800, [{ id: 'p', w: 50, h: 50, at: { x: 100, y: 100 } }])], 1);
    const at = t.off.get('p')!;
    expect(overlap({ ...at, w: 50, h: 50 }, { x: 0, y: 0, w: 800, h: 800 })).toBe(false);
  });

  it('puts parts no one dropped on free spots under their board, none on another', () => {
    const off = ['p', 'q', 'r'].map(id => ({ id, w: 300, h: 420 }));
    const t = layoutTable([board('a', 780, 460, off), board('b', 460, 770)], 2);
    const rects = off.map(p => ({ ...t.off.get(p.id)!, w: p.w, h: p.h }));
    expect(rects[0].y).toBeGreaterThan(460);
    for (const [i, a] of rects.entries()) {
      for (const b of rects.slice(i + 1)) expect(overlap(a, b)).toBe(false);
      expect(overlap(a, { x: 0, y: 0, w: 780, h: 460 })).toBe(false);
      expect(overlap(a, { ...t.boards.get('b')!, w: 460, h: 770 })).toBe(false);
    }
  });
});

describe('bestColumns', () => {
  it('fits a wide area with a row, and a tall one with a column', () => {
    const boards = [board('a', 500, 500), board('b', 500, 500), board('c', 500, 500)];
    expect(bestColumns(boards, { w: 2000, h: 600 })).toBe(3);
    expect(bestColumns(boards, { w: 600, h: 2000 })).toBe(1);
  });
});

describe('fitScale', () => {
  it('fills the area by whichever side is tighter, leaving room for labels', () => {
    expect(fitScale({ w: 572, h: 2000 }, { w: 500, h: 100 })).toBeCloseTo(1, 5);
    expect(fitScale({ w: 2000, h: 588 }, { w: 100, h: 500 })).toBeCloseTo(1, 5);
  });
});
