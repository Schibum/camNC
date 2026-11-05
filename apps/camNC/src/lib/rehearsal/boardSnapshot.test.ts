import { describe, expect, it } from 'vitest';
import { boardRequest, nestBoard, newBoard, type PartInstance } from '@/cam/boards';
import { freezeRehearsalBoard } from './boardSnapshot';

const parts: PartInstance[] = [
  [220, 90],
  [110, 180],
  [180, 140],
  [140, 70],
  [95, 160],
  [90, 80],
].map(([w, h], i) => ({
  id: `part-${i}`,
  partId: `part-${i}`,
  name: `Part ${i}`,
  size: [w, h, 12],
  thickness: 12,
}));

describe('rehearsal board snapshot', () => {
  it('preserves the approved fitted layout when the copy is packed again on bootstrap', () => {
    const board = newBoard(
      [],
      12,
      'plywood',
      parts.map(p => p.id)
    );
    const nest = nestBoard(board, parts, 3.175);
    const before = structuredClone(board);
    const copied = freezeRehearsalBoard(board, nest);
    const restored = nestBoard(copied, parts, 3.175);
    expect(restored.board).toEqual(nest.board);
    expect(restored.unplaced).toEqual([]);
    expect(restored.placements).toEqual(nest.placements);
    expect(boardRequest(copied, restored, parts)).toEqual(boardRequest(board, nest, parts));
    expect(board).toEqual(before);
  });

  it('retains a manually rotated part and the automatic placements around it', () => {
    const board = {
      ...newBoard(
        [],
        12,
        'plywood',
        parts.map(p => p.id)
      ),
      layout: { w: 600, h: 600, at: { 'part-0': { x: 18, y: 18, rotated: true } } },
      pinned: ['part-0'],
    };
    const before = structuredClone(board);
    const nest = nestBoard(board, parts, 3.175);
    const copied = freezeRehearsalBoard(board, nest);
    const restored = nestBoard(copied, parts, 3.175);
    expect(restored.placements.find(p => p.id === 'part-0')?.rotated).toBe(true);
    expect(boardRequest(copied, restored, parts)).toEqual(boardRequest(board, nest, parts));
    copied.layout!.at['part-0'].x += 1;
    expect(board).toEqual(before);
  });

  it('keeps the fixtures placed on the board', () => {
    const board = {
      ...newBoard(
        [],
        12,
        'plywood',
        parts.map(p => p.id)
      ),
      fixtures: [{ kind: 'clamp' as const, side: 'right' as const, at: 100 }],
    };
    const nest = nestBoard(board, parts, 3.175);
    const copied = freezeRehearsalBoard(board, nest);
    expect(copied.fixtures).toEqual(board.fixtures);
    expect(boardRequest(copied, nestBoard(copied, parts, 3.175), parts).holdPoints).toEqual(nest.holds);
  });

  it('retains the existing fixed-board packing behavior', () => {
    const board = {
      ...newBoard(
        [],
        12,
        'plywood',
        parts.map(p => p.id)
      ),
      size: { fit: false as const, w: 700, h: 500 },
    };
    const nest = nestBoard(board, parts, 3.175);
    const copied = freezeRehearsalBoard(board, nest);
    expect(copied).toEqual(board);
    expect(boardRequest(copied, nestBoard(copied, parts, 3.175), parts)).toEqual(boardRequest(board, nest, parts));
  });
});
