import type { CadArcEntity, CadLineEntity, CadPoint } from './types';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';

type Edge = CadLineEntity | CadArcEntity;
export type OffsetSupport =
  | { kind: 'line'; curve: CadLineEntity; a: CadPoint; b: CadPoint; u: CadPoint; side: 1 | -1 }
  | { kind: 'arc'; curve: CadArcEntity; center: CadPoint; radius: number; side: 1 | -1 };
const tolerance = CAD_GEOMETRY_TOLERANCE;
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const cross = (a: CadPoint, b: CadPoint) => a.x * b.y - a.y * b.x;
const minus = (a: CadPoint, b: CadPoint) => ({ x: a.x - b.x, y: a.y - b.y });

export function offsetSupport(curve: Edge, points: ReadonlyMap<string, CadPoint>, side: 1 | -1, value: number): OffsetSupport | string {
  if (curve.type === 'arc') {
    const center = points.get(curve.centerId);
    const radius = curve.radius + side * value;
    if (!center || !Number.isFinite(radius) || radius <= tolerance)
      return 'This offset would collapse a circular radius. Choose a smaller value.';
    return { kind: 'arc', curve, center, radius, side };
  }
  const a = points.get(curve.startId),
    b = points.get(curve.endId);
  if (!a || !b || distance(a, b) <= tolerance) return 'Repair the missing or zero-length source edge before offsetting it.';
  const length = distance(a, b),
    u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const shift = { x: -u.y * side * value, y: u.x * side * value };
  return { kind: 'line', curve, a: { x: a.x + shift.x, y: a.y + shift.y }, b: { x: b.x + shift.x, y: b.y + shift.y }, u, side };
}

export function projectOffsetSupport(s: OffsetSupport, point: CadPoint): CadPoint {
  if (s.kind === 'line') {
    const t = (point.x - s.a.x) * s.u.x + (point.y - s.a.y) * s.u.y;
    return { x: s.a.x + t * s.u.x, y: s.a.y + t * s.u.y };
  }
  const angle = Math.atan2(point.y - s.center.y, point.x - s.center.x);
  return { x: s.center.x + s.radius * Math.cos(angle), y: s.center.y + s.radius * Math.sin(angle) };
}

/** Intersections use infinite supports; final finite curves are checked for collapse and topology below. */
export function intersectOffsetSupports(a: OffsetSupport, b: OffsetSupport, joint: CadPoint): CadPoint[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const d = cross(a.u, b.u);
    if (Math.abs(d) <= 1e-12) return Math.abs(cross(minus(b.a, a.a), a.u)) <= tolerance ? [projectOffsetSupport(a, joint)] : [];
    const t = cross(minus(b.a, a.a), b.u) / d;
    return [{ x: a.a.x + t * a.u.x, y: a.a.y + t * a.u.y }];
  }
  if (a.kind === 'line' || b.kind === 'line') {
    const line = a.kind === 'line' ? a : (b as Extract<OffsetSupport, { kind: 'line' }>);
    const circle = a.kind === 'arc' ? a : (b as Extract<OffsetSupport, { kind: 'arc' }>);
    const foot = projectOffsetSupport(line, circle.center);
    const h2 = circle.radius ** 2 - distance(foot, circle.center) ** 2;
    if (h2 < -tolerance * Math.max(1, circle.radius)) return [];
    const h = Math.sqrt(Math.max(0, h2));
    return [
      { x: foot.x + line.u.x * h, y: foot.y + line.u.y * h },
      { x: foot.x - line.u.x * h, y: foot.y - line.u.y * h },
    ];
  }
  const d = distance(a.center, b.center);
  if (d <= tolerance) return Math.abs(a.radius - b.radius) <= tolerance ? [projectOffsetSupport(a, joint)] : [];
  const along = (a.radius ** 2 - b.radius ** 2 + d ** 2) / (2 * d);
  const h2 = a.radius ** 2 - along ** 2;
  if (h2 < -tolerance * Math.max(1, a.radius, b.radius)) return [];
  const u = { x: (b.center.x - a.center.x) / d, y: (b.center.y - a.center.y) / d };
  const base = { x: a.center.x + along * u.x, y: a.center.y + along * u.y },
    h = Math.sqrt(Math.max(0, h2));
  return [
    { x: base.x - u.y * h, y: base.y + u.x * h },
    { x: base.x + u.y * h, y: base.y - u.x * h },
  ];
}
