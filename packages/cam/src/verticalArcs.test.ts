import { describe, expect, it } from 'vitest';
import { fitArcs, toGcode } from './gcode';
import { readGcode } from './analyze';
import type { Vec3 } from './geom';
import { fitVerticalRun, verticalRunEnd, type VerticalPlane } from './verticalArcs';
import type { PartCam } from './toolpaths';

const fit: Parameters<typeof fitVerticalRun>[3] = (points, tolerance) => fitArcs(points, tolerance, tolerance);
const quarter = (plane: VerticalPlane, clockwise: boolean): Vec3[] =>
  Array.from({ length: 31 }, (_, i) => {
    const angle = ((clockwise ? -1 : 1) * i * Math.PI) / 60;
    return plane === 18 ? [10 + 2 * Math.sin(angle), 8, 5 + 2 * Math.cos(angle)] : [8, 10 + 2 * Math.cos(angle), 5 + 2 * Math.sin(angle)];
  });

describe('vertical-plane arc recovery', () => {
  it.each([18, 19] as const)('recovers an in-tolerance quarter circle in G%s', plane => {
    for (const clockwise of [false, true]) {
      const points = quarter(plane, clockwise);
      const output = fitVerticalRun(points, plane, 0.01, fit)!;
      expect(output).toHaveLength(1);
      expect(output[0]).toMatchObject({ type: 'arc', plane, cw: clockwise, to: points.at(-1) });
      const center = plane === 18 ? [10, 8, 5] : [8, 10, 5];
      center.forEach((coordinate, axis) => expect(output[0].center![axis]).toBeCloseTo(coordinate, 9));
    }
  });

  it('rejects nonplanar or coarse motion and preserves the original points for fallback', () => {
    const points = quarter(18, false);
    points[15][1] += 0.01;
    expect(fitVerticalRun(points, 18, 0.01, fit)).toBeUndefined();
    expect(
      fitVerticalRun(
        quarter(19, true).filter((_, i) => i % 10 === 0),
        19,
        0.01,
        fit
      )
    ).toBeUndefined();
  });

  it('does not cross feed or semantic role boundaries', () => {
    const points = quarter(18, false),
      feeds = points.map(() => 600);
    const roles = points.map(() => 'lead-in');
    feeds[10] = 480;
    expect(verticalRunEnd(points, feeds, roles, 1, 18)).toBe(10);
    feeds[10] = 600;
    roles[8] = 'cut';
    expect(verticalRunEnd(points, feeds, roles, 1, 18)).toBe(8);
  });

  it.each([18, 19] as const)('posts G%s with the correct centers and restores XY motion', plane => {
    const pts = quarter(plane, true);
    pts.push([pts.at(-1)![0] + 2, pts.at(-1)![1] + 2, pts.at(-1)![2]]);
    const cam: PartCam = {
      stockTop: 8,
      warnings: [],
      operations: [
        {
          name: 'Vertical blend',
          kind: 'profile',
          feature: 'outline',
          tool: { number: 1, diameter: 3 },
          passes: [{ pts, feeds: pts.map(() => 600), link: 'retract' }],
        },
      ],
    };
    const code = toGcode(cam);
    expect(code).toContain(`G${plane}\nG2`);
    expect(code).toContain(plane === 18 ? 'I0 K-2' : 'J-2 K0');
    expect(code).toMatch(/G17\nG1 /);
    const cuts = readGcode(code).filter(move => !move.rapid);
    expect(cuts.some(move => Math.hypot(...move.to.map((value, axis) => value - pts.at(-1)![axis])) < 1e-9)).toBe(true);
    expect(Math.min(...cuts.map(move => move.to[2]))).toBeGreaterThanOrEqual(Math.min(...pts.map(point => point[2])) - 0.0005);
  });
});
