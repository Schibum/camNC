import { addCircle, addLine, addPoint, createCadPart, dimensionWitnessPoints, type CadDimension } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { linearDimensionGeometry } from './dimensionGeometry';

function fixture() {
  let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 120, y2: 20 });
  const line = sketch.entities.find(e => e.type === 'line')!;
  sketch = addLine(sketch, { x1: 30, y1: 60, x2: 110, y2: 60 });
  const other = sketch.entities.filter(e => e.type === 'line')[1]!;
  sketch = addCircle(sketch, { x: 80, y: 90, radius: 10 });
  const circle = sketch.entities.at(-1)!;
  sketch = addCircle(sketch, { x: 140, y: 90, radius: 15 });
  const secondCircle = sketch.entities.at(-1)!;
  sketch = addPoint(sketch, { x: 70, y: 45 });
  const point = sketch.entities.at(-1)!;
  sketch = addPoint(sketch, { x: 80, y: 130 });
  const above = sketch.entities.at(-1)!;
  return { sketch, line, other, circle, secondCircle, point, above };
}
const span = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('linear annotation projection', () => {
  it.each([
    { x: -40, y: 100, leaderY: 45 },
    { x: 160, y: 0, leaderY: 20 },
  ])('moves point-line dimension and extension lines beyond either finite reference endpoint at $x,$y', ({ x, y, leaderY }) => {
    const { sketch, point, line } = fixture();
    const c: CadDimension = { id: 'gap', type: 'pointLineDistance', pointId: point.id, entityId: line.id, value: 25 };
    const before = structuredClone(sketch),
      geometry = linearDimensionGeometry(c, sketch, { x, y })!;
    expect(geometry.a).toMatchObject({ x: 70, y: 20 });
    expect(geometry.b).toMatchObject({ x: 70, y: 45 });
    expect(geometry.da).toEqual({ x, y: 20 });
    expect(geometry.db).toEqual({ x, y: 45 });
    expect(geometry.extensionA).toMatchObject({ source: { x: x < 20 ? 20 : 120, y: 20 }, target: { x, y: 20 }, continuesLine: true });
    expect(geometry.labelLeader).toEqual([
      { x, y: leaderY },
      { x, y },
    ]);
    expect(sketch).toEqual(before);
    expect(c.value).toBe(25);
  });

  it.each(['distanceX', 'distanceY', 'positionX', 'positionY'] as const)(
    'projects $type witnesses independently to the label line rather than keeping their differing normal coordinates',
    type => {
      const { sketch, line, other } = fixture();
      const c: CadDimension =
        type === 'positionX' || type === 'positionY'
          ? { id: type, type, pointId: other.endId, value: type === 'positionX' ? 110 : 60 }
          : { id: type, type, pointAId: line.startId, pointBId: other.endId, value: type === 'distanceX' ? 90 : 40 };
      for (const label of [
        { x: -40, y: -20 },
        { x: 160, y: 130 },
      ]) {
        const geometry = linearDimensionGeometry(c, sketch, label)!;
        if (type.endsWith('X')) {
          expect(geometry.da.y).toBe(label.y);
          expect(geometry.db.y).toBe(label.y);
          expect(geometry.da.x).toBe(geometry.a.x);
          expect(geometry.db.x).toBe(geometry.b.x);
        } else {
          expect(geometry.da.x).toBe(label.x);
          expect(geometry.db.x).toBe(label.x);
          expect(geometry.da.y).toBe(geometry.a.y);
          expect(geometry.db.y).toBe(geometry.b.y);
        }
        expect(geometry.labelLeader?.[1]).toEqual(label);
        expect(span(geometry.da, geometry.db)).toBe(Math.abs(c.value));
      }
    }
  );

  it('keeps the linear witness length and perpendicular source extensions for every normal-gap category', () => {
    const { sketch, line, other, circle, secondCircle, point, above } = fixture();
    const dimensions: CadDimension[] = [
      { id: 'points', type: 'distance', pointAId: line.startId, pointBId: other.endId, value: Math.hypot(90, 40) },
      { id: 'point-line', type: 'pointLineDistance', pointId: point.id, entityId: line.id, value: 25 },
      { id: 'lines', type: 'lineLineDistance', entityAId: line.id, entityBId: other.id, value: 40 },
      { id: 'point-arc', type: 'pointArcDistance', pointId: above.id, entityId: circle.id, value: 30, side: 'outside' },
      { id: 'line-arc', type: 'lineCircleDistance', entityAId: line.id, entityBId: circle.id, value: 60, side: 'outside' },
      {
        id: 'arcs',
        type: 'circleCircleDistance',
        entityAId: circle.id,
        entityBId: secondCircle.id,
        radiusASign: -1,
        radiusBSign: -1,
        direction: 1,
        value: 35,
      },
    ];
    for (const c of dimensions)
      for (const label of [
        { x: -70, y: -40 },
        { x: 230, y: 170 },
      ]) {
        const { a, b, da, db } = linearDimensionGeometry(c, sketch, label)!;
        expect(span(da, db)).toBeCloseTo(span(...dimensionWitnessPoints(sketch, c)!), 9);
        expect((da.x - a.x) * (db.x - da.x) + (da.y - a.y) * (db.y - da.y)).toBeCloseTo(0, 8);
        expect((db.x - b.x) * (db.x - da.x) + (db.y - b.y) * (db.y - da.y)).toBeCloseTo(0, 8);
        expect((label.x - da.x) * (db.y - da.y) - (label.y - da.y) * (db.x - da.x)).toBeCloseTo(0, 8);
      }
  });

  it('omits an extra leader when the label lies within the arrow span', () => {
    const { sketch, line, point } = fixture();
    const c: CadDimension = { id: 'gap', type: 'pointLineDistance', pointId: point.id, entityId: line.id, value: 25 };
    expect(linearDimensionGeometry(c, sketch, { x: 160, y: 30 })!.labelLeader).toBeNull();
  });

  it('omits extension overdraw inside finite parallel references and starts outside continuations at their actual ends', () => {
    const { sketch, line, other } = fixture();
    const c: CadDimension = { id: 'lines', type: 'lineLineDistance', entityAId: line.id, entityBId: other.id, value: 40 };
    const inside = linearDimensionGeometry(c, sketch, { x: 70, y: 40 })!;
    expect(inside.extensionA).toBeNull();
    expect(inside.extensionB).toBeNull();
    const right = linearDimensionGeometry(c, sketch, { x: 160, y: 40 })!;
    expect(right.extensionA?.source).toMatchObject({ x: 120, y: 20 });
    expect(right.extensionB?.source).toMatchObject({ x: 110, y: 60 });
    const left = linearDimensionGeometry(c, sketch, { x: -10, y: 40 })!;
    expect(left.extensionA?.source).toMatchObject({ x: 20, y: 20 });
    expect(left.extensionB?.source).toMatchObject({ x: 30, y: 60 });
  });
});
