import {
  FillRule,
  JoinType,
  EndType,
  inflatePathsD,
  unionD,
  differenceD,
  intersectD,
  areaD,
  simplifyPathsD,
  type PathD,
  type PathsD,
} from 'clipper2-ts';

export type Vec3 = [number, number, number];
export type Pt = { x: number; y: number };

/** Decimal places Clipper works with (1e-4 mm). */
export const PRECISION = 4;

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 0 ? scale(a, 1 / l) : [0, 0, 0];
};

/** Triangle mesh, triangle indices grouped by B-rep face (from occt). */
export interface Mesh {
  positions: Float64Array;
  indices: Uint32Array;
  /** Inclusive triangle index ranges, one per B-rep face. */
  faceRanges: { first: number; last: number }[];
}

export function triangle(mesh: Mesh, t: number): [Vec3, Vec3, Vec3] {
  const p = mesh.positions;
  const v = (i: number): Vec3 => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  return [v(mesh.indices[3 * t]), v(mesh.indices[3 * t + 1]), v(mesh.indices[3 * t + 2])];
}

/** Area-weighted (unnormalized, length = 2*area) triangle normal. */
export function triangleNormal2A(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return cross(sub(b, a), sub(c, a));
}

export function meshBounds(mesh: Mesh): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k];
      if (p[i + k] > max[k]) max[k] = p[i + k];
    }
  }
  return { min, max };
}

// ---- 2D polygon helpers (Clipper2, double API) ----

export const union = (a: PathsD, b: PathsD = []) => unionD(a, b, FillRule.NonZero, PRECISION);
export const difference = (a: PathsD, b: PathsD) => differenceD(a, b, FillRule.NonZero, PRECISION);
export const intersect = (a: PathsD, b: PathsD) => intersectD(a, b, FillRule.NonZero, PRECISION);
/** Offset closed polygons; positive grows. Round joins, arc tolerance in mm. */
export const offset = (paths: PathsD, delta: number, arcTol = 0.005) =>
  inflatePathsD(paths, delta, JoinType.Round, EndType.Polygon, 2, PRECISION, arcTol);
export const polyArea = (paths: PathsD) => paths.reduce((s, p) => s + areaD(p), 0);

const miter = (paths: PathsD, delta: number) => inflatePathsD(paths, delta, JoinType.Miter, EndType.Polygon, 4, PRECISION);

/** Morphological clean-up: closes hairline gaps between triangles and drops slivers/specks. Miter joins keep the
 * vertex count down (round joins at this scale add an arc to every tessellation vertex). */
export function cleanRegion(paths: PathsD, eps = 0.01, minArea = 0.05): PathsD {
  const closed = miter(miter(paths, eps), -eps);
  const opened = simplifyPathsD(miter(miter(closed, -eps), eps), 0.001, true);
  // Drop tiny islands (positive) and tiny holes (negative).
  return opened.filter(p => Math.abs(areaD(p)) >= minArea);
}

export function pathLength(path: Pt[], closed: boolean): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  if (closed && path.length > 1) {
    const a = path[path.length - 1];
    len += Math.hypot(path[0].x - a.x, path[0].y - a.y);
  }
  return len;
}

export function bounds2(paths: PathsD) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of paths)
    for (const q of p) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
  return { minX, minY, maxX, maxY };
}

/** Distance from point to segment ab. */
export function distPointSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export type { PathD, PathsD };
