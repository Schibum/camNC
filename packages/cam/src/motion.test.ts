import { describe, expect, it } from 'vitest';
import { applyFeedPolicy, type MotionPath } from './motion';
import { profileEntryRegion, tangentLoopPass, lineInsideRegion } from './entry';
import { applyTabMotion, repeatTabIntervals } from './tabMotion';
import { difference, type PathD, type Vec3 } from './geom';

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
const path = (pts: Vec3[], feed = 1000): MotionPath => ({ pts, feeds: pts.map(() => feed), link: 'retract' });

describe('semantic motion and feed scheduling', () => {
  it('uses independent ramp/lead/plunge feeds while preserving cut feeds and role alignment', () => {
    const p = path([
      [0, 0, 8],
      [10, 0, 7],
      [11, 0, 7],
      [20, 0, 7],
      [21, 1, 7],
    ]);
    p.roles = ['approach', 'ramp', 'lead-in', 'cut', 'lead-out'];
    const result = applyFeedPolicy(p, { ...policy, cornerFeed: false });
    expect(result.feeds).toEqual([300, 420, 700, 1000, 700]);
    expect(result.roles).toHaveLength(result.pts.length);
    expect(p.feeds).toEqual([1000, 1000, 1000, 1000, 1000]);
  });

  it('splits before a concave material-side corner and restores the straight feed afterward', () => {
    const result = applyFeedPolicy(
      path([
        [0, 0, 2],
        [20, 0, 2],
        [20, 20, 2],
      ]),
      policy
    );
    expect(result.pts).toEqual([
      [0, 0, 2],
      [18, 0, 2],
      [20, 0, 2],
      [20, 2, 2],
      [20, 20, 2],
    ]);
    expect(result.feeds).toEqual([300, 1000, 500, 500, 1000]);
    expect(result.roles).toEqual(['approach', 'cut', 'corner', 'corner', 'cut']);
  });

  it('does not reduce convex outside turns or turns without known material side', () => {
    const clockwise = path([
      [0, 0, 2],
      [0, 20, 2],
      [20, 20, 2],
      [20, 0, 2],
      [0, 0, 2],
    ]);
    expect(applyFeedPolicy(clockwise, policy).roles).not.toContain('corner');
    expect(
      applyFeedPolicy(
        path([
          [0, 0, 2],
          [20, 0, 2],
          [20, 20, 2],
        ]),
        { ...policy, materialSide: undefined }
      ).roles
    ).not.toContain('corner');
  });

  it('includes a closed contour seam in corner scheduling', () => {
    const result = applyFeedPolicy(
      path([
        [0, 0, 2],
        [20, 0, 2],
        [20, 20, 2],
        [0, 20, 2],
        [0, 0, 2],
      ]),
      policy
    );
    expect(result.feeds[1]).toBe(500);
    expect(result.feeds.at(-1)).toBe(500);
  });

  it('reduces accumulated tight curvature but leaves broad curves at cutting feed', () => {
    const arc = (radius: number) =>
      path(Array.from({ length: 31 }, (_, i) => [radius * Math.cos((i * Math.PI) / 60), radius * Math.sin((i * Math.PI) / 60), 2] as Vec3));
    expect(applyFeedPolicy(arc(0.2), policy).roles).toContain('corner');
    expect(applyFeedPolicy(arc(5), policy).roles).not.toContain('corner');
  });
});

describe('contained tangent leads', () => {
  it.each([false, true])('keeps every lead segment in the cutter-centre region (inside=%s)', inside => {
    const shape = rect(0, 0, 40, 30),
      radius = 1.5;
    const loop = inside ? rect(radius, radius, 40 - radius, 30 - radius) : [...rect(-radius, -radius, 40 + radius, 30 + radius)].reverse();
    const free = profileEntryRegion(shape, radius, radius, inside);
    const pass = tangentLoopPass(loop, 2, 1000, radius, free)!;
    expect(pass).toBeDefined();
    expect(pass.roles).toContain('lead-in');
    expect(pass.roles).toContain('lead-out');
    const leadPoints = pass.pts
      .filter((_, i) => pass.roles[i] === 'lead-in' || pass.roles[i] === 'lead-out')
      .map(p => ({ x: p[0], y: p[1] }));
    for (const q of leadPoints) expect(lineInsideRegion([q, { x: q.x + 1e-8, y: q.y }], free)).toBe(true);
    expect(pass.feeds).toHaveLength(pass.pts.length);
    expect(pass.roles).toHaveLength(pass.pts.length);
  });

  it('checks whole lines against islands, including obstacles between endpoints', () => {
    const free = difference([rect(0, 0, 20, 20)], [rect(9, 9, 11, 11)]);
    expect(
      lineInsideRegion(
        [
          { x: 2, y: 10 },
          { x: 18, y: 10 },
        ],
        free
      )
    ).toBe(false);
    expect(
      lineInsideRegion(
        [
          { x: 2, y: 2 },
          { x: 18, y: 2 },
        ],
        free
      )
    ).toBe(true);
  });

  it('refuses a lead when no cutter-centre room remains', () => {
    expect(tangentLoopPass(rect(0, 0, 10, 10), 2, 1000, 1, [])).toBeUndefined();
    expect(tangentLoopPass(rect(0, 0, 10, 10), 2, 1000, 0, [rect(0, 0, 10, 10)])).toBeUndefined();
  });
});

describe('tab shoulders and repeated ramp laps', () => {
  it('preserves the full plateau and ramps outside its borders without vertical jumps', () => {
    const result = applyTabMotion(
      path([
        [0, 0, 0],
        [20, 0, 0],
      ]),
      [[8, 12]],
      2,
      300,
      2
    );
    expect(result.pts).toEqual([
      [0, 0, 0],
      [6, 0, 0],
      [8, 0, 2],
      [12, 0, 2],
      [14, 0, 0],
      [20, 0, 0],
    ]);
    expect(result.feeds[4]).toBe(300);
    expect(result.roles.slice(2, 5)).toEqual(['tab', 'tab', 'tab']);
    expect(result.pts.every((p, i) => i === 0 || p[0] > result.pts[i - 1][0])).toBe(true);
  });

  it('retains vertical tabs when ramp shoulders are disabled', () => {
    const result = applyTabMotion(
      path([
        [0, 0, 0],
        [20, 0, 0],
      ]),
      [[8, 12]],
      2,
      300
    );
    expect(result.pts).toEqual([
      [0, 0, 0],
      [8, 0, 0],
      [8, 0, 2],
      [12, 0, 2],
      [12, 0, 0],
      [20, 0, 0],
    ]);
    expect(result.feeds[4]).toBe(300);
  });

  it('repeats holding plateaux at every lap and across the contour seam', () => {
    const intervals = repeatTabIntervals([[-2, 2]], 20, 45);
    expect(intervals).toEqual([
      [-2, 2],
      [18, 22],
      [38, 42],
    ]);
    const result = applyTabMotion(
      path([
        [0, 0, 0],
        [45, 0, 0],
      ]),
      intervals,
      2,
      300,
      1
    );
    expect(result.pts.filter(p => p[2] === 2).map(p => p[0])).toEqual([0, 2, 18, 22, 38, 42]);
  });
});
