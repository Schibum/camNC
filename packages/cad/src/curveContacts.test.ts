import { describe, expect, it } from 'vitest';
import {
  addArc,
  addBezier,
  addCircle,
  addConic,
  addLine,
  addSpline,
  createCadPart,
  curveContactPoints,
  curveContacts,
  evaluateCadPart,
  isOwnedSplineHandle,
  CAD_GEOMETRY_TOLERANCE,
  type CadEntity,
  type CadPointEntity,
  type CadSketch,
} from './index';

const points = (sketch: CadSketch) =>
  new Map(sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point]));
const curves = (sketch: CadSketch) =>
  sketch.entities.filter(
    (entity): entity is Exclude<CadEntity, { type: 'point' }> => entity.type !== 'point' && !isOwnedSplineHandle(entity)
  );
const contacts = (sketch: CadSketch) => curveContactPoints(curves(sketch)[0]!, curves(sketch)[1]!, points(sketch), CAD_GEOMETRY_TOLERANCE);

describe('shared finite curve contacts', () => {
  it.each([
    [3, 7, true],
    [10, 0, true],
    [10, 20, false],
    [11, 20, false],
  ])('distinguishes finite straight overlap %s→%s from an isolated endpoint', (start, end, overlap) => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 20, x2: 10, y2: 20 });
    sketch = addLine(sketch, { x1: start, y1: 20, x2: end, y2: 20 });
    const [a, b] = curves(sketch);
    expect(curveContacts(a!, b!, points(sketch), CAD_GEOMETRY_TOLERANCE).overlap).toBe(overlap);
    expect(curveContacts(b!, a!, points(sketch), CAD_GEOMETRY_TOLERANCE).overlap).toBe(overlap);
  });
  it.each([
    [0, 10, true],
    [10, 0, true],
    [3, 7, true],
    [10, 20, false],
    [11, 20, false],
  ])('classifies a collinear rational segment %s→%s against a finite line as overlap %s', (start, end, overlap) => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 20, x2: 10, y2: 20 });
    sketch = addBezier(sketch, {
      points: [
        { x: start, y: 20 },
        { x: end, y: 20 },
      ],
    });
    const [line, bezier] = curves(sketch);
    const result = curveContacts(line!, bezier!, points(sketch), CAD_GEOMETRY_TOLERANCE);
    expect(result.overlap).toBe(overlap);
    expect(curveContacts(bezier!, line!, points(sketch), CAD_GEOMETRY_TOLERANCE).overlap).toBe(overlap);
    if (overlap) expect(result.points).toEqual([]);
    else expect(result.points).toHaveLength(start === 10 ? 1 : 0);
  });

  it.each([
    [0, 0, 1],
    [125000, -75000, 10000],
  ])(
    'recognizes an implicit rational-circle overlap at center %s,%s radius %s without mistaking a nearby conic for it',
    (cx, cy, radius) => {
      const fixture = (rhoDelta: number) => {
        let sketch = addCircle(createCadPart().sketch, { x: cx, y: cy, radius });
        const weight = Math.sqrt(0.5);
        sketch = addConic(sketch, {
          start: { x: cx, y: cy + radius },
          end: { x: cx + radius, y: cy },
          control: { x: cx + radius, y: cy + radius },
          rho: weight / (1 + weight) + rhoDelta,
        });
        return sketch;
      };
      const exact = fixture(0),
        [circle, conic] = curves(exact);
      expect(curveContacts(circle!, conic!, points(exact), CAD_GEOMETRY_TOLERANCE)).toEqual({ points: [], overlap: true });
      expect(curveContacts(conic!, circle!, points(exact), CAD_GEOMETRY_TOLERANCE)).toEqual({ points: [], overlap: true });
      const nearby = fixture(1e-5),
        [otherCircle, otherConic] = curves(nearby);
      expect(curveContacts(otherCircle!, otherConic!, points(nearby), CAD_GEOMETRY_TOLERANCE).overlap).toBe(false);
    }
  );

  it('reports coincident circular overlap separately without manufacturing cardinal trim boundaries', () => {
    const part = createCadPart();
    let sketch = addCircle(part.sketch, { x: 50, y: 50, radius: 10 });
    sketch = addCircle(sketch, { x: 50, y: 50, radius: 10 });
    const [a, b] = curves(sketch);
    expect(curveContacts(a!, b!, points(sketch), CAD_GEOMETRY_TOLERANCE)).toEqual({ points: [], overlap: true });
    expect(evaluateCadPart({ ...part, sketch }).diagnostics.some(diagnostic => diagnostic.code === 'intersecting-profiles')).toBe(true);
  });

  it('distinguishes complementary arc endpoint contacts from overlapping sweeps', () => {
    let sketch = addArc(createCadPart().sketch, { cx: 50, cy: 50, radius: 10, startAngle: 0, endAngle: Math.PI });
    sketch = addArc(sketch, { cx: 50, cy: 50, radius: 10, startAngle: Math.PI, endAngle: 2 * Math.PI });
    const [a, b] = curves(sketch);
    expect(curveContacts(a!, b!, points(sketch), CAD_GEOMETRY_TOLERANCE)).toMatchObject({ overlap: false });
    expect(contacts(sketch)).toHaveLength(2);
    let overlapping = addArc(createCadPart().sketch, { cx: 50, cy: 50, radius: 10, startAngle: 0, endAngle: Math.PI });
    overlapping = addArc(overlapping, { cx: 50, cy: 50, radius: 10, startAngle: Math.PI / 2, endAngle: (3 * Math.PI) / 2 });
    expect(curveContacts(curves(overlapping)[0]!, curves(overlapping)[1]!, points(overlapping), CAD_GEOMETRY_TOLERANCE).overlap).toBe(true);
  });

  it.each(['conic', 'bezier', 'spline'] as const)('finds both line/%s intersections without display tessellation', type => {
    let sketch = addLine(createCadPart().sketch, { x1: -20, y1: 0, x2: 20, y2: 0 });
    if (type === 'conic')
      sketch = addConic(sketch, { start: { x: -10, y: 10 }, end: { x: 10, y: 10 }, control: { x: 0, y: -30 }, rho: 0.5 });
    if (type === 'bezier')
      sketch = addBezier(sketch, {
        points: [
          { x: -10, y: 10 },
          { x: 0, y: -30 },
          { x: 10, y: 10 },
        ],
      });
    if (type === 'spline')
      sketch = addSpline(sketch, {
        points: [
          { x: -10, y: 10 },
          { x: 0, y: -10 },
          { x: 10, y: 10 },
        ],
      });
    const found = contacts(sketch).sort((a, b) => a.x - b.x);
    expect(found).toHaveLength(2);
    if (type === 'spline') {
      expect(found[0]!.x).toBeGreaterThan(-8);
      expect(found[0]!.x).toBeLessThan(-5);
      expect(found[1]!.x).toBeCloseTo(-found[0]!.x, 5);
    } else {
      expect(found[0]!.x).toBeCloseTo(-Math.sqrt(50), 5);
      expect(found[1]!.x).toBeCloseTo(Math.sqrt(50), 5);
    }
    found.forEach(point => expect(point.y).toBeCloseTo(0, 6));
    const [a, b] = curves(sketch);
    expect(curveContactPoints(b!, a!, points(sketch), CAD_GEOMETRY_TOLERANCE)).toHaveLength(2);
  });

  it('filters contacts against a finite arc sweep', () => {
    let sketch = addLine(createCadPart().sketch, { x1: -20, y1: 5, x2: 20, y2: 5 });
    sketch = addArc(sketch, { cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2 });
    expect(contacts(sketch)).toHaveLength(1);
    expect(contacts(sketch)[0]!.x).toBeCloseTo(Math.sqrt(75), 10);
  });

  it('keeps collinear overlap boundaries and finite endpoint contacts', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    sketch = addLine(sketch, { x1: 30, y1: 0, x2: 60, y2: 0 });
    expect(
      contacts(sketch)
        .map(p => p.x)
        .sort((a, b) => a - b)
    ).toEqual([30, 60]);
  });

  it.each([0, 0.00317, 1.234])('deduplicates translated R10000 tangency at angle %s without masking shallow real crossings', angle => {
    const cx = 125000,
      cy = -75000,
      radius = 10000;
    const fixture = (inset: number) => {
      let sketch = addCircle(createCadPart().sketch, { x: cx, y: cy, radius });
      const tangent = { x: cx + (radius - inset) * Math.cos(angle), y: cy + (radius - inset) * Math.sin(angle) };
      sketch = addLine(sketch, {
        x1: tangent.x - 100 * Math.sin(angle),
        y1: tangent.y + 100 * Math.cos(angle),
        x2: tangent.x + 100 * Math.sin(angle),
        y2: tangent.y - 100 * Math.cos(angle),
      });
      return sketch;
    };
    expect(contacts(fixture(0))).toHaveLength(1);
    const crossing = contacts(fixture(1e-5));
    expect(crossing).toHaveLength(2);
    expect(Math.hypot(crossing[0]!.x - crossing[1]!.x, crossing[0]!.y - crossing[1]!.y)).toBeGreaterThan(0.8);
  });

  it('requires an explicit finite positive model-space tolerance', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 10, y2: 0 });
    sketch = addCircle(sketch, { x: 5, y: 0, radius: 2 });
    for (const tolerance of [0, -1, NaN, Infinity])
      expect(() => curveContactPoints(curves(sketch)[0]!, curves(sketch)[1]!, points(sketch), tolerance)).toThrow();
  });
});
