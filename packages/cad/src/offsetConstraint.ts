import type { SketchPrimitive } from '@salusoft89/planegcs';
import type { CadConstraint, CadEntity, CadOffsetMember, CadPoint, CadSketch } from './types';
import { pointEquivalence } from './pointEquivalence';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import { intersectOffsetSupports, offsetSupport, projectOffsetSupport, type OffsetSupport } from './offsetGeometry';

type Offset = Extract<CadConstraint, { type: 'offset' }>;
const point = (entities: ReadonlyMap<string, CadEntity>, id: string) => {
  const p = entities.get(id);
  return p?.type === 'point' ? p : undefined;
};

/** Gap witnesses remain independent of annotation placement and of the retained driving value. */
export function offsetMemberWitness(member: CadOffsetMember, entities: ReadonlyMap<string, CadEntity>): [CadPoint, CadPoint] | null {
  const source = entities.get(member.sourceId),
    target = entities.get(member.targetId);
  if (member.kind === 'line' && source?.type === 'line' && target?.type === 'line') {
    const a = point(entities, source.startId),
      b = point(entities, source.endId),
      p = point(entities, target.startId);
    if (!a || !b || !p) return null;
    if (member.endpoints) return [a, p];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      squared = dx * dx + dy * dy;
    if (!squared) return null;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared;
    return [{ x: a.x + t * dx, y: a.y + t * dy }, p];
  }
  if ((source?.type === 'circle' || source?.type === 'arc') && (target?.type === 'circle' || target?.type === 'arc')) {
    const a = point(entities, source.centerId),
      b = point(entities, target.centerId);
    if (!a || !b) return null;
    const angle = target.type === 'arc' ? target.startAngle : 0;
    return [
      { x: a.x + source.radius * Math.cos(angle), y: a.y + source.radius * Math.sin(angle) },
      { x: b.x + target.radius * Math.cos(angle), y: b.y + target.radius * Math.sin(angle) },
    ];
  }
  return null;
}

export function measureOffset(sketch: CadSketch, offset: Pick<Offset, 'members'>): number | null {
  const member = offset.members[0];
  if (!member) return null;
  const entities = new Map(sketch.entities.map(entity => [entity.id, entity]));
  const source = entities.get(member.sourceId),
    target = entities.get(member.targetId);
  if (member.kind === 'line' && source?.type === 'line') {
    const a = point(entities, source.startId),
      b = point(entities, source.endId),
      witness = offsetMemberWitness(member, entities);
    if (!a || !b || !witness) return null;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    return length ? (dx * (witness[1].y - a.y) - dy * (witness[1].x - a.x)) / length / member.side : null;
  }
  if ((source?.type === 'circle' || source?.type === 'arc') && (target?.type === 'circle' || target?.type === 'arc'))
    return (target.radius - source.radius) / member.side;
  return null;
}

/** Native auxiliaries belong to this one source relation and never become user geometry. */
export function offsetNativePrimitives(
  c: Offset,
  entities: ReadonlyMap<string, CadEntity>,
  constraints: readonly CadConstraint[]
): SketchPrimitive[] {
  const result: SketchPrimitive[] = [];
  c.members.forEach((member, index) => {
    const prefix = `${c.id}:offset:${index}`;
    const source = entities.get(member.sourceId)!,
      target = entities.get(member.targetId)!;
    if (member.kind === 'line' && source.type === 'line' && target.type === 'line') {
      const pairs = member.endpoints
        ? [
            [source.startId, target.startId],
            [source.endId, target.endId],
          ]
        : [[`${prefix}:foot`, target.startId]];
      if (!member.endpoints) {
        const witness = offsetMemberWitness(member, entities)!;
        result.push({ id: `${prefix}:foot`, type: 'point', ...witness[0], fixed: false });
        result.push({ id: `${prefix}:on-line`, type: 'point_on_line_pl', p_id: `${prefix}:foot`, l_id: source.id });
        result.push({ id: `${prefix}:parallel`, type: 'parallel', l1_id: source.id, l2_id: target.id });
      }
      pairs.forEach(([from, to], end) => {
        const normal = `${prefix}:normal:${end}`;
        result.push({ id: normal, type: 'line', p1_id: from!, p2_id: to! });
        result.push({
          id: `${prefix}:direction:${end}`,
          type: 'l2l_angle_ll',
          l1_id: source.id,
          l2_id: normal,
          angle: (member.side * Math.sign(c.value) * Math.PI) / 2,
        });
        result.push({ id: `${prefix}:gap:${end}`, type: 'p2p_distance', p1_id: from!, p2_id: to!, distance: `${c.id}:offset-magnitude` });
      });
    } else if ((source.type === 'circle' || source.type === 'arc') && (target.type === 'circle' || target.type === 'arc')) {
      result.push({ id: `${prefix}:center`, type: 'p2p_coincident', p1_id: source.centerId, p2_id: target.centerId });
      result.push({
        id: `${prefix}:radius`,
        type: 'difference',
        param1: { o_id: member.side === 1 ? source.id : target.id, prop: 'radius' },
        param2: { o_id: member.side === 1 ? target.id : source.id, prop: 'radius' },
        difference: `${c.id}:offset-value`,
      });
      if (member.kind === 'arc' && member.endpoints && source.type === 'arc' && target.type === 'arc')
        for (const prop of ['start_angle', 'end_angle'] as const)
          result.push({ id: `${prefix}:${prop}`, type: 'equal', param1: { o_id: source.id, prop }, param2: { o_id: target.id, prop } });
    }
  });
  for (const join of tangentJoins(c, entities, constraints))
    result.push({
      id: `${c.id}:offset:tangent:${join.i}:${join.j}`,
      type: 'angle_via_point',
      crv1_id: join.targetA.id,
      crv2_id: join.targetB.id,
      p_id: join.targetPointId,
      angle: join.angle,
    });
  return result;
}

/** Tangency follows a real source driver or two immutable, analytically tangent supports. */
function tangentJoins(c: Offset, entities: ReadonlyMap<string, CadEntity>, constraints: readonly CadConstraint[]) {
  const result: {
    i: number;
    j: number;
    sourceA: CadEntity;
    sourceB: CadEntity;
    targetA: CadEntity;
    targetB: CadEntity;
    sourcePointId: string;
    targetPointId: string;
    angle: number;
  }[] = [];
  const equivalent = pointEquivalence(constraints);
  const ends = (entity: CadEntity) => (entity.type === 'line' || entity.type === 'arc' ? [entity.startId, entity.endId] : []);
  const fixed = (entity: CadEntity) =>
    [...ends(entity), ...(entity.type === 'arc' ? [entity.centerId] : [])].every(id => point(entities, id)?.fixed);
  for (let i = 0; i < c.members.length; i++)
    for (let j = i + 1; j < c.members.length; j++) {
      const first = c.members[i]!,
        second = c.members[j]!;
      if (first.kind === 'circle' || second.kind === 'circle' || first.endpoints || second.endpoints) continue;
      const a = entities.get(first.sourceId)!,
        b = entities.get(second.sourceId)!;
      if (a.type !== 'arc' && b.type !== 'arc') continue;
      const sourceJoin = equivalent.match(ends(a), ends(b));
      const targetA = entities.get(first.targetId)!,
        targetB = entities.get(second.targetId)!;
      const targetJoin = equivalent.match(ends(targetA), ends(targetB));
      if (!sourceJoin || !targetJoin) continue;
      const joint = point(entities, sourceJoin[0])!;
      const normal = (curve: CadEntity): CadPoint => {
        if (curve.type === 'line') {
          const start = point(entities, curve.startId)!,
            end = point(entities, curve.endId)!;
          return { x: start.y - end.y, y: end.x - start.x };
        }
        const center = point(entities, (curve as Extract<CadEntity, { type: 'arc' }>).centerId)!;
        return { x: center.x - joint.x, y: center.y - joint.y };
      };
      const na = normal(a),
        nb = normal(b),
        lengths = Math.hypot(na.x, na.y) * Math.hypot(nb.x, nb.y);
      const explicit = constraints.some(
        relation =>
          relation.type === 'tangent' &&
          ((relation.entityAId === a.id && relation.entityBId === b.id) || (relation.entityBId === a.id && relation.entityAId === b.id))
      );
      if (!lengths || (!explicit && !(fixed(a) && fixed(b) && Math.abs(na.x * nb.y - na.y * nb.x) / lengths <= Number.EPSILON * 64)))
        continue;
      result.push({
        i,
        j,
        sourceA: a,
        sourceB: b,
        targetA,
        targetB,
        sourcePointId: sourceJoin[0],
        targetPointId: targetJoin[0],
        angle: na.x * nb.x + na.y * nb.y >= 0 ? 0 : Math.PI,
      });
    }
  return result;
}

/** Native initial guesses only: no fixed flags, dimensions, source entities or history are changed. */
export function offsetNativeSeed(sketch: CadSketch): ReadonlyMap<string, CadEntity> {
  const entities = new Map(sketch.entities.map(entity => [entity.id, entity]));
  const movePoint = (id: string, value: CadPoint) => {
    const old = point(entities, id);
    if (old && !old.fixed) entities.set(id, { ...old, x: value.x, y: value.y });
  };
  const pending = new Set(sketch.constraints.filter((c): c is Offset => c.type === 'offset' && !c.driven));
  const equivalent = pointEquivalence(sketch.constraints);
  while (pending.size) {
    // Offset chains seed their upstream copies first, independent of source array order.
    const c = [...pending].find(
      candidate =>
        ![...pending].some(
          other =>
            other !== candidate && candidate.members.some(member => other.members.some(upstream => upstream.targetId === member.sourceId))
        )
    );
    if (!c) break; // A cyclic graph is left entirely to the native solver.
    pending.delete(c);
    const points = new Map(
      [...entities.values()]
        .filter((entity): entity is Extract<CadEntity, { type: 'point' }> => entity.type === 'point')
        .map(p => [p.id, p])
    );
    const joins = new Map<string, { support: OffsetSupport; sourcePointId: string; targetPointId: string }[]>();
    for (const member of c.members) {
      const source = entities.get(member.sourceId)!,
        target = entities.get(member.targetId)!;
      if (source.type !== 'line' && source.type !== 'arc') continue;
      if (target.type !== source.type || member.kind === 'circle') continue;
      const support = offsetSupport(source, points, member.side, c.value);
      if (typeof support === 'string') continue;
      for (const end of ['startId', 'endId'] as const) {
        if (member.endpoints) movePoint(target[end], projectOffsetSupport(support, points.get(source[end])!));
        else {
          const key = equivalent.canonical(target[end]),
            entries = joins.get(key) ?? [];
          entries.push({ support, sourcePointId: source[end], targetPointId: target[end] });
          joins.set(key, entries);
        }
      }
    }
    for (const entries of joins.values()) {
      if (entries.length !== 2) continue;
      const first = entries[0]!,
        second = entries[1]!,
        sourcePoint = points.get(first.sourcePointId)!;
      const candidates = intersectOffsetSupports(first.support, second.support, sourcePoint)
        .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
        .sort((a, b) => Math.hypot(a.x - sourcePoint.x, a.y - sourcePoint.y) - Math.hypot(b.x - sourcePoint.x, b.y - sourcePoint.y));
      if (!candidates.length) continue;
      movePoint(first.targetPointId, candidates[0]!);
      movePoint(second.targetPointId, candidates[0]!);
    }
    for (const member of c.members) {
      const source = entities.get(member.sourceId)!,
        target = entities.get(member.targetId)!;
      if ((source.type !== 'circle' && source.type !== 'arc') || (target.type !== 'circle' && target.type !== 'arc')) continue;
      const center = point(entities, source.centerId)!,
        radius = source.radius + member.side * c.value;
      if (radius <= CAD_GEOMETRY_TOLERANCE) continue;
      entities.set(target.id, { ...target, radius });
      movePoint(target.centerId, center);
      if (member.kind === 'arc' && member.endpoints && source.type === 'arc' && target.type === 'arc') {
        entities.set(target.id, { ...target, radius, startAngle: source.startAngle, endAngle: source.endAngle });
        for (const end of ['start', 'end'] as const) {
          const angle = source[`${end}Angle`];
          movePoint(target[`${end}Id`], { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
        }
      }
    }
    for (const join of tangentJoins(c, entities, sketch.constraints)) {
      const source = join.sourceA.type === 'arc' ? join.sourceA : join.sourceB;
      const target = join.targetA.type === 'arc' ? join.targetA : join.targetB;
      if (source.type !== 'arc' || target.type !== 'arc') continue;
      const center = point(entities, source.centerId)!,
        sourcePoint = point(entities, join.sourcePointId)!;
      const length = Math.hypot(sourcePoint.x - center.x, sourcePoint.y - center.y);
      if (!length) continue;
      movePoint(join.targetPointId, {
        x: center.x + ((sourcePoint.x - center.x) * target.radius) / length,
        y: center.y + ((sourcePoint.y - center.y) * target.radius) / length,
      });
    }
    for (const member of c.members) {
      const source = entities.get(member.sourceId)!,
        target = entities.get(member.targetId)!;
      if (source.type !== 'arc' || target.type !== 'arc') continue;
      const center = point(entities, target.centerId)!,
        start = point(entities, target.startId)!,
        end = point(entities, target.endId)!;
      const change = (angle: number, previous: number) => Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
      const startAngle = source.startAngle + change(Math.atan2(start.y - center.y, start.x - center.x), source.startAngle);
      const endAngle = source.endAngle + change(Math.atan2(end.y - center.y, end.x - center.x), source.endAngle);
      entities.set(target.id, { ...target, startAngle, endAngle });
    }
  }
  return entities;
}

/** Infinite support equations cannot distinguish a consumed edge from its reversed continuation. */
export function invalidOffsetBranches(sketch: CadSketch): string[] {
  const entities = new Map(sketch.entities.map(entity => [entity.id, entity]));
  return sketch.constraints
    .filter((c): c is Offset => c.type === 'offset' && !c.driven)
    .filter(c =>
      c.members.some(member => {
        const source = entities.get(member.sourceId)!,
          target = entities.get(member.targetId)!;
        if (source.type === 'line' && target.type === 'line' && member.kind === 'line' && !member.endpoints) {
          const a = point(entities, source.startId)!,
            b = point(entities, source.endId)!;
          const p = point(entities, target.startId)!,
            q = point(entities, target.endId)!;
          const dx = b.x - a.x,
            dy = b.y - a.y;
          return dx * (q.x - p.x) + dy * (q.y - p.y) <= CAD_GEOMETRY_TOLERANCE * Math.hypot(dx, dy);
        }
        return (target.type === 'circle' || target.type === 'arc') && target.radius <= CAD_GEOMETRY_TOLERANCE;
      })
    )
    .map(c => c.id);
}
