import { describe, expect, it } from 'vitest';
import { camBoard, type BoardSpec } from './board';
import { extractFeatures, type PartFeatures } from './features';
import { readStep } from './fixtures';
import { dowelSpots, sideBSpec } from './flip';
import { toGcode } from './gcode';
import { bounds2 } from './geom';
import { detectFlat, flipPart, loadStep } from './import';
import { checkGcodeSafety } from './safety';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const plain = (w: number, h: number): PartFeatures => {
  const outline = rect(0, 0, w, h);
  return {
    thickness: 8,
    footprint: [outline],
    outlines: [outline],
    throughHoles: [],
    levels: [],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
};
const board = (over: Partial<BoardSpec> = {}): BoardSpec => ({
  id: 'a',
  name: 'A',
  w: 400,
  h: 200,
  thickness: 8,
  holdDown: 'tabs',
  parts: [
    { id: 'p', name: 'p', features: plain(200, 60), size: [200, 60, 8], x: 100, y: 20, rotated: false },
    { id: 'q', name: 'q', features: plain(200, 60), size: [200, 60, 8], x: 100, y: 120, rotated: false },
  ],
  ...over,
});

describe('flip setups', () => {
  it('turns a part over about its X or its Y axis: the same underside, half a turn apart', async () => {
    const vert1 = (await loadStep(readStep('besteckkasten'))).bodies.map(detectFlat).find(p => p.name === 'vert1')!;
    const [X, Y] = vert1.size;
    const pocket = (axis: 'x' | 'y') =>
      bounds2(extractFeatures(flipPart(vert1, axis).mesh, vert1.thickness).pockets.flatMap(p => p.strictRegion));
    const [a, b] = [pocket('x'), pocket('y')];
    expect(b.minX).toBeCloseTo(X - a.maxX, 1);
    expect(b.maxX).toBeCloseTo(X - a.minX, 1);
    expect(b.minY).toBeCloseTo(Y - a.maxY, 1);
    expect(b.maxY).toBeCloseTo(Y - a.minY, 1);
  }, 60_000);

  it('side B: every part where it lies once the board is turned over top to bottom', () => {
    const b = sideBSpec(board(), () => plain(200, 60));
    expect(b.parts.map(p => [p.x, p.y])).toEqual([
      [100, 120],
      [100, 20],
    ]);
  });

  it('dowel pins: two spots far apart whose mirrors are free too, none when the board is full', () => {
    const spots = dowelSpots(board(), 6, 3)!;
    expect(spots).toHaveLength(2);
    expect(Math.abs(spots[1].x - spots[0].x)).toBeGreaterThan(400 / 3);
    const full = board({ parts: [{ id: 'p', name: 'p', features: plain(390, 190), size: [390, 190, 8], x: 5, y: 5, rotated: false }] });
    expect(dowelSpots(full, 6, 3)).toBeUndefined();
  });

  it('side A on dowels drills the pin holes and their mirrors first, into the spoilboard', () => {
    const spec = board();
    const at = dowelSpots(spec, 6, 3)!;
    const cam = camBoard({ ...spec, dowels: { at, diameter: 6, depth: 6 } }, {});
    const pins = cam.operations.filter(o => o.name.startsWith('Dowel pin hole'));
    // Two spots off the middle line, each with its mirror.
    expect(pins).toHaveLength(
      at.filter(p => Math.abs(spec.h - 2 * p.y) > 1e-6).length * 2 + at.filter(p => Math.abs(spec.h - 2 * p.y) <= 1e-6).length
    );
    expect(cam.operations.slice(0, pins.length)).toEqual(pins);
    expect(Math.min(...pins.flatMap(o => o.passes.flatMap(p => p.pts.map(q => q[2]))))).toBeCloseTo(-6);
    expect(checkGcodeSafety(toGcode(cam), { stockTop: 8, size: [400, 200], minZ: -6, toolRadius: 3.175 / 2 })).toEqual([]);
  });
});
