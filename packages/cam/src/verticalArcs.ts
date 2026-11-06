import type { Prim } from './gcode';
import type { Vec3 } from './geom';
import { quantizedArcIsSafe, quantizePostNumber } from './postValidation';

export type VerticalPlane = 18 | 19;
type Point = { x: number; y: number; z: number; source: Vec3 };
type Fit = (points: Point[], tolerance: number) => Prim<Point>[];

export interface VerticalPrimitive {
  type: 'line' | 'arc';
  to: Vec3;
  center?: Vec3;
  cw?: boolean;
  plane: VerticalPlane;
}

/** Principal-plane coordinates use the controller's right-handed arc convention. */
export const verticalAxes = (plane: VerticalPlane): [number, number, number] => (plane === 18 ? [2, 0, 1] : [1, 2, 0]);

function map(point: Vec3, plane: VerticalPlane): Point {
  const [u, v, axial] = verticalAxes(plane);
  return { x: point[u], y: point[v], z: point[axial], source: point };
}

function angleAlong(begin: number, end: number, clockwise: boolean): number {
  const angle = clockwise ? begin - end : end - begin;
  return ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/** Arc fitting must not introduce an in-plane Z extremum below the planned floor. */
function preservesVerticalBounds(
  start: Point,
  points: Point[],
  center: { x: number; y: number },
  cw: boolean,
  plane: VerticalPlane
): boolean {
  const q = quantizePostNumber;
  const sx = q(start.x),
    sy = q(start.y);
  const cx = sx + q(center.x - sx),
    cy = sy + q(center.y - sy);
  const end = points.at(-1)!;
  const radius = Math.hypot(sx - cx, sy - cy);
  const begin = Math.atan2(sy - cy, sx - cx);
  const sweep = angleAlong(begin, Math.atan2(q(end.y) - cy, q(end.x) - cx), cw);
  const extrema = [start.source[2], end.source[2]];
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    if (angleAlong(begin, angle, cw) <= sweep + 1e-9)
      extrema.push(plane === 18 ? cx + radius * Math.cos(angle) : cy + radius * Math.sin(angle));
  }
  const zs = points.map(point => point.source[2]);
  const floor = Math.min(start.source[2], ...zs),
    ceiling = Math.max(start.source[2], ...zs);
  return Math.min(...extrema) >= floor - 0.0005 - 1e-9 && Math.max(...extrema) <= ceiling + 0.0005 + 1e-9;
}

/**
 * Recover only principal vertical circles. Arbitrarily oriented 3D blends remain
 * their planned lines, with the same numerical and depth checks as other output.
 */
export function fitVerticalRun(points: Vec3[], plane: VerticalPlane, tolerance: number, fit: Fit): VerticalPrimitive[] | undefined {
  if (points.length < 4) return undefined;
  const [, , axial] = verticalAxes(plane);
  if (!points.every(point => Math.abs(point[axial] - points[0][axial]) <= 1e-9)) return undefined;
  if (Math.max(...points.map(point => point[2])) - Math.min(...points.map(point => point[2])) < 1e-9) return undefined;
  const mapped = points.map(point => map(point, plane));
  const indices = new Map(mapped.map((point, index) => [point, index]));
  const result: VerticalPrimitive[] = [];
  let start = 0,
    arcs = 0;
  for (const primitive of fit(mapped, tolerance)) {
    const end = indices.get(primitive.to)!;
    const source = mapped.slice(start, end + 1);
    if (
      primitive.type === 'arc' &&
      quantizedArcIsSafe(mapped[start], source, primitive, tolerance) &&
      preservesVerticalBounds(mapped[start], source, primitive.c, primitive.cw, plane)
    ) {
      const [u, v, axial] = verticalAxes(plane);
      const center: Vec3 = [...points[start]];
      center[u] = primitive.c.x;
      center[v] = primitive.c.y;
      center[axial] = points[start][axial];
      result.push({ type: 'arc', to: primitive.to.source, center, cw: primitive.cw, plane });
      arcs++;
    } else {
      for (const point of source.slice(1)) result.push({ type: 'line', to: point.source, plane });
    }
    start = end;
  }
  return arcs ? result : undefined;
}

/** Find a bounded run with one feed and role; helical XY runs use the ordinary arc fitter. */
export function verticalRunEnd(
  points: Vec3[],
  feeds: number[],
  roles: readonly string[] | undefined,
  from: number,
  plane: VerticalPlane
): number {
  const [, , axial] = verticalAxes(plane);
  const origin = points[from - 1][axial];
  let end = from;
  while (
    end < points.length &&
    end - from < 400 &&
    feeds[end] === feeds[from] &&
    roles?.[end] === roles?.[from] &&
    Math.abs(points[end][axial] - origin) <= 1e-9
  )
    end++;
  return end;
}
