import { clipLines, distPointSeg, offset, pathLength, union, type PathsD, type Pt, type Vec3 } from './geom';
import type { Operation, PartCam } from './toolpaths';

const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const [abc, abd, cda, cdb] = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)];
  if (((abc > 0 && abd < 0) || (abc < 0 && abd > 0)) && ((cda > 0 && cdb < 0) || (cda < 0 && cdb > 0))) return 0;
  return Math.min(
    distPointSeg(a.x, a.y, c.x, c.y, d.x, d.y),
    distPointSeg(b.x, b.y, c.x, c.y, d.x, d.y),
    distPointSeg(c.x, c.y, a.x, a.y, b.x, b.y),
    distPointSeg(d.x, d.y, a.x, a.y, b.x, b.y)
  );
}

function insideOutline(point: Pt, outline: PathsD[number]): boolean {
  let winding = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i],
      b = outline[(i + 1) % outline.length],
      side = cross(a, b, point);
    if (a.y <= point.y && b.y > point.y && side > 0) winding++;
    else if (a.y > point.y && b.y <= point.y && side < 0) winding--;
  }
  return winding !== 0;
}

/** Complete pocket cutter envelopes, including start disks and implicit direct links, against raw neighbor outlines. */
export function pocketOperationClashes(operation: Operation, neighbors: PathsD, toBoard: (point: Vec3) => Vec3, tolerance = 0.05): boolean {
  if (!neighbors.length) return false;
  const radius = operation.tool.diameter / 2 + tolerance;
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(tolerance) || tolerance < 0)
    throw new Error('Pocket neighbor checks require a positive cutter radius and nonnegative finite tolerance');
  if (neighbors.some(outline => outline.length < 3 || outline.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))))
    throw new Error('Pocket neighbor keepouts require finite polygon outlines');
  const obstacles = neighbors.map(outline => ({
    outline,
    bounds: outline.reduce(
      (box, point) => ({
        x0: Math.min(box.x0, point.x),
        y0: Math.min(box.y0, point.y),
        x1: Math.max(box.x1, point.x),
        y1: Math.max(box.y1, point.y),
      }),
      { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
    ),
  }));
  const clashes = (from: Vec3, to: Vec3) => {
    const aa = toBoard(from),
      bb = toBoard(to);
    const a = { x: aa[0], y: aa[1] },
      b = { x: bb[0], y: bb[1] };
    return obstacles.some(({ outline, bounds }) => {
      if (
        Math.max(a.x, b.x) + radius < bounds.x0 ||
        Math.min(a.x, b.x) - radius > bounds.x1 ||
        Math.max(a.y, b.y) + radius < bounds.y0 ||
        Math.min(a.y, b.y) - radius > bounds.y1
      )
        return false;
      if (insideOutline(a, outline) || insideOutline(b, outline)) return true;
      return outline.some((point, index) => {
        const distance = segmentDistance(a, b, point, outline[(index + 1) % outline.length]);
        return !Number.isFinite(distance) || distance <= radius;
      });
    });
  };
  let last: Vec3 | undefined;
  for (const pass of operation.passes) {
    const first = pass.pts[0];
    if (!first) continue;
    if (clashes(first, first) || (last && pass.link === 'direct' && clashes(last, first))) return true;
    for (let i = 1; i < pass.pts.length; i++) if (clashes(pass.pts[i - 1], pass.pts[i])) return true;
    last = pass.pts.at(-1);
  }
  return false;
}

/** Keep the complete cutter envelope of optional tangent leads out of neighboring finished geometry. */
export function tangentEntryClashes(cam: PartCam, neighbors: PathsD, toBoard: (point: Vec3) => Vec3, tolerance = 0.05): boolean {
  if (!neighbors.length) return false;
  const material = union(neighbors);
  return cam.operations.some(operation => {
    const keepout = offset(material, operation.tool.diameter / 2 + tolerance);
    return operation.passes.some(pass => {
      if (pass.entry !== 'tangent') return false;
      for (let i = 1; i < pass.pts.length; i++) {
        if (pass.roles && pass.roles[i] !== 'lead-in' && pass.roles[i] !== 'lead-out') continue;
        const a = toBoard(pass.pts[i - 1]),
          b = toBoard(pass.pts[i]);
        const line = [
          { x: a[0], y: a[1] },
          { x: b[0], y: b[1] },
        ];
        if (clipLines([line], keepout).some(path => pathLength(path, false) > 1e-7)) return true;
      }
      return false;
    });
  });
}
