import {
  isOwnedSplineHandle,
  CAD_GEOMETRY_TOLERANCE,
  constraintEntityIds,
  constraintForCurveContact,
  curveContacts,
  curveEndpointIds,
  entityPointIds,
  newCadId,
  originId,
  pointEquivalence,
  type CadConstraint,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';

type Point = { x: number; y: number };
const tau = Math.PI * 2;
const wrap = (angle: number) => ((angle % tau) + tau) % tau;

/** Converts the start → end → through-point gesture to a counterclockwise arc. */
export function threePointArc(start: Point, end: Point, through: Point) {
  const det = 2 * (start.x * (end.y - through.y) + end.x * (through.y - start.y) + through.x * (start.y - end.y));
  if (Math.abs(det) < 1e-8) return null;
  const squared = (p: Point) => p.x * p.x + p.y * p.y;
  const cx = (squared(start) * (end.y - through.y) + squared(end) * (through.y - start.y) + squared(through) * (start.y - end.y)) / det;
  const cy = (squared(start) * (through.x - end.x) + squared(end) * (start.x - through.x) + squared(through) * (end.x - start.x)) / det;
  const a = Math.atan2(start.y - cy, start.x - cx),
    b = Math.atan2(end.y - cy, end.x - cx),
    c = Math.atan2(through.y - cy, through.x - cx);
  const contains = wrap(c - a) < wrap(b - a);
  return { cx, cy, radius: Math.hypot(start.x - cx, start.y - cy), startAngle: contains ? a : b, endAngle: contains ? b : a };
}

/** Arc from a chain endpoint with a prescribed incoming direction, as in Line → Shift+A. */
export function tangentArcFrom(start: Point, tangent: Point, end: Point) {
  const length = Math.hypot(tangent.x, tangent.y);
  if (!Number.isFinite(length) || length < 1e-9) return null;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (!Number.isFinite(chord) || chord < 1e-7) return null;
  const nx = -tangent.y / length,
    ny = tangent.x / length;
  const projection = dx * nx + dy * ny;
  // A point on the tangent itself has no finite circle through it and the start.
  if (Math.abs(projection) < 1e-8 * Math.max(1, chord)) return null;
  const signedRadius = (chord * chord) / (2 * projection);
  const cx = start.x + nx * signedRadius,
    cy = start.y + ny * signedRadius;
  const radius = Math.abs(signedRadius);
  const startAngle = Math.atan2(start.y - cy, start.x - cx),
    endAngle = Math.atan2(end.y - cy, end.x - cx);
  const direction = signedRadius > 0 ? 1 : -1;
  return {
    cx,
    cy,
    radius,
    startAngle: direction > 0 ? startAngle : endAngle,
    endAngle: direction > 0 ? endAngle : startAngle,
    endTangent: { x: (-(end.y - cy) / radius) * direction, y: ((end.x - cx) / radius) * direction },
  };
}

/** Trim only the line interval clicked between intersections; untouched curves keep their identities. */
export function trimLineAt(sketch: CadSketch, id: string, hit: Point): CadSketch | null {
  const line = sketch.entities.find(e => e.id === id);
  if (line && isOwnedSplineHandle(line)) return null;
  if (line?.type !== 'line') return null;
  const equivalent = pointEquivalence(sketch.constraints);
  const points = new Map(sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
  const a = points.get(line.startId),
    b = points.get(line.endId);
  if (!a || !b) return null;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length2 = dx * dx + dy * dy;
  const length = Math.sqrt(length2);
  if (length <= CAD_GEOMETRY_TOLERANCE || ![hit.x, hit.y].every(Number.isFinite)) return null;
  const parameterTolerance = CAD_GEOMETRY_TOLERANCE / length;
  const intersections = [0, 1];
  const boundaryPoints = new Map<number, string>([
    [0, a.id],
    [1, b.id],
  ]);
  const boundaryContacts = new Map<number, Set<string>>();
  const add = (t: number, pointId?: string, contactId?: string) => {
    if (t <= parameterTolerance || t >= 1 - parameterTolerance) return;
    const existing = intersections.find(v => Math.abs(v - t) < parameterTolerance);
    const at = existing ?? t;
    if (existing === undefined) intersections.push(t);
    if (pointId && !boundaryPoints.has(at)) boundaryPoints.set(at, pointId);
    if (contactId) boundaryContacts.set(at, new Set([...(boundaryContacts.get(at) ?? []), contactId]));
  };
  const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
  try {
    for (const other of sketch.entities) {
      if (other.id === id || other.type === 'point' || other.construction) continue;
      const contacts = curveContacts(line, other, points, CAD_GEOMETRY_TOLERANCE);
      if (contacts.overlap) return null;
      for (const contact of contacts.points) {
        const t = ((contact.x - a.x) * dx + (contact.y - a.y) * dy) / length2;
        const endpoint = curveEndpointIds(other)
          .map(pointId => points.get(pointId))
          .find(point => point && Math.hypot(point.x - contact.x, point.y - contact.y) <= CAD_GEOMETRY_TOLERANCE);
        add(t, endpoint?.id, other.id);
      }
    }
  } catch {
    // An incomplete or excessively complex boundary must never become a whole-line deletion.
    return null;
  }
  const attachedPoints = new Set(
    sketch.constraints.flatMap(c => ((c.type === 'pointOnLine' || c.type === 'midpoint') && c.entityId === id ? [c.pointId] : []))
  );
  const ownedPoints = new Set(sketch.entities.flatMap(entityPointIds));
  const candidates = [...points.values()]
    .filter(
      point =>
        point.id !== a.id &&
        point.id !== b.id &&
        (attachedPoints.has(point.id) || point.standalone || (!ownedPoints.has(point.id) && point.id !== originId(sketch)))
    )
    .sort((left, right) => Number(attachedPoints.has(right.id)) - Number(attachedPoints.has(left.id)) || left.id.localeCompare(right.id));
  for (const point of candidates) {
    const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2;
    if (Math.abs(dx * (point.y - a.y) - dy * (point.x - a.x)) / length <= CAD_GEOMETRY_TOLERANCE) add(t, point.id);
  }
  intersections.sort((x, y) => x - y);
  const tHit = Math.max(0, Math.min(1, ((hit.x - a.x) * dx + (hit.y - a.y) * dy) / length2));
  const nextIntersection = intersections.findIndex(t => t > tHit);
  const index = nextIntersection < 0 ? intersections.length - 2 : Math.max(0, nextIntersection - 1);
  const lo = intersections[index]!,
    hi = intersections[index + 1]!;
  const addedPoints: CadPointEntity[] = [];
  const boundary = (t: number) => {
    const known = boundaryPoints.get(t);
    if (known) return known;
    const p = at(t);
    const existing = [...points.values(), ...addedPoints].find(point => Math.hypot(point.x - p.x, point.y - p.y) <= CAD_GEOMETRY_TOLERANCE);
    if (existing) return existing.id;
    const point: CadPointEntity = { id: newCadId(), type: 'point', ...p, construction: line.construction };
    addedPoints.push(point);
    return point.id;
  };
  const intervals = [...(lo > parameterTolerance ? [[0, lo] as const] : []), ...(hi < 1 - parameterTolerance ? [[hi, 1] as const] : [])];
  const retained = intervals.map(([from, to], index) => ({
    ...line,
    id: index ? newCadId() : line.id,
    startId: boundary(from),
    endId: boundary(to),
  }));
  const provisional = sketch.entities.flatMap(entity => (entity.id === line.id ? retained : [entity]));
  const usedPoints = new Set(provisional.flatMap(entityPointIds));
  const removed = new Set(retained.length ? [] : [line.id]);
  const entities = [...provisional, ...addedPoints].filter(entity => {
    const drop =
      entity.type === 'point' &&
      [a.id, b.id].includes(entity.id) &&
      !usedPoints.has(entity.id) &&
      entity.id !== originId(sketch) &&
      !entity.standalone;
    if (drop) removed.add(entity.id);
    return !drop;
  });
  const constraints = sketch.constraints.flatMap((constraint): CadConstraint[] => {
    if (constraintEntityIds(constraint).some(reference => removed.has(reference))) return [];
    if ('sourceEntityId' in constraint && constraint.sourceEntityId === line.id) return [];
    if ((constraint.type === 'pointOnLine' || constraint.type === 'midpoint') && constraint.entityId === line.id) {
      const point = points.get(constraint.pointId);
      if (!point) return [];
      const targetPointId = retained
        .flatMap(edge => [edge.startId, edge.endId])
        .find(pointId => {
          const endpoint = points.get(pointId) ?? addedPoints.find(candidate => candidate.id === pointId);
          return endpoint && Math.hypot(endpoint.x - point.x, endpoint.y - point.y) <= CAD_GEOMETRY_TOLERANCE;
        });
      // Sharing the boundary point is now the attachment; a midpoint equation would shorten it again.
      if (targetPointId)
        return targetPointId === point.id ? [] : [{ id: constraint.id, type: 'coincident', pointAId: point.id, pointBId: targetPointId }];
      const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2;
      const index = intervals.findIndex(([from, to]) => t >= from - parameterTolerance && t <= to + parameterTolerance);
      return index < 0 ? [] : [{ id: constraint.id, type: 'pointOnLine', pointId: point.id, entityId: retained[index]!.id }];
    }
    if ((constraint.type === 'horizontal' || constraint.type === 'vertical') && constraint.entityId === line.id)
      return retained.map((edge, index) => ({ ...constraint, id: index ? newCadId() : constraint.id, entityId: edge.id }));
    if (
      (constraint.type === 'parallel' || constraint.type === 'perpendicular' || constraint.type === 'angle') &&
      [constraint.entityAId, constraint.entityBId].includes(line.id)
    )
      return retained.map((edge, index) => ({
        ...constraint,
        id: index ? newCadId() : constraint.id,
        entityAId: constraint.entityAId === line.id ? edge.id : constraint.entityAId,
        entityBId: constraint.entityBId === line.id ? edge.id : constraint.entityBId,
      }));
    if (constraint.type === 'tangent' && [constraint.entityAId, constraint.entityBId].includes(line.id)) {
      const otherId = constraint.entityAId === line.id ? constraint.entityBId : constraint.entityAId;
      const other = sketch.entities.find(entity => entity.id === otherId);
      const joint = other && equivalent.match(curveEndpointIds(line), curveEndpointIds(other));
      const edge = joint && retained.find(edge => curveEndpointIds(edge).some(pointId => equivalent.equivalent(pointId, joint[0])));
      return edge
        ? [
            {
              ...constraint,
              entityAId: constraint.entityAId === line.id ? edge.id : constraint.entityAId,
              entityBId: constraint.entityBId === line.id ? edge.id : constraint.entityBId,
            },
          ]
        : [];
    }
    if (constraintEntityIds(constraint).includes(line.id)) return [];
    return [constraint];
  });
  for (const t of new Set(intervals.flatMap(interval => [...interval])))
    for (const contactId of boundaryContacts.get(t) ?? []) {
      const pointId = boundary(t),
        curve = sketch.entities.find(entity => entity.id === contactId);
      if (!curve || curve.type === 'point' || curveEndpointIds(curve).includes(pointId)) continue;
      const relation = constraintForCurveContact(pointId, curve, points, at(t));
      if (
        !constraints.some(
          constraint =>
            constraint.type === relation.type &&
            'pointId' in constraint &&
            constraint.pointId === pointId &&
            constraint.entityId === curve.id
        )
      )
        constraints.push({ id: newCadId(), ...relation });
    }
  return { ...sketch, entities, constraints };
}
