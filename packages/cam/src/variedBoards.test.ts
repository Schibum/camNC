import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractFeatures } from './features';
import { fixturePath, readStep } from './fixtures';
import { detectFlat, loadStep } from './import';

type Loop = [number, number][];
interface Board {
  id: string;
  thickness: number;
  parts: { name: string; outer: Loop; holes: Loop[] }[];
}

const boards: Board[] = JSON.parse(readFileSync(fixturePath('varied-boards/boards.json'), 'utf8'));

const area = (loop: { x: number; y: number }[]) =>
  Math.abs(loop.reduce((s, p, i) => s + p.x * loop[(i + 1) % loop.length].y - loop[(i + 1) % loop.length].x * p.y, 0) / 2);
const points = (loop: Loop) => loop.map(([x, y]) => ({ x, y }));

describe('varied STEP boards', () => {
  it('are what generate.mjs writes', () => {
    expect(boards).toHaveLength(40);
    execFileSync(process.execPath, [fixturePath('varied-boards/generate.mjs'), '--check']);
  });

  it.each(boards.map(b => [b.id, b] as const))('%s imports as its parts', async (_, board) => {
    const { bodies } = await loadStep(readStep(`varied-boards/${board.id}`));
    expect(bodies.map(b => b.name)).toEqual(board.parts.map(p => p.name));
    bodies.forEach((body, i) => {
      const part = board.parts[i];
      const flat = detectFlat(body);
      expect(flat.thickness, part.name).toBeCloseTo(board.thickness, 3);
      expect(flat.slopedShare, part.name).toBe(0);
      const features = extractFeatures(flat.mesh, flat.thickness);
      expect(features.outlines, part.name).toHaveLength(1);
      expect(features.outlines[0].length, part.name).toBeGreaterThanOrEqual(3);
      expect(features.throughHoles, part.name).toHaveLength(part.holes.length);
      expect(features.pockets, part.name).toEqual([]);
      const netArea = (outer: number, holes: number[]) => holes.reduce((s, h) => s - h, outer);
      const expected = netArea(
        area(points(part.outer)),
        part.holes.map(h => area(points(h)))
      );
      const got = netArea(area(features.outlines[0]), features.throughHoles.map(area));
      expect(Math.abs(got - expected) / expected, part.name).toBeLessThan(0.001);
    });
  });
});
