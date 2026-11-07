import {
  CAD_GEOMETRY_TOLERANCE,
  constraintEntityIds,
  constraintForCurveContact,
  curveContacts,
  curveEndpointIds,
  entityPointIds,
  isOwnedSplineHandle,
  newCadId,
  originId,
  pointEquivalence,
  removeEntity,
  type CadArcEntity,
  type CadEntity,
  type CadPoint,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
import { trimLineAt } from './geometry';

const tau = 2 * Math.PI;
const epsilon = CAD_GEOMETRY_TOLERANCE;
const wrap = (angle: number) => ((angle % tau) + tau) % tau;
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
type Circular = Extract<CadEntity, { type: 'circle' | 'arc' }>;
interface Contact {
  point: CadPoint;
  pointId?: string;
  contactEntityIds?: string[];
}
interface Boundary extends Contact {
  parameter: number;
}

function onArc(point: CadPoint, arc: CadArcEntity, points: Map<string, CadPointEntity>): boolean {
  const center = points.get(arc.centerId);
  if (!center) return false;
  const parameter = wrap(Math.atan2(point.y - center.y, point.x - center.x) - arc.startAngle);
  const tolerance = epsilon / arc.radius;
  return parameter <= wrap(arc.endAngle - arc.startAngle) + tolerance || tau - parameter <= tolerance;
}

/** Trim a clicked circular interval, preserving explicit points and the original curve identity on one remainder. */
function trimCircularAt(sketch: CadSketch, curve: Circular, hit: CadPoint): CadSketch | null {
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  const center = points.get(curve.centerId);
  if (!center || !Number.isFinite(curve.radius) || curve.radius <= epsilon || ![hit.x, hit.y].every(Number.isFinite)) return null;
  const start = curve.type === 'arc' ? curve.startAngle : 0;
  const sweep = curve.type === 'arc' ? wrap(curve.endAngle - start) : tau;
  if (![start, sweep].every(Number.isFinite) || sweep <= epsilon / curve.radius) return null;
  const angularTolerance = epsilon / curve.radius;
  const boundaries: Boundary[] = [];
  const add = (contact: Contact, endpointParameter?: number) => {
    if (Math.abs(distance(contact.point, center) - curve.radius) > epsilon) return;
    const parameter = endpointParameter ?? wrap(Math.atan2(contact.point.y - center.y, contact.point.x - center.x) - start);
    if (curve.type === 'arc' && parameter > sweep + angularTolerance && tau - parameter > angularTolerance) return;
    const normalized = curve.type === 'arc' ? Math.max(0, Math.min(sweep, tau - parameter <= angularTolerance ? 0 : parameter)) : parameter;
    const previous = boundaries.find(
      boundary =>
        Math.abs(boundary.parameter - normalized) <= angularTolerance ||
        (curve.type === 'circle' && tau - Math.abs(boundary.parameter - normalized) <= angularTolerance)
    );
    if (previous) {
      previous.pointId ??= contact.pointId;
      previous.contactEntityIds = [...new Set([...(previous.contactEntityIds ?? []), ...(contact.contactEntityIds ?? [])])];
    } else boundaries.push({ ...contact, parameter: normalized });
  };
  if (curve.type === 'arc') {
    const a = points.get(curve.startId),
      b = points.get(curve.endId);
    if (!a || !b) return null;
    add({ point: a, pointId: a.id }, 0);
    add({ point: b, pointId: b.id }, sweep);
  }
  const attached = new Set(
    sketch.constraints.flatMap(constraint =>
      constraint.type === 'pointOnCircle' && constraint.entityId === curve.id ? [constraint.pointId] : []
    )
  );
  for (const point of points.values()) if (point.standalone || attached.has(point.id)) add({ point, pointId: point.id });
  try {
    for (const other of sketch.entities) {
      if (other.type === 'point' || other.id === curve.id || other.construction) continue;
      const contacts = curveContacts(curve, other, points, epsilon);
      if (contacts.overlap) return null;
      for (const point of contacts.points) {
        const endpoint = curveEndpointIds(other)
          .map(pointId => points.get(pointId))
          .find(candidate => candidate && distance(point, candidate) <= epsilon);
        add({ point, pointId: endpoint?.id, contactEntityIds: endpoint ? [] : [other.id] });
      }
    }
  } catch {
    // Keep the source intact when a boundary cannot be analyzed safely.
    return null;
  }
  boundaries.sort((a, b) => a.parameter - b.parameter);
  if (curve.type === 'circle' && boundaries.length < 2) return removeEntity(sketch, curve.id);
  if (curve.type === 'arc' && boundaries.length < 2) return null;
  const hitParameter = wrap(Math.atan2(hit.y - center.y, hit.x - center.x) - start);
  const intervals: [number, number][] = [];
  if (curve.type === 'circle') {
    const next = boundaries.findIndex(boundary => boundary.parameter > hitParameter + angularTolerance);
    const hi = next < 0 ? 0 : next,
      lo = (hi + boundaries.length - 1) % boundaries.length;
    const from = boundaries[hi]!.parameter,
      to = boundaries[lo]!.parameter + (lo < hi ? tau : 0);
    intervals.push([from, to <= from ? to + tau : to]);
  } else {
    const parameter =
      hitParameter <= sweep
        ? hitParameter
        : distance(hit, points.get(curve.startId)!) <= distance(hit, points.get(curve.endId)!)
          ? 0
          : sweep;
    const next = boundaries.findIndex(boundary => boundary.parameter > parameter + angularTolerance);
    const index = next < 0 ? boundaries.length - 2 : Math.max(0, next - 1);
    const lo = boundaries[index]!.parameter,
      hi = boundaries[index + 1]!.parameter;
    if (lo > angularTolerance) intervals.push([0, lo]);
    if (hi < sweep - angularTolerance) intervals.push([hi, sweep]);
    if (!intervals.length) return removeEntity(sketch, curve.id);
  }
  const next = structuredClone(sketch);
  next.entities = next.entities.filter(entity => entity.id !== curve.id);
  const endpoint = (parameter: number): string => {
    const normalized = wrap(parameter);
    const boundary = boundaries.find(
      candidate =>
        Math.abs(candidate.parameter - normalized) <= angularTolerance ||
        tau - Math.abs(candidate.parameter - normalized) <= angularTolerance
    )!;
    if (!boundary.pointId) {
      const existing = next.entities.find(
        (entity): entity is CadPointEntity => entity.type === 'point' && distance(entity, boundary.point) <= epsilon
      );
      boundary.pointId = existing?.id ?? newCadId();
      if (!existing)
        next.entities.push({ id: boundary.pointId, type: 'point', ...boundary.point, construction: curve.construction, standalone: false });
    }
    for (const contactId of boundary.contactEntityIds ?? []) {
      const contactCurve = sketch.entities.find(entity => entity.id === contactId);
      if (!contactCurve || contactCurve.type === 'point') continue;
      const relation = constraintForCurveContact(boundary.pointId, contactCurve, points, boundary.point);
      if (
        !next.constraints.some(
          constraint =>
            constraint.type === relation.type &&
            'pointId' in constraint &&
            constraint.pointId === boundary.pointId &&
            constraint.entityId === contactId
        )
      )
        next.constraints.push({ id: newCadId(), ...relation });
    }
    return boundary.pointId;
  };
  const remainders: CadArcEntity[] = [];
  intervals.forEach(([from, to], index) => {
    const arc: CadArcEntity = {
      id: index === 0 ? curve.id : newCadId(),
      type: 'arc',
      centerId: curve.centerId,
      startId: endpoint(from),
      endId: endpoint(to),
      radius: curve.radius,
      startAngle: start + from,
      endAngle: start + to,
      construction: curve.construction,
    };
    next.entities.push(arc);
    remainders.push(arc);
    if (index > 0) next.constraints.push({ id: newCadId(), type: 'equal', entityAId: curve.id, entityBId: arc.id });
  });
  const equivalent = pointEquivalence(sketch.constraints);
  // Points on a removed interval become independent again. Contacts on a surviving piece follow its ID.
  next.constraints = next.constraints.flatMap(constraint => {
    // A trim changes finite ownership. Retaining a circle member after circle→arc
    // conversion is invalid; retaining an arc member can restore its old extent
    // or feed later copy edits back into the source. Match line-trim semantics:
    // release the complete owning Offset group while keeping unrelated drivers.
    if (constraint.type === 'offset' && constraintEntityIds(constraint).includes(curve.id)) return [];
    if (constraint.type === 'tangent' && [constraint.entityAId, constraint.entityBId].includes(curve.id)) {
      const otherId = constraint.entityAId === curve.id ? constraint.entityBId : constraint.entityAId;
      const other = sketch.entities.find(entity => entity.id === otherId);
      const joint = other && equivalent.match(curveEndpointIds(curve), curveEndpointIds(other));
      // Support-circle tangency has no endpoint ownership to rebind.
      if (!joint) return [constraint];
      const remainder = remainders.find(arc => curveEndpointIds(arc).some(pointId => equivalent.equivalent(pointId, joint[0])));
      return remainder
        ? [
            {
              ...constraint,
              entityAId: constraint.entityAId === curve.id ? remainder.id : constraint.entityAId,
              entityBId: constraint.entityBId === curve.id ? remainder.id : constraint.entityBId,
            },
          ]
        : [];
    }
    if (constraint.type !== 'pointOnCircle' || constraint.entityId !== curve.id) return [constraint];
    const sourcePoint = points.get(constraint.pointId);
    const remainder = sourcePoint && remainders.find(arc => onArc(sourcePoint, arc, points));
    return remainder ? [{ ...constraint, entityId: remainder.id }] : [];
  });
  // Discard only implicit points formerly owned by the trimmed curve; standalone points remain available.
  const used = new Set(next.entities.flatMap(entityPointIds));
  const formerlyOwned = new Set(entityPointIds(curve));
  const removed = new Set(
    next.entities
      .filter(
        entity =>
          entity.type === 'point' &&
          formerlyOwned.has(entity.id) &&
          !entity.standalone &&
          entity.id !== originId(sketch) &&
          !used.has(entity.id)
      )
      .map(entity => entity.id)
  );
  next.entities = next.entities.filter(entity => !removed.has(entity.id));
  next.constraints = next.constraints.filter(constraint => !constraintEntityIds(constraint).some(id => removed.has(id)));
  return next;
}

/** Shared entry point: line, circle and finite arc trims use the same atomic editor command. */
export function trimSketchCurveAt(sketch: CadSketch, id: string, hit: CadPoint): CadSketch | null {
  const curve = sketch.entities.find(entity => entity.id === id);
  if (curve && isOwnedSplineHandle(curve)) return null;
  if (curve?.type === 'line') return trimLineAt(sketch, id, hit);
  if (curve?.type === 'circle' || curve?.type === 'arc') return trimCircularAt(sketch, curve, hit);
  return null;
}
