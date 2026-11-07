import { dimensionAngleWitness, dimensionWitnessPoints } from './dimensions';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import { isBareBaseUnitLiteral } from './dimensionExpressions';
import { pointEquivalence } from './pointEquivalence';
import type { CadDimension, CadDimensionPlacement, CadDocument, CadPoint, CadSketch, NewCadDimension } from './types';

type Dimension = CadDimension | NewCadDimension;
type Frame =
  | { kind: 'linear'; origin: CadPoint; axis: CadPoint; normal: CadPoint; span: number }
  | { kind: 'radial'; origin: CadPoint; radius: number }
  | { kind: 'angle'; origin: CadPoint; startAngle: number }
  | { kind: 'fallback'; origin: CadPoint; axis?: CadPoint };

const finitePoint = (point: CadPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const midpoint = (a: CadPoint, b: CadPoint): CadPoint => ({ x: a.x / 2 + b.x / 2, y: a.y / 2 + b.y / 2 });
const dot = (a: CadPoint, b: CadPoint) => a.x * b.x + a.y * b.y;
// Bounded gain plus a fixed residual retains the user's initial radial position.
const MAX_RADIAL_GAIN = 4;
const STABLE_ANGLE_CROSS = 0.01;
const smoothstep = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
const finitePlacement = (placement: CadDimensionPlacement) => {
  if (placement.kind === 'fallback') return finitePoint(placement.offset);
  const values =
    placement.kind === 'linear'
      ? [placement.fraction, placement.normalOffset, placement.overshoot ?? 0]
      : placement.kind === 'radial'
        ? [placement.angle, placement.radiusRatio, placement.radiusOffset ?? 0, placement.distance ?? 0]
        : [placement.radius, placement.angleOffset];
  return values.every(Number.isFinite);
};

function angleEndpoints(sketch: CadSketch, dimension: Extract<Dimension, { type: 'angle' }>) {
  return [dimension.entityAId, dimension.entityBId].flatMap(id => {
    const line = sketch.entities.find(entity => entity.id === id);
    return line?.type === 'line'
      ? [line.startId, line.endId].flatMap(id => {
          const point = sketch.entities.find(entity => entity.id === id);
          return point?.type === 'point' ? [point] : [];
        })
      : [];
  });
}
const centroid = (points: readonly CadPoint[]): CadPoint => ({
  x: points.reduce((sum, point) => sum + point.x / points.length, 0),
  y: points.reduce((sum, point) => sum + point.y / points.length, 0),
});

function placementFrame(sketch: CadSketch, dimension: Dimension): Frame | null {
  const witnesses = dimensionWitnessPoints(sketch, dimension);
  if (witnesses) {
    const [a, b] = witnesses,
      origin = midpoint(a, b),
      delta = { x: b.x - a.x, y: b.y - a.y },
      length = Math.hypot(delta.x, delta.y);
    const axis =
      dimension.type === 'distanceX' || dimension.type === 'positionX'
        ? { x: 1, y: 0 }
        : dimension.type === 'distanceY' || dimension.type === 'positionY'
          ? { x: 0, y: 1 }
          : length > CAD_GEOMETRY_TOLERANCE
            ? { x: delta.x / length, y: delta.y / length }
            : null;
    const span = axis && dot(delta, axis);
    return axis && span !== null && Math.abs(span) > CAD_GEOMETRY_TOLERANCE
      ? { kind: 'linear', origin, axis, normal: { x: -axis.y, y: axis.x }, span }
      : { kind: 'fallback', origin, axis: axis ?? { x: 1, y: 0 } };
  }
  if (dimension.type === 'radius' || dimension.type === 'diameter') {
    const curve = sketch.entities.find(entity => entity.id === dimension.entityId);
    const center = curve && 'centerId' in curve && sketch.entities.find(entity => entity.id === curve.centerId);
    if (!curve || !('radius' in curve) || !center || center.type !== 'point') return null;
    return Number.isFinite(curve.radius) && curve.radius >= 0 ? { kind: 'radial', origin: center, radius: curve.radius } : null;
  }
  if (dimension.type !== 'angle') return null;
  const endpoints = angleEndpoints(sketch, dimension);
  if (endpoints.length !== 4) return null;
  const startAngle =
    Math.atan2(endpoints[1]!.y - endpoints[0]!.y, endpoints[1]!.x - endpoints[0]!.x) +
    (dimension.orientation !== undefined && dimension.reversedA ? Math.PI : 0);
  const equivalent = pointEquivalence(sketch.constraints);
  for (const a of endpoints.slice(0, 2))
    for (const b of endpoints.slice(2)) if (equivalent.equivalent(a.id, b.id)) return { kind: 'angle', origin: midpoint(a, b), startAngle };
  const center = centroid(endpoints);
  const angle = dimensionAngleWitness(sketch, dimension);
  if (angle && finitePoint(angle.center)) {
    const first = { x: endpoints[1]!.x - endpoints[0]!.x, y: endpoints[1]!.y - endpoints[0]!.y },
      second = { x: endpoints[3]!.x - endpoints[2]!.x, y: endpoints[3]!.y - endpoints[2]!.y },
      firstLength = Math.hypot(first.x, first.y),
      secondLength = Math.hypot(second.x, second.y),
      normalizedCross = Math.abs((first.x / firstLength) * (second.y / secondLength) - (first.y / firstLength) * (second.x / secondLength)),
      vertexRatio = Math.hypot(angle.center.x - center.x, angle.center.y - center.y) / Math.max(firstLength, secondLength);
    // Compact distance blending bounds a remote vertex. The determinant weight
    // gives unjoined, coincident lines the same limit from every approach.
    const weight = (1 - smoothstep(vertexRatio - 1)) * smoothstep(normalizedCross / STABLE_ANGLE_CROSS);
    if (Number.isFinite(weight) && weight > 0)
      return {
        kind: 'angle',
        origin: { x: center.x + (angle.center.x - center.x) * weight, y: center.y + (angle.center.y - center.y) * weight },
        startAngle,
      };
  }
  return { kind: 'angle', origin: center, startAngle };
}

/** Preserve the prior display interpretation of unflagged input before its one-time local-frame upgrade. */
function legacyAnglePosition(sketch: CadSketch, dimension: Dimension): CadPoint | null {
  if (dimension.type !== 'angle' || dimension.labelPlacement?.kind !== 'angle') return null;
  const raw = dimensionAngleWitness(sketch, dimension),
    endpoints = angleEndpoints(sketch, dimension);
  if (endpoints.length !== 4) return null;
  const placement = dimension.labelPlacement;
  const finiteCenter = centroid(endpoints),
    start =
      raw?.startAngle ??
      Math.atan2(endpoints[1]!.y - endpoints[0]!.y, endpoints[1]!.x - endpoints[0]!.x) +
        (dimension.orientation !== undefined && dimension.reversedA ? Math.PI : 0),
    angle = start + placement.angleOffset;
  let center = finiteCenter;
  if (raw && finitePoint(raw.center)) {
    const first = { x: endpoints[1]!.x - endpoints[0]!.x, y: endpoints[1]!.y - endpoints[0]!.y },
      second = { x: endpoints[3]!.x - endpoints[2]!.x, y: endpoints[3]!.y - endpoints[2]!.y },
      firstLength = Math.hypot(first.x, first.y),
      secondLength = Math.hypot(second.x, second.y),
      scale = Math.max(firstLength, secondLength),
      cross = Math.abs((first.x / firstLength) * (second.y / secondLength) - (first.y / firstLength) * (second.x / secondLength)),
      ratio = Math.hypot(raw.center.x - finiteCenter.x, raw.center.y - finiteCenter.y) / scale;
    if (ratio <= 1000 && (cross >= 1e-3 || ratio <= 8)) center = raw.center;
    else if (placement.radius > scale * 8) {
      const original = { x: raw.center.x + Math.cos(angle) * placement.radius, y: raw.center.y + Math.sin(angle) * placement.radius };
      if (finitePoint(original) && Math.hypot(original.x - finiteCenter.x, original.y - finiteCenter.y) <= scale * 8) return original;
    }
  }
  const position = { x: center.x + Math.cos(angle) * placement.radius, y: center.y + Math.sin(angle) * placement.radius };
  return finitePoint(position) ? position : null;
}

/** Annotation graphics share the label's conditioned vertex; numeric angle measurement remains unchanged. */
export function dimensionAnnotationAngleWitness(sketch: CadSketch, dimension: Extract<Dimension, { type: 'angle' }>) {
  const frame = placementFrame(sketch, dimension);
  return frame?.kind === 'angle'
    ? { center: frame.origin, startAngle: frame.startAngle, sweep: ((dimension.orientation ?? 1) * dimension.value * Math.PI) / 180 }
    : null;
}

/** Capture user placement against source geometry, before a command changes its coordinates or values. */
export function captureDimensionPlacement(sketch: CadSketch, dimension: Dimension, position: CadPoint): CadDimensionPlacement | null {
  if (!finitePoint(position)) return null;
  const frame = placementFrame(sketch, dimension);
  if (!frame || !finitePoint(frame.origin)) return null;
  const offset = { x: position.x - frame.origin.x, y: position.y - frame.origin.y };
  let placement: CadDimensionPlacement;
  if (frame.kind === 'linear') {
    const along = dot(offset, frame.axis),
      rawFraction = 0.5 + along / frame.span,
      fraction = Math.max(0, Math.min(1, rawFraction)),
      overshoot = fraction === rawFraction ? 0 : along - (fraction - 0.5) * frame.span;
    placement = { kind: 'linear', fraction, normalOffset: dot(offset, frame.normal), ...(overshoot !== 0 && { overshoot }) };
  } else if (frame.kind === 'radial') {
    const distance = Math.hypot(offset.x, offset.y),
      ratio = frame.radius > 0 ? distance / frame.radius : distance > 0 ? Infinity : 0,
      radiusRatio = Math.min(ratio, MAX_RADIAL_GAIN),
      radiusOffset = ratio === radiusRatio ? 0 : distance - radiusRatio * frame.radius;
    placement = { kind: 'radial', angle: Math.atan2(offset.y, offset.x), radiusRatio, ...(radiusOffset !== 0 && { radiusOffset }) };
  } else if (frame.kind === 'angle') {
    const angle = Math.atan2(offset.y, offset.x) - frame.startAngle;
    placement = {
      kind: 'angle',
      frame: 'local',
      radius: Math.hypot(offset.x, offset.y),
      angleOffset: Math.atan2(Math.sin(angle), Math.cos(angle)),
    };
  } else placement = { kind: 'fallback', offset };
  return finitePlacement(placement) ? placement : null;
}

/** Resolve only persisted placement. A null result lets the renderer choose its screen-space default. */
export function resolveDimensionPlacement(sketch: CadSketch, dimension: Dimension): CadPoint | null {
  const placement = dimension.labelPlacement;
  if (!placement) return dimension.labelPosition && finitePoint(dimension.labelPosition) ? { ...dimension.labelPosition } : null;
  if (placement.kind === 'angle' && placement.frame !== 'local') return legacyAnglePosition(sketch, dimension);
  const frame = placementFrame(sketch, dimension);
  if (!frame || !finitePlacement(placement)) return null;
  let origin = frame.origin;
  let offset: CadPoint;
  if (placement.kind === 'fallback') {
    if (dimension.type === 'angle') {
      const endpoints = angleEndpoints(sketch, dimension);
      if (endpoints.length !== 4) return null;
      origin = centroid(endpoints);
    }
    offset = placement.offset;
  } else if (placement.kind === 'linear' && (frame.kind === 'linear' || (frame.kind === 'fallback' && frame.axis))) {
    const axis = frame.axis!,
      normal = { x: -axis.y, y: axis.x },
      along = (placement.fraction - 0.5) * (frame.kind === 'linear' ? frame.span : 0) + (placement.overshoot ?? 0);
    offset = {
      x: axis.x * along + normal.x * placement.normalOffset,
      y: axis.y * along + normal.y * placement.normalOffset,
    };
  } else if (placement.kind === 'radial' && frame.kind === 'radial') {
    const radius = placement.distance ?? frame.radius * placement.radiusRatio + (placement.radiusOffset ?? 0);
    offset = { x: Math.cos(placement.angle) * radius, y: Math.sin(placement.angle) * radius };
  } else if (placement.kind === 'angle' && frame.kind === 'angle') {
    const angle = frame.startAngle + placement.angleOffset;
    offset = { x: Math.cos(angle) * placement.radius, y: Math.sin(angle) * placement.radius };
  } else return null;
  const position = { x: origin.x + offset.x, y: origin.y + offset.y };
  return finitePoint(position) ? position : null;
}

/** One authoritative persisted placement replaces any legacy absolute coordinates. */
export function withDimensionPlacement<T extends Dimension>(sketch: CadSketch, dimension: T, position: CadPoint): T {
  if (!finitePoint(position)) throw new Error('Dimension label coordinates must be finite.');
  const labelPlacement = captureDimensionPlacement(sketch, dimension, position);
  if (!labelPlacement) {
    const legacy = { ...dimension, labelPosition: { ...position } };
    delete legacy.labelPlacement;
    return legacy;
  }
  const next = { ...dimension, labelPlacement };
  delete next.labelPosition;
  return next;
}

/** Upgrade a detached source snapshot without creating an edit command or changing its revision. */
export function migrateDimensionPlacements(document: CadDocument): CadDocument {
  const next = structuredClone(document);
  for (const part of next.parts)
    part.sketch.constraints = part.sketch.constraints.map(constraint => {
      if (!('value' in constraint)) return constraint;
      let current = constraint;
      if (current.expression && isBareBaseUnitLiteral(current.expression, current.type === 'angle' ? 'deg' : 'mm', current.value)) {
        current = { ...current };
        delete current.expression;
      }
      const previous = current.labelPlacement;
      const frame = previous?.kind === 'radial' ? placementFrame(part.sketch, current) : null;
      if (
        previous?.kind === 'radial' &&
        previous.distance === undefined &&
        previous.radiusRatio > MAX_RADIAL_GAIN &&
        frame?.kind === 'radial'
      ) {
        const radiusOffset = (previous.radiusOffset ?? 0) + (previous.radiusRatio - MAX_RADIAL_GAIN) * frame.radius;
        if (Number.isFinite(radiusOffset))
          current = {
            ...current,
            labelPlacement: { ...previous, radiusRatio: MAX_RADIAL_GAIN, ...(radiusOffset !== 0 && { radiusOffset }) },
          };
      }
      if (
        (previous?.kind === 'linear' && (previous.fraction < 0 || previous.fraction > 1)) ||
        (previous?.kind === 'angle' && previous.frame !== 'local')
      ) {
        const position = resolveDimensionPlacement(part.sketch, current);
        const placement = position && captureDimensionPlacement(part.sketch, current, position);
        if (placement) current = { ...current, labelPlacement: placement };
      }
      if (!current.labelPosition) return current;
      if (current.labelPlacement) {
        const normalized = { ...current };
        delete normalized.labelPosition;
        return normalized;
      }
      const placement = captureDimensionPlacement(part.sketch, current, current.labelPosition);
      if (!placement) return current;
      const normalized = { ...current, labelPlacement: placement };
      delete normalized.labelPosition;
      return normalized;
    });
  return next;
}
