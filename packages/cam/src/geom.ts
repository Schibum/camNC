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
  ClipperD,
  ClipType,
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
/**
 * Offset closed polygons; positive grows. Round joins, arc tolerance in mm. Remembered by what it was asked
 * (`offsetCache`): a board planned again with other feeds or stepdowns asks the same offsets of the same parts.
 */
export function offset(paths: PathsD, delta: number, arcTol = 0.005): PathsD {
  const flat = new Float64Array(paths.reduce((n, p) => n + p.length * 2 + 1, 3));
  let k = 0;
  flat[k++] = delta;
  flat[k++] = arcTol;
  flat[k++] = paths.length;
  for (const path of paths) {
    flat[k++] = path.length;
    for (const q of path) {
      flat[k++] = q.x;
      flat[k++] = q.y;
    }
  }
  const key = hashFloats(flat);
  const hit = offsetCache.get(key);
  if (hit && sameFloats(hit.input, flat)) {
    // (Its points stay counted.)
    // Most recently used last.
    offsetCache.delete(key);
    offsetCache.set(key, hit);
    return copyPaths(hit.output);
  }
  const output = inflatePathsD(paths, delta, JoinType.Round, EndType.Polygon, 2, PRECISION, arcTol);
  const points = flat.length / 2 + output.reduce((n, p) => n + p.length, 0);
  offsetCache.set(key, { input: flat, output: copyPaths(output), points });
  cachedPoints += points;
  // Oldest first, until it fits again.
  while (cachedPoints > kOffsetCachePoints) {
    const [oldest, entry] = offsetCache.entries().next().value!;
    offsetCache.delete(oldest);
    cachedPoints -= entry.points;
  }
  return output;
}

/** Points the remembered offsets may hold (inputs and outputs), ~100 MB: a few boards' worth. */
const kOffsetCachePoints = 1_500_000;
const offsetCache = new Map<string, { input: Float64Array; output: PathsD; points: number }>();
let cachedPoints = 0;

const copyPaths = (paths: PathsD): PathsD => paths.map(p => p.map(q => ({ x: q.x, y: q.y })));

function hashFloats(a: Float64Array): string {
  const words = new Uint32Array(a.buffer, a.byteOffset, a.length * 2);
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (let i = 0; i < words.length; i++) {
    h1 = Math.imul(h1 ^ words[i], 0x01000193);
    h2 = Math.imul(h2 ^ words[i], 0x5bd1e995) ^ (h2 >>> 15);
  }
  return `${a.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}

function sameFloats(a: Float64Array, b: Float64Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
/** The parts of open polylines that lie inside `region` (closed polygons, holes included). */
export function clipLines(lines: PathsD, region: PathsD): PathsD {
  const c = new ClipperD(PRECISION);
  c.addOpenSubjectPaths(lines);
  c.addClipPaths(region);
  const closed: PathsD = [],
    open: PathsD = [];
  c.execute(ClipType.Intersection, FillRule.NonZero, closed, open);
  return open;
}
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
