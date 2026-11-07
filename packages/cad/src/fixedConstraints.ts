import { constraintEntityIds, entityPointIds } from './document';
import { curveEndpointIds, evaluateCurvePoint, evaluateCurveTangent, isNurbsCurve } from './curves';
import { CAD_GEOMETRY_TOLERANCE } from './geometry';
import type { CadDiagnostic, CadPart, CadPointEntity } from './types';
import { pointEquivalence } from './pointEquivalence';

/** PlaneGCS omits equations containing no unknowns. Check only relationships fully determined by fixed points. */
export function fixedConstraintConflicts(part: CadPart): CadDiagnostic[] {
  const entities = new Map(part.sketch.entities.map(entity => [entity.id, entity]));
  const equivalent = pointEquivalence(part.sketch.constraints);
  const point = (id: string): CadPointEntity | undefined => {
    const entity = entities.get(id);
    return entity?.type === 'point' && entity.fixed ? entity : undefined;
  };
  const line = (id: string) => {
    const entity = entities.get(id);
    if (entity?.type !== 'line') return undefined;
    const a = point(entity.startId),
      b = point(entity.endId);
    return a && b ? { a, b, dx: b.x - a.x, dy: b.y - a.y, length: Math.hypot(b.x - a.x, b.y - a.y) } : undefined;
  };
  const arc = (id: string) => {
    const entity = entities.get(id);
    if (entity?.type !== 'arc') return undefined;
    const center = point(entity.centerId),
      start = point(entity.startId),
      end = point(entity.endId);
    return center && start && end ? { center, radius: Math.hypot(start.x - center.x, start.y - center.y) } : undefined;
  };
  const errors: CadDiagnostic[] = [];
  const fixedCurve = (curve: import('./types').CadEntity) =>
    curve.type !== 'circle' && (curve.type === 'spline' ? curve.controlPointIds : entityPointIds(curve)).every(id => point(id));
  for (const constraint of part.sketch.constraints) {
    if ('value' in constraint && constraint.driven) continue;
    let error: number | undefined;
    switch (constraint.type) {
      case 'symmetricPoints': {
        const a = point(constraint.pointAId),
          b = point(constraint.pointBId),
          axis = line(constraint.lineId);
        if (!a || !b || !axis || !axis.length) break;
        const t = ((a.x - axis.a.x) * axis.dx + (a.y - axis.a.y) * axis.dy) / (axis.length * axis.length);
        error = Math.hypot(b.x - (2 * (axis.a.x + t * axis.dx) - a.x), b.y - (2 * (axis.a.y + t * axis.dy) - a.y));
        break;
      }
      case 'offset': {
        for (const member of constraint.members) {
          const source = entities.get(member.sourceId),
            target = entities.get(member.targetId);
          if (member.kind === 'line') {
            const a = line(member.sourceId),
              b = line(member.targetId);
            if (!a || !b || !a.length) continue;
            const gap = member.side * constraint.value,
              nx = -a.dy / a.length,
              ny = a.dx / a.length;
            const candidate = member.endpoints
              ? Math.max(
                  Math.hypot(b.a.x - a.a.x - nx * gap, b.a.y - a.a.y - ny * gap),
                  Math.hypot(b.b.x - a.b.x - nx * gap, b.b.y - a.b.y - ny * gap)
                )
              : Math.max(
                  Math.abs((a.dx * b.dy - a.dy * b.dx) / Math.max(a.length, b.length)),
                  Math.abs((a.dx * (b.a.y - a.a.y) - a.dy * (b.a.x - a.a.x)) / a.length - gap)
                );
            error = Math.max(error ?? 0, candidate);
          } else if ((source?.type === 'circle' || source?.type === 'arc') && (target?.type === 'circle' || target?.type === 'arc')) {
            const a = point(source.centerId),
              b = point(target.centerId);
            if (a && b) error = Math.max(error ?? 0, Math.hypot(b.x - a.x, b.y - a.y));
            const sourceArc = arc(source.id),
              targetArc = arc(target.id);
            if (sourceArc && targetArc) {
              error = Math.max(error ?? 0, Math.abs(targetArc.radius - sourceArc.radius - member.side * constraint.value));
              if (member.kind === 'arc' && member.endpoints && source.type === 'arc' && target.type === 'arc')
                for (const end of ['startId', 'endId'] as const) {
                  const s = point(source[end])!,
                    t = point(target[end])!;
                  error = Math.max(
                    error ?? 0,
                    Math.hypot(
                      (s.x - sourceArc.center.x) / sourceArc.radius - (t.x - targetArc.center.x) / targetArc.radius,
                      (s.y - sourceArc.center.y) / sourceArc.radius - (t.y - targetArc.center.y) / targetArc.radius
                    ) * Math.min(sourceArc.radius, targetArc.radius)
                  );
                }
            }
          }
        }
        break;
      }
      case 'horizontal':
      case 'vertical': {
        const fixed = line(constraint.entityId);
        if (fixed) error = constraint.type === 'horizontal' ? fixed.dy : fixed.dx;
        break;
      }
      case 'horizontalPoints':
      case 'verticalPoints':
      case 'coincident':
      case 'distance':
      case 'distanceX':
      case 'distanceY': {
        const a = point(constraint.pointAId),
          b = point(constraint.pointBId);
        if (!a || !b) break;
        const dx = b.x - a.x,
          dy = b.y - a.y;
        switch (constraint.type) {
          case 'horizontalPoints':
            error = dy;
            break;
          case 'verticalPoints':
            error = dx;
            break;
          case 'coincident':
            error = Math.hypot(dx, dy);
            break;
          case 'distance':
            error = Math.hypot(dx, dy) - constraint.value;
            break;
          case 'distanceX':
            error = dx - constraint.value;
            break;
          case 'distanceY':
            error = dy - constraint.value;
            break;
        }
        break;
      }
      case 'positionX':
      case 'positionY': {
        const fixed = point(constraint.pointId);
        if (fixed) error = (constraint.type === 'positionX' ? fixed.x : fixed.y) - constraint.value;
        break;
      }
      case 'pointOnLine':
      case 'pointLineDistance':
      case 'midpoint': {
        const fixedPoint = point(constraint.pointId),
          fixedLine = line(constraint.entityId);
        if (!fixedPoint || !fixedLine) break;
        error =
          constraint.type === 'midpoint'
            ? Math.hypot(fixedPoint.x - (fixedLine.a.x + fixedLine.b.x) / 2, fixedPoint.y - (fixedLine.a.y + fixedLine.b.y) / 2)
            : (fixedLine.dx * (fixedPoint.y - fixedLine.a.y) - fixedLine.dy * (fixedPoint.x - fixedLine.a.x)) / fixedLine.length;
        if (constraint.type === 'pointLineDistance') error = Math.abs(error) - constraint.value;
        break;
      }
      case 'pointOnCurve': {
        const fixedPoint = point(constraint.pointId),
          curve = entities.get(constraint.entityId);
        if (fixedPoint && curve && isNurbsCurve(curve) && constraint.parameterFixed && fixedCurve(curve)) {
          const points = new Map(part.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
          const value = evaluateCurvePoint(curve, points, constraint.parameter);
          error = Math.hypot(fixedPoint.x - value.x, fixedPoint.y - value.y);
        }
        break;
      }
      case 'pointArcDistance':
      case 'lineCircleDistance': {
        const fixedArc = arc(constraint.type === 'pointArcDistance' ? constraint.entityId : constraint.entityBId);
        if (!fixedArc) break;
        let distance: number;
        if (constraint.type === 'pointArcDistance') {
          const p = point(constraint.pointId);
          if (!p) break;
          distance = Math.hypot(p.x - fixedArc.center.x, p.y - fixedArc.center.y);
        } else {
          const l = line(constraint.entityAId);
          if (!l) break;
          distance = Math.abs(l.dx * (fixedArc.center.y - l.a.y) - l.dy * (fixedArc.center.x - l.a.x)) / l.length;
        }
        error =
          (constraint.radiusSide === 'far'
            ? distance + fixedArc.radius
            : constraint.side === 'outside'
              ? distance - fixedArc.radius
              : fixedArc.radius - distance) - constraint.value;
        break;
      }
      case 'circleCircleDistance': {
        const a = arc(constraint.entityAId),
          b = arc(constraint.entityBId);
        if (a && b)
          error =
            Math.hypot(b.center.x - a.center.x, b.center.y - a.center.y) +
            constraint.radiusASign * a.radius +
            constraint.radiusBSign * b.radius -
            constraint.direction * constraint.value;
        break;
      }
      case 'lineLineDistance': {
        const a = line(constraint.entityAId),
          b = line(constraint.entityBId);
        if (!a || !b) break;
        const parallelError = (a.dx * b.dy - a.dy * b.dx) / Math.max(a.length, b.length);
        error =
          Math.abs(parallelError) > CAD_GEOMETRY_TOLERANCE
            ? parallelError
            : Math.abs(a.dx * (b.a.y - a.a.y) - a.dy * (b.a.x - a.a.x)) / a.length - constraint.value;
        break;
      }
      case 'parallel':
      case 'perpendicular':
      case 'equal':
      case 'angle': {
        const a = line(constraint.entityAId),
          b = line(constraint.entityBId);
        if (!a || !b) break;
        const cross = a.dx * b.dy - a.dy * b.dx,
          dot = a.dx * b.dx + a.dy * b.dy;
        if (constraint.type === 'equal') error = a.length - b.length;
        else if (constraint.type === 'angle') {
          const target =
            constraint.orientation === undefined
              ? constraint.value
              : constraint.orientation * constraint.value + (constraint.reversedA ? 180 : 0) - (constraint.reversedB ? 180 : 0);
          const delta = Math.atan2(cross, dot) - (target * Math.PI) / 180;
          // Express angular mismatch as endpoint travel, so the same mm tolerance applies.
          error = Math.atan2(Math.sin(delta), Math.cos(delta)) * Math.min(a.length, b.length);
        } else error = (constraint.type === 'parallel' ? cross : dot) / Math.max(a.length, b.length);
        break;
      }
      case 'tangent': {
        const curveA = entities.get(constraint.entityAId),
          curveB = entities.get(constraint.entityBId);
        if (
          curveA &&
          curveB &&
          curveA.type !== 'point' &&
          curveB.type !== 'point' &&
          (isNurbsCurve(curveA) || isNurbsCurve(curveB)) &&
          [curveA, curveB].every(fixedCurve)
        ) {
          const shared = equivalent.match(curveEndpointIds(curveA), curveEndpointIds(curveB));
          if (shared) {
            const points = new Map(part.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
            const a = evaluateCurveTangent(curveA, points, equivalent.equivalent(curveEndpointIds(curveA)[0]!, shared[0]) ? 0 : 1),
              b = evaluateCurveTangent(curveB, points, equivalent.equivalent(curveEndpointIds(curveB)[0]!, shared[1]) ? 0 : 1);
            error = (a.x * b.y - a.y * b.x) / Math.max(Math.hypot(a.x, a.y), Math.hypot(b.x, b.y));
          }
          break;
        }
        const lineA = line(constraint.entityAId),
          lineB = line(constraint.entityBId);
        const arcA = arc(constraint.entityAId),
          arcB = arc(constraint.entityBId);
        const fixedLine = lineA ?? lineB,
          fixedArc = arcA ?? arcB;
        if (fixedLine && fixedArc) {
          const distance =
            Math.abs(fixedLine.dx * (fixedArc.center.y - fixedLine.a.y) - fixedLine.dy * (fixedArc.center.x - fixedLine.a.x)) /
            fixedLine.length;
          error = distance - fixedArc.radius;
        } else if (arcA && arcB) {
          const distance = Math.hypot(arcB.center.x - arcA.center.x, arcB.center.y - arcA.center.y);
          error = Math.min(Math.abs(distance - arcA.radius - arcB.radius), Math.abs(distance - Math.abs(arcA.radius - arcB.radius)));
        }
        break;
      }
      // A fixed circle center does not fix its radius. Arc-specific constants keep a native radius equation.
      default:
        break;
    }
    if (error !== undefined && Math.abs(error) > CAD_GEOMETRY_TOLERANCE) {
      const name = (constraint.label ?? constraint.type).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      errors.push({
        code: 'constraint-conflict',
        message: `The ${name} constraint conflicts with fixed geometry. Unfix a point or change the constraint.`,
        severity: 'error',
        partId: part.id,
        constraintIds: [constraint.id],
        entityIds: constraintEntityIds(constraint),
      });
    }
  }
  const allPoints = new Map(part.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
  for (const curve of part.sketch.entities)
    if (curve.type === 'spline' && curve.controlPointIds.every(id => point(id)))
      curve.fitPointIds.forEach((id, i) => {
        const fixed = point(id);
        if (!fixed) return;
        const p = evaluateCurvePoint(curve, allPoints, curve.fitParameters[i]!);
        if (Math.hypot(p.x - fixed.x, p.y - fixed.y) > CAD_GEOMETRY_TOLERANCE)
          errors.push({
            code: 'constraint-conflict',
            message: 'A fixed spline fit point does not lie on its fixed curve.',
            severity: 'error',
            partId: part.id,
            entityIds: [curve.id, id],
          });
      });
  return errors;
}
