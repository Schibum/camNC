import { addBezier, addCircle, addConstraint, addLine, addPoint, createCadPart } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { buildConstraintForSelection } from './constraintCommands';

function setup() {
  let sketch = addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 50, y2: 25 });
  sketch = addCircle(sketch, { x: 30, y: 40, radius: 5 });
  const line = sketch.entities.find(e => e.type === 'line')!;
  const circle = sketch.entities.find(e => e.type === 'circle')!;
  return { sketch, line, circle };
}

describe('sketch constraint commands', () => {
  it('accepts tangency at distinct endpoints connected by transitive coincidence', () => {
    let sketch = addLine(createCadPart().sketch, { x1: -20, y1: 0, x2: 0, y2: 0 });
    const line = sketch.entities.find(entity => entity.type === 'line')!;
    sketch = addBezier(sketch, {
      points: [
        { x: 5, y: 5 },
        { x: 30, y: 10 },
        { x: 70, y: 40 },
      ],
    });
    const curve = sketch.entities.at(-1)!;
    if (curve.type !== 'bezier') throw Error();
    sketch = addPoint(sketch, { x: 0, y: 0 });
    const bridge = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: line.endId, pointBId: bridge.id });
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: bridge.id, pointBId: curve.startId });
    expect(buildConstraintForSelection(sketch, 'tangent', [line.id, curve.id]).constraint).toEqual({
      type: 'tangent',
      entityAId: line.id,
      entityBId: curve.id,
    });
    expect(buildConstraintForSelection(sketch, 'coincident', [line.endId, curve.startId]).alreadyApplied).toBe(true);
    expect(buildConstraintForSelection(sketch, 'midpoint', [line.id, bridge.id]).constraint).toBeUndefined();
    expect(buildConstraintForSelection(sketch, 'coincident', [line.id, bridge.id]).alreadyApplied).toBe(true);
  });
  it('accepts a line or point pair for H/V and keeps tool-first point selection pending', () => {
    const { sketch, line } = setup();
    expect(buildConstraintForSelection(sketch, 'horizontal', []).needsMore).toBe(true);
    expect(buildConstraintForSelection(sketch, 'horizontal', [line.startId]).needsMore).toBe(true);
    expect(buildConstraintForSelection(sketch, 'horizontal', [line.startId, line.endId]).constraint).toEqual({
      type: 'horizontalPoints',
      pointAId: line.startId,
      pointBId: line.endId,
    });
    expect(buildConstraintForSelection(sketch, 'vertical', [line.id]).constraint).toEqual({ type: 'vertical', entityId: line.id });
  });

  it('makes Coincident work between points and curves in either selection order', () => {
    const { sketch, line, circle } = setup();
    expect(buildConstraintForSelection(sketch, 'coincident', [circle.centerId, line.id]).constraint).toEqual({
      type: 'pointOnLine',
      pointId: circle.centerId,
      entityId: line.id,
    });
    expect(buildConstraintForSelection(sketch, 'coincident', [circle.id, line.startId]).constraint).toEqual({
      type: 'pointOnCircle',
      pointId: line.startId,
      entityId: circle.id,
    });
    expect(buildConstraintForSelection(sketch, 'coincident', [line.startId, line.endId]).constraint?.type).toBe('coincident');
  });

  it('rejects impossible center-on-circumference and midpoint-of-own-endpoint requests', () => {
    const { sketch, line, circle } = setup();
    expect(buildConstraintForSelection(sketch, 'coincident', [circle.id, circle.centerId]).constraint).toBeUndefined();
    expect(buildConstraintForSelection(sketch, 'midpoint', [line.id, line.startId]).constraint).toBeUndefined();
    expect(buildConstraintForSelection(sketch, 'midpoint', [circle.centerId, line.id]).constraint).toEqual({
      type: 'midpoint',
      pointId: circle.centerId,
      entityId: line.id,
    });
  });

  it('does not add duplicate or unsupported constraints', () => {
    const { sketch, line, circle } = setup();
    const constrained = addConstraint(sketch, { type: 'horizontalPoints', pointAId: line.startId, pointBId: line.endId });
    expect(buildConstraintForSelection(constrained, 'horizontal', [line.endId, line.startId]).alreadyApplied).toBe(true);
    expect(buildConstraintForSelection(sketch, 'parallel', [line.id, circle.id]).constraint).toBeUndefined();
    expect(buildConstraintForSelection(sketch, 'equal', [line.id, circle.id]).constraint).toBeUndefined();
    expect(buildConstraintForSelection(sketch, 'tangent', [line.id, circle.id]).constraint?.type).toBe('tangent');
  });
});
