import { constraintEntityIds, entityPointIds, newCadId, originId, removeEntity } from './document';
import { constraintForCurveContact, curveContacts } from './curveContacts';
import { curveEndpointIds, isNurbsCurve } from './curves';
import { pointEquivalence } from './pointEquivalence';
import { isOwnedSplineHandle } from './splineHandles';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import type { CadArcEntity, CadConstraint, CadEntity, CadLineEntity, CadPoint, CadPointEntity, CadSketch } from './types';

export interface CadExtendOptions {
  entityId: string;
  /** Chosen by the initial pick. The target never silently switches this endpoint. */
  end: 'start' | 'end';
  target: CadPoint;
  /** A picked finite boundary takes precedence over the pointer's off-support projection. */
  boundaryId?: string;
}
export type CadExtendResult =
  | { ok: false; message: string }
  | {
      ok: true;
      sketch: CadSketch;
      entityId: string;
      end: 'start' | 'end';
      kind: 'extend' | 'delete' | 'circle';
      point?: CadPoint;
      pointId?: string;
      boundaryId?: string;
      createdEntityIds: string[];
      changedEntityIds: string[];
      removedEntityIds: string[];
      removedConstraintIds: string[];
    };

type OpenCurve = CadLineEntity | CadArcEntity;
type Curve = Exclude<CadEntity, { type: 'point' }>;
interface Contact {
  point: CadPoint;
  distance: number;
  boundaryIds: string[];
  pointId?: string;
}
const epsilon = CAD_GEOMETRY_TOLERANCE;
const tau = 2 * Math.PI;
const wrap = (angle: number) => ((angle % tau) + tau) % tau;
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const finite = (p: CadPoint) => Number.isFinite(p.x) && Number.isFinite(p.y);

function result(
  before: CadSketch,
  sketch: CadSketch,
  options: CadExtendOptions,
  kind: 'extend' | 'delete' | 'circle',
  extra: { point?: CadPoint; pointId?: string; boundaryId?: string } = {}
): CadExtendResult {
  const old = new Map(before.entities.map(entity => [entity.id, entity]));
  const ids = new Set(sketch.entities.map(entity => entity.id));
  const constraints = new Set(sketch.constraints.map(constraint => constraint.id));
  return {
    ok: true,
    sketch,
    entityId: options.entityId,
    end: options.end,
    kind,
    ...extra,
    createdEntityIds: sketch.entities.filter(entity => !old.has(entity.id)).map(entity => entity.id),
    changedEntityIds: sketch.entities
      .filter(entity => old.has(entity.id) && JSON.stringify(old.get(entity.id)) !== JSON.stringify(entity))
      .map(entity => entity.id),
    removedEntityIds: before.entities.filter(entity => !ids.has(entity.id)).map(entity => entity.id),
    removedConstraintIds: before.constraints.filter(constraint => !constraints.has(constraint.id)).map(constraint => constraint.id),
  };
}

/** A finite hull bounds every support-line intersection without an arbitrary long synthetic ray. */
function projectionRange(
  curve: Curve,
  points: ReadonlyMap<string, CadPointEntity>,
  origin: CadPoint,
  direction: CadPoint
): [number, number] {
  const project = (point: CadPoint) => (point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y;
  if (curve.type === 'arc' || curve.type === 'circle') {
    const center = points.get(curve.centerId);
    if (!center || !finite(center) || !Number.isFinite(curve.radius) || curve.radius <= epsilon)
      throw new Error('Repair the boundary geometry before extending.');
    const middle = project(center);
    return [middle - curve.radius, middle + curve.radius];
  }
  const refs = entityPointIds(curve).map(id => points.get(id));
  if (!refs.length || refs.some(point => !point || !finite(point))) throw new Error('Repair the boundary geometry before extending.');
  const values = refs.map(point => project(point!));
  return [Math.min(...values), Math.max(...values)];
}

function lineContacts(origin: CadPoint, end: CadPoint, boundary: CadEntity, points: ReadonlyMap<string, CadPointEntity>): CadPoint[] {
  const length = distance(origin, end);
  if (length <= epsilon) return [];
  if (boundary.type === 'point') {
    const along = ((boundary.x - origin.x) * (end.x - origin.x) + (boundary.y - origin.y) * (end.y - origin.y)) / (length * length);
    const normal = Math.abs((boundary.x - origin.x) * (end.y - origin.y) - (boundary.y - origin.y) * (end.x - origin.x)) / length;
    return normal <= epsilon && along >= -epsilon / length && along <= 1 + epsilon / length ? [boundary] : [];
  }
  const temporary = new Map(points);
  const a = newCadId(),
    b = newCadId();
  temporary.set(a, { id: a, type: 'point', ...origin });
  temporary.set(b, { id: b, type: 'point', ...end });
  const contact = curveContacts({ id: newCadId(), type: 'line', startId: a, endId: b }, boundary, temporary, epsilon);
  if (contact.overlap) throw new Error('The boundary overlaps the extension support. Choose an isolated intersection.');
  return contact.points;
}

function selectedLineBoundary(
  boundary: CadEntity,
  origin: CadPoint,
  direction: CadPoint,
  points: ReadonlyMap<string, CadPointEntity>,
  sign: number
): CadPoint {
  if (boundary.type === 'point') {
    const off = Math.abs((boundary.x - origin.x) * direction.y - (boundary.y - origin.y) * direction.x);
    if (off > epsilon) throw new Error('The selected point is not on this line’s support.');
    return boundary;
  }
  const [low, high] = projectionRange(boundary, points, origin, direction);
  const from = { x: origin.x + direction.x * (low - epsilon * 2), y: origin.y + direction.y * (low - epsilon * 2) };
  const to = { x: origin.x + direction.x * (high + epsilon * 2), y: origin.y + direction.y * (high + epsilon * 2) };
  const contacts = lineContacts(from, to, boundary, points)
    .map(point => ({ point, along: ((point.x - origin.x) * direction.x + (point.y - origin.y) * direction.y) * sign }))
    .filter(contact => contact.along > epsilon)
    .sort((a, b) => a.along - b.along);
  if (!contacts.length) throw new Error('The selected boundary does not intersect this endpoint’s extension.');
  return contacts[0]!.point;
}

function firstContact(
  sketch: CadSketch,
  source: OpenCurve,
  points: ReadonlyMap<string, CadPointEntity>,
  maximum: number,
  contacts: (boundary: CadEntity) => CadPoint[],
  progress: (point: CadPoint) => number,
  preferred?: string
): Contact | undefined {
  let first: Contact | undefined;
  for (const boundary of sketch.entities) {
    // Guides (including the origin) do not stop a free extension. An explicit
    // boundary pick must still keep its persistent contact when that guide moves.
    if (boundary.id === source.id || (boundary.construction && boundary.id !== preferred)) continue;
    if (boundary.type === 'point' && !boundary.standalone && boundary.id !== preferred) continue;
    for (const point of contacts(boundary)) {
      const along = progress(point);
      if (!Number.isFinite(along) || along <= epsilon || along > maximum + epsilon) continue;
      if (first && along > first.distance + epsilon) continue;
      const endpoint =
        boundary.type === 'point'
          ? boundary
          : curveEndpointIds(boundary)
              .map(id => points.get(id))
              .find(candidate => candidate && distance(candidate, point) <= epsilon);
      if (first && Math.abs(along - first.distance) <= epsilon) {
        first.boundaryIds.push(boundary.id);
        first.pointId ??= endpoint?.id;
      } else first = { point, distance: along, boundaryIds: [boundary.id], pointId: endpoint?.id };
    }
  }
  return first;
}

function ownsOffset(constraint: CadConstraint, id: string): boolean {
  if (!('members' in constraint) || !Array.isArray(constraint.members)) return false;
  return constraint.members.some(
    (member: unknown) =>
      !!member &&
      typeof member === 'object' &&
      (('sourceId' in member && member.sourceId === id) || ('targetId' in member && member.targetId === id))
  );
}

/** Keep support relations, detach the moved endpoint, and never move neighboring source points. */
function replaceEndpoint(
  sketch: CadSketch,
  source: OpenCurve,
  options: CadExtendOptions,
  point: CadPoint,
  contact: Contact | undefined,
  circle = false
): CadExtendResult {
  const next = structuredClone(sketch);
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(entity => [entity.id, entity])
  );
  const oldPointId = options.end === 'start' ? source.startId : source.endId;
  let pointId: string | undefined;
  let replacement: Curve;
  if (circle && source.type === 'arc') {
    replacement = { id: source.id, type: 'circle', centerId: source.centerId, radius: source.radius, construction: source.construction };
    // A circle has no endpoint slot, so retain a source point as the persistent
    // boundary witness when the completion itself lands on another curve.
    if (contact) pointId = contact.pointId ?? (options.end === 'start' ? source.endId : source.startId);
  } else {
    const candidate = contact?.pointId ? points.get(contact.pointId) : undefined;
    pointId = candidate?.id ?? newCadId();
    if (!candidate)
      next.entities.push({ id: pointId, type: 'point', x: point.x, y: point.y, standalone: false, construction: source.construction });
    replacement = { ...source, ...(options.end === 'start' ? { startId: pointId } : { endId: pointId }) };
    if (replacement.type === 'arc') {
      const center = points.get(replacement.centerId)!;
      const angle = Math.atan2(point.y - center.y, point.x - center.x);
      if (options.end === 'start') replacement.startAngle = angle;
      else replacement.endAngle = angle;
    }
  }
  next.entities = next.entities.map(entity => (entity.id === source.id ? replacement : entity));
  const equivalent = pointEquivalence(sketch.constraints);
  next.constraints = next.constraints.flatMap((constraint): CadConstraint[] => {
    if (ownsOffset(constraint, source.id)) return [];
    if ('sourceEntityId' in constraint && constraint.sourceEntityId === source.id) return [];
    if (source.type === 'line' && constraint.type === 'equal' && [constraint.entityAId, constraint.entityBId].includes(source.id))
      return [];
    if (source.type === 'line' && constraint.type === 'midpoint' && constraint.entityId === source.id)
      return [{ ...constraint, type: 'pointOnLine' }];
    if (constraint.type === 'tangent' && [constraint.entityAId, constraint.entityBId].includes(source.id)) {
      const other = sketch.entities.find(
        entity => entity.id === (constraint.entityAId === source.id ? constraint.entityBId : constraint.entityAId)
      );
      if (other && isNurbsCurve(other) && !equivalent.match(curveEndpointIds(replacement), curveEndpointIds(other))) return [];
    }
    return [constraint];
  });
  // An old shared/explicit point is retained at its original location. Its compatible
  // support attachment survives even though it no longer owns this curve's endpoint.
  const formerlyOwned = new Set(entityPointIds(source));
  const used = equivalent.expand([...next.entities.flatMap(entityPointIds), ...(circle && pointId ? [pointId] : [])]);
  const removed = new Set(
    next.entities
      .filter(
        entity =>
          entity.type === 'point' &&
          formerlyOwned.has(entity.id) &&
          !used.has(entity.id) &&
          !entity.standalone &&
          !entity.fixed &&
          entity.id !== originId(sketch)
      )
      .map(entity => entity.id)
  );
  next.entities = next.entities.filter(entity => !removed.has(entity.id));
  next.constraints = next.constraints.filter(constraint => !constraintEntityIds(constraint).some(id => removed.has(id)));
  if (pointId && contact)
    for (const boundaryId of contact.boundaryIds) {
      const boundary = sketch.entities.find(entity => entity.id === boundaryId);
      if (!boundary || boundary.type === 'point' || curveEndpointIds(boundary).includes(pointId)) continue;
      const relation = constraintForCurveContact(pointId, boundary, points, point);
      if (
        !next.constraints.some(
          constraint =>
            constraint.type === relation.type &&
            'pointId' in constraint &&
            constraint.pointId === pointId &&
            constraint.entityId === boundaryId
        )
      )
        next.constraints.push({ id: newCadId(), ...relation });
    }
  if (
    circle &&
    pointId &&
    !next.constraints.some(
      constraint => constraint.type === 'pointOnCircle' && constraint.pointId === pointId && constraint.entityId === source.id
    )
  )
    next.constraints.push({ id: newCadId(), type: 'pointOnCircle', pointId, entityId: source.id });
  // Preserve the former junction's support relation, including explicit coincidence
  // aliases. Circle completion retains both surviving endpoint contacts.
  const attachments = circle ? [source.startId, source.endId] : [oldPointId];
  for (const oldId of attachments) {
    if (
      removed.has(oldId) ||
      !next.entities.some(entity => entity.id === oldId) ||
      curveEndpointIds(replacement).some(id => equivalent.equivalent(id, oldId))
    )
      continue;
    const relation =
      replacement.type === 'line'
        ? { type: 'pointOnLine' as const, pointId: oldId, entityId: source.id }
        : { type: 'pointOnCircle' as const, pointId: oldId, entityId: source.id };
    if (
      !next.constraints.some(
        constraint =>
          constraint.type === relation.type && 'pointId' in constraint && constraint.pointId === oldId && constraint.entityId === source.id
      )
    )
      next.constraints.push({ id: newCadId(), ...relation });
  }
  return result(sketch, next, options, circle ? 'circle' : 'extend', {
    point,
    ...(pointId && { pointId }),
    ...(contact && { boundaryId: contact.boundaryIds.includes(options.boundaryId ?? '') ? options.boundaryId : contact.boundaryIds[0] }),
  });
}

/** Extend a picked line/arc endpoint atomically; the same detached result serves preview and commit. */
export function extendSketchCurve(sketch: CadSketch, options: CadExtendOptions): CadExtendResult {
  const source = sketch.entities.find(entity => entity.id === options.entityId);
  if (source && isOwnedSplineHandle(source))
    return { ok: false, message: 'Spline tangent handles belong to their curve and cannot be extended separately.' };
  if (!source || (source.type !== 'line' && source.type !== 'arc'))
    return { ok: false, message: 'Extend supports a straight line or a finite circular arc.' };
  if (!finite(options.target) || !['start', 'end'].includes(options.end))
    return { ok: false, message: 'Choose a finite target for the picked endpoint.' };
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  const moving = points.get(options.end === 'start' ? source.startId : source.endId);
  const fixed = points.get(options.end === 'start' ? source.endId : source.startId);
  if (!moving || !fixed || !finite(moving) || !finite(fixed) || distance(moving, fixed) <= epsilon)
    return { ok: false, message: 'Repair this curve’s endpoints before extending.' };
  const boundary = options.boundaryId
    ? sketch.entities.find(entity => entity.id === options.boundaryId && entity.id !== source.id)
    : undefined;
  if (options.boundaryId && !boundary) return { ok: false, message: 'The selected boundary is no longer available.' };
  try {
    if (source.type === 'line') {
      const length = distance(moving, fixed);
      const unit = { x: (moving.x - fixed.x) / length, y: (moving.y - fixed.y) / length };
      const requested = (options.target.x - moving.x) * unit.x + (options.target.y - moving.y) * unit.y;
      if (Math.abs(requested) <= epsilon) return { ok: false, message: 'Choose a different endpoint position.' };
      const sign = Math.sign(requested);
      let target = { x: moving.x + unit.x * requested, y: moving.y + unit.y * requested };
      if (boundary) target = selectedLineBoundary(boundary, moving, unit, points, sign);
      const maximum = distance(moving, target);
      const direction = { x: unit.x * sign, y: unit.y * sign };
      const contact = firstContact(
        sketch,
        source,
        points,
        maximum,
        candidate => lineContacts(moving, target, candidate, points),
        point => (point.x - moving.x) * direction.x + (point.y - moving.y) * direction.y,
        options.boundaryId
      );
      if (contact) target = contact.point;
      if ((target.x - fixed.x) * unit.x + (target.y - fixed.y) * unit.y <= epsilon)
        return result(sketch, removeEntity(structuredClone(sketch), source.id), options, 'delete', { point: target });
      return replaceEndpoint(sketch, source, options, target, contact);
    }
    const center = points.get(source.centerId);
    if (
      !center ||
      !finite(center) ||
      !Number.isFinite(source.radius) ||
      source.radius <= epsilon ||
      distance(options.target, center) <= epsilon
    )
      return { ok: false, message: 'Choose a target away from the arc center.' };
    const sweep = wrap(source.endAngle - source.startAngle);
    if (
      sweep * source.radius <= epsilon ||
      Math.abs(distance(moving, center) - source.radius) > epsilon ||
      Math.abs(distance(fixed, center) - source.radius) > epsilon
    )
      return { ok: false, message: 'Solve this finite arc before extending it.' };
    const angle = Math.atan2(options.target.y - center.y, options.target.x - center.x);
    const fixedAngle = options.end === 'end' ? source.startAngle : source.endAngle;
    let desired = options.end === 'end' ? wrap(angle - fixedAngle) : wrap(fixedAngle - angle);
    if (Math.min(desired, tau - desired) * source.radius <= epsilon) desired = tau;
    let amount = desired - sweep;
    if (Math.abs(amount) * source.radius <= epsilon) return { ok: false, message: 'Choose a different endpoint position.' };
    const direction = (options.end === 'end' ? 1 : -1) * Math.sign(amount);
    const oldAngle = options.end === 'end' ? source.endAngle : source.startAngle;
    const circular = { id: source.id, type: 'circle' as const, centerId: source.centerId, radius: source.radius };
    const contacts = (candidate: CadEntity) => {
      if (candidate.type === 'point') return Math.abs(distance(candidate, center) - source.radius) <= epsilon ? [candidate] : [];
      const found = curveContacts(circular, candidate, points, epsilon);
      if (found.overlap) throw new Error('The boundary overlaps the arc’s circle. Choose an isolated intersection.');
      return found.points;
    };
    const progress = (point: CadPoint) => wrap((Math.atan2(point.y - center.y, point.x - center.x) - oldAngle) * direction) * source.radius;
    if (boundary) {
      const candidates = contacts(boundary)
        .map(point => ({ point, along: progress(point) }))
        .filter(contact => contact.along > epsilon && contact.along <= (amount > 0 ? tau - sweep : sweep) * source.radius + epsilon)
        .sort((a, b) => a.along - b.along);
      if (!candidates.length) return { ok: false, message: 'The selected boundary does not intersect this endpoint’s extension.' };
      amount = (Math.sign(amount) * candidates[0]!.along) / source.radius;
      desired = sweep + amount;
    }
    const contact = firstContact(sketch, source, points, Math.abs(amount) * source.radius, contacts, progress, options.boundaryId);
    if (contact) {
      amount = (Math.sign(amount) * contact.distance) / source.radius;
      desired = sweep + amount;
    }
    const nextAngle = oldAngle + direction * Math.abs(amount);
    const target = contact?.point ?? {
      x: center.x + source.radius * Math.cos(nextAngle),
      y: center.y + source.radius * Math.sin(nextAngle),
    };
    return replaceEndpoint(sketch, source, options, target, contact, (tau - desired) * source.radius <= epsilon);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'This boundary cannot be analyzed safely.' };
  }
}
