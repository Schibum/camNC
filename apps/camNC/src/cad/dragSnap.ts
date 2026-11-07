import { entityPointIds, pointEquivalence, type CadPoint, type CadSketch, type NewCadConstraint } from '@wbcnc/cad';
import { inferDrawingPoint, inferredPointConstraints, type CadDrawingInference, type CadDrawingInferenceOptions } from './drawingInference';
import { pickSketchSnap, type CadPickingOptions } from './picking';

/** Reuse drawing inference for point drags without snapping back to the dragged geometry. */
export function inferDragPoint(
  sketch: CadSketch,
  pointId: string,
  raw: CadPoint,
  options: CadDrawingInferenceOptions
): CadDrawingInference {
  const moving = pointEquivalence(sketch.constraints).expand([pointId, ...(options.excludePointIds ?? [])]);
  // Contact with another point on the same curve would collapse that curve. Its axes remain
  // useful references, so exclude those points only from direct contact picking.
  const contactExcluded = new Set(moving);
  for (const entity of sketch.entities) {
    if (entity.type === 'point') continue;
    const ids = entityPointIds(entity);
    if (ids.some(id => moving.has(id))) ids.forEach(id => contactExcluded.add(id));
  }
  const directSnap =
    options.enabled === false
      ? null
      : pickSketchSnap(sketch, options.project(raw), {
          ...options,
          excludePointIds: contactExcluded,
        });
  return inferDrawingPoint(sketch, raw, { ...options, excludePointIds: moving, directSnap });
}

/** Propose permanent relations only when the native drag preview actually reached the inference. */
export function dragSnapConstraints(
  sketch: CadSketch,
  pointId: string,
  inference: CadDrawingInference | null,
  options: Pick<CadPickingOptions, 'project'> & { tolerancePx?: number }
): NewCadConstraint[] {
  if (!inference) return [];
  const point = sketch.entities.find(entity => entity.id === pointId);
  if (point?.type !== 'point' || point.fixed) return [];
  const tolerance = Math.max(0, options.tolerancePx ?? 1);
  const near = (a: CadPoint, b: CadPoint) => {
    const sa = options.project(a),
      sb = options.project(b);
    return [sa.x, sa.y, sb.x, sb.y].every(Number.isFinite) && Math.hypot(sa.x - sb.x, sa.y - sb.y) <= tolerance;
  };
  const existing = sketch.constraints;
  const snap = inference.snap;
  if (snap?.targetPointId) {
    const target = sketch.entities.find(entity => entity.id === snap.targetPointId);
    if (target?.type !== 'point' || !near(point, target) || pointEquivalence(sketch.constraints).equivalent(pointId, target.id)) return [];
    return [{ type: 'coincident', pointAId: pointId, pointBId: target.id }];
  }
  if (snap?.entityId) {
    const curve = sketch.entities.find(entity => entity.id === snap.entityId);
    if (!curve || curve.type === 'point' || entityPointIds(curve).includes(pointId)) return [];
    if (snap.kind === 'midpoint' && curve.type === 'line') {
      const a = sketch.entities.find(entity => entity.id === curve.startId);
      const b = sketch.entities.find(entity => entity.id === curve.endId);
      if (a?.type !== 'point' || b?.type !== 'point' || !near(point, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) return [];
      return existing.some(c => c.type === 'midpoint' && c.pointId === pointId && c.entityId === curve.id)
        ? []
        : [{ type: 'midpoint', pointId, entityId: curve.id }];
    }
    // Re-evaluate the contact on the solved curve, since constraints may have moved it too.
    const hit = pickSketchSnap(
      { ...sketch, entities: sketch.entities.filter(entity => entity.type === 'point' || entity.id === curve.id) },
      options.project(point),
      {
        project: options.project,
        pointRadiusPx: -1,
        includeMidpoints: false,
        curveRadiusPx: tolerance,
      }
    );
    if (!hit || hit.entityId !== curve.id) return [];
    if (
      existing.some(
        c =>
          'pointId' in c &&
          'entityId' in c &&
          c.pointId === pointId &&
          c.entityId === curve.id &&
          ['pointOnLine', 'pointOnCircle', 'pointOnCurve', 'midpoint'].includes(c.type)
      )
    )
      return [];
    if (curve.type === 'line') return [{ type: 'pointOnLine', pointId, entityId: curve.id }];
    if (curve.type === 'arc' || curve.type === 'circle') return [{ type: 'pointOnCircle', pointId, entityId: curve.id }];
    return hit.parameter === undefined ? [] : [{ type: 'pointOnCurve', pointId, entityId: curve.id, parameter: hit.parameter }];
  }
  const reachedAlignments = inference.alignments.filter(alignment => {
    const source = sketch.entities.find(entity => entity.id === alignment.sourcePointId);
    if (source?.type !== 'point') return false;
    const axisPoint = alignment.type === 'horizontalPoints' ? { x: point.x, y: source.y } : { x: source.x, y: point.y };
    return near(point, axisPoint);
  });
  return inferredPointConstraints({ ...inference, alignments: reachedAlignments }, pointId, sketch);
}
