import { addCircle, addLine, createCadPart } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { tangentArcFrom, threePointArc, trimLineAt } from './geometry';

describe('sketch command geometry', () => {
  it('creates tangent chain arcs on either side while retaining the user endpoint direction', () => {
    const upper = tangentArcFrom({ x: 40, y: 0 }, { x: 2, y: 0 }, { x: 60, y: 20 })!;
    expect(upper.cx).toBeCloseTo(40);
    expect(upper.cy).toBeCloseTo(20);
    expect(upper.radius).toBeCloseTo(20);
    expect(upper.startAngle).toBeCloseTo(-Math.PI / 2);
    expect(upper.endAngle).toBeCloseTo(0);
    expect(upper.endTangent.x).toBeCloseTo(0);
    expect(upper.endTangent.y).toBeCloseTo(1);
    const lower = tangentArcFrom({ x: 40, y: 0 }, { x: 2, y: 0 }, { x: 60, y: -20 })!;
    expect(lower.cy).toBeCloseTo(-20);
    expect(lower.startAngle).toBeCloseTo(0);
    expect(lower.endAngle).toBeCloseTo(Math.PI / 2);
    expect(lower.endTangent.x).toBeCloseTo(0);
    expect(lower.endTangent.y).toBeCloseTo(-1);
    const next = tangentArcFrom({ x: 60, y: -20 }, lower.endTangent, { x: 40, y: -40 })!;
    expect(next.cx).toBeCloseTo(40);
    expect(next.cy).toBeCloseTo(-20);
    expect(next.radius).toBeCloseTo(20);
  });

  it('rejects tangent arcs without a direction, with coincident endpoints or along the tangent', () => {
    expect(tangentArcFrom({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 20, y: 20 })).toBeNull();
    expect(tangentArcFrom({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(tangentArcFrom({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 20, y: 0 })).toBeNull();
  });

  it('places the arc through the third click in either direction and rejects collinear clicks', () => {
    const upper = threePointArc({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 })!;
    expect(upper.cx).toBeCloseTo(0);
    expect(upper.cy).toBeCloseTo(0);
    expect(upper.radius).toBeCloseTo(10);
    expect(upper.startAngle).toBeCloseTo(0);
    expect(upper.endAngle).toBeCloseTo(Math.PI);
    const lower = threePointArc({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -10 })!;
    expect(lower.startAngle).toBeCloseTo(Math.PI);
    expect(lower.endAngle).toBeCloseTo(0);
    expect(threePointArc({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });

  it('trims the clicked interval between crossings, preserves untouched curves and one retained lineage', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 10, x2: 100, y2: 10 });
    const line = sketch.entities.find(e => e.type === 'line')!;
    sketch = addLine(sketch, { x1: 20, y1: 0, x2: 20, y2: 20 });
    sketch = addLine(sketch, { x1: 70, y1: 0, x2: 70, y2: 20 });
    const untouched = sketch.entities.filter(e => e.type === 'line' && e.id !== line.id);
    const result = trimLineAt(sketch, line.id, { x: 40, y: 10 })!;
    expect(result.entities.filter(e => e.type === 'line')).toHaveLength(4);
    expect(result.entities.find(e => e.id === line.id)).toBeTruthy();
    untouched.forEach(e => expect(result.entities).toContainEqual(e));
    const points = new Map(result.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
    const kept = result.entities
      .filter(e => e.type === 'line')
      .map(e => (e.type === 'line' ? [points.get(e.startId)!.x, points.get(e.endId)!.x] : []));
    expect(kept).toContainEqual([0, 20]);
    expect(kept).toContainEqual([70, 100]);
  });

  it('trims at circle intersections rather than deleting the whole line', () => {
    let sketch = addLine(createCadPart().sketch, { x1: -20, y1: 0, x2: 20, y2: 0 });
    const line = sketch.entities.find(e => e.type === 'line')!;
    sketch = addCircle(sketch, { x: 0, y: 0, radius: 5 });
    const result = trimLineAt(sketch, line.id, { x: 0, y: 0 })!;
    expect(result.entities.filter(e => e.type === 'line')).toHaveLength(2);
    expect(result.entities.filter(e => e.type === 'circle')).toHaveLength(1);
  });
});
