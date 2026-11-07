import {
  pointEquivalence,
  closestCurvePoint,
  curveEndpointIds,
  isNurbsCurve,
  type CadConstraint,
  type CadEntity,
  type CadPointEntity,
  type CadSketch,
  type NewCadConstraint,
} from '@wbcnc/cad';

export type ConstraintCommandTool =
  | 'horizontal'
  | 'vertical'
  | 'coincident'
  | 'midpoint'
  | 'parallel'
  | 'perpendicular'
  | 'equal'
  | 'tangent';
export interface ConstraintSelectionResult {
  constraint?: NewCadConstraint;
  needsMore: boolean;
  message: string;
  alreadyApplied?: boolean;
}

export const constraintPrompt = (tool: ConstraintCommandTool) =>
  tool === 'horizontal' || tool === 'vertical'
    ? `Select a line or two points to make them ${tool}.`
    : tool === 'coincident'
      ? 'Select two points, or a point and a curve, to make them coincident.'
      : tool === 'midpoint'
        ? 'Select a point and a line to place the point at its midpoint.'
        : `Select two ${tool === 'parallel' || tool === 'perpendicular' ? 'lines' : 'curves'} to make them ${tool}.`;

function relationshipKey(c: CadConstraint | NewCadConstraint): string {
  if ('pointId' in c && 'entityId' in c) return `${c.type}:${c.pointId}:${c.entityId}`;
  if ('pointAId' in c) return `${c.type}:${[c.pointAId, c.pointBId].sort().join(':')}`;
  if ('entityAId' in c) return `${c.type}:${[c.entityAId, c.entityBId].sort().join(':')}`;
  return `${c.type}:${'entityId' in c ? c.entityId : 'pointId' in c ? c.pointId : ''}`;
}

/** The same selection rules serve preselection and an armed constraint tool. */
export function buildConstraintForSelection(
  sketch: CadSketch,
  tool: ConstraintCommandTool,
  selectedIds: string[]
): ConstraintSelectionResult {
  const selected = [...new Set(selectedIds)].map(id => sketch.entities.find(e => e.id === id)).filter((e): e is CadEntity => !!e);
  const prompt = constraintPrompt(tool);
  const equivalent = pointEquivalence(sketch.constraints);
  const invalid = (message = prompt): ConstraintSelectionResult => ({ needsMore: false, message });
  const done = (constraint: NewCadConstraint): ConstraintSelectionResult => {
    if (
      'pointAId' in constraint &&
      ['coincident', 'horizontalPoints', 'verticalPoints'].includes(constraint.type) &&
      equivalent.equivalent(constraint.pointAId, constraint.pointBId)
    )
      return { needsMore: false, alreadyApplied: true, message: 'These points are already coincident.' };
    if (sketch.constraints.some(c => relationshipKey(c) === relationshipKey(constraint)))
      return { needsMore: false, alreadyApplied: true, message: 'That relationship is already constrained.' };
    return { constraint, needsMore: false, message: `${tool[0]!.toUpperCase()}${tool.slice(1)} constraint added.` };
  };
  if (!selected.length) return { needsMore: true, message: prompt };
  const [a, b] = selected;
  if (tool === 'horizontal' || tool === 'vertical') {
    if (selected.length === 1 && a!.type === 'line') return done({ type: tool, entityId: a!.id });
    if (selected.length === 1 && a!.type === 'point') return { needsMore: true, message: 'Select the second point.' };
    if (selected.length === 2 && a!.type === 'point' && b!.type === 'point')
      return done({ type: tool === 'horizontal' ? 'horizontalPoints' : 'verticalPoints', pointAId: a!.id, pointBId: b!.id });
    return invalid();
  }
  if (selected.length === 1) return { needsMore: true, message: 'Select the second entity. ' + prompt };
  if (selected.length !== 2) return invalid();
  const point = a!.type === 'point' ? a : b!.type === 'point' ? b : undefined;
  const curve = a!.type !== 'point' ? a : b!.type !== 'point' ? b : undefined;
  if (tool === 'coincident') {
    if (a!.type === 'point' && b!.type === 'point') return done({ type: 'coincident', pointAId: a!.id, pointBId: b!.id });
    if (!point || !curve) return invalid();
    if (curve.type === 'line') {
      if ([curve.startId, curve.endId].some(id => equivalent.equivalent(id, point.id)))
        return { needsMore: false, alreadyApplied: true, message: 'This point is already an endpoint of the line.' };
      return done({ type: 'pointOnLine', pointId: point.id, entityId: curve.id });
    }
    if (curve.type === 'arc' && [curve.startId, curve.endId].some(id => equivalent.equivalent(id, point.id)))
      return { needsMore: false, alreadyApplied: true, message: 'This point is already an endpoint of the arc.' };
    if (isNurbsCurve(curve)) {
      if (curveEndpointIds(curve).some(id => equivalent.equivalent(id, point.id)))
        return { needsMore: false, alreadyApplied: true, message: 'This point is already a curve endpoint.' };
      const map = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
      const { parameter } = closestCurvePoint(curve, map, point);
      return done({ type: 'pointOnCurve', pointId: point.id, entityId: curve.id, parameter });
    }
    if (equivalent.equivalent(curve.centerId, point.id)) return invalid('A circle or arc center cannot also lie on its circumference.');
    return done({ type: 'pointOnCircle', pointId: point.id, entityId: curve.id });
  }
  if (tool === 'midpoint') {
    if (!point || curve?.type !== 'line') return invalid();
    if ([curve.startId, curve.endId].some(id => equivalent.equivalent(id, point.id)))
      return invalid('Select a separate point and the line to define its midpoint.');
    return done({ type: 'midpoint', pointId: point.id, entityId: curve.id });
  }
  if (tool === 'parallel' || tool === 'perpendicular') {
    if (a!.type !== 'line' || b!.type !== 'line') return invalid();
  } else if (tool === 'equal') {
    const lines = a!.type === 'line' && b!.type === 'line';
    const round = (a!.type === 'circle' || a!.type === 'arc') && (b!.type === 'circle' || b!.type === 'arc');
    if (!lines && !round) return invalid('Select two lines, or two circular curves, to make them equal.');
  } else if (a!.type === 'point' || b!.type === 'point' || (a!.type === 'line' && b!.type === 'line')) {
    return invalid('Select a line and a circular curve, or two circular curves, for tangency.');
  }
  if (tool === 'tangent' && (isNurbsCurve(a!) || isNurbsCurve(b!)) && !equivalent.match(curveEndpointIds(a!), curveEndpointIds(b!)))
    return invalid('Spline, Bézier, and conic tangency requires a shared endpoint.');
  return done({ type: tool, entityAId: a!.id, entityBId: b!.id });
}
