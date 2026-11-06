import { describe, expect, it } from 'vitest';
import { readGcode } from './analyze';
import { profileEntryRegion, tangentLoopPass } from './entry';
import { limitRemovalRate } from './engagement';
import { toGcode } from './gcode';
import type { PathD, Vec3 } from './geom';
import { applyFeedPolicy, type MotionPath } from './motion';
import { quantizedArcIsSafe } from './postValidation';
import { StockModel } from './stock';
import { applyTabMotion, repeatTabIntervals } from './tabMotion';
import { estimateProgramTime, LOWRIDER_V4_REFERENCE_PROFILE } from './timing';
import type { PartCam, Pass } from './toolpaths';

const path = (points: Vec3[]): MotionPath => ({ pts: points, feeds: points.map(() => 1000), link: 'retract' });
const rect = (x0: number, y0: number, x1: number, y1: number): PathD => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const policy = {
  plungeFeed: 300,
  rampFeed: 420,
  leadFeed: 700,
  materialSide: 'right' as const,
  cornerFeed: { factor: 0.5, minAngleDeg: 30, maxRadius: 0.5, distance: 2 },
};

describe('machining output invariants', () => {
  it('does not retract between consecutive passes whose shared endpoint requires no linking motion', () => {
    const cam: PartCam = {
      stockTop: 10,
      warnings: [],
      operations: [
        {
          name: 'Continuous entry and wall',
          kind: 'pocket',
          feature: 'pocket',
          tool: { number: 1, diameter: 4 },
          passes: [
            {
              pts: [
                [0, 0, 5],
                [10, 0, 5],
              ],
              feeds: [300, 1000],
              link: 'retract',
            },
            {
              pts: [
                [10, 0, 5],
                [10, 10, 5],
              ],
              feeds: [1000, 1000],
              link: 'direct',
            },
          ],
        },
      ],
    };
    const afterMarker = toGcode(cam).split('(PASS 2/2 Z5)\n')[1];
    expect(afterMarker).toBeDefined();
    expect(afterMarker.trimStart().split('\n')[0]).not.toMatch(/^G0\b/);
  });

  it('does not credit a long link that the emitted program retracts over', () => {
    const stock = new StockModel({ stockTop: 10 });
    const passes: Pass[] = [
      {
        pts: [
          [0, 0, 5],
          [5, 0, 5],
        ],
        feeds: [300, 1000],
        link: 'retract',
      },
      {
        pts: [
          [30, 0, 5],
          [35, 0, 5],
        ],
        feeds: [300, 1000],
        link: 'direct',
        clearLink: false,
      },
    ];
    const tool = { number: 1, diameter: 4 };
    const rated = limitRemovalRate(passes, tool, stock, { maxPlanarRemovalRate: 1e9, minimumFeed: 1 });
    const cam: PartCam = {
      stockTop: 10,
      warnings: [],
      operations: [{ name: 'Two regions', kind: 'pocket', feature: 'pocket', tool, passes: rated.passes }],
    };
    const moves = readGcode(toGcode(cam));
    expect(moves.some(move => move.rapid && move.from[0] <= 10 && move.to[0] >= 30)).toBe(true);
    expect(stock.certifyLink([15, 0, 5], [20, 0, 5], 2).clear).toBe(false);
  });

  it('applies a combined 3D fitting budget rather than a separate full budget per component', () => {
    const source = Array.from({ length: 91 }, (_, index) => {
      const angle = (index * Math.PI) / 180;
      const radius = index === 45 ? 1.008 : 1;
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: index === 45 ? 0.008 : 0 };
    });
    expect(Math.hypot(0.008, 0.008)).toBeGreaterThan(0.01);
    expect(quantizedArcIsSafe(source[0], source, { c: { x: 0, y: 0 }, cw: false }, 0.01)).toBe(false);
  });

  it('keeps accepted quantized off-radius helices within the 3D source-polyline envelope', () => {
    let seed = 84371,
      accepted = 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const distance = (p: Vec3, a: Vec3, b: Vec3) => {
      const direction = b.map((value, axis) => value - a[axis]);
      const length2 = direction.reduce((sum, value) => sum + value * value, 0);
      const t = length2
        ? Math.max(0, Math.min(1, direction.reduce((sum, value, axis) => sum + (p[axis] - a[axis]) * value, 0) / length2))
        : 0;
      return Math.hypot(...p.map((value, axis) => value - a[axis] - t * direction[axis]));
    };
    for (let trial = 0; trial < 32; trial++) {
      const count = [7, 10, 20, 40][trial % 4];
      const source = Array.from({ length: count + 1 }, (_, index) => {
        const angle = (index * Math.PI) / (2 * count);
        const radius = index && index < count ? 1 + (random() - 0.5) * 0.006 : 1;
        return {
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle),
          z: 2 - angle * 0.3 + (index && index < count ? (random() - 0.5) * 0.006 : 0),
        };
      });
      if (!quantizedArcIsSafe(source[0], source, { c: { x: 0, y: 0 }, cw: false }, 0.01)) continue;
      accepted++;
      const first = source[0],
        last = source.at(-1)!;
      for (let index = 0; index <= 500; index++) {
        const t = index / 500,
          angle = (t * Math.PI) / 2;
        const point: Vec3 = [Math.cos(angle), Math.sin(angle), +first.z.toFixed(3) + (+last.z.toFixed(3) - +first.z.toFixed(3)) * t];
        const closest = Math.min(
          ...source.slice(1).map((b, i) => distance(point, [source[i].x, source[i].y, source[i].z], [b.x, b.y, b.z]))
        );
        expect(closest).toBeLessThanOrEqual(0.01 + 1e-10);
      }
    }
    expect(accepted).toBeGreaterThan(8);
  });

  it('schedules the same physical corner when path direction and material side are reversed', () => {
    const points: Vec3[] = [
      [0, 0, 2],
      [20, 0, 2],
      [20, 20, 2],
    ];
    const forward = applyFeedPolicy(path(points), policy);
    const reversed = applyFeedPolicy(path([...points].reverse()), { ...policy, materialSide: 'left' });
    const reducedEdges = (pass: MotionPath) =>
      pass.pts
        .slice(1)
        .flatMap((point, index) => (pass.feeds[index + 1] === 500 ? [[pass.pts[index].join(','), point.join(',')].sort().join('|')] : []))
        .sort();
    expect(reducedEdges(forward)).toEqual(reducedEdges(reversed));
  });

  it('keeps corner feeds and inserted vertices invariant under rigid placement transforms', () => {
    const points: Vec3[] = [
      [0, 0, 2],
      [20, 0, 2],
      [20, 20, 2],
      [40, 20, 2],
    ];
    const turn = ([x, y, z]: Vec3): Vec3 => [73 - y, -19 + x, z];
    const baseline = applyFeedPolicy(path(points), policy);
    const placed = applyFeedPolicy(path(points.map(turn)), policy);
    expect(placed.pts).toEqual(baseline.pts.map(turn));
    expect(placed.feeds).toEqual(baseline.feeds);
    expect(placed.roles).toEqual(baseline.roles);
  });

  it('keeps posted tangent leads inside a rectangular cutter-center region for either winding', () => {
    const shape = rect(0, 0, 40, 30);
    const free = profileEntryRegion(shape, 1.5, 1.5, true);
    for (const loop of [rect(1.5, 1.5, 38.5, 28.5), [...rect(1.5, 1.5, 38.5, 28.5)].reverse()]) {
      const pass = tangentLoopPass(loop, 2, 1000, 1.5, free)!;
      expect(pass).toBeDefined();
      const code = toGcode({
        stockTop: 8,
        warnings: [],
        operations: [{ name: 'Inner wall', kind: 'profile', feature: 'hole', tool: { number: 1, diameter: 3 }, passes: [pass] }],
      });
      for (const move of readGcode(code).filter(move => !move.rapid)) {
        expect(move.to[0]).toBeGreaterThanOrEqual(1.5 - 0.001);
        expect(move.to[0]).toBeLessThanOrEqual(38.5 + 0.001);
        expect(move.to[1]).toBeGreaterThanOrEqual(1.5 - 0.001);
        expect(move.to[1]).toBeLessThanOrEqual(28.5 + 0.001);
        expect(move.to[2]).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('preserves full tab plateaux on later laps of a descending contour', () => {
    const original = path([
      [0, 0, 4],
      [120, 0, -1],
    ]);
    const intervals = repeatTabIntervals([[8, 12]], 40, 120);
    const tabbed = applyTabMotion(original, intervals, 2, 300, 2);
    const zAt = (x: number) => {
      const index = tabbed.pts.findIndex((point, i) => i > 0 && point[0] >= x);
      const a = tabbed.pts[index - 1],
        b = tabbed.pts[index];
      return a[2] + ((b[2] - a[2]) * (x - a[0])) / (b[0] - a[0]);
    };
    for (const x of [48, 49, 50, 51, 52, 88, 89, 90, 91, 92]) expect(zAt(x)).toBeGreaterThanOrEqual(2);
    expect(original.pts).toEqual([
      [0, 0, 4],
      [120, 0, -1],
    ]);
  });

  it('treats G53 as absolute machine motion while preserving subsequent incremental mode', () => {
    const result = estimateProgramTime('G91\nG1 Z10 F600\nG53 G0 Z-5\nG1 Z-1', LOWRIDER_V4_REFERENCE_PROFILE, {
      initialWorkPosition: [0, 0, 0],
      workOffset: [0, 0, -20],
    });
    expect(result.complete).toBe(true);
    expect(result.motionLowerBoundSeconds).toBeCloseTo(1.35, 8);
  });
});
