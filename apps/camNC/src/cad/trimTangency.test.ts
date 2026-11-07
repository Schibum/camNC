import {
  addArc,
  addConstraint,
  addLine,
  addPoint,
  addSpline,
  createCadDocument,
  createCadPart,
  newCadId,
  parseCadDocument,
  solveCadDocument,
  type CadArcEntity,
  type CadLineEntity,
  type CadSketch,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { trimSketchCurveAt } from './trimCurves';

function boundary(sketch: CadSketch, x: number, y: number) {
  return addPoint(sketch, { x, y });
}

function separateArcStart(sketch: CadSketch, arc: CadArcEntity, transitive: boolean): CadSketch {
  const original = sketch.entities.find(entity => entity.type === 'point' && entity.id === arc.startId)!;
  const alias = { ...original, id: newCadId() };
  const middle = { ...original, id: newCadId(), standalone: true };
  let next: CadSketch = {
    ...sketch,
    entities: [...sketch.entities.map(entity => (entity.id === arc.id ? { ...arc, startId: alias.id } : entity)), alias],
  };
  if (transitive) next = { ...next, entities: [...next.entities, middle] };
  next = addConstraint(next, { type: 'coincident', pointAId: arc.startId, pointBId: transitive ? middle.id : alias.id });
  return transitive ? addConstraint(next, { type: 'coincident', pointAId: middle.id, pointBId: alias.id }) : next;
}

async function expectNativeSolved(sketch: CadSketch) {
  const document = createCadDocument();
  document.parts.push({ ...createCadPart(), sketch });
  expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
  const result = await solveCadDocument(document);
  expect(result.sketches[0]?.status, JSON.stringify(result.diagnostics)).toBe('solved');
  expect(result.diagnostics.some(diagnostic => diagnostic.code === 'invalid-reference')).toBe(false);
  return result;
}

describe('trim retains tangency at the original logical joint', () => {
  it.each([false, true])('rebinds an arc–spline end tangent to the second remainder (aliased joint: %s)', async aliased => {
    let sketch = addArc(createCadPart().sketch, { cx: 60, cy: 40, radius: 10, startAngle: 0, endAngle: (3 * Math.PI) / 2 });
    const arc = sketch.entities.find((entity): entity is CadArcEntity => entity.type === 'arc')!;
    sketch = addSpline(sketch, {
      points: [
        { x: 60, y: 30 },
        { x: 75, y: 30 },
        { x: 90, y: 30 },
      ],
    });
    let spline = sketch.entities.find(entity => entity.type === 'spline')!;
    if (aliased) {
      const original = sketch.entities.find(entity => entity.type === 'point' && entity.id === spline.startId)!;
      const alias = { ...original, id: newCadId() };
      spline = {
        ...spline,
        startId: alias.id,
        fitPointIds: spline.fitPointIds.map(id => (id === original.id ? alias.id : id)),
        controlPointIds: spline.controlPointIds.map(id => (id === original.id ? alias.id : id)),
      };
      sketch.entities = [
        ...sketch.entities.map(entity =>
          entity.id === spline.id
            ? spline
            : entity.type === 'line' && entity.owner?.splineId === spline.id && entity.owner.end === 'start'
              ? { ...entity, startId: alias.id }
              : entity
        ),
        alias,
      ];
      sketch = addConstraint(sketch, { type: 'coincident', pointAId: original.id, pointBId: alias.id });
    }
    sketch = addConstraint(sketch, { id: 'end-tangent', type: 'tangent', entityAId: arc.id, entityBId: spline.id });
    sketch = boundary(boundary(sketch, 60, 50), 50, 40);
    const before = structuredClone(sketch);
    await expectNativeSolved(sketch);
    const trimmed = trimSketchCurveAt(sketch, arc.id, { x: 53, y: 47 })!;
    const remainingJoint = trimmed.entities.find((entity): entity is CadArcEntity => entity.type === 'arc' && entity.endId === arc.endId)!;
    expect(remainingJoint.id).not.toBe(arc.id);
    expect(trimmed.constraints.find(constraint => constraint.id === 'end-tangent')).toEqual({
      id: 'end-tangent',
      type: 'tangent',
      entityAId: remainingJoint.id,
      entityBId: spline.id,
    });
    expect(trimmed.entities.find(entity => entity.id === spline.id)).toEqual(spline);
    await expectNativeSolved(trimmed);
    expect(sketch).toEqual(before);
  });

  it.each([false, true])('keeps only the tangent whose arc endpoint survives (trim joint: %s)', async removeJoint => {
    let sketch = addArc(createCadPart().sketch, { cx: 60, cy: 40, radius: 10, startAngle: 0, endAngle: (3 * Math.PI) / 2 });
    const arc = sketch.entities.find((entity): entity is CadArcEntity => entity.type === 'arc')!;
    sketch = addSpline(sketch, {
      points: [
        { x: 70, y: 40 },
        { x: 70, y: 55 },
        { x: 70, y: 70 },
      ],
    });
    const spline = sketch.entities.find(entity => entity.type === 'spline')!;
    sketch = addConstraint(sketch, { id: 'start-tangent', type: 'tangent', entityAId: spline.id, entityBId: arc.id });
    sketch = boundary(boundary(sketch, 60, 50), 50, 40);
    await expectNativeSolved(sketch);
    const trimmed = trimSketchCurveAt(sketch, arc.id, removeJoint ? { x: 67, y: 47 } : { x: 53, y: 47 })!;
    expect(trimmed.constraints.find(constraint => constraint.id === 'start-tangent')).toEqual(
      removeJoint
        ? undefined
        : {
            id: 'start-tangent',
            type: 'tangent',
            entityAId: spline.id,
            entityBId: arc.id,
          }
    );
    await expectNativeSolved(trimmed);
  });

  it.each([false, true])('retains line–arc tangency through %s transitive coincidence when the middle is removed', async transitive => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 10, x2: 100, y2: 10 });
    const line = sketch.entities.find((entity): entity is CadLineEntity => entity.type === 'line')!;
    sketch = addArc(sketch, { cx: 100, cy: 20, radius: 10, startAngle: -Math.PI / 2, endAngle: 0 });
    const arc = sketch.entities.find((entity): entity is CadArcEntity => entity.type === 'arc')!;
    sketch = separateArcStart(sketch, arc, transitive);
    sketch = addConstraint(sketch, { id: 'joined-tangent', type: 'tangent', entityAId: arc.id, entityBId: line.id });
    sketch = boundary(boundary(sketch, 30, 10), 70, 10);
    const before = structuredClone(sketch);
    await expectNativeSolved(sketch);
    const trimmed = trimSketchCurveAt(sketch, line.id, { x: 50, y: 10 })!;
    const remainingJoint = trimmed.entities.find(
      (entity): entity is CadLineEntity => entity.type === 'line' && entity.endId === line.endId
    )!;
    expect(remainingJoint.id).not.toBe(line.id);
    expect(trimmed.constraints.find(constraint => constraint.id === 'joined-tangent')).toEqual({
      id: 'joined-tangent',
      type: 'tangent',
      entityAId: arc.id,
      entityBId: remainingJoint.id,
    });
    expect(trimmed.constraints.filter(constraint => constraint.type === 'coincident')).toEqual(
      sketch.constraints.filter(constraint => constraint.type === 'coincident')
    );
    await expectNativeSolved(trimmed);
    expect(sketch).toEqual(before);
  });

  it('removes a line–arc tangent when the aliased joint is trimmed away', async () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 10, x2: 100, y2: 10 });
    const line = sketch.entities.find((entity): entity is CadLineEntity => entity.type === 'line')!;
    sketch = addArc(sketch, { cx: 100, cy: 20, radius: 10, startAngle: -Math.PI / 2, endAngle: 0 });
    const arc = sketch.entities.find((entity): entity is CadArcEntity => entity.type === 'arc')!;
    sketch = separateArcStart(sketch, arc, true);
    sketch = addConstraint(sketch, { id: 'joined-tangent', type: 'tangent', entityAId: arc.id, entityBId: line.id });
    sketch = boundary(boundary(sketch, 30, 10), 70, 10);
    const trimmed = trimSketchCurveAt(sketch, line.id, { x: 90, y: 10 })!;
    expect(trimmed.constraints.some(constraint => constraint.id === 'joined-tangent')).toBe(false);
    expect(trimmed.entities.find(entity => entity.id === line.id)).toMatchObject({ startId: line.startId });
    await expectNativeSolved(trimmed);
  });
});
