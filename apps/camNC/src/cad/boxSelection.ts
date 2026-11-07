import {
  CAD_GEOMETRY_TOLERANCE,
  entityPointIds,
  originId,
  tessellateCurve,
  type CadEntity,
  type CadPoint,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';

export interface CadSelectionBox {
  /** Raw gesture endpoints in CAD coordinates, before snapping or grid rounding. */
  start: CadPoint;
  end: CadPoint;
}
export interface CadBoxSelectionOptions {
  /** Hidden spline poles and inactive control handles can be excluded without changing curve selection. */
  visiblePointIds?: Iterable<string>;
  /** Chord error in model units for conics/splines; the editor can supply a screen-equivalent tolerance. */
  curveTolerance?: number;
  includeConstruction?: boolean;
}
export interface CadBoxSelectionResult {
  mode: 'window' | 'crossing';
  entityIds: string[];
}
interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
type Curve = Exclude<CadEntity, { type: 'point' }>;
const tau = 2 * Math.PI;
const epsilon = CAD_GEOMETRY_TOLERANCE;
const finite = (point: CadPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const inside = (point: CadPoint, box: Bounds) =>
  finite(point) &&
  point.x >= box.minX - epsilon &&
  point.x <= box.maxX + epsilon &&
  point.y >= box.minY - epsilon &&
  point.y <= box.maxY + epsilon;

function segmentMeetsBox(a: CadPoint, b: CadPoint, box: Bounds): boolean {
  if (!finite(a) || !finite(b)) return false;
  if (inside(a, box) || inside(b, box)) return true;
  let lo = 0,
    hi = 1;
  for (const [position, direction, min, max] of [
    [a.x, b.x - a.x, box.minX - epsilon, box.maxX + epsilon],
    [a.y, b.y - a.y, box.minY - epsilon, box.maxY + epsilon],
  ] as const) {
    if (Math.abs(direction) < Number.EPSILON) {
      if (position < min || position > max) return false;
    } else {
      const first = (min - position) / direction,
        second = (max - position) / direction;
      lo = Math.max(lo, Math.min(first, second));
      hi = Math.min(hi, Math.max(first, second));
      if (lo > hi) return false;
    }
  }
  return true;
}

const angleInArc = (angle: number, start: number, end: number, radius: number) => {
  const delta = (((angle - start) % tau) + tau) % tau;
  const sweep = (((end - start) % tau) + tau) % tau;
  return delta <= sweep + epsilon / radius || tau - delta <= epsilon / radius;
};

function circularSelection(curve: Extract<Curve, { type: 'circle' | 'arc' }>, center: CadPoint, box: Bounds, window: boolean): boolean {
  if (!finite(center) || !Number.isFinite(curve.radius) || curve.radius <= 0) return false;
  const radius = curve.radius;
  const at = (angle: number) => ({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  if (curve.type === 'circle') {
    if (window)
      return inside({ x: center.x - radius, y: center.y - radius }, box) && inside({ x: center.x + radius, y: center.y + radius }, box);
    const nearX = Math.max(box.minX, Math.min(center.x, box.maxX)),
      nearY = Math.max(box.minY, Math.min(center.y, box.maxY));
    const nearest = Math.hypot(center.x - nearX, center.y - nearY);
    const farthest = Math.hypot(
      Math.max(Math.abs(center.x - box.minX), Math.abs(center.x - box.maxX)),
      Math.max(Math.abs(center.y - box.minY), Math.abs(center.y - box.maxY))
    );
    return nearest <= radius + epsilon && farthest >= radius - epsilon;
  }
  if (![curve.startAngle, curve.endAngle].every(Number.isFinite)) return false;
  const onArc = (angle: number) => angleInArc(angle, curve.startAngle, curve.endAngle, radius);
  const ends = [at(curve.startAngle), at(curve.endAngle)];
  if (window) return [...ends, ...[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].filter(onArc).map(at)].every(point => inside(point, box));
  if (ends.some(point => inside(point, box))) return true;
  for (const x of [box.minX, box.maxX]) {
    const delta = Math.abs(x - center.x);
    if (delta > radius + epsilon) continue;
    const offset = Math.sqrt(Math.max(0, (radius - delta) * (radius + delta)));
    for (const y of [center.y - offset, center.y + offset])
      if (y >= box.minY - epsilon && y <= box.maxY + epsilon && onArc(Math.atan2(y - center.y, x - center.x))) return true;
  }
  for (const y of [box.minY, box.maxY]) {
    const delta = Math.abs(y - center.y);
    if (delta > radius + epsilon) continue;
    const offset = Math.sqrt(Math.max(0, (radius - delta) * (radius + delta)));
    for (const x of [center.x - offset, center.x + offset])
      if (x >= box.minX - epsilon && x <= box.maxX + epsilon && onArc(Math.atan2(y - center.y, x - center.x))) return true;
  }
  return false;
}

function curveSelected(curve: Curve, points: Map<string, CadPointEntity>, box: Bounds, window: boolean, tolerance: number): boolean {
  if (curve.type === 'circle' || curve.type === 'arc') {
    const center = points.get(curve.centerId);
    return !!center && circularSelection(curve, center, box, window);
  }
  if (curve.type === 'line') {
    const a = points.get(curve.startId),
      b = points.get(curve.endId);
    return !!a && !!b && (window ? inside(a, box) && inside(b, box) : segmentMeetsBox(a, b, box));
  }
  let path: CadPoint[];
  try {
    path = tessellateCurve(curve, points, tolerance);
  } catch {
    // Partial or invalid draft curves remain editable; they cannot supply a selection boundary yet.
    return false;
  }
  if (!path.length || path.some(point => !finite(point))) return false;
  return window
    ? path.every(point => inside(point, box))
    : path.some(point => inside(point, box)) || path.some((point, i) => i > 0 && segmentMeetsBox(path[i - 1]!, point, box));
}

/** Window selection contains complete curves; crossing selection intersects their actual boundaries. */
export function boxSelectSketch(sketch: CadSketch, gesture: CadSelectionBox, options: CadBoxSelectionOptions = {}): CadBoxSelectionResult {
  const mode = gesture.end.x >= gesture.start.x ? 'window' : 'crossing';
  if (!finite(gesture.start) || !finite(gesture.end)) return { mode, entityIds: [] };
  const box = {
    minX: Math.min(gesture.start.x, gesture.end.x),
    minY: Math.min(gesture.start.y, gesture.end.y),
    maxX: Math.max(gesture.start.x, gesture.end.x),
    maxY: Math.max(gesture.start.y, gesture.end.y),
  };
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  const tolerance = Number.isFinite(options.curveTolerance) && options.curveTolerance! > 0 ? options.curveTolerance! : 0.001;
  const selected = new Set<string>();
  const ownedBySelection = new Set<string>();
  for (const entity of sketch.entities) {
    if (entity.type === 'point' || (entity.construction && options.includeConstruction === false)) continue;
    if (curveSelected(entity, points, box, mode === 'window', tolerance)) {
      selected.add(entity.id);
      entityPointIds(entity).forEach(id => ownedBySelection.add(id));
    }
  }
  const visible = options.visiblePointIds === undefined ? null : new Set(options.visiblePointIds);
  for (const point of points.values()) {
    if (
      point.id === originId(sketch) ||
      ownedBySelection.has(point.id) ||
      (visible && !visible.has(point.id)) ||
      (point.construction && options.includeConstruction === false)
    )
      continue;
    if (inside(point, box)) selected.add(point.id);
  }
  return { mode, entityIds: sketch.entities.filter(entity => selected.has(entity.id)).map(entity => entity.id) };
}
