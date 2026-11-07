import {
  CAD_GEOMETRY_TOLERANCE,
  closestCurvePoint,
  curveContacts,
  dimensionForSelection,
  dimensionWitnessPoints,
  entityPointIds,
  type CadEntity,
  type CadPoint,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';

export interface SelectionMeasurement {
  label: string;
  value: number;
  unit: 'mm' | 'deg';
}

type AnalyticCurve = Extract<CadEntity, { type: 'line' | 'circle' | 'arc' }>;
type CircularCurve = Extract<AnalyticCurve, { type: 'circle' | 'arc' }>;
type Points = ReadonlyMap<string, CadPoint>;
const isCircular = (curve: AnalyticCurve): curve is CircularCurve => curve.type !== 'line';
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const finitePoint = (point: CadPoint | undefined): point is CadPoint => !!point && Number.isFinite(point.x) && Number.isFinite(point.y);

function validCurve(entity: CadEntity, points: Points): entity is AnalyticCurve {
  if (entity.type !== 'line' && entity.type !== 'circle' && entity.type !== 'arc') return false;
  if (!entityPointIds(entity).every(id => finitePoint(points.get(id)))) return false;
  if (entity.type === 'line') return distance(points.get(entity.startId)!, points.get(entity.endId)!) > CAD_GEOMETRY_TOLERANCE;
  return (
    Number.isFinite(entity.radius) &&
    entity.radius > CAD_GEOMETRY_TOLERANCE &&
    (entity.type !== 'arc' || (Number.isFinite(entity.startAngle) && Number.isFinite(entity.endAngle)))
  );
}

function pointCurveDistance(point: CadPoint, curve: AnalyticCurve, points: Points): number {
  // The center is equidistant from every point of a circular arc, including finite arcs.
  if (isCircular(curve) && distance(point, points.get(curve.centerId)!) <= Number.EPSILON) return curve.radius;
  return closestCurvePoint(curve, points, point).distance;
}

function boundaryPoints(curve: AnalyticCurve, points: Points): CadPoint[] {
  return curve.type === 'circle' ? [] : [points.get(curve.startId)!, points.get(curve.endId)!];
}

/** Finite source curves: contacts, endpoint witnesses and analytic stationary witnesses. */
function curveDistance(a: AnalyticCurve, b: AnalyticCurve, points: Points, sketch: CadSketch): number {
  const contacts = curveContacts(a, b, points, CAD_GEOMETRY_TOLERANCE);
  if (contacts.overlap || contacts.points.length) return 0;
  const candidates = [
    ...boundaryPoints(a, points).map(point => pointCurveDistance(point, b, points)),
    ...boundaryPoints(b, points).map(point => pointCurveDistance(point, a, points)),
  ];
  if (a.type === 'line' || b.type === 'line') {
    const line = a.type === 'line' ? a : b;
    const circular = a.type === 'line' ? b : a;
    if (isCircular(circular)) {
      // Interior line/circle extrema lie on the normal through the center. The core
      // closest-point helper clamps this witness to the actual finite segment.
      const foot = closestCurvePoint(line, points, points.get(circular.centerId)!).point;
      candidates.push(pointCurveDistance(foot, circular, points));
    }
  } else {
    // The four center-line witness pairs cover circular interior extrema. Reject
    // witnesses outside a finite arc rather than measuring its full support circle.
    for (const radiusASign of [-1, 1] as const)
      for (const radiusBSign of [-1, 1] as const) {
        const pair = dimensionWitnessPoints(sketch, {
          type: 'circleCircleDistance',
          entityAId: a.id,
          entityBId: b.id,
          radiusASign,
          radiusBSign,
          direction: 1,
          value: 0,
        });
        if (
          pair &&
          pointCurveDistance(pair[0], a, points) <= CAD_GEOMETRY_TOLERANCE &&
          pointCurveDistance(pair[1], b, points) <= CAD_GEOMETRY_TOLERANCE
        )
          candidates.push(distance(pair[0], pair[1]));
      }
  }
  return Math.min(...candidates);
}

/** Read-only geometric measurements. No dimensions, constraints, guesses or history are changed. */
export function selectionMeasurements(
  sketch: CadSketch,
  ids: readonly string[],
  picks?: Readonly<Record<string, CadPoint>>
): SelectionMeasurement[] {
  const selectedIds = [...new Set(ids)];
  if (!selectedIds.length || selectedIds.length > 2) return [];
  const entities = selectedIds.map(id => sketch.entities.find(entity => entity.id === id));
  if (entities.some(entity => !entity)) return [];
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  const selected = entities as CadEntity[];
  const metric = (label: string, value: number, unit: SelectionMeasurement['unit'] = 'mm'): SelectionMeasurement[] =>
    Number.isFinite(value) ? [{ label, value: Math.max(0, value), unit }] : [];
  if (selected.length === 1) {
    const curve = selected[0]!;
    if (!validCurve(curve, points)) return [];
    return curve.type === 'line'
      ? metric('Length', distance(points.get(curve.startId)!, points.get(curve.endId)!))
      : metric(curve.type === 'circle' ? 'Diameter' : 'Radius', curve.radius * (curve.type === 'circle' ? 2 : 1));
  }
  const [a, b] = selected as [CadEntity, CadEntity];
  if (a.type === 'point' && b.type === 'point') return finitePoint(a) && finitePoint(b) ? metric('Minimum distance', distance(a, b)) : [];
  if (a.type === 'point' || b.type === 'point') {
    const point = a.type === 'point' ? a : b;
    const curve = a.type === 'point' ? b : a;
    if (!finitePoint(point as CadPoint) || !validCurve(curve, points)) return [];
    return metric('Minimum distance', pointCurveDistance(point as CadPoint, curve, points));
  }
  if (!validCurve(a, points) || !validCurve(b, points)) return [];
  const measurements = metric('Minimum distance', curveDistance(a, b, points, sketch));
  if (a.type === 'line' && b.type === 'line') {
    // Existing driving dimensions may be temporarily unsolved. Resolve the angle
    // from current geometry and the selected rays, never from stored target values.
    const angle = dimensionForSelection({ ...sketch, constraints: [] }, selectedIds, { mode: 'angle', picks });
    if ('constraint' in angle && angle.constraint.type === 'angle') measurements.push(...metric('Angle', angle.constraint.value, 'deg'));
  } else if (isCircular(a) && isCircular(b)) {
    measurements.push(...metric('Center distance', distance(points.get(a.centerId)!, points.get(b.centerId)!)));
  } else {
    const circular = isCircular(a) ? a : b;
    const line = a.type === 'line' ? a : b;
    if (isCircular(circular))
      measurements.push(...metric('Center to line', pointCurveDistance(points.get(circular.centerId)!, line, points)));
  }
  return measurements;
}
