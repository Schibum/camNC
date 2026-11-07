import { newCadId } from './document';
import { CAD_GEOMETRY_TOLERANCE, evaluateCadPart } from './geometry';
import type { CadArcEntity, CadConstraint, CadLineEntity, CadPoint, CadPointEntity, CadSketch } from './types';
import { pointEquivalence, type CadPointEquivalence } from './pointEquivalence';

export type CadFilletSelection = { ok: true; cornerPointIds: string[] } | { ok: false; message: string; cornerPointIds: string[] };

export interface CadFilletOptions {
  cornerPointIds: readonly string[];
  /** Radius for the first application. A shared radius constraint supplies the radius on subsequent applications. */
  radius: number;
  sharedRadiusConstraintId?: string;
}

export type CadFilletResult =
  | { ok: true; sketch: CadSketch; cornerPointIds: string[]; arcIds: string[]; radiusConstraintId: string }
  | { ok: false; message: string; cornerPointIds: string[]; maximumRadius?: number };

interface Corner {
  point: CadPointEntity;
  lines: [CadLineEntity, CadLineEntity];
  endpointIds: [string, string];
  aliases: readonly string[];
  directions: [CadPoint, CadPoint];
  lengths: [number, number];
  /** Distance consumed along each incident line, divided by the fillet radius. */
  trimFactor: number;
  centerFactor: number;
  bisector: CadPoint;
}

function connectedCurves(sketch: CadSketch, pointId: string, equivalent: CadPointEquivalence) {
  return sketch.entities.filter(
    entity =>
      entity.type !== 'point' &&
      !entity.construction &&
      'startId' in entity &&
      'endId' in entity &&
      (equivalent.equivalent(entity.startId, pointId) || equivalent.equivalent(entity.endId, pointId))
  );
}

function lineCorner(sketch: CadSketch, pointId: string, equivalent: CadPointEquivalence): Corner | string {
  const point = sketch.entities.find((entity): entity is CadPointEntity => entity.type === 'point' && entity.id === pointId);
  const connected = connectedCurves(sketch, pointId, equivalent);
  if (!point || connected.length !== 2 || !connected.every((entity): entity is CadLineEntity => entity.type === 'line'))
    return 'Select a corner shared by exactly two straight profile lines.';
  const lines = connected as [CadLineEntity, CadLineEntity];
  const endpointIds = lines.map(line => (equivalent.equivalent(line.startId, pointId) ? line.startId : line.endId)) as [string, string];
  const ends = lines.map(line =>
    sketch.entities.find(
      (entity): entity is CadPointEntity =>
        entity.type === 'point' && entity.id === (equivalent.equivalent(line.startId, pointId) ? line.endId : line.startId)
    )
  );
  if (!ends.every((end): end is CadPointEntity => !!end) || ![point, ...ends].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)))
    return 'Repair the corner’s missing or invalid endpoints before adding a fillet.';
  const lengths = ends.map(end => Math.hypot(end.x - point.x, end.y - point.y)) as [number, number];
  if (lengths.some(length => length <= CAD_GEOMETRY_TOLERANCE)) return 'A fillet needs two nonzero straight segments.';
  const directions = ends.map((end, i) => ({ x: (end.x - point.x) / lengths[i]!, y: (end.y - point.y) / lengths[i]! })) as [
    CadPoint,
    CadPoint,
  ];
  const [u, v] = directions;
  const dot = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y));
  const angle = Math.acos(dot);
  if (Math.abs(u.x * v.y - u.y * v.x) < 1e-8) return 'A straight or folded-back junction cannot be filleted.';
  const bisectorLength = Math.hypot(u.x + v.x, u.y + v.y);
  return {
    point,
    lines,
    endpointIds,
    aliases: equivalent.members(pointId),
    directions,
    lengths,
    trimFactor: 1 / Math.tan(angle / 2),
    centerFactor: 1 / Math.sin(angle / 2),
    bisector: { x: (u.x + v.x) / bisectorLength, y: (u.y + v.y) / bisectorLength },
  };
}

/** Explicit corner points and pairs of selected incident lines resolve to the same atomic operation. */
export function resolveFilletCorners(sketch: CadSketch, selectedIds: readonly string[]): CadFilletSelection {
  const equivalent = pointEquivalence(sketch.constraints);
  const selected = [...new Set(selectedIds)];
  const corners = new Set<string>();
  const lines = new Set<string>();
  for (const id of selected) {
    const entity = sketch.entities.find(candidate => candidate.id === id);
    if (entity?.type === 'point') corners.add(equivalent.canonical(id));
    else if (entity?.type === 'line' && !entity.construction) lines.add(id);
    else
      return {
        ok: false,
        cornerPointIds: [...corners],
        message: 'Fillet currently supports straight profile lines and their shared corner points.',
      };
  }
  const pairedLines = new Set<string>();
  for (const entity of sketch.entities) {
    if (entity.type !== 'point') continue;
    const connected = connectedCurves(sketch, entity.id, equivalent);
    if (connected.length === 2 && connected.every(curve => lines.has(curve.id))) {
      corners.add(equivalent.canonical(entity.id));
      connected.forEach(curve => pairedLines.add(curve.id));
    }
  }
  for (const id of corners) {
    const corner = lineCorner(sketch, id, equivalent);
    if (typeof corner === 'string') return { ok: false, cornerPointIds: [id], message: corner };
    corner.lines.forEach(line => pairedLines.add(line.id));
  }
  if (!corners.size || [...lines].some(id => !pairedLines.has(id)))
    return { ok: false, cornerPointIds: [...corners], message: 'Select a shared corner point or two adjacent straight lines.' };
  return { ok: true, cornerPointIds: [...corners] };
}

/**
 * Round line-line corners in one detached transaction. Original corners become virtual sharp references,
 * so existing dimensions retain their meaning while persistent tangent/radius/equal constraints drive the arcs.
 */
export function filletLineCorners(sketch: CadSketch, options: CadFilletOptions): CadFilletResult {
  const equivalent = pointEquivalence(sketch.constraints);
  const cornerPointIds = [...new Set(options.cornerPointIds.map(equivalent.canonical))];
  if (!cornerPointIds.length) return { ok: false, cornerPointIds, message: 'Select at least one corner to fillet.' };
  const shared = options.sharedRadiusConstraintId
    ? sketch.constraints.find(constraint => constraint.id === options.sharedRadiusConstraintId)
    : undefined;
  const sharedArc = shared?.type === 'radius' ? sketch.entities.find(entity => entity.id === shared.entityId) : undefined;
  if (options.sharedRadiusConstraintId && (shared?.type !== 'radius' || sharedArc?.type !== 'arc'))
    return { ok: false, cornerPointIds, message: 'The shared fillet radius is no longer available. Start a new fillet application.' };
  const radius = shared?.type === 'radius' ? shared.value : options.radius;
  if (!Number.isFinite(radius) || radius <= CAD_GEOMETRY_TOLERANCE)
    return { ok: false, cornerPointIds, message: 'Enter a finite fillet radius greater than zero.' };
  const corners: Corner[] = [];
  for (const id of cornerPointIds) {
    const corner = lineCorner(sketch, id, equivalent);
    if (typeof corner === 'string') return { ok: false, cornerPointIds: [id], message: corner };
    corners.push(corner);
  }
  const consumption = new Map<string, { length: number; factor: number; corners: string[] }>();
  for (const corner of corners)
    corner.lines.forEach((line, i) => {
      const previous = consumption.get(line.id);
      consumption.set(line.id, {
        length: corner.lengths[i]!,
        factor: (previous?.factor ?? 0) + corner.trimFactor,
        corners: [...(previous?.corners ?? []), corner.point.id],
      });
    });
  for (const edge of consumption.values())
    if (radius * edge.factor >= edge.length - CAD_GEOMETRY_TOLERANCE)
      return {
        ok: false,
        cornerPointIds: edge.corners,
        maximumRadius: (edge.length - CAD_GEOMETRY_TOLERANCE) / edge.factor,
        message: 'This radius would consume an entire adjacent line. Choose a smaller radius.',
      };

  const next = structuredClone(sketch);
  const arcIds: string[] = [];
  const radiusConstraintId = shared?.id ?? newCadId();
  let equalToArcId = sharedArc?.id;
  for (const corner of corners) {
    const center: CadPointEntity = {
      id: newCadId(),
      type: 'point',
      x: corner.point.x + corner.bisector.x * radius * corner.centerFactor,
      y: corner.point.y + corner.bisector.y * radius * corner.centerFactor,
    };
    const endpoints = corner.directions.map(direction => ({
      id: newCadId(),
      type: 'point' as const,
      x: corner.point.x + direction.x * radius * corner.trimFactor,
      y: corner.point.y + direction.y * radius * corner.trimFactor,
    })) as [CadPointEntity, CadPointEntity];
    const angles = endpoints.map(endpoint => Math.atan2(endpoint.y - center.y, endpoint.x - center.x)) as [number, number];
    const sweep = (((angles[1] - angles[0]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const start = sweep <= Math.PI ? 0 : 1,
      end = 1 - start;
    const arc: CadArcEntity = {
      id: newCadId(),
      type: 'arc',
      centerId: center.id,
      startId: endpoints[start]!.id,
      endId: endpoints[end]!.id,
      radius,
      startAngle: angles[start]!,
      endAngle: angles[end]!,
    };
    for (const id of corner.aliases) {
      const virtual = next.entities.find(entity => entity.id === id);
      if (virtual) virtual.construction = true;
    }
    corner.lines.forEach((line, i) => {
      const retained = next.entities.find((entity): entity is CadLineEntity => entity.id === line.id && entity.type === 'line')!;
      if (retained.startId === corner.endpointIds[i]) retained.startId = endpoints[i]!.id;
      if (retained.endId === corner.endpointIds[i]) retained.endId = endpoints[i]!.id;
      const pointId = corner.endpointIds[i]!;
      if (
        !next.constraints.some(
          constraint => constraint.type === 'pointOnLine' && constraint.pointId === pointId && constraint.entityId === line.id
        )
      )
        next.constraints.push({ id: newCadId(), type: 'pointOnLine', pointId, entityId: line.id });
      next.constraints.push({ id: newCadId(), type: 'tangent', entityAId: line.id, entityBId: arc.id });
    });
    next.entities.push(center, ...endpoints, arc);
    arcIds.push(arc.id);
    const size: CadConstraint = equalToArcId
      ? { id: newCadId(), type: 'equal', entityAId: equalToArcId, entityBId: arc.id }
      : { id: radiusConstraintId, type: 'radius', entityId: arc.id, value: radius, label: 'Fillet radius' };
    next.constraints.push(size);
    equalToArcId ??= arc.id;
  }
  const profile = (value: CadSketch) =>
    evaluateCadPart({ id: 'fillet-validation', name: 'Fillet validation', thickness: 1, sketch: value });
  if (profile(sketch).part && !profile(next).part)
    return { ok: false, cornerPointIds, message: 'This radius would make the fillet cross, touch, or disconnect other profile geometry.' };
  return { ok: true, sketch: next, cornerPointIds, arcIds, radiusConstraintId };
}
