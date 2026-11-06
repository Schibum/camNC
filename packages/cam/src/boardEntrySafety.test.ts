import { describe, expect, it } from 'vitest';
import { circle, rectangle } from '../test/machining-fixtures';
import { camBoard, partToBoard, type BoardPart, type BoardSpec } from './board';
import { tangentEntryClashes } from './boardEntrySafety';
import { camPart } from './toolpaths';
import type { PartFeatures } from './features';
import { clipLines, offset, pathLength, union } from './geom';

const features = (): PartFeatures => ({
  thickness: 12,
  footprint: [rectangle(0, 0, 20, 60)],
  outlines: [rectangle(0, 0, 20, 60)],
  throughHoles: [],
  levels: [],
  pockets: [],
  bottomFaces: [],
  slopedArea: 0,
});
const board = (rotated = false, gap = 4): BoardSpec => ({
  id: 'board',
  name: 'board',
  w: 120,
  h: 120,
  thickness: 12,
  holdDown: 'fixture-tape',
  rotationDeg: 17,
  parts: [0, 1, 2].map(
    (i): BoardPart => ({
      id: String(i),
      name: `part ${i}`,
      features: features(),
      size: [20, 60, 12],
      x: rotated ? 20 : 16 + i * (20 + gap),
      y: rotated ? 16 + i * (20 + gap) : 20,
      rotated,
    })
  ),
});
const options = { profileEntry: 'tangent' as const, maxStepdown: 3 };

describe('nested profile entry keepouts', () => {
  it.each([false, true])('reproduces the isolated tangent lead collision and falls back on the board (rotated=%s)', rotated => {
    const spec = board(rotated),
      part = spec.parts[1];
    const neighbors = spec.parts
      .filter(p => p.id !== part.id)
      .flatMap(p =>
        p.features.footprint.map(loop =>
          loop.map(q => {
            const [x, y] = partToBoard(p, [q.x, q.y, 0]);
            return { x, y };
          })
        )
      );
    const isolated = camPart(part.features, { ...options, outlineFloor: 0.5 });
    expect(tangentEntryClashes(isolated, neighbors, q => partToBoard(part, q))).toBe(true);
    const result = camBoard(spec, options);
    const center = result.operations.filter(op => op.name.startsWith('part 1:'));
    expect(center.length).toBeGreaterThan(0);
    expect(center.some(op => op.passes.some(p => p.entry === 'tangent'))).toBe(false);
    expect(result.warnings).toContain('part 1: Tangent profile lead intersects a neighboring part; using contour ramps');
    // The fallback contours also clear the neighbor geometry with their whole cutter radius.
    const keepout = offset(union(neighbors), 3.175 / 2 - 0.001);
    const unturn = (x: number, y: number) => {
      const angle = (-17 * Math.PI) / 180;
      return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) };
    };
    for (const op of center)
      for (const pass of op.passes)
        for (let i = 1; i < pass.pts.length; i++) {
          const a = pass.pts[i - 1],
            b = pass.pts[i];
          expect(
            clipLines([[unturn(a[0], a[1]), unturn(b[0], b[1])]], keepout).reduce((sum, line) => sum + pathLength(line, false), 0)
          ).toBeLessThan(1e-6);
        }
  });

  it('retains tangent entry when the neighboring keepout leaves enough room', () => {
    const result = camBoard(board(false, 12), options);
    expect(result.operations.some(op => op.passes.some(p => p.entry === 'tangent'))).toBe(true);
    expect(result.warnings.some(w => w.includes('neighboring part'))).toBe(false);
  });

  it('protects a second part nested inside a through hole, including the hole lead-in', () => {
    const hole = circle(50, 35, 16);
    const frame: PartFeatures = {
      thickness: 12,
      footprint: [rectangle(0, 0, 100, 70), [...hole].reverse()],
      outlines: [rectangle(0, 0, 100, 70)],
      throughHoles: [hole],
      levels: [],
      pockets: [],
      bottomFaces: [],
      slopedArea: 0,
    };
    const disc = circle(11.5, 11.5, 11.5);
    const round: PartFeatures = {
      thickness: 12,
      footprint: [disc],
      outlines: [disc],
      throughHoles: [],
      levels: [],
      pockets: [],
      bottomFaces: [],
      slopedArea: 0,
    };
    const spec: BoardSpec = {
      id: 'nested',
      name: 'nested',
      w: 140,
      h: 110,
      thickness: 12,
      holdDown: 'fixture-tape',
      parts: [
        { id: 'frame', name: 'frame', features: frame, size: [100, 70, 12], x: 20, y: 20, rotated: false },
        { id: 'disc', name: 'disc', features: round, size: [23, 23, 12], x: 58.5, y: 43.5, rotated: false },
      ],
    };
    const isolated = camPart(frame, { ...options, outlineFloor: 0.5 });
    const keepout = [circle(70, 55, 11.5)];
    expect(
      tangentEntryClashes({ ...isolated, operations: isolated.operations.filter(op => op.feature === 'hole') }, keepout, q =>
        partToBoard(spec.parts[0], q)
      )
    ).toBe(true);
    const result = camBoard(spec, options);
    const holeOperation = result.operations.find(op => op.name.startsWith('frame:') && op.feature === 'hole')!;
    expect(holeOperation.passes.some(p => p.entry === 'tangent')).toBe(false);
    expect(result.warnings).toContain('frame: Tangent profile lead intersects a neighboring part; using contour ramps');
  });
});
