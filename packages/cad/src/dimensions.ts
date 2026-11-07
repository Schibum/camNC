import type { CadDimension, CadDimensionMode, CadEntity, CadPoint, CadPointEntity, CadSketch, NewCadDimension } from './types';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import { measureOffset, offsetMemberWitness } from './offsetConstraint';

export interface CadDimensionOptions {
  mode?: CadDimensionMode;
  placement?: CadPoint;
  /** Actual curve-body picks preserve which side of a circular support was selected. */
  picks?: Readonly<Record<string, CadPoint>>;
}
export type CadDimensionSelection = { constraint: NewCadDimension; existingConstraintId?: string } | { message: string };

const samePair = (a: string, b: string, c: string, d: string) => (a === c && b === d) || (a === d && b === c);
const tau = 2 * Math.PI;
const wrap = (angle: number) => ((angle % tau) + tau) % tau;
function lineIntersection(a: CadPoint, b: CadPoint, c: CadPoint, d: CadPoint): CadPoint | null {
  const ax = b.x - a.x,
    ay = b.y - a.y,
    bx = d.x - c.x,
    by = d.y - c.y;
  const determinant = ax * by - ay * bx;
  if (Math.abs(determinant) <= 1e-12 * Math.hypot(ax, ay) * Math.hypot(bx, by)) return null;
  const t = ((c.x - a.x) * by - (c.y - a.y) * bx) / determinant;
  return { x: a.x + t * ax, y: a.y + t * ay };
}

export function dimensionAngleWitness(
  sketch: CadSketch,
  dimension: Extract<CadDimension | NewCadDimension, { type: 'angle' }>
): { center: CadPoint; startAngle: number; sweep: number } | null {
  const a = sketch.entities.find(entity => entity.id === dimension.entityAId),
    b = sketch.entities.find(entity => entity.id === dimension.entityBId);
  if (a?.type !== 'line' || b?.type !== 'line') return null;
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  const a0 = points.get(a.startId),
    a1 = points.get(a.endId),
    b0 = points.get(b.startId),
    b1 = points.get(b.endId);
  if (!a0 || !a1 || !b0 || !b1) return null;
  const center = lineIntersection(a0, a1, b0, b1);
  if (!center) return null;
  return {
    center,
    startAngle: Math.atan2(a1.y - a0.y, a1.x - a0.x) + (dimension.orientation !== undefined && dimension.reversedA ? Math.PI : 0),
    sweep: ((dimension.orientation ?? 1) * dimension.value * Math.PI) / 180,
  };
}

/** Current geometry measurement; retained numeric values never masquerade as measured geometry. */
export function measureDimension(sketch: CadSketch, dimension: CadDimension | NewCadDimension): number | null {
  if (dimension.type === 'offset') return measureOffset(sketch, dimension);
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  if (dimension.type === 'radius' || dimension.type === 'diameter') {
    const curve = sketch.entities.find(entity => entity.id === dimension.entityId);
    return curve && (curve.type === 'circle' || curve.type === 'arc') ? curve.radius * (dimension.type === 'diameter' ? 2 : 1) : null;
  }
  if (dimension.type === 'angle') {
    const a = sketch.entities.find(entity => entity.id === dimension.entityAId),
      b = sketch.entities.find(entity => entity.id === dimension.entityBId);
    if (a?.type !== 'line' || b?.type !== 'line') return null;
    const a0 = points.get(a.startId),
      a1 = points.get(a.endId),
      b0 = points.get(b.startId),
      b1 = points.get(b.endId);
    if (!a0 || !a1 || !b0 || !b1) return null;
    let delta = Math.atan2(b1.y - b0.y, b1.x - b0.x) - Math.atan2(a1.y - a0.y, a1.x - a0.x);
    if (dimension.orientation !== undefined) delta += (dimension.reversedB ? Math.PI : 0) - (dimension.reversedA ? Math.PI : 0);
    const measured = ((dimension.orientation ?? 1) * Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI;
    return measured + 360 * Math.round((dimension.value - measured) / 360);
  }
  const witness = dimensionWitnessPoints(sketch, dimension);
  if (!witness) return null;
  const [a, b] = witness;
  if (dimension.type === 'distanceX' || dimension.type === 'positionX') return b.x - a.x;
  if (dimension.type === 'distanceY' || dimension.type === 'positionY') return b.y - a.y;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Refresh reference value and the corresponding signed branch for a later return to driving. */
export function refreshDimensionMeasurement(sketch: CadSketch, dimension: CadDimension): CadDimension {
  if (dimension.driven && dimension.expression !== undefined) {
    const measured = { ...dimension };
    delete measured.expression;
    dimension = measured;
  }
  const value = measureDimension(sketch, dimension);
  if (value === null || !Number.isFinite(value)) return dimension;
  if (dimension.type === 'pointArcDistance' || dimension.type === 'lineCircleDistance') {
    const circular = sketch.entities.find(
      entity => entity.id === (dimension.type === 'pointArcDistance' ? dimension.entityId : dimension.entityBId)
    );
    if (!circular || (circular.type !== 'circle' && circular.type !== 'arc')) return dimension;
    const points = new Map(
      sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
    );
    const center = points.get(circular.centerId);
    if (!center) return dimension;
    let distance: number;
    if (dimension.type === 'pointArcDistance') {
      const point = points.get(dimension.pointId);
      if (!point) return dimension;
      distance = Math.hypot(point.x - center.x, point.y - center.y);
    } else {
      const line = sketch.entities.find(entity => entity.id === dimension.entityAId);
      if (line?.type !== 'line') return dimension;
      const a = points.get(line.startId),
        b = points.get(line.endId);
      if (!a || !b) return dimension;
      distance = Math.abs((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
    }
    return { ...dimension, value, side: dimension.radiusSide === 'far' || distance >= circular.radius ? 'outside' : 'inside' };
  }
  if (dimension.type === 'circleCircleDistance') {
    const a = sketch.entities.find(entity => entity.id === dimension.entityAId),
      b = sketch.entities.find(entity => entity.id === dimension.entityBId);
    if (!a || !b || (a.type !== 'circle' && a.type !== 'arc') || (b.type !== 'circle' && b.type !== 'arc')) return dimension;
    const points = new Map(
      sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
    );
    const ca = points.get(a.centerId),
      cb = points.get(b.centerId);
    if (!ca || !cb) return dimension;
    const projected = Math.hypot(cb.x - ca.x, cb.y - ca.y) + dimension.radiusASign * a.radius + dimension.radiusBSign * b.radius;
    return { ...dimension, value, direction: projected < 0 ? -1 : 1 };
  }
  return { ...dimension, value };
}

/** Geometry witnesses for linear dimension annotations, independent of their screen placement. */
export function dimensionWitnessPoints(sketch: CadSketch, dimension: CadDimension | NewCadDimension): [CadPoint, CadPoint] | null {
  if (dimension.type === 'offset') {
    const member = dimension.members[0];
    return member ? offsetMemberWitness(member, new Map(sketch.entities.map(entity => [entity.id, entity]))) : null;
  }
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  if (dimension.type === 'circleCircleDistance') {
    const a = sketch.entities.find(entity => entity.id === dimension.entityAId),
      b = sketch.entities.find(entity => entity.id === dimension.entityBId);
    if (!a || !b || (a.type !== 'circle' && a.type !== 'arc') || (b.type !== 'circle' && b.type !== 'arc')) return null;
    const ca = points.get(a.centerId),
      cb = points.get(b.centerId);
    if (!ca || !cb) return null;
    const distance = Math.hypot(cb.x - ca.x, cb.y - ca.y);
    const ux = distance > CAD_GEOMETRY_TOLERANCE ? (cb.x - ca.x) / distance : 1,
      uy = distance > CAD_GEOMETRY_TOLERANCE ? (cb.y - ca.y) / distance : 0;
    return [
      { x: ca.x - dimension.radiusASign * ux * a.radius, y: ca.y - dimension.radiusASign * uy * a.radius },
      { x: cb.x + dimension.radiusBSign * ux * b.radius, y: cb.y + dimension.radiusBSign * uy * b.radius },
    ];
  }
  if ('pointAId' in dimension) {
    const a = points.get(dimension.pointAId),
      b = points.get(dimension.pointBId);
    return a && b ? [a, b] : null;
  }
  if (dimension.type === 'positionX' || dimension.type === 'positionY') {
    const p = points.get(dimension.pointId);
    return p ? [{ x: 0, y: 0 }, p] : null;
  }
  if (dimension.type === 'pointArcDistance' || dimension.type === 'lineCircleDistance') {
    const circular = sketch.entities.find(
      entity => entity.id === (dimension.type === 'pointArcDistance' ? dimension.entityId : dimension.entityBId)
    );
    if (!circular || (circular.type !== 'circle' && circular.type !== 'arc')) return null;
    const center = points.get(circular.centerId);
    if (!center) return null;
    if (dimension.type === 'pointArcDistance') {
      const p = points.get(dimension.pointId);
      if (!p) return null;
      const distance = Math.hypot(p.x - center.x, p.y - center.y);
      const angle = circular.type === 'arc' ? circular.startAngle : 0;
      const ux = distance > CAD_GEOMETRY_TOLERANCE ? (p.x - center.x) / distance : Math.cos(angle);
      const uy = distance > CAD_GEOMETRY_TOLERANCE ? (p.y - center.y) / distance : Math.sin(angle);
      const sign = dimension.radiusSide === 'far' ? -1 : 1;
      return [{ x: center.x + sign * ux * circular.radius, y: center.y + sign * uy * circular.radius }, p];
    }
    const line = sketch.entities.find(entity => entity.id === dimension.entityAId);
    if (line?.type !== 'line') return null;
    const a = points.get(line.startId),
      b = points.get(line.endId);
    if (!a || !b) return null;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (length <= CAD_GEOMETRY_TOLERANCE) return null;
    const t = ((center.x - a.x) * dx + (center.y - a.y) * dy) / (length * length);
    const foot = { x: a.x + t * dx, y: a.y + t * dy };
    const distance = Math.hypot(foot.x - center.x, foot.y - center.y);
    const ux = distance > CAD_GEOMETRY_TOLERANCE ? (foot.x - center.x) / distance : -dy / length;
    const uy = distance > CAD_GEOMETRY_TOLERANCE ? (foot.y - center.y) / distance : dx / length;
    const sign = dimension.radiusSide === 'far' ? -1 : 1;
    return [foot, { x: center.x + sign * ux * circular.radius, y: center.y + sign * uy * circular.radius }];
  }
  if (dimension.type !== 'pointLineDistance' && dimension.type !== 'lineLineDistance') return null;
  const source = sketch.entities.find(
    entity => entity.id === (dimension.type === 'pointLineDistance' ? dimension.entityId : dimension.entityAId)
  );
  if (source?.type !== 'line') return null;
  const a = points.get(source.startId),
    b = points.get(source.endId);
  let p: CadPoint | undefined;
  if (dimension.type === 'pointLineDistance') p = points.get(dimension.pointId);
  else {
    const other = sketch.entities.find(entity => entity.id === dimension.entityBId);
    if (other?.type === 'line') {
      const c = points.get(other.startId),
        d = points.get(other.endId);
      if (c && d) p = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
    }
  }
  if (!a || !b || !p) return null;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length2 = dx * dx + dy * dy;
  if (length2 <= CAD_GEOMETRY_TOLERANCE * CAD_GEOMETRY_TOLERANCE) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
  return [{ x: a.x + t * dx, y: a.y + t * dy }, p];
}
function existingDimension(sketch: CadSketch, dimension: NewCadDimension, mode: CadDimensionMode): CadDimension | undefined {
  return sketch.constraints.find((c): c is CadDimension => {
    if (!('value' in c)) return false;
    if ('pointAId' in dimension && 'pointAId' in c)
      return (
        (c.type === dimension.type ||
          (mode === 'auto' && dimension.sourceEntityId !== undefined && ['distance', 'distanceX', 'distanceY'].includes(c.type))) &&
        samePair(c.pointAId, c.pointBId, dimension.pointAId, dimension.pointBId)
      );
    if (dimension.type === 'circleCircleDistance' && c.type === 'circleCircleDistance')
      return (
        c.direction === dimension.direction &&
        ((c.entityAId === dimension.entityAId &&
          c.entityBId === dimension.entityBId &&
          c.radiusASign === dimension.radiusASign &&
          c.radiusBSign === dimension.radiusBSign) ||
          (c.entityAId === dimension.entityBId &&
            c.entityBId === dimension.entityAId &&
            c.radiusASign === dimension.radiusBSign &&
            c.radiusBSign === dimension.radiusASign))
      );
    if (dimension.type === 'lineCircleDistance' && c.type === 'lineCircleDistance')
      return (
        c.entityAId === dimension.entityAId &&
        c.entityBId === dimension.entityBId &&
        c.side === dimension.side &&
        (c.radiusSide ?? 'near') === (dimension.radiusSide ?? 'near')
      );
    if ('entityAId' in dimension && 'entityAId' in c)
      return c.type === dimension.type && samePair(c.entityAId, c.entityBId, dimension.entityAId, dimension.entityBId);
    if ('pointId' in dimension && 'entityId' in dimension && 'pointId' in c && 'entityId' in c)
      return (
        c.type === dimension.type &&
        c.pointId === dimension.pointId &&
        c.entityId === dimension.entityId &&
        (c.type !== 'pointArcDistance' ||
          dimension.type !== 'pointArcDistance' ||
          (c.side === dimension.side && (c.radiusSide ?? 'near') === (dimension.radiusSide ?? 'near')))
      );
    if ((dimension.type === 'radius' || dimension.type === 'diameter') && (c.type === 'radius' || c.type === 'diameter'))
      return c.entityId === dimension.entityId;
    return false;
  });
}

/** Resolve geometry selections independently of tool gestures, annotation rendering, and history. */
export function dimensionForSelection(sketch: CadSketch, ids: readonly string[], options: CadDimensionOptions = {}): CadDimensionSelection {
  const mode = options.mode ?? 'auto';
  const selected = [...new Set(ids)].map(id => sketch.entities.find(entity => entity.id === id));
  if (selected.some(entity => !entity) || !selected.length || selected.length > 2)
    return { message: 'Select one curve, two points, a point and line, or two lines to dimension.' };
  const entities = selected as CadEntity[];
  const points = new Map(
    sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
  );
  const result = (constraint: NewCadDimension): CadDimensionSelection => {
    const existing = existingDimension(sketch, constraint, mode);
    return existing ? { constraint: existing, existingConstraintId: existing.id } : { constraint };
  };
  const pointDistance = (a: CadPointEntity, b: CadPointEntity, owner?: string): CadDimensionSelection => {
    if (mode === 'angle') return { message: 'Select two lines for an angular dimension.' };
    let type = mode === 'auto' ? ('distance' as const) : mode;
    const placement = options.placement;
    if (mode === 'auto' && placement) {
      if (
        placement.x >= Math.min(a.x, b.x) &&
        placement.x <= Math.max(a.x, b.x) &&
        (placement.y < Math.min(a.y, b.y) || placement.y > Math.max(a.y, b.y))
      )
        type = 'distanceX';
      else if (
        placement.y >= Math.min(a.y, b.y) &&
        placement.y <= Math.max(a.y, b.y) &&
        (placement.x < Math.min(a.x, b.x) || placement.x > Math.max(a.x, b.x))
      )
        type = 'distanceY';
    }
    if ((type === 'distanceX' && b.x < a.x) || (type === 'distanceY' && b.y < a.y)) [a, b] = [b, a];
    return result({
      type,
      pointAId: a.id,
      pointBId: b.id,
      value: type === 'distanceX' ? b.x - a.x : type === 'distanceY' ? b.y - a.y : Math.hypot(b.x - a.x, b.y - a.y),
      ...(owner && { sourceEntityId: owner }),
      label:
        owner && mode === 'auto'
          ? 'Length'
          : type === 'distanceX'
            ? 'Horizontal distance'
            : type === 'distanceY'
              ? 'Vertical distance'
              : 'Length',
    });
  };
  if (entities.length === 1) {
    const entity = entities[0]!;
    if (entity.type === 'line') {
      const a = points.get(entity.startId),
        b = points.get(entity.endId);
      return a && b ? pointDistance(a, b, entity.id) : { message: 'The selected line has a missing endpoint.' };
    }
    if ((entity.type === 'circle' || entity.type === 'arc') && mode !== 'angle')
      return result({
        type: entity.type === 'arc' ? 'radius' : 'diameter',
        entityId: entity.id,
        value: entity.radius * (entity.type === 'arc' ? 1 : 2),
      });
    return {
      message: entity.type === 'point' ? 'Select another point or a line to dimension.' : 'Select supported sketch geometry to dimension.',
    };
  }
  const [first, second] = entities as [CadEntity, CadEntity];
  if (first.type === 'point' && second.type === 'point') return pointDistance(first, second);
  const point = first.type === 'point' ? first : second.type === 'point' ? second : undefined;
  const line = first.type === 'line' ? first : second.type === 'line' ? second : undefined;
  const circular =
    first.type === 'circle' || first.type === 'arc' ? first : second.type === 'circle' || second.type === 'arc' ? second : undefined;
  if (
    (first.type === 'circle' || first.type === 'arc') &&
    (second.type === 'circle' || second.type === 'arc') &&
    (mode === 'auto' || mode === 'distance')
  ) {
    const a = points.get(first.centerId),
      b = points.get(second.centerId);
    if (!a || !b) return { message: 'A selected circular curve has a missing center.' };
    const distance = Math.hypot(b.x - a.x, b.y - a.y),
      ux = distance > CAD_GEOMETRY_TOLERANCE ? (b.x - a.x) / distance : 1,
      uy = distance > CAD_GEOMETRY_TOLERANCE ? (b.y - a.y) / distance : 0;
    const pickA = options.picks?.[first.id],
      pickB = options.picks?.[second.id];
    const radiusASign = pickA && (pickA.x - a.x) * ux + (pickA.y - a.y) * uy <= 0 ? 1 : -1;
    const radiusBSign = pickB && (pickB.x - b.x) * ux + (pickB.y - b.y) * uy > 0 ? 1 : -1;
    const projected = distance + radiusASign * first.radius + radiusBSign * second.radius;
    return result({
      type: 'circleCircleDistance',
      entityAId: first.id,
      entityBId: second.id,
      radiusASign,
      radiusBSign,
      direction: projected < 0 ? -1 : 1,
      value: Math.abs(projected),
      label: 'Distance',
    });
  }
  if (circular && (mode === 'auto' || mode === 'distance')) {
    const center = points.get(circular.centerId);
    if (!center) return { message: 'The selected circular curve has a missing center.' };
    if (point) {
      const distance = Math.hypot(point.x - center.x, point.y - center.y);
      const pick = options.picks?.[circular.id];
      const radiusSide =
        pick && (pick.x - center.x) * (point.x - center.x) + (pick.y - center.y) * (point.y - center.y) < 0 ? 'far' : 'near';
      const projected = distance + (radiusSide === 'far' ? circular.radius : -circular.radius);
      return result({
        type: 'pointArcDistance',
        pointId: point.id,
        entityId: circular.id,
        value: Math.abs(projected),
        side: projected < 0 ? 'inside' : 'outside',
        radiusSide,
        label: 'Distance',
      });
    }
    if (line) {
      const a = points.get(line.startId),
        b = points.get(line.endId);
      if (!a || !b) return { message: 'The selected line has a missing endpoint.' };
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length <= CAD_GEOMETRY_TOLERANCE) return { message: 'The selected line needs distinct endpoints.' };
      const distance = Math.abs((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)) / length;
      const t = ((center.x - a.x) * (b.x - a.x) + (center.y - a.y) * (b.y - a.y)) / (length * length);
      const pick = options.picks?.[circular.id],
        fx = a.x + t * (b.x - a.x) - center.x,
        fy = a.y + t * (b.y - a.y) - center.y;
      const radiusSide = pick && (pick.x - center.x) * fx + (pick.y - center.y) * fy < 0 ? 'far' : 'near';
      const projected = distance + (radiusSide === 'far' ? circular.radius : -circular.radius);
      return result({
        type: 'lineCircleDistance',
        entityAId: line.id,
        entityBId: circular.id,
        value: Math.abs(projected),
        side: projected < 0 ? 'inside' : 'outside',
        radiusSide,
        label: 'Distance',
      });
    }
  }
  if (point && line && (mode === 'auto' || mode === 'distance')) {
    const a = points.get(line.startId),
      b = points.get(line.endId);
    if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) <= CAD_GEOMETRY_TOLERANCE)
      return { message: 'The selected line needs distinct endpoints.' };
    return result({
      type: 'pointLineDistance',
      pointId: point.id,
      entityId: line.id,
      value: Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y),
      label: 'Distance',
    });
  }
  if (first.type === 'line' && second.type === 'line') {
    const a = points.get(first.startId),
      b = points.get(first.endId),
      c = points.get(second.startId),
      d = points.get(second.endId);
    if (!a || !b || !c || !d) return { message: 'The selected lines have a missing endpoint.' };
    const ax = b.x - a.x,
      ay = b.y - a.y,
      bx = d.x - c.x,
      by = d.y - c.y;
    const la = Math.hypot(ax, ay),
      lb = Math.hypot(bx, by);
    if (Math.min(la, lb) <= CAD_GEOMETRY_TOLERANCE) return { message: 'The selected lines need distinct endpoints.' };
    const cross = ax * by - ay * bx;
    if (mode === 'angle' || (mode === 'auto' && Math.abs(cross) / (la * lb) > 1e-8)) {
      const center = lineIntersection(a, b, c, d),
        angleA = Math.atan2(ay, ax),
        angleB = Math.atan2(by, bx);
      const pickA = options.picks?.[first.id] ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        pickB = options.picks?.[second.id] ?? { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
      let reversedA = !!center && (pickA.x - center.x) * ax + (pickA.y - center.y) * ay < 0;
      let reversedB = !!center && (pickB.x - center.x) * bx + (pickB.y - center.y) * by < 0;
      const placement = options.placement;
      if (center && placement && Math.hypot(placement.x - center.x, placement.y - center.y) > CAD_GEOMETRY_TOLERANCE) {
        const angle = Math.atan2(placement.y - center.y, placement.x - center.x);
        for (const ra of [false, true])
          for (const rb of [false, true]) {
            const start = angleA + (ra ? Math.PI : 0),
              end = angleB + (rb ? Math.PI : 0);
            const sweep = Math.atan2(Math.sin(end - start), Math.cos(end - start));
            const delta = sweep < 0 ? wrap(start - angle) : wrap(angle - start);
            if (delta <= Math.abs(sweep) + 1e-10) {
              reversedA = ra;
              reversedB = rb;
            }
          }
      }
      const delta = angleB + (reversedB ? Math.PI : 0) - angleA - (reversedA ? Math.PI : 0);
      const sweep = Math.atan2(Math.sin(delta), Math.cos(delta));
      return result({
        type: 'angle',
        entityAId: first.id,
        entityBId: second.id,
        value: (Math.abs(sweep) * 180) / Math.PI,
        orientation: sweep < 0 ? -1 : 1,
        reversedA,
        reversedB,
        label: 'Angle',
      });
    }
    if (mode === 'auto' || mode === 'distance')
      return result({
        type: 'lineLineDistance',
        entityAId: first.id,
        entityBId: second.id,
        value: Math.abs(ax * (c.y - a.y) - ay * (c.x - a.x)) / la,
        label: 'Distance',
      });
  }
  return { message: 'This selection does not support the chosen dimension type.' };
}
