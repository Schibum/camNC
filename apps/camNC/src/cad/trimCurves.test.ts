import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addPoint,
  addSpline,
  isOwnedSplineHandle,
  createCadPart,
  createPlateDocument,
  entityPointIds,
  parseCadDocument,
  solveCadDocument,
  type CadArcEntity,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { trimSketchCurveAt } from './trimCurves';
import { trimLineAt } from './geometry';

it('keeps owned spline tangent segments and their parent intact when asked to trim them', () => {
  const sketch = addSpline(createCadPart().sketch, {
    points: [
      { x: 20, y: 20 },
      { x: 60, y: 70 },
      { x: 120, y: 20 },
    ],
  });
  const segment = sketch.entities.find(isOwnedSplineHandle)!;
  const before = structuredClone(sketch);
  expect(trimSketchCurveAt(sketch, segment.id, { x: 25, y: 30 })).toBeNull();
  expect(trimLineAt(sketch, segment.id, { x: 25, y: 30 })).toBeNull();
  expect(sketch).toEqual(before);
});

function circleFixture(radius = 10) {
  const document = createPlateDocument();
  const part = document.parts[0]!;
  part.sketch = addCircle(part.sketch, { x: 60, y: 40, radius, dimensioned: true, positioned: true });
  const circle = part.sketch.entities.find(entity => entity.type === 'circle')!;
  return { document, part, circle };
}
function rimPoint(sketch: CadSketch, x: number, y: number, entityId?: string) {
  let next = addPoint(sketch, { x, y });
  const pointId = next.entities.at(-1)!.id;
  if (entityId) next = addConstraint(next, { type: 'pointOnCircle', pointId, entityId });
  return { sketch: next, pointId };
}
const point = (sketch: CadSketch, id: string) =>
  sketch.entities.find((entity): entity is CadPointEntity => entity.type === 'point' && entity.id === id)!;

describe('circular sketch trim intervals', () => {
  it.each([0, 1])('deletes the entire circle with %s rim boundaries and retains an explicitly placed point', count => {
    const { part, circle } = circleFixture();
    let placedId: string | undefined;
    if (count) {
      const placed = rimPoint(part.sketch, 70, 40, circle.id);
      part.sketch = placed.sketch;
      placedId = placed.pointId;
    }
    const before = structuredClone(part.sketch);
    const result = trimSketchCurveAt(part.sketch, circle.id, { x: 60, y: 50 })!;
    expect(result.entities.some(entity => entity.id === circle.id)).toBe(false);
    expect(result.entities.some(entity => entity.id === circle.centerId)).toBe(false);
    if (placedId) expect(result.entities).toContainEqual(point(before, placedId));
    expect(result.constraints.some(constraint => 'entityId' in constraint && constraint.entityId === circle.id)).toBe(false);
    expect(part.sketch).toEqual(before);
  });

  it('removes a circle semicircle between two standalone rim points and retains their IDs and the driving size', async () => {
    const { document, part, circle } = circleFixture();
    const left = rimPoint(part.sketch, 50, 40, circle.id);
    const right = rimPoint(left.sketch, 70, 40, circle.id);
    part.sketch = right.sketch;
    const diameter = part.sketch.constraints.find(constraint => constraint.type === 'diameter')!;
    const result = trimSketchCurveAt(part.sketch, circle.id, { x: 60, y: 50 })!;
    const arc = result.entities.find(entity => entity.id === circle.id) as CadArcEntity;
    expect(arc).toMatchObject({ type: 'arc', centerId: circle.centerId, startId: left.pointId, endId: right.pointId, radius: 10 });
    expect(result.constraints).toContainEqual(diameter);
    expect(Math.sin((arc.startAngle + arc.endAngle) / 2)).toBeLessThan(0);
    // Close the remaining half to make a D-shaped cutout.
    part.sketch = addLine(result, { x1: 50, y1: 40, x2: 70, y2: 40 });
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts[0]!.holes).toHaveLength(1);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  });

  it('trims a finite arc at an added midpoint and preserves the unused explicit old endpoint', async () => {
    const { document, part, circle } = circleFixture();
    const left = rimPoint(part.sketch, 50, 40, circle.id),
      right = rimPoint(left.sketch, 70, 40, circle.id);
    const lower = trimSketchCurveAt(right.sketch, circle.id, { x: 60, y: 50 })!;
    const middle = rimPoint(lower, 60, 30, circle.id);
    part.sketch = trimSketchCurveAt(middle.sketch, circle.id, { x: 53, y: 33 })!;
    const arc = part.sketch.entities.find(entity => entity.id === circle.id) as CadArcEntity;
    expect(arc).toMatchObject({ startId: middle.pointId, endId: right.pointId, radius: 10 });
    expect(part.sketch.entities.some(entity => entity.id === left.pointId)).toBe(true);
    expect(entityPointIds(arc)).not.toContain(left.pointId);
    expect(part.sketch.constraints.some(constraint => constraint.type === 'pointOnCircle' && constraint.pointId === left.pointId)).toBe(
      false
    );
    const solved = await solveCadDocument(document);
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.diagnostics.some(diagnostic => diagnostic.code === 'open-profile')).toBe(true);
  });

  it('removes the clicked middle interval of an arc and creates two equal-radius remainders', async () => {
    const { document, part } = circleFixture();
    // Replace the fixture circle with a large three-quarter arc.
    const circle = part.sketch.entities.find(entity => entity.type === 'circle')!;
    part.sketch.entities = part.sketch.entities.filter(entity => entity.id !== circle.id);
    part.sketch.constraints = part.sketch.constraints.filter(
      constraint => !('entityId' in constraint && constraint.entityId === circle.id)
    );
    part.sketch = addArc(part.sketch, { cx: 60, cy: 40, radius: 10, startAngle: 0, endAngle: (3 * Math.PI) / 2 });
    const arc = part.sketch.entities.find(entity => entity.type === 'arc')!;
    const top = rimPoint(part.sketch, 60, 50, arc.id),
      left = rimPoint(top.sketch, 50, 40, arc.id);
    const result = trimSketchCurveAt(left.sketch, arc.id, { x: 53, y: 47 })!;
    const arcs = result.entities.filter((entity): entity is CadArcEntity => entity.type === 'arc');
    expect(arcs).toHaveLength(2);
    expect(arcs[0]!.id).toBe(arc.id);
    expect(arcs[0]!.endId).toBe(top.pointId);
    expect(arcs[1]!.startId).toBe(left.pointId);
    expect(arcs[0]!.centerId).toBe(arcs[1]!.centerId);
    expect(
      result.constraints.some(
        constraint => constraint.type === 'equal' && constraint.entityAId === arc.id && constraint.entityBId === arcs[1]!.id
      )
    ).toBe(true);
    expect(
      result.constraints.some(
        constraint => constraint.type === 'pointOnCircle' && constraint.pointId === left.pointId && constraint.entityId === arcs[1]!.id
      )
    ).toBe(true);
    part.sketch = result;
    const solved = await solveCadDocument(document);
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  });

  it('uses exact line/circle intersections as boundaries and records persistent endpoint contact', () => {
    const { part, circle } = circleFixture();
    part.sketch = addLine(part.sketch, { x1: 40, y1: 40, x2: 80, y2: 40 });
    const line = part.sketch.entities.filter(entity => entity.type === 'line').at(-1)!;
    const result = trimSketchCurveAt(part.sketch, circle.id, { x: 60, y: 50 })!;
    const arc = result.entities.find(entity => entity.id === circle.id) as CadArcEntity;
    expect(point(result, arc.startId)).toMatchObject({ x: 50, y: 40 });
    expect(point(result, arc.endId)).toMatchObject({ x: 70, y: 40 });
    for (const pointId of [arc.startId, arc.endId])
      expect(
        result.constraints.some(
          constraint => constraint.type === 'pointOnLine' && constraint.pointId === pointId && constraint.entityId === line.id
        )
      ).toBe(true);
  });

  it('uses exact circle/circle intersections and retains one connected major arc', () => {
    const { part, circle } = circleFixture();
    part.sketch = addCircle(part.sketch, { x: 70, y: 40, radius: 10 });
    const other = part.sketch.entities.filter(entity => entity.type === 'circle').at(-1)!;
    const result = trimSketchCurveAt(part.sketch, circle.id, { x: 70, y: 40 })!;
    const arc = result.entities.find(entity => entity.id === circle.id) as CadArcEntity;
    expect(point(result, arc.startId).x).toBeCloseTo(65, 8);
    expect(point(result, arc.endId).x).toBeCloseTo(65, 8);
    expect(arc.endAngle - arc.startAngle).toBeCloseTo((4 * Math.PI) / 3, 8);
    expect(result.entities.some(entity => entity.id === other.id)).toBe(true);
    for (const pointId of [arc.startId, arc.endId])
      expect(
        result.constraints.some(
          constraint => constraint.type === 'pointOnCircle' && constraint.pointId === pointId && constraint.entityId === other.id
        )
      ).toBe(true);
  });

  it('deduplicates a tangent contact and still deletes a circle with only one distinct boundary', () => {
    const { part, circle } = circleFixture();
    part.sketch = addLine(part.sketch, { x1: 40, y1: 50, x2: 80, y2: 50 });
    expect(trimSketchCurveAt(part.sketch, circle.id, { x: 60, y: 30 })!.entities.some(entity => entity.id === circle.id)).toBe(false);
  });

  it('keeps a single major remainder when three rim points bound the clicked interval', () => {
    const { part, circle } = circleFixture();
    const right = rimPoint(part.sketch, 70, 40),
      top = rimPoint(right.sketch, 60, 50),
      left = rimPoint(top.sketch, 50, 40);
    const result = trimSketchCurveAt(left.sketch, circle.id, { x: 67, y: 47 })!;
    const arc = result.entities.find(entity => entity.id === circle.id) as CadArcEntity;
    expect(arc.startId).toBe(top.pointId);
    expect(arc.endId).toBe(right.pointId);
    expect(arc.endAngle - arc.startAngle).toBeCloseTo((3 * Math.PI) / 2, 8);
    expect(result.entities).toContainEqual(point(left.sketch, left.pointId));
  });

  it('does not invent two trim boundaries from a translated large-radius tangent', () => {
    const cx = 125000,
      cy = -75000,
      radius = 10000,
      angle = 0.00317;
    let sketch = addCircle(createCadPart().sketch, { x: cx, y: cy, radius });
    const circle = sketch.entities.find(entity => entity.type === 'circle')!;
    const tangent = { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
    sketch = addLine(sketch, {
      x1: tangent.x - Math.sin(angle) * 100,
      y1: tangent.y + Math.cos(angle) * 100,
      x2: tangent.x + Math.sin(angle) * 100,
      y2: tangent.y - Math.cos(angle) * 100,
    });
    expect(trimSketchCurveAt(sketch, circle.id, { x: cx - radius, y: cy })!.entities.some(entity => entity.id === circle.id)).toBe(false);
  });

  it('reuses a neighboring curve endpoint as a trim boundary instead of creating an overlapping point', () => {
    const { part, circle } = circleFixture();
    part.sketch = addLine(part.sketch, { x1: 50, y1: 40, x2: 70, y2: 40 });
    const line = part.sketch.entities.filter(entity => entity.type === 'line').at(-1)!;
    const result = trimSketchCurveAt(part.sketch, circle.id, { x: 60, y: 50 })!;
    const arc = result.entities.find(entity => entity.id === circle.id) as CadArcEntity;
    expect(arc.startId).toBe(line.startId);
    expect(arc.endId).toBe(line.endId);
    expect(result.entities.filter(entity => entity.type === 'point')).toHaveLength(
      part.sketch.entities.filter(entity => entity.type === 'point').length
    );
  });

  it('does not use points inside the circle as interval boundaries and keeps the source unchanged', () => {
    const { part, circle } = circleFixture();
    part.sketch = addPoint(part.sketch, { x: 65, y: 40 });
    const before = structuredClone(part.sketch);
    expect(trimSketchCurveAt(part.sketch, circle.id, { x: 60, y: 50 })!.entities.some(entity => entity.id === circle.id)).toBe(false);
    expect(part.sketch).toEqual(before);
    expect(trimSketchCurveAt(part.sketch, 'missing', { x: 0, y: 0 })).toBeNull();
  });
});
