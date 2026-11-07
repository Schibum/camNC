import { describe, expect, it } from 'vitest';
import { addArc, addCircle, addLine, closestCurvePoint, createCadPart, type CadPointEntity, type CadSketch } from './index';
const points = (s: CadSketch) => new Map(s.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
describe('analytic finite primitive projections', () => {
  it('projects a billion-mm segment to sub-micron accuracy and clamps its finite endpoints', () => {
    const sketch = addLine(createCadPart().sketch, { x1: -5e8, y1: 1e8, x2: 5e8, y2: 1e8 }),
      line = sketch.entities.at(-1)!;
    if (line.type !== 'line') throw Error();
    const projected = closestCurvePoint(line, points(sketch), { x: 123.456, y: 1e8 + 23 });
    expect(projected.point.x).toBeCloseTo(123.456, 6);
    expect(projected.point.y).toBe(1e8);
    expect(projected.distance).toBe(23);
    expect(closestCurvePoint(line, points(sketch), { x: 6e8, y: 1e8 }).parameter).toBe(1);
  });
  it('projects a translated large circle without a numeric parameter-search error', () => {
    const x = 2e7,
      y = -3e7,
      radius = 1e7,
      angle = 0.714123456789;
    const sketch = addCircle(createCadPart().sketch, { x, y, radius }),
      circle = sketch.entities.at(-1)!;
    if (circle.type !== 'circle') throw Error();
    const found = closestCurvePoint(circle, points(sketch), {
      x: x + (radius + 7.5) * Math.cos(angle),
      y: y + (radius + 7.5) * Math.sin(angle),
    });
    expect(found.point.x).toBeCloseTo(x + radius * Math.cos(angle), 6);
    expect(found.point.y).toBeCloseTo(y + radius * Math.sin(angle), 6);
    expect(found.distance).toBeCloseTo(7.5, 6);
  });
  it('handles wrapped finite arcs under rotated reflected screen projections and clamps to the nearer endpoint', () => {
    const radius = 1e6,
      start = 5.7,
      end = 2.2,
      angle = 5.9;
    const sketch = addArc(createCadPart().sketch, { cx: 0, cy: 0, radius, startAngle: start, endAngle: end }),
      arc = sketch.entities.at(-1)!;
    if (arc.type !== 'arc') throw Error();
    const project = (p: { x: number; y: number }) => ({ x: 100 - p.y * 2, y: 50 - p.x * 2 });
    const target = project({ x: (radius + 4) * Math.cos(angle), y: (radius + 4) * Math.sin(angle) });
    const found = closestCurvePoint(arc, points(sketch), target, project);
    expect(found.point.x).toBeCloseTo(radius * Math.cos(angle), 6);
    expect(found.point.y).toBeCloseTo(radius * Math.sin(angle), 6);
    expect(found.distance).toBeCloseTo(8, 6);
    expect(
      closestCurvePoint(arc, points(sketch), project({ x: radius * Math.cos(3.5), y: radius * Math.sin(3.5) }), project).parameter
    ).toBe(1);
  });
});
