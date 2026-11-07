import { describe, expect, it } from 'vitest';
import { boardRequest, nestBoard, newBoard, type PartInstance } from './boards';
import { layoutBlock } from './boardBlock';

const part: PartInstance = { id: 'part#0', partId: 'part', name: 'Panel', size: [180, 100, 12], thickness: 12 };
const board = () => ({
  ...newBoard([], 12, 'plywood', [part.id]),
  size: { fit: false as const, w: 220, h: 140 },
  margin: 10,
  gap: 10,
  pinned: [part.id],
  layout: { w: 220, h: 140, at: { [part.id]: { x: 12, y: 12, rotated: false } } },
});

describe('native board execution boundaries', () => {
  it('keeps an invalid saved placement visible but excludes it from every execution request', () => {
    const saved = board(),
      enlarged = { ...part, size: [500, 100, 12] as [number, number, number] };
    const nest = nestBoard(saved, [enlarged], 3.175, { preserveLayout: true });
    expect(nest.placements).toContainEqual({ id: part.id, x: 12, y: 12, rotated: false });
    expect(nest.unplaced).toContain(part.id);
    expect(boardRequest(saved, nest, [enlarged]).parts).toEqual([]);
  });

  it.each([true, false])('blocks existing oversized stock with fit=%s even when each saved part fits', fit => {
    const saved = {
      ...board(),
      size: fit ? { fit: true as const } : { fit: false as const, w: 1000, h: 800 },
      layout: { ...board().layout, w: 1000, h: 800 },
    };
    const nest = nestBoard(saved, [part], 3.175, { preserveLayout: true, machine: { w: 600, h: 400 } });
    expect(nest.board).toEqual({ w: 1000, h: 800 });
    expect(nest.unplaced).toEqual([]);
    expect(layoutBlock({ board: saved, nest }, { bit: 3.175, missing: [] })).toMatch(/larger than.*machine|machine.*work area/i);
    expect(boardRequest(saved, nest, [part]).parts).toEqual([]);
  });

  it('keeps an explicit exclusion in force after repair until the user includes it again', () => {
    const saved = board(),
      nest = nestBoard(saved, [part], 3.175, { preserveLayout: true });
    expect(nest.unplaced).toEqual([]);
    expect(boardRequest(saved, nest, [part], { leaveOut: [part.id] }).parts).toEqual([]);
    expect(boardRequest(saved, nest, [part], { leaveOut: [] }).parts.map(part => part.id)).toEqual([part.id]);
    expect(nest.placements).toHaveLength(1);
  });
});
