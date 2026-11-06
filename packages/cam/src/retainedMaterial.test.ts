import { describe, expect, it } from 'vitest';
import { machiningPart, rectangle } from '../test/machining-fixtures';
import { readGcode } from './analyze';
import { geometryTolerances } from './accuracy';
import { throughCuts, camPart, type PartCam } from './toolpaths';
import { extractFeatures, openPocketRegion } from './features';
import { toGcode } from './gcode';
import { distPointSeg, intersect, polyArea, type Mesh, type PathD, type Vec3 } from './geom';

const island = rectangle(44.7, 34.7, 45.3, 35.3);
const pocket = rectangle(20, 20, 70, 50);

function segmentToIsland(a: Vec3, b: Vec3, retained = island): number {
  const xs = retained.map(point => point.x),
    ys = retained.map(point => point.y);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys);
  let lo = 0,
    hi = 1;
  for (const [axis, min, max] of [
    [0, x0, x1],
    [1, y0, y1],
  ]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-12) {
      if (a[axis] < min || a[axis] > max) {
        lo = 1;
        hi = 0;
        break;
      }
    } else {
      const t0 = (min - a[axis]) / delta,
        t1 = (max - a[axis]) / delta;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
  }
  if (hi >= lo) return 0;
  const endpointDistance = (p: Vec3) => Math.hypot(Math.max(x0 - p[0], 0, p[0] - x1), Math.max(y0 - p[1], 0, p[1] - y1));
  return Math.min(endpointDistance(a), endpointDistance(b), ...retained.map(p => distPointSeg(p.x, p.y, a[0], a[1], b[0], b[1])));
}

function expectProtected(cam: PartCam, retained = island) {
  const radius = 3.175 / 2;
  for (const operation of cam.operations)
    for (const pass of operation.passes)
      for (let i = 1; i < pass.pts.length; i++)
        expect(segmentToIsland(pass.pts[i - 1], pass.pts[i], retained)).toBeGreaterThanOrEqual(radius - 0.01);
  for (const move of readGcode(toGcode(cam)).filter(move => !move.rapid && move.spindle && Math.min(move.from[2], move.to[2]) < 12))
    expect(segmentToIsland(move.from, move.to, retained)).toBeGreaterThanOrEqual(radius - 0.01);
}

/** Horizontal face patches suffice for feature extraction; no CAD importer is involved. */
function horizontalMesh(patches: { shape: PathD; z: number }[]): Mesh {
  const positions: number[] = [],
    indices: number[] = [];
  for (const { shape, z } of patches) {
    const base = positions.length / 3;
    positions.push(...shape.flatMap(point => [point.x, point.y, z]));
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: new Float64Array(positions), indices: new Uint32Array(indices), faceRanges: [] };
}

describe('retained material and local precision', () => {
  it('never fills a supplied small island while extending or cleaning a pocket', () => {
    const features = machiningPart([[pocket, [...island].reverse()]], 10.5);
    const region = openPocketRegion(features.outlines, features.pockets[0], 3, geometryTolerances(0.01));
    expect(polyArea(intersect(region, [island]))).toBe(0);
    expectProtected(camPart(features, { cutThrough: false, geometryTolerance: 0.01, maxStepdown: 1.5 }));
  });

  it.each([0.6, 0.2])('preserves a %s mm top island through mesh feature extraction and posted machining', size => {
    const x0 = 45 - size / 2,
      x1 = 45 + size / 2,
      y0 = 35 - size / 2,
      y1 = 35 + size / 2;
    const retained = rectangle(x0, y0, x1, y1);
    const top = [rectangle(0, 0, 100, 20), rectangle(0, 50, 100, 70), rectangle(0, 20, 20, 50), rectangle(70, 20, 100, 50), retained];
    const floor = [rectangle(20, 20, 70, y0), rectangle(20, y1, 70, 50), rectangle(20, y0, x0, y1), rectangle(x1, y0, 70, y1)];
    const features = extractFeatures(
      horizontalMesh([...top.map(shape => ({ shape, z: 12 })), ...floor.map(shape => ({ shape, z: 10.5 }))]),
      12
    );
    expect(features.pockets).toHaveLength(1);
    expect(polyArea(intersect(features.pockets[0].strictRegion, [retained]))).toBe(0);
    expectProtected(camPart(features, { cutThrough: false, geometryTolerance: 0.01, maxStepdown: 1.5 }), retained);
  });

  it('keeps tool-width thresholds and through-cut templates consistent at a tighter tolerance', () => {
    for (const width of [3, 3.175, 3.176, 3.4]) {
      const cam = camPart(machiningPart([[rectangle(20, 20, 65, 20 + width)]], 10.5), { cutThrough: false, geometryTolerance: 0.01 });
      expect(cam.operations.length).toBe(width <= 3.175 ? 0 : 1);
    }
    const features = machiningPart([], 10.5, [rectangle(25, 25, 28.176, 45)]);
    const settings = { geometryTolerance: 0.01, profileEntry: 'plunge' as const };
    const template = throughCuts(features, settings).find(operation => operation.feature === 'hole')!;
    const actual = camPart(features, settings).operations.find(operation => operation.feature === 'hole')!;
    expect(template.passes.map(pass => pass.pts)).toEqual(actual.passes.map(pass => pass.pts));
  });
});
