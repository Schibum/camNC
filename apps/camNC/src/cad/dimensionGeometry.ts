import {
  dimensionAnnotationAngleWitness,
  dimensionWitnessPoints,
  resolveDimensionPlacement,
  type CadDimension,
  type CadPoint,
  type CadSketch,
} from '@wbcnc/cad';

export const dimensionPoints = (sketch: CadSketch) =>
  new Map(sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));

export function angleDimensionGeometry(c: Extract<CadDimension, { type: 'angle' }>, sketch: CadSketch) {
  return dimensionAnnotationAngleWitness(sketch, c);
}

/** Project both witnesses onto the label's common dimension line, including labels beyond its arrow span. */
export function linearDimensionGeometry(c: CadDimension, sketch: CadSketch, label: CadPoint) {
  const witnesses = dimensionWitnessPoints(sketch, c);
  if (!witnesses) return null;
  const [a, b] = witnesses,
    length = Math.hypot(b.x - a.x, b.y - a.y);
  const axis =
    c.type === 'distanceX' || c.type === 'positionX'
      ? { x: 1, y: 0 }
      : c.type === 'distanceY' || c.type === 'positionY'
        ? { x: 0, y: 1 }
        : length > 1e-10
          ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
          : null;
  if (!axis) return null;
  const normal = { x: -axis.y, y: axis.x },
    dot = (a: CadPoint, b: CadPoint) => a.x * b.x + a.y * b.y;
  const project = (point: CadPoint) => {
    const offset = dot(label, normal) - dot(point, normal);
    return { x: point.x + normal.x * offset, y: point.y + normal.y * offset };
  };
  const da = project(a),
    db = project(b),
    ta = dot(da, axis),
    tb = dot(db, axis),
    tl = dot(label, axis);
  const near = tl < Math.min(ta, tb) - 1e-10 ? (ta < tb ? da : db) : tl > Math.max(ta, tb) + 1e-10 ? (ta > tb ? da : db) : null;
  const lineA =
    c.type === 'pointLineDistance'
      ? c.entityId
      : c.type === 'lineLineDistance' || c.type === 'lineCircleDistance'
        ? c.entityAId
        : undefined;
  const lineB = c.type === 'lineLineDistance' ? c.entityBId : undefined;
  const points = dimensionPoints(sketch);
  const extension = (source: CadPoint, target: CadPoint, lineId?: string) => {
    const line = lineId && sketch.entities.find(e => e.id === lineId);
    const start = line && line.type === 'line' ? points.get(line.startId) : undefined;
    const end = line && line.type === 'line' ? points.get(line.endId) : undefined;
    if (start && end) {
      const dx = end.x - start.x,
        dy = end.y - start.y,
        length2 = dx * dx + dy * dy;
      if (length2 > 1e-20 && Math.abs((target.x - start.x) * dy - (target.y - start.y) * dx) <= 1e-8 * Math.sqrt(length2)) {
        const t = ((target.x - start.x) * dx + (target.y - start.y) * dy) / length2;
        if (t >= -1e-10 && t <= 1 + 1e-10) return null;
        return { source: t < 0 ? start : end, target, continuesLine: true };
      }
    }
    return { source, target, continuesLine: false };
  };
  return {
    a,
    b,
    da,
    db,
    extensionA: extension(a, da, lineA),
    extensionB: extension(b, db, lineB),
    labelLeader: near ? ([near, { ...label }] as const) : null,
  };
}

/** Placed annotations follow their geometry; unplaced defaults use CSS-pixel distances. */
export function dimensionAnchor(c: CadDimension, sketch: CadSketch, pixelScale = 1): CadPoint | null {
  const placed = resolveDimensionPlacement(sketch, c);
  if (placed) return placed;
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const points = dimensionPoints(sketch),
    offset = 20 / scale;
  const witnesses = dimensionWitnessPoints(sketch, c);
  if (witnesses) {
    const [a, b] = witnesses;
    if (c.type === 'distanceX' || c.type === 'positionX') return { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - offset };
    if (c.type === 'distanceY' || c.type === 'positionY') return { x: Math.max(a.x, b.x) + offset, y: (a.y + b.y) / 2 };
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      x: (a.x + b.x) / 2 + (length ? ((b.y - a.y) / length) * offset : 0),
      y: (a.y + b.y) / 2 - (length ? ((b.x - a.x) / length) * offset : offset),
    };
  }
  if ('entityId' in c) {
    const entity = sketch.entities.find(e => e.id === c.entityId);
    const center = entity && 'centerId' in entity ? points.get(entity.centerId) : undefined;
    if (!center || !entity || !('radius' in entity)) return null;
    const sweep = entity.type === 'arc' ? (((entity.endAngle - entity.startAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) : 0;
    const angle = entity.type === 'arc' ? entity.startAngle + sweep / 2 : Math.PI / 4;
    return { x: center.x + Math.cos(angle) * (entity.radius + offset), y: center.y + Math.sin(angle) * (entity.radius + offset) };
  }
  if (c.type !== 'angle') return null;
  const angle = angleDimensionGeometry(c, sketch);
  if (angle)
    return {
      x: angle.center.x + (Math.cos(angle.startAngle + angle.sweep / 2) * 40) / scale,
      y: angle.center.y + (Math.sin(angle.startAngle + angle.sweep / 2) * 40) / scale,
    };
  // Parallel lines still have a meaningful0°/180° dimension even though their intersection is at infinity.
  const endpoints = [c.entityAId, c.entityBId].flatMap(id => {
    const line = sketch.entities.find(e => e.id === id);
    return line?.type === 'line' ? [points.get(line.startId), points.get(line.endId)].filter(p => !!p) : [];
  });
  return endpoints.length
    ? {
        x: endpoints.reduce((sum, point) => sum + point.x, 0) / endpoints.length + offset,
        y: endpoints.reduce((sum, point) => sum + point.y, 0) / endpoints.length + offset,
      }
    : null;
}
