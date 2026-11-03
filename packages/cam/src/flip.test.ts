import { describe, expect, it } from 'vitest';
import { camBoard, type BoardSpec } from './board';
import { extractFeatures, type PartFeatures } from './features';
import { readStep } from './fixtures';
import { dowelSpots, sideBSpec } from './flip';
import { toGcode } from './gcode';
import { bounds2 } from './geom';
import { detectFlat, flipPart, loadStep } from './import';
import { checkGcodeSafety } from './safety';
import { freePartsProgram } from './tabPlan';
import { tabRemovalProgram } from './tabRemoval';
import { DEFAULT_TABS, type PartCam } from './toolpaths';

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

  describe('after side B, with the board turned over: freeing skin parts and tab removal', () => {
    // An L, not symmetric about anything, low on the board: a missing mirror can't go unnoticed.
    const L = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 60 },
      { x: 100, y: 60 },
      { x: 100, y: 30 },
      { x: 0, y: 30 },
    ];
    const shape = (loop: { x: number; y: number }[]): PartFeatures => ({ ...plain(200, 60), footprint: [loop], outlines: [loop] });
    // The L turned over about its X axis: what side B sees.
    const turnedL = shape(L.map(p => ({ x: p.x, y: 60 - p.y })).reverse());
    const spec = (holdDown: BoardSpec['holdDown'], registration: 'camera' | 'dowels' | 'fence'): BoardSpec => ({
      ...board({ holdDown, tabs: DEFAULT_TABS, stockTop: 8.3, skin: 1 }),
      parts: [{ id: 'l', name: 'l', features: shape(L), size: [200, 60, 8], x: 100, y: 20, rotated: false }],
      ...(registration === 'dowels' && {
        dowels: {
          at: [
            { x: 30, y: 30 },
            { x: 370, y: 30 },
          ],
          diameter: 6,
          depth: 6,
        },
      }),
    });
    /** Where side B would cut the outline (if it cut outlines): the L at its turned-over place. */
    const sideBPath = (s: BoardSpec) => {
      const b = camBoard(
        sideBSpec(s, () => turnedL),
        { tabs: false }
      );
      return b.operations.find(o => o.feature === 'outline')!.passes.at(-1)!.pts;
    };
    const onPath = (q: number[], path: number[][]) =>
      path.some((a, i) => {
        const b = path[(i + 1) % path.length];
        const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(a[0] + t * dx - q[0], a[1] + t * dy - q[1]) < 0.05;
      });
    const area = (pts: number[][]) =>
      pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2;
    const deepest = (cam: PartCam) => Math.min(...cam.operations.flatMap(o => o.passes.flatMap(p => p.pts.map(q => q[2]))));

    it.each(['camera', 'dowels', 'fence'] as const)(
      'frees skin parts along side B’s outline, from the new top through the skin only (%s)',
      registration => {
        const s = spec('skin', registration);
        const a = camBoard(s, {});
        const free = freePartsProgram(a, { feed: 900, plungeFeed: 480, finalZ: -0.3, turned: { h: s.h } });
        const cut = free.cam.operations[0].passes[0].pts;
        const path = sideBPath(s);
        expect(cut.every(q => onPath(q, path))).toBe(true);
        // The skin (1 mm, now on top of 8.3 mm) and 0.3 mm past it: never deeper.
        expect(cut.every(q => Math.abs(q[2] - (8.3 - 1 - 0.3)) < 1e-6)).toBe(true);
        // The same cutting direction as side A's outline: mirrored and reversed.
        const outlineA = a.operations.find(o => o.feature === 'outline')!.passes.at(-1)!.pts;
        expect(Math.sign(area(cut))).toBe(Math.sign(area(outlineA)));
        expect(free.parts[0].at.y).toBeCloseTo(200 - (20 + 30), 0);
        expect(
          checkGcodeSafety(toGcode(free.cam), { stockTop: 8.3, size: [400, 200], minZ: deepest(free.cam), toolRadius: 3.175 / 2 })
        ).toEqual([]);
        expect(deepest(free.cam)).toBeCloseTo(7);
      }
    );

    it.each(['camera', 'dowels', 'fence'] as const)(
      'cuts each tab along side B’s outline, from the new top through the tab only (%s)',
      registration => {
        const s = spec('tabs-guided', registration);
        const a = camBoard(s, {});
        const { cam, tabs } = tabRemovalProgram(a, { feed: 900, plungeFeed: 480, turned: { h: s.h } });
        expect(tabs.length).toBeGreaterThanOrEqual(3);
        const path = sideBPath(s);
        for (const op of cam.operations) {
          const run = op.passes[0].pts;
          expect(run.every(q => onPath(q, path))).toBe(true);
          // The 2 mm tab now hangs from the top: 8.3 - 2, and 0.3 past it.
          expect(run.every(q => Math.abs(q[2] - (8.3 - 2 - 0.3)) < 1e-6)).toBe(true);
        }
        for (const t of tabs) expect(onPath([t.at.x, t.at.y], path)).toBe(true);
      }
    );
  });
});
