import {
  addBezier,
  addCircle,
  addConic,
  addLine,
  addPoint,
  addSpline,
  createCadDocument,
  createCadPart,
  isOwnedSplineHandle,
  solveCadDocument,
  type CadLineEntity,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { trimLineAt } from './geometry';
import { trimSketchCurveAt } from './trimCurves';

const points = (sketch: CadSketch) =>
  new Map(sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point]));

describe('shared curve contact trim boundaries', () => {
  it.each([
    ['bezier', 0, 10],
    ['bezier', 10, 0],
    ['bezier', 3, 7],
    ['conic', 0, 10],
    ['conic', 10, 0],
    ['conic', 3, 7],
  ] as const)('declines a line trim with a proven collinear %s overlap %s→%s', (type, start, end) => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 20, x2: 10, y2: 20 });
    const line = sketch.entities.find(entity => entity.type === 'line')!;
    sketch =
      type === 'bezier'
        ? addBezier(sketch, {
            points: [
              { x: start, y: 20 },
              { x: end, y: 20 },
            ],
          })
        : addConic(sketch, { start: { x: start, y: 20 }, end: { x: end, y: 20 }, control: { x: 5, y: 20 }, rho: 0.5 });
    const before = structuredClone(sketch);
    expect(trimSketchCurveAt(sketch, line.id, { x: 5, y: 20 })).toBeNull();
    expect(sketch).toEqual(before);
  });

  it('declines a circle trim with an exact rational quarter-circle overlap', () => {
    let sketch = addCircle(createCadPart().sketch, { x: 0, y: 0, radius: 1 });
    const circle = sketch.entities.find(entity => entity.type === 'circle')!;
    const weight = Math.sqrt(0.5);
    sketch = addConic(sketch, { start: { x: 0, y: 1 }, end: { x: 1, y: 0 }, control: { x: 1, y: 1 }, rho: weight / (1 + weight) });
    const before = structuredClone(sketch);
    expect(trimSketchCurveAt(sketch, circle.id, { x: -1, y: 0 })).toBeNull();
    expect(sketch).toEqual(before);
  });

  it('declines coincident-circle trimming atomically instead of inventing quarter-circle boundaries', () => {
    let sketch = addCircle(createCadPart().sketch, { x: 50, y: 50, radius: 10 });
    const circle = sketch.entities.find(entity => entity.type === 'circle')!;
    sketch = addCircle(sketch, { x: 50, y: 50, radius: 10 });
    const before = structuredClone(sketch);
    expect(trimSketchCurveAt(sketch, circle.id, { x: 60, y: 50 })).toBeNull();
    expect(sketch).toEqual(before);
  });

  it.each(['conic', 'bezier', 'spline'] as const)(
    'retains both outside line intervals at %s boundaries and persists native curve contacts',
    async type => {
      const part = createCadPart();
      let sketch = addLine(part.sketch, { x1: -20, y1: 0, x2: 20, y2: 0 });
      const source = sketch.entities.find(entity => entity.type === 'line')!;
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
      const curve = sketch.entities.at(-1)!;
      const before = structuredClone(sketch);
      const trimmed = trimLineAt(sketch, source.id, { x: 0, y: 0 })!;
      expect(trimmed).not.toBeNull();
      const lines = trimmed.entities.filter((entity): entity is CadLineEntity => entity.type === 'line' && !isOwnedSplineHandle(entity)),
        map = points(trimmed);
      expect(lines).toHaveLength(2);
      expect(lines[0]!.id).toBe(source.id);
      expect(map.get(lines[0]!.startId)!.x).toBe(-20);
      if (type === 'spline') {
        expect(map.get(lines[0]!.endId)!.x).toBeGreaterThan(-8);
        expect(map.get(lines[0]!.endId)!.x).toBeLessThan(-5);
        expect(map.get(lines[1]!.startId)!.x).toBeCloseTo(-map.get(lines[0]!.endId)!.x, 5);
      } else {
        expect(map.get(lines[0]!.endId)!.x).toBeCloseTo(-Math.sqrt(50), 5);
        expect(map.get(lines[1]!.startId)!.x).toBeCloseTo(Math.sqrt(50), 5);
      }
      expect(map.get(lines[1]!.endId)!.x).toBe(20);
      expect(trimmed.entities).toContainEqual(curve);
      const attachments = trimmed.constraints.filter(constraint => constraint.type === 'pointOnCurve');
      expect(attachments).toHaveLength(2);
      expect(attachments.every(constraint => constraint.entityId === curve.id && !constraint.parameterFixed)).toBe(true);
      expect(sketch).toEqual(before);
      const doc = createCadDocument();
      doc.parts.push({ ...part, sketch: trimmed });
      const solved = await solveCadDocument(doc);
      expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    }
  );

  it('trims a circle at Bézier intersections and retains both sliding point-on-curve relations', async () => {
    const part = createCadPart();
    let sketch = addCircle(part.sketch, { x: 60, y: 40, radius: 10, dimensioned: true });
    const circle = sketch.entities.find(entity => entity.type === 'circle')!;
    sketch = addBezier(sketch, {
      points: [
        { x: 60, y: 20 },
        { x: 60, y: 40 },
        { x: 60, y: 60 },
      ],
    });
    const bezier = sketch.entities.at(-1)!;
    const before = structuredClone(sketch);
    const trimmed = trimSketchCurveAt(sketch, circle.id, { x: 70, y: 40 })!;
    const arc = trimmed.entities.find(entity => entity.id === circle.id)!;
    if (arc.type !== 'arc') throw Error('The opposite semicircle must remain.');
    const map = points(trimmed);
    expect(map.get(arc.startId)!.x).toBeCloseTo(60, 6);
    expect(map.get(arc.startId)!.y).toBeCloseTo(50, 6);
    expect(map.get(arc.endId)!.y).toBeCloseTo(30, 6);
    expect(arc.endAngle - arc.startAngle).toBeCloseTo(Math.PI, 6);
    const attachments = trimmed.constraints.filter(constraint => constraint.type === 'pointOnCurve');
    expect(attachments).toHaveLength(2);
    expect(attachments.every(constraint => constraint.entityId === bezier.id && !constraint.parameterFixed)).toBe(true);
    expect(sketch).toEqual(before);
    const doc = createCadDocument();
    doc.parts.push({ ...part, sketch: trimmed });
    expect((await solveCadDocument(doc)).sketches[0]!.status).toBe('solved');
  });

  it('uses the same physical tolerance on a long line instead of merging distinct parameter fractions', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 20, x2: 10000, y2: 20 });
    const line = sketch.entities.find(entity => entity.type === 'line')!;
    sketch = addPoint(sketch, { x: 5000, y: 20 });
    sketch = addPoint(sketch, { x: 5000.0001, y: 20 });
    const result = trimLineAt(sketch, line.id, { x: 5000.00005, y: 20 })!;
    const lines = result.entities.filter(entity => entity.type === 'line'),
      map = points(result);
    expect(lines).toHaveLength(2);
    expect(map.get(lines[0]!.endId)!.x).toBe(5000);
    expect(map.get(lines[1]!.startId)!.x).toBe(5000.0001);
  });

  it.each(['line', 'circle'] as const)('leaves a %s unchanged when an incomplete boundary cannot be analyzed', type => {
    let sketch =
      type === 'line'
        ? addLine(createCadPart().sketch, { x1: -20, y1: 0, x2: 20, y2: 0 })
        : addCircle(createCadPart().sketch, { x: 0, y: 0, radius: 10 });
    const target = sketch.entities.find(entity => entity.type === type)!;
    sketch = addConic(sketch, { start: { x: -10, y: 10 }, end: { x: 10, y: 10 }, control: { x: 0, y: -30 }, rho: 0.5 });
    const conic = sketch.entities.at(-1)!;
    if (conic.type !== 'conic') throw Error();
    sketch = { ...sketch, entities: sketch.entities.filter(entity => entity.id !== conic.controlId) };
    const before = structuredClone(sketch);
    expect(trimSketchCurveAt(sketch, target.id, { x: 0, y: 0 })).toBeNull();
    expect(sketch).toEqual(before);
  });
});
