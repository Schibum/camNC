import { describe, expect, it } from 'vitest';
import type { CamPartInfo, PlanResult } from '../camTypes';
import type { QueueEntry } from './camMachine';
import { ghostParts, sidePath } from './partGhost';

const square = (x: number, y: number, w: number, h: number): [number, number][] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const part = {
  id: 'part-1',
  size: [100, 50, 18],
  shape: { outlines: [square(0, 0, 100, 50)], holes: [square(10, 10, 5, 5)], pockets: [{ depth: 5, region: [square(40, 20, 20, 10)] }] },
} as unknown as CamPartInfo;

const board = (rotated = false) => ({ h: 300, parts: [{ id: 'a', partId: 'part-1', name: 'Shelf', x: 20, y: 30, rotated }] }) as never;
const round = (l: [number, number][]) => l.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]);

describe('ghostParts', () => {
  it('places a part as nested, its hole inside its outline, with its pockets', () => {
    const [g] = ghostParts(board(), [part], 'a', 0);
    expect(g.name).toBe('Shelf');
    expect(g.shapes[0].outline[0]).toEqual([20, 30]);
    expect(g.shapes[0].outline[2]).toEqual([120, 80]);
    expect(g.shapes[0].holes).toHaveLength(1);
    expect(g.pockets[0][0]).toEqual([60, 50]);
  });

  it('lays a turned part across', () => {
    const [g] = ghostParts(board(true), [part], 'a', 0);
    // Part frame (0, 0) -> (x + part height, y).
    expect(g.shapes[0].outline[0]).toEqual([70, 30]);
    expect(g.shapes[0].outline[2]).toEqual([20, 130]);
  });

  it('turns side B over top to bottom, without the pockets that are now underneath', () => {
    const [g] = ghostParts(board(), [part], 'b', 0);
    expect(g.shapes[0].outline[0]).toEqual([20, 270]);
    expect(g.pockets).toEqual([]);
  });

  it('turns with the program about the XY zero', () => {
    const [g] = ghostParts(board(), [part], 'a', 90);
    expect(round(g.shapes[0].outline)[0]).toEqual([-30, 20]);
  });

  it('skips a part the model no longer has', () => {
    expect(ghostParts(board(), [], 'a', 0)).toEqual([]);
  });
});

describe('sidePath', () => {
  const a = { path: [[[0, 0, 0]]] } as unknown as PlanResult;
  const b = { path: [[[1, 1, 0]]] } as unknown as PlanResult;
  const entry = (e: Partial<QueueEntry>) => ({ board: { board: { id: 'B' } }, kind: 'bit', ...e }) as QueueEntry;

  it('is the side the entry is cut on', () => {
    expect(sidePath(entry({ plan: { ...a, sideB: b } }))).toBe(a.path);
    expect(sidePath(entry({ plan: b, sideB: true } as never))).toBe(b.path);
    expect(sidePath(entry({ kind: 'tabs', plan: { ...a, sideB: b }, release: { turned: true } } as never))).toBe(b.path);
    expect(sidePath(entry({ kind: 'tabs', plan: a, release: { turned: true } } as never))).toBeUndefined();
  });
});
