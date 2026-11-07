import {
  closestCurvePoint,
  entityPointIds,
  isNurbsCurve,
  visibleSketchPointIds,
  type CadEntity,
  type CadPoint,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';

export type ScreenPoint = CadPoint;
export interface CadSnapResult {
  kind: 'endpoint' | 'center' | 'point' | 'midpoint' | 'pointOnCurve';
  point: CadPoint;
  screenPoint: ScreenPoint;
  distancePx: number;
  targetPointId?: string;
  entityId?: string;
  /** Line/NURBS fraction (0..1), or the circular curve's angle in radians. */
  parameter?: number;
  intent?: { type: 'midpoint' | 'pointOnCurve'; entityId: string };
}

export interface CadPickingOptions {
  /** Map model XY to client pixels, including the canvas's Y inversion and current zoom. */
  project: (point: CadPoint) => ScreenPoint;
  pointRadiusPx?: number;
  curveRadiusPx?: number;
  /** Midpoint inference applies to lines; arcs retain point-on-curve intent. */
  midpointRadiusPx?: number;
  excludePointIds?: Iterable<string>;
  /** Excludes curves and points owned solely by those curves. Shared points remain eligible. */
  excludeEntityIds?: Iterable<string>;
  includeMidpoints?: boolean;
  includeCurves?: boolean;
  includeConstruction?: boolean;
  /** Selected curves expose their editable control handles. */
  selectedEntityIds?: readonly string[];
  /** The painted point under the pointer wins only exact-distance ties between overlapping aliases. */
  preferredPointId?: string;
  /** The painted curve wins only exact-distance ties, never over a closer visible curve. */
  preferredCurveId?: string;
}

type Curve = Exclude<CadEntity, { type: 'point' }>;
export interface CadSketchPointReference {
  kind: 'endpoint' | 'center' | 'point';
  point: CadPoint;
  screenPoint: ScreenPoint;
  targetPointId: string;
  entityId: string;
}
export interface CadControlPolygonHit {
  kind: 'segment' | 'vertex';
  entityId: string;
  /** Polygon segment fraction, not a parameter on the analytic Bezier curve. */
  parameter: number;
  point: CadPoint;
  screenPoint: ScreenPoint;
  distancePx: number;
  vertexId?: string;
}
const tau = 2 * Math.PI;
const finite = (point: CadPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const pointIds = (curve: Curve) => entityPointIds(curve);
const rank: Record<CadSnapResult['kind'], number> = { endpoint: 0, center: 1, point: 2, midpoint: 3, pointOnCurve: 4 };
const nearest = (hits: CadSnapResult[], preferredCurveId?: string) => {
  const closest =
    hits.sort((a, b) =>
      Math.abs(a.distancePx - b.distancePx) > 1e-9
        ? a.distancePx - b.distancePx
        : rank[a.kind] - rank[b.kind] || (a.targetPointId ?? a.entityId ?? '').localeCompare(b.targetPointId ?? b.entityId ?? '')
    )[0] ?? null;
  const preferred = preferredCurveId && hits.find(hit => hit.entityId === preferredCurveId);
  return preferred && closest && Math.abs(preferred.distancePx - closest.distancePx) <= 1e-9 ? preferred : closest;
};

/** The add-control command targets the visible polygon, independently of the actual curve. */
export function pickBezierControlPolygon(sketch: CadSketch, pointer: ScreenPoint, options: CadPickingOptions): CadControlPolygonHit | null {
  if (!finite(pointer)) return null;
  const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
  const excluded = new Set(options.excludeEntityIds),
    excludedPoints = new Set(options.excludePointIds);
  const vertices: CadControlPolygonHit[] = [],
    segments: CadControlPolygonHit[] = [];
  for (const curve of sketch.entities) {
    if (curve.type !== 'bezier' || excluded.has(curve.id) || (curve.construction && options.includeConstruction === false)) continue;
    const controls = curve.controlPointIds.map(id => points.get(id));
    for (let i = 0; i < controls.length; i++) {
      const p = controls[i];
      if (!p || !finite(p) || excludedPoints.has(p.id)) continue;
      const screenPoint = options.project(p),
        distancePx = distance(pointer, screenPoint);
      if (finite(screenPoint) && distancePx <= (options.pointRadiusPx ?? 8))
        vertices.push({
          kind: 'vertex',
          entityId: curve.id,
          vertexId: p.id,
          parameter: i / (controls.length - 1),
          point: { x: p.x, y: p.y },
          screenPoint,
          distancePx,
        });
      const q = controls[i + 1];
      if (!q || !finite(q) || excludedPoints.has(q.id)) continue;
      const a = options.project(p),
        b = options.project(q),
        dx = b.x - a.x,
        dy = b.y - a.y,
        length2 = dx * dx + dy * dy;
      if (!finite(a) || !finite(b) || length2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) / length2));
      const at = { x: a.x + t * dx, y: a.y + t * dy },
        d = distance(pointer, at);
      if (d <= (options.curveRadiusPx ?? 8))
        segments.push({
          kind: 'segment',
          entityId: curve.id,
          parameter: (i + t) / (controls.length - 1),
          point: { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) },
          screenPoint: at,
          distancePx: d,
        });
    }
  }
  const nearest = (hits: CadControlPolygonHit[]) =>
    hits.sort((a, b) => a.distancePx - b.distancePx || a.entityId.localeCompare(b.entityId))[0] ?? null;
  return nearest(vertices) ?? nearest(segments);
}

/** Shared reference eligibility for direct point hits and off-geometry drawing inference. */
export function sketchPointReferences(sketch: CadSketch, options: CadPickingOptions): CadSketchPointReference[] {
  const excludedPoints = new Set(options.excludePointIds);
  const excludedEntities = new Set(options.excludeEntityIds);
  const owners = new Map<string, { endpoint: boolean; center: boolean; ids: string[] }>();
  const visible = visibleSketchPointIds(sketch, options.selectedEntityIds);
  for (const curve of sketch.entities) {
    if (curve.type === 'point' || (curve.construction && options.includeConstruction === false)) continue;
    for (const id of pointIds(curve)) {
      const role = owners.get(id) ?? { endpoint: false, center: false, ids: [] };
      role.ids.push(curve.id);
      if ((curve.type === 'circle' || curve.type === 'arc') && id === curve.centerId) role.center = true;
      else if ('startId' in curve && (id === curve.startId || id === curve.endId)) role.endpoint = true;
      owners.set(id, role);
    }
  }
  const references: CadSketchPointReference[] = [];
  for (const point of sketch.entities) {
    if (
      point.type !== 'point' ||
      !visible.has(point.id) ||
      !finite(point) ||
      excludedPoints.has(point.id) ||
      excludedEntities.has(point.id)
    )
      continue;
    if (point.construction && options.includeConstruction === false) continue;
    const role = owners.get(point.id);
    if (role?.ids.length && role.ids.every(id => excludedEntities.has(id))) continue;
    const screenPoint = options.project(point);
    if (!finite(screenPoint)) continue;
    references.push({
      kind: role?.endpoint ? 'endpoint' : role?.center ? 'center' : 'point',
      point: { x: point.x, y: point.y },
      screenPoint,
      targetPointId: point.id,
      entityId: point.id,
    });
  }
  return references;
}

/** Nearest endpoint, center or standalone point within a pixel radius, independent of source array order. */
export function pickSketchPoint(sketch: CadSketch, pointerScreen: ScreenPoint, options: CadPickingOptions): CadSnapResult | null {
  if (!finite(pointerScreen)) return null;
  const hits = sketchPointReferences(sketch, options)
    .map(reference => ({ ...reference, distancePx: distance(pointerScreen, reference.screenPoint) }))
    .filter(hit => hit.distancePx <= (options.pointRadiusPx ?? 8));
  const closest = nearest(hits);
  const preferred = options.preferredPointId && hits.find(hit => hit.targetPointId === options.preferredPointId);
  return preferred && closest && Math.abs(preferred.distancePx - closest.distancePx) <= 1e-9 ? preferred : closest;
}

/** Closest point on a circle or finite arc after an affine projection, including a nonuniform scale. */
function circularProjection(
  curve: Extract<Curve, { type: 'circle' | 'arc' }>,
  center: CadPoint,
  pointer: ScreenPoint,
  project: CadPickingOptions['project']
) {
  if (!finite(center) || !Number.isFinite(curve.radius) || curve.radius <= 0) return null;
  const screenCenter = project(center);
  const horizontal = project({ x: center.x + curve.radius, y: center.y });
  const vertical = project({ x: center.x, y: center.y + curve.radius });
  if (![screenCenter, horizontal, vertical].every(finite)) return null;
  const u = { x: horizontal.x - screenCenter.x, y: horizontal.y - screenCenter.y };
  const v = { x: vertical.x - screenCenter.x, y: vertical.y - screenCenter.y };
  if (Math.abs(u.x * v.y - u.y * v.x) < 1e-12) return null;
  const start = curve.type === 'arc' ? curve.startAngle : 0;
  const rawSweep = curve.type === 'arc' ? (((curve.endAngle - start) % tau) + tau) % tau : tau;
  const sweep = rawSweep < 1e-10 ? tau : rawSweep;
  if (![start, sweep].every(Number.isFinite)) return null;
  const at = (t: number) => {
    const angle = start + t;
    const screenPoint = {
      x: screenCenter.x + u.x * Math.cos(angle) + v.x * Math.sin(angle),
      y: screenCenter.y + u.y * Math.cos(angle) + v.y * Math.sin(angle),
    };
    return { angle, screenPoint, distancePx: distance(pointer, screenPoint) };
  };
  // Locate the global minimum before refining it. A projected circle is an ellipse, which can have several extrema.
  const steps = 64,
    step = sweep / steps;
  let bestIndex = 0,
    best = at(0);
  for (let i = 1; i <= steps; i++) {
    const hit = at(i * step);
    if (hit.distancePx < best.distancePx) {
      best = hit;
      bestIndex = i;
    }
  }
  const fullCircle = sweep === tau;
  let lo = (bestIndex - 1) * step,
    hi = (bestIndex + 1) * step;
  if (!fullCircle) {
    lo = Math.max(0, lo);
    hi = Math.min(sweep, hi);
  }
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = hi - ratio * (hi - lo),
    b = lo + ratio * (hi - lo),
    left = at(a),
    right = at(b);
  for (let i = 0; i < 40; i++) {
    if (left.distancePx < right.distancePx) {
      hi = b;
      b = a;
      right = left;
      a = hi - ratio * (hi - lo);
      left = at(a);
    } else {
      lo = a;
      a = b;
      left = right;
      b = lo + ratio * (hi - lo);
      right = at(b);
    }
  }
  for (const hit of [left, right]) if (hit.distancePx < best.distancePx) best = hit;
  return { ...best, point: { x: center.x + curve.radius * Math.cos(best.angle), y: center.y + curve.radius * Math.sin(best.angle) } };
}

/** Refine all sampled local minima, rather than assuming a spline has one closest branch. */
function nurbsProjection(
  curve: Extract<Curve, { type: 'conic' | 'spline' | 'bezier' }>,
  points: Map<string, CadPointEntity>,
  pointer: ScreenPoint,
  project: CadPickingOptions['project']
) {
  const hit = closestCurvePoint(curve, points, pointer, project);
  return { parameter: hit.parameter, point: hit.point, screenPoint: project(hit.point), distancePx: hit.distance };
}

/** Points win; nearby line midpoints win over generic curves; all distances are measured in client pixels. */
export function pickSketchSnap(sketch: CadSketch, pointerScreen: ScreenPoint, options: CadPickingOptions): CadSnapResult | null {
  const excludedEntities = new Set(options.excludeEntityIds),
    excludedPoints = new Set(options.excludePointIds);
  const pointHit = pickSketchPoint(sketch, pointerScreen, {
    ...options,
    excludeEntityIds: excludedEntities,
    excludePointIds: excludedPoints,
  });
  if (pointHit || !finite(pointerScreen)) return pointHit;
  const points = new Map(sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
  const midpoints: CadSnapResult[] = [],
    curves: CadSnapResult[] = [];
  for (const curve of sketch.entities) {
    if (curve.type === 'point' || excludedEntities.has(curve.id) || (curve.construction && options.includeConstruction === false)) continue;
    // A dragged point must not attract itself through one of its incident curves or their midpoint.
    if (pointIds(curve).some(id => excludedPoints.has(id))) continue;
    if (curve.type === 'line') {
      const a = points.get(curve.startId),
        b = points.get(curve.endId);
      if (!a || !b || !finite(a) || !finite(b)) continue;
      const screenA = options.project(a),
        screenB = options.project(b);
      if (!finite(screenA) || !finite(screenB)) continue;
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const screenMidpoint = options.project(midpoint),
        midpointDistance = distance(pointerScreen, screenMidpoint);
      if (options.includeMidpoints !== false && midpointDistance <= (options.midpointRadiusPx ?? 6))
        midpoints.push({
          kind: 'midpoint',
          point: midpoint,
          screenPoint: screenMidpoint,
          distancePx: midpointDistance,
          entityId: curve.id,
          parameter: 0.5,
          intent: { type: 'midpoint', entityId: curve.id },
        });
      const dx = screenB.x - screenA.x,
        dy = screenB.y - screenA.y,
        length2 = dx * dx + dy * dy;
      if (length2 < 1e-12 || options.includeCurves === false) continue;
      const parameter = Math.max(0, Math.min(1, ((pointerScreen.x - screenA.x) * dx + (pointerScreen.y - screenA.y) * dy) / length2));
      const screenPoint = { x: screenA.x + parameter * dx, y: screenA.y + parameter * dy };
      const distancePx = distance(pointerScreen, screenPoint);
      if (distancePx <= (options.curveRadiusPx ?? 6))
        curves.push({
          kind: 'pointOnCurve',
          point: { x: a.x + parameter * (b.x - a.x), y: a.y + parameter * (b.y - a.y) },
          screenPoint,
          distancePx,
          entityId: curve.id,
          parameter,
          intent: { type: 'pointOnCurve', entityId: curve.id },
        });
    } else if (isNurbsCurve(curve) && options.includeCurves !== false) {
      try {
        const hit = nurbsProjection(curve, points, pointerScreen, options.project);
        if (hit.distancePx <= (options.curveRadiusPx ?? 6))
          curves.push({ kind: 'pointOnCurve', ...hit, entityId: curve.id, intent: { type: 'pointOnCurve', entityId: curve.id } });
      } catch {
        /* Invalid drafts cannot offer reliable curve snaps. */
      }
    } else if ((curve.type === 'circle' || curve.type === 'arc') && options.includeCurves !== false) {
      const center = points.get(curve.centerId);
      const hit = center && circularProjection(curve, center, pointerScreen, options.project);
      if (hit && hit.distancePx <= (options.curveRadiusPx ?? 6))
        curves.push({
          kind: 'pointOnCurve',
          point: hit.point,
          screenPoint: hit.screenPoint,
          distancePx: hit.distancePx,
          entityId: curve.id,
          parameter: hit.angle,
          intent: { type: 'pointOnCurve', entityId: curve.id },
        });
    }
  }
  return nearest(midpoints, options.preferredCurveId) ?? nearest(curves, options.preferredCurveId);
}
