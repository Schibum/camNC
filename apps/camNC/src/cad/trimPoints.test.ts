import { addConstraint, addLine, addPoint, createCadDocument, createCadPart, solveCadDocument, type CadSketch } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { trimLineAt } from './geometry';

function fixture() {
  const part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 0, y1: 10, x2: 100, y2: 10 });
  const line = part.sketch.entities.find(entity => entity.type === 'line')!;
  part.sketch = addConstraint(part.sketch, { id: 'horizontal', type: 'horizontal', entityId: line.id });
  return { part, line };
}
const point = (sketch: CadSketch, id: string) => sketch.entities.find(entity => entity.id === id)!;

describe('trim intervals bounded by sketch points', () => {
  it('retains the midpoint identity as an endpoint without pulling it into the shortened line', async () => {
    const { part, line } = fixture();
    part.sketch.entities = part.sketch.entities.map(entity => (entity.id === line.startId ? { ...entity, fixed: true } : entity));
    part.sketch = addPoint(part.sketch, { x: 50, y: 10 });
    const middle = part.sketch.entities.at(-1)!;
    part.sketch = addConstraint(part.sketch, { id: 'midpoint', type: 'midpoint', pointId: middle.id, entityId: line.id });
    part.sketch = addConstraint(part.sketch, { id: 'point-x', type: 'positionX', pointId: middle.id, value: 50 });
    const before = structuredClone(part.sketch);
    const trimmed = trimLineAt(part.sketch, line.id, { x: 75, y: 10 })!;
    expect(trimmed.entities.find(entity => entity.id === line.id)).toMatchObject({ startId: line.startId, endId: middle.id });
    expect(point(trimmed, line.startId)).toEqual(point(before, line.startId));
    expect(point(trimmed, middle.id)).toEqual(middle);
    expect(trimmed.constraints.some(constraint => constraint.type === 'midpoint')).toBe(false);
    expect(trimmed.constraints.map(constraint => constraint.id)).toEqual(['horizontal', 'point-x']);
    const document = createCadDocument();
    document.parts.push({ ...part, sketch: trimmed });
    const solved = await solveCadDocument(document);
    expect(solved.sketches[0]!.status).toBe('solved');
    expect(point(solved.document.parts[0]!.sketch, middle.id)).toMatchObject({ x: 50, y: 10 });
    expect(part.sketch).toEqual(before);
  });

  it('uses a point-on-line attachment as a trim boundary and preserves the untouched far endpoint', () => {
    const { part, line } = fixture();
    part.sketch = addPoint(part.sketch, { x: 40, y: 10 });
    const onLine = part.sketch.entities.at(-1)!;
    part.sketch = addConstraint(part.sketch, { id: 'on-line', type: 'pointOnLine', pointId: onLine.id, entityId: line.id });
    const end = point(part.sketch, line.endId);
    const trimmed = trimLineAt(part.sketch, line.id, { x: 10, y: 10 })!;
    expect(trimmed.entities.find(entity => entity.id === line.id)).toMatchObject({ startId: onLine.id, endId: line.endId });
    expect(point(trimmed, line.endId)).toEqual(end);
    expect(trimmed.constraints.some(constraint => constraint.id === 'on-line')).toBe(false);
    expect(trimmed.constraints).toContainEqual({ id: 'horizontal', type: 'horizontal', entityId: line.id });
  });

  it('recognizes a geometric standalone point and keeps an independent original endpoint', () => {
    const part = createCadPart();
    part.sketch = addPoint(part.sketch, { x: 0, y: 10, fixed: true });
    const independentStart = part.sketch.entities.at(-1)!;
    part.sketch = addLine(part.sketch, { x1: 0, y1: 10, x2: 100, y2: 10 });
    const line = part.sketch.entities.find(entity => entity.type === 'line')!;
    part.sketch = addPoint(part.sketch, { x: 30, y: 10 });
    const boundary = part.sketch.entities.at(-1)!;
    const trimmed = trimLineAt(part.sketch, line.id, { x: 10, y: 10 })!;
    expect(trimmed.entities.find(entity => entity.id === line.id)).toMatchObject({ startId: boundary.id, endId: line.endId });
    expect(point(trimmed, independentStart.id)).toEqual(independentStart);
  });

  it('preserves both original ends and horizontal intent when removing the interval between two points', () => {
    const { part, line } = fixture();
    part.sketch = addPoint(part.sketch, { x: 30, y: 10 });
    const left = part.sketch.entities.at(-1)!;
    part.sketch = addPoint(part.sketch, { x: 70, y: 10 });
    const right = part.sketch.entities.at(-1)!;
    part.sketch = addConstraint(part.sketch, {
      id: 'old-length',
      type: 'distance',
      pointAId: line.startId,
      pointBId: line.endId,
      sourceEntityId: line.id,
      value: 100,
    });
    const trimmed = trimLineAt(part.sketch, line.id, { x: 50, y: 10 })!;
    const edges = trimmed.entities.filter(entity => entity.type === 'line');
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({ id: line.id, startId: line.startId, endId: left.id });
    expect(edges[1]).toMatchObject({ startId: right.id, endId: line.endId });
    expect(trimmed.constraints.filter(constraint => constraint.type === 'horizontal')).toHaveLength(2);
    expect(trimmed.constraints.some(constraint => constraint.id === 'old-length')).toBe(false);
  });
});
