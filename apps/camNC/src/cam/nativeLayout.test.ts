import { describe, expect, it } from 'vitest';
import { nestBoard, newBoard, reconcileBoards, withLayout, type PartInstance } from './boards';

const instance = (id: string, w: number, h: number, thickness = 12): PartInstance => ({
  id,
  partId: id,
  name: id,
  size: [w, h, thickness],
  thickness,
});

describe('layouts after native CAD edits', () => {
  it('keeps overlapping and enlarged parts at their existing spots and reports a repair instead of re-packing', () => {
    const before = [instance('left', 50, 40), instance('right', 50, 40)];
    const board = {
      ...newBoard([], 12, 'plywood', ['left', 'right']),
      size: { fit: false as const, w: 160, h: 100 },
      layout: { w: 160, h: 100, at: { left: { x: 10, y: 10, rotated: false }, right: { x: 80, y: 10, rotated: false } } },
      gap: 10,
      margin: 5,
    };
    expect(nestBoard(board, before, 3, { preserveLayout: true }).unplaced).toEqual([]);
    const after = [instance('left', 100, 40), instance('right', 100, 40)];
    const nest = nestBoard(board, after, 3, { preserveLayout: true });
    expect(nest.placements.map(p => ({ id: p.id, x: p.x, y: p.y }))).toEqual([
      { id: 'left', x: 10, y: 10 },
      { id: 'right', x: 80, y: 10 },
    ]);
    expect(nest.unplaced).toContain('right');
    expect(withLayout(board, nest).layout).toEqual(board.layout);
  });

  it('retains deleted part and changed-thickness references for explicit repair', () => {
    const board = {
      ...newBoard([], 12, 'plywood', ['gone', 'thicker']),
      layout: { w: 160, h: 100, at: { gone: { x: 10, y: 10, rotated: false }, thicker: { x: 80, y: 10, rotated: false } } },
    };
    const parts = [instance('thicker', 40, 40, 18)];
    const reconciled = reconcileBoards([board], parts, 'plywood', { preserveReferences: true });
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].items).toEqual(['gone', 'thicker']);
    expect(reconciled[0].layout).toEqual(board.layout);
    const nest = nestBoard(reconciled[0], parts, 3, { preserveLayout: true });
    expect(nest.unplaced).toEqual(expect.arrayContaining(['gone', 'thicker']));
  });
});
