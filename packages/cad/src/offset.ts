import { newCadId } from './document';
import { offsetSupport, projectOffsetSupport, intersectOffsetSupports, type OffsetSupport } from './offsetGeometry';
import { tessellateCurve } from './curves';
import { CAD_GEOMETRY_TOLERANCE, evaluateCadPart, polygonArea } from './geometry';
import { pointEquivalence } from './pointEquivalence';
import { isOwnedSplineHandle } from './splineHandles';
import type {
  CadArcEntity,
  CadCircleEntity,
  CadEntity,
  CadLineEntity,
  CadOffsetMember,
  CadPoint,
  CadPointEntity,
  CadSketch,
} from './types';

export interface CadOffsetOptions {
  entityIds: readonly string[];
  /** Positive closed-profile values go inward; a single line uses its source-left normal. */
  value: number;
  /** Explicitly include connected curves. A single selected edge stays single by default. */
  wholeLoop?: boolean;
}

export type CadOffsetResult =
  | { ok: true; sketch: CadSketch; sourceIds: string[]; entityIds: string[]; dimensionId: string }
  | { ok: false; message: string };

type Curve = CadLineEntity | CadCircleEntity | CadArcEntity;
type Edge = CadLineEntity | CadArcEntity;
type Step = { curve: Edge; forward: boolean };

const tau = 2 * Math.PI;
const tolerance = CAD_GEOMETRY_TOLERANCE;
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const wrap = (angle: number) => ((angle % tau) + tau) % tau;
const angularChange = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const supported = (entity: CadEntity): entity is Curve => ['line', 'circle', 'arc'].includes(entity.type);

function endpoints(curve: Edge) {
  return [curve.startId, curve.endId];
}

function selectCurves(sketch: CadSketch, options: CadOffsetOptions): Curve[] | string {
  const selected = new Set(options.entityIds);
  if (!selected.size) return 'Select a line, circle, arc, or every edge of a closed profile to offset.';
  for (const id of selected) {
    const entity = sketch.entities.find(candidate => candidate.id === id);
    if (!entity || !supported(entity)) return 'Offset currently supports straight lines, circles and circular arcs.';
  }
  if (options.wholeLoop) {
    const equivalent = pointEquivalence(sketch.constraints);
    const pending = sketch.entities.filter(
      (entity): entity is Edge => selected.has(entity.id) && supported(entity) && entity.type !== 'circle'
    );
    while (pending.length) {
      const curve = pending.pop()!;
      const vertices = endpoints(curve).map(equivalent.canonical);
      for (const entity of sketch.entities) {
        if (
          entity.type === 'point' ||
          entity.type === 'circle' ||
          selected.has(entity.id) ||
          !!entity.construction !== !!curve.construction
        )
          continue;
        if (![entity.startId, entity.endId].some(id => vertices.includes(equivalent.canonical(id)))) continue;
        if (!supported(entity)) return 'This connected profile contains a curve that Offset does not support yet.';
        selected.add(entity.id);
        pending.push(entity);
      }
    }
  }
  return sketch.entities.filter((entity): entity is Curve => selected.has(entity.id) && supported(entity));
}

function components(curves: Curve[], sketch: CadSketch): Curve[][] {
  const equivalent = pointEquivalence(sketch.constraints);
  const rest = [...curves],
    out: Curve[][] = [];
  while (rest.length) {
    const first = rest.shift()!;
    const group = [first];
    if (first.type !== 'circle') {
      const vertices = new Set(endpoints(first).map(equivalent.canonical));
      for (let i = 0; i < group.length; i++) {
        for (let j = rest.length - 1; j >= 0; j--) {
          const curve = rest[j]!;
          if (curve.type === 'circle' || !endpoints(curve).some(id => vertices.has(equivalent.canonical(id)))) continue;
          group.push(curve);
          endpoints(curve).forEach(id => vertices.add(equivalent.canonical(id)));
          rest.splice(j, 1);
        }
      }
    }
    out.push(group);
  }
  return out;
}

function orderLoop(curves: Edge[], sketch: CadSketch): Step[] | null {
  const equivalent = pointEquivalence(sketch.constraints);
  const degree = new Map<string, number>();
  for (const curve of curves)
    for (const id of endpoints(curve)) degree.set(equivalent.canonical(id), (degree.get(equivalent.canonical(id)) ?? 0) + 1);
  if ([...degree.values()].some(count => count !== 2)) return null;
  const first = curves[0]!;
  const out: Step[] = [{ curve: first, forward: true }];
  const remaining = curves.slice(1);
  let cursor = equivalent.canonical(first.endId);
  while (remaining.length) {
    const index = remaining.findIndex(curve => endpoints(curve).some(id => equivalent.canonical(id) === cursor));
    if (index < 0) return null;
    const curve = remaining.splice(index, 1)[0]!;
    const forward = equivalent.canonical(curve.startId) === cursor;
    out.push({ curve, forward });
    cursor = equivalent.canonical(forward ? curve.endId : curve.startId);
  }
  return cursor === equivalent.canonical(first.startId) ? out : null;
}

function profile(curves: Curve[], points: CadPointEntity[], sketch: CadSketch) {
  return evaluateCadPart({
    id: 'offset-validation',
    name: 'Offset validation',
    thickness: 1,
    sketch: {
      id: sketch.id,
      entities: [...points, ...curves.map(curve => ({ ...curve, construction: false }))],
      constraints: sketch.constraints.filter(constraint => constraint.type === 'coincident'),
    },
  }).part;
}

/** Create a detached linked offset. No source entity, source constraint, document revision or history is mutated. */
export function offsetSketch(sketch: CadSketch, options: CadOffsetOptions): CadOffsetResult {
  if (!Number.isFinite(options.value) || Math.abs(options.value) <= tolerance)
    return { ok: false, message: 'Enter a finite nonzero offset distance.' };
  const selected = selectCurves(sketch, options);
  if (typeof selected === 'string') return { ok: false, message: selected };
  if (selected.some(isOwnedSplineHandle))
    return { ok: false, message: 'Spline tangent handles belong to their curve and cannot be offset separately.' };
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  for (const curve of selected) {
    const references =
      curve.type === 'circle'
        ? [curve.centerId]
        : curve.type === 'arc'
          ? [curve.centerId, curve.startId, curve.endId]
          : [curve.startId, curve.endId];
    if (
      references.some(id => {
        const p = points.get(id);
        return !p || !Number.isFinite(p.x) || !Number.isFinite(p.y);
      }) ||
      (curve.type !== 'line' && (!Number.isFinite(curve.radius) || curve.radius <= tolerance)) ||
      (curve.type === 'arc' && (!Number.isFinite(curve.startAngle) || !Number.isFinite(curve.endAngle)))
    )
      return { ok: false, message: 'Repair the missing or invalid source geometry before offsetting it.' };
  }
  const addedPoints: CadPointEntity[] = [],
    addedCurves: Curve[] = [],
    members: CadOffsetMember[] = [];
  const point = (position: CadPoint, construction?: boolean): CadPointEntity => {
    const result: CadPointEntity = { x: position.x, y: position.y, id: newCadId(), type: 'point', ...(construction && { construction }) };
    addedPoints.push(result);
    return result;
  };
  const fail = (message: string): CadOffsetResult => ({ ok: false, message });

  for (const group of components(selected, sketch)) {
    if (group.length === 1 && group[0]!.type === 'circle') {
      const source = group[0]!;
      const originalCenter = points.get(source.centerId);
      const radius = source.radius - options.value;
      if (!originalCenter || !Number.isFinite(radius) || radius <= tolerance)
        return fail('This offset would collapse a circular radius. Choose a smaller value.');
      const center = point(originalCenter, source.construction);
      const target: CadCircleEntity = { ...source, id: newCadId(), centerId: center.id, radius };
      addedCurves.push(target);
      members.push({ kind: 'circle', sourceId: source.id, targetId: target.id, side: -1 });
      continue;
    }
    const edges = group as Edge[];
    const loop = edges.length > 1 ? orderLoop(edges, sketch) : null;
    if (edges.length > 1 && !loop) return fail('Select one finite edge or every edge of a closed, unbranched profile.');
    const steps = loop ?? [{ curve: edges[0]!, forward: true }];
    const sourcePoints: CadPoint[] = [];
    if (loop) {
      for (const step of steps) {
        const samples = tessellateCurve(step.curve, points);
        if (!step.forward) samples.reverse();
        sourcePoints.push(...(sourcePoints.length ? samples.slice(1) : samples));
      }
    }
    const area = loop ? polygonArea(sourcePoints) : 0;
    if (loop && (!Number.isFinite(area) || Math.abs(area) <= tolerance || !profile(edges, [...points.values()], sketch)))
      return fail('Repair the closed source profile before offsetting it.');
    const supports: OffsetSupport[] = [];
    for (const step of steps) {
      const direction = step.forward ? 1 : -1;
      const inward = area > 0 ? 1 : -1;
      const side = (loop ? (step.curve.type === 'arc' ? -inward * direction : inward * direction) : step.curve.type === 'arc' ? -1 : 1) as
        | 1
        | -1;
      const built = offsetSupport(step.curve, points, side, options.value);
      if (typeof built === 'string') return fail(built);
      supports.push(built);
    }
    const vertices: CadPointEntity[] = [];
    if (loop) {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!,
          original = points.get(step.forward ? step.curve.startId : step.curve.endId);
        if (!original) return fail('Repair the missing source endpoints before offsetting.');
        const candidates = intersectOffsetSupports(supports[(i + supports.length - 1) % supports.length]!, supports[i]!, original)
          .filter(candidate => Number.isFinite(candidate.x) && Number.isFinite(candidate.y))
          .sort((a, b) => distance(a, original) - distance(b, original));
        if (!candidates.length) return fail('This offset would disconnect or collapse a corner. Choose a smaller value.');
        if (
          candidates[1] &&
          distance(candidates[0]!, candidates[1]) > tolerance &&
          Math.abs(distance(candidates[0]!, original) - distance(candidates[1], original)) <= tolerance
        )
          return fail('This offset corner is ambiguous. Choose a smaller value.');
        vertices.push(
          point(
            candidates[0]!,
            edges.every(edge => !!edge.construction)
          )
        );
      }
    } else {
      const source = edges[0]!;
      const start = points.get(source.startId),
        end = points.get(source.endId);
      if (!start || !end || distance(start, end) <= tolerance)
        return fail('Use a circle for a complete circular offset, or repair the source endpoints.');
      vertices.push(
        point(projectOffsetSupport(supports[0]!, start), source.construction),
        point(projectOffsetSupport(supports[0]!, end), source.construction)
      );
    }
    const targets: Edge[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!,
        s = supports[i]!;
      const from = vertices[i]!,
        to = vertices[loop ? (i + 1) % vertices.length : 1]!;
      const start = step.forward ? from : to,
        end = step.forward ? to : from;
      if (distance(start, end) <= tolerance) return fail('This offset would consume an entire edge. Choose a smaller value.');
      let target: Edge;
      if (s.kind === 'line') {
        const originalA = points.get(s.curve.startId)!,
          originalB = points.get(s.curve.endId)!;
        if (
          (end.x - start.x) * (originalB.x - originalA.x) + (end.y - start.y) * (originalB.y - originalA.y) <=
          tolerance * distance(originalA, originalB)
        )
          return fail('This offset would reverse or consume an edge. Choose a smaller value.');
        target = { ...s.curve, id: newCadId(), startId: start.id, endId: end.id };
      } else {
        const center = point(s.center, s.curve.construction);
        const startAngle = s.curve.startAngle + angularChange(Math.atan2(start.y - center.y, start.x - center.x), s.curve.startAngle);
        const endChange = angularChange(Math.atan2(end.y - center.y, end.x - center.x), s.curve.endAngle);
        const sweep = (wrap(s.curve.endAngle - s.curve.startAngle) || tau) + endChange - (startAngle - s.curve.startAngle);
        if (sweep <= 1e-10 || sweep >= tau - 1e-10) return fail('This offset would collapse or reverse an arc. Choose a smaller value.');
        target = {
          ...s.curve,
          id: newCadId(),
          centerId: center.id,
          startId: start.id,
          endId: end.id,
          radius: s.radius,
          startAngle,
          endAngle: startAngle + sweep,
        };
      }
      targets.push(target);
      members.push({ kind: target.type, sourceId: step.curve.id, targetId: target.id, side: s.side, endpoints: !loop });
    }
    if (loop) {
      const allPoints = [...points.values(), ...addedPoints];
      const targetProfile = profile(targets, allPoints, sketch);
      const sourceProfile = profile(edges, [...points.values()], sketch)!;
      if (!targetProfile || !profile([...edges, ...targets], allPoints, sketch))
        return fail('This offset would cross, touch, or collapse its source profile. Choose a smaller value.');
      const sourceArea = Math.abs(polygonArea(sourceProfile.outline)),
        targetArea = Math.abs(polygonArea(targetProfile.outline));
      if (options.value > 0 ? targetArea >= sourceArea - tolerance : targetArea <= sourceArea + tolerance)
        return fail('This offset would reverse the profile. Choose a smaller value.');
    }
    addedCurves.push(...targets);
  }
  const dimensionId = newCadId();
  return {
    ok: true,
    sketch: {
      ...sketch,
      entities: [...sketch.entities, ...addedPoints, ...addedCurves],
      constraints: [...sketch.constraints, { id: dimensionId, type: 'offset', label: 'Offset', value: options.value, members }],
    },
    sourceIds: selected.map(curve => curve.id),
    entityIds: addedCurves.map(curve => curve.id),
    dimensionId,
  };
}
