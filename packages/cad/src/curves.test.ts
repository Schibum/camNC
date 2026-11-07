import { describe, expect, it } from 'vitest';
import {
  addBezier,
  addCircle,
  addConic,
  addConstraint,
  addLine,
  addPoint,
  addSpline,
  createCadDocument,
  createCadPart,
  entityPointIds,
  evaluateCadDocument,
  evaluateCurvePoint,
  evaluateCurveTangent,
  parseCadDocument,
  insertCurveControlPoint,
  removeEntity,
  setConicRho,
  solveCadDocument,
  tessellateCurve,
  validateCadDocument,
} from './index';
import type { CadEntity, CadPointEntity, CadSketch } from './types';
const points = (sketch: CadSketch) => new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
function document(sketch: CadSketch) {
  const doc = createCadDocument();
  doc.parts.push({ ...createCadPart(), sketch });
  return doc;
}
const lastCurve = (sketch: CadSketch) => sketch.entities.at(-1)! as Exclude<CadEntity, { type: 'point' }>;
describe('analytic editable sketch curves', () => {
  it('evaluates conic rho as the exact midpoint apex fraction and persists it', () => {
    let sketch = addConic(createCadPart().sketch, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, control: { x: 50, y: 80 }, rho: 0.25 });
    const curve = lastCurve(sketch);
    expect(evaluateCurvePoint(curve, points(sketch), 0.5).x).toBeCloseTo(50, 10);
    expect(evaluateCurvePoint(curve, points(sketch), 0.5).y).toBeCloseTo(20, 10);
    sketch = setConicRho(sketch, curve.id, 0.75);
    expect(evaluateCurvePoint(lastCurve(sketch), points(sketch), 0.5)).toEqual({ x: 50, y: 60 });
    expect(parseCadDocument(document(sketch)).parts[0]!.sketch).toEqual(sketch);
  });
  it('interpolates all spline fit points rather than using them as a control polygon', () => {
    const fits = [
      { x: 0, y: 0 },
      { x: 20, y: 40 },
      { x: 60, y: -10 },
      { x: 100, y: 0 },
      { x: 130, y: 35 },
    ];
    const sketch = addSpline(createCadPart().sketch, { points: fits });
    const curve = lastCurve(sketch);
    if (curve.type !== 'spline') throw Error();
    curve.fitParameters.forEach((t, i) => {
      const p = evaluateCurvePoint(curve, points(sketch), t);
      expect(p.x).toBeCloseTo(fits[i]!.x, 8);
      expect(p.y).toBeCloseTo(fits[i]!.y, 8);
    });
    expect(entityPointIds(curve)).toEqual(expect.arrayContaining([...curve.controlPointIds, ...curve.fitPointIds]));
  });
  it('creates a smooth periodic closed fit spline with equal endpoint tangents', async () => {
    const sketch = addSpline(createCadPart().sketch, {
      closed: true,
      points: [
        { x: 0, y: 30 },
        { x: 30, y: 0 },
        { x: 60, y: 30 },
        { x: 30, y: 60 },
      ],
    });
    const curve = lastCurve(sketch);
    const a = evaluateCurvePoint(curve, points(sketch), 0),
      b = evaluateCurvePoint(curve, points(sketch), 1);
    expect(a.x).toBeCloseTo(b.x, 8);
    expect(a.y).toBeCloseTo(b.y, 8);
    expect(evaluateCurveTangent(curve, points(sketch), 0)).toEqual(evaluateCurveTangent(curve, points(sketch), 1));
    const result = await solveCadDocument(document(sketch));
    expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    expect(result.parts[0]!.outline.length).toBeGreaterThan(20);
  });
  it('bounds tessellation error for a high-degree oscillating Bézier', () => {
    const controls = Array.from({ length: 16 }, (_, i) => ({ x: i * 8, y: i === 0 || i === 15 ? 0 : i % 2 ? 60 : -60 }));
    const sketch = addBezier(createCadPart().sketch, { points: controls });
    const curve = lastCurve(sketch),
      map = points(sketch),
      path = tessellateCurve(curve, map, 0.01);
    const segmentDistance = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    };
    for (let i = 0; i <= 2000; i++) {
      const p = evaluateCurvePoint(curve, map, i / 2000);
      expect(Math.min(...path.slice(1).map((q, j) => segmentDistance(p, path[j]!, q)))).toBeLessThanOrEqual(0.010001);
    }
  });
  it('solves native conic control drag and exports its line-closed profile', async () => {
    let sketch = addConic(createCadPart().sketch, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, control: { x: 50, y: 60 } });
    const curve = lastCurve(sketch);
    if (curve.type !== 'conic') throw Error();
    sketch = addLine(sketch, { x1: 100, y1: 0, x2: 0, y2: 0 });
    const solved = await solveCadDocument(document(sketch), { drag: { pointId: curve.controlId, x: 65, y: 80 } });
    expect(solved.status).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(4);
    expect(points(solved.document.parts[0]!.sketch).get(curve.controlId)).toMatchObject({ x: 65, y: 80 });
  });
  it('solves fit point dragging while retaining every native interpolation equation', async () => {
    let sketch = addSpline(createCadPart().sketch, {
      points: [
        { x: 0, y: 0 },
        { x: 25, y: 35 },
        { x: 70, y: 20 },
        { x: 100, y: 0 },
      ],
    });
    const curve = lastCurve(sketch);
    if (curve.type !== 'spline') throw Error();
    sketch = addLine(sketch, { x1: 100, y1: 0, x2: 0, y2: 0 });
    const solved = await solveCadDocument(document(sketch), { drag: { pointId: curve.fitPointIds[1]!, x: 30, y: 60 } });
    expect(solved.status).toBe('solved');
    const out = solved.document.parts[0]!.sketch,
      map = points(out),
      s = out.entities.find(e => e.id === curve.id)!;
    if (s.type !== 'spline') throw Error();
    expect(map.get(curve.fitPointIds[1]!)!.y).toBeCloseTo(60, 5);
    s.fitParameters.forEach((t, i) => {
      const p = evaluateCurvePoint(s, map, t),
        fit = map.get(s.fitPointIds[i]!)!;
      expect(p.x).toBeCloseTo(fit.x, 5);
      expect(p.y).toBeCloseTo(fit.y, 5);
    });
  });
  it('persists a native sliding point-on-curve relation during drag', async () => {
    let sketch = addBezier(createCadPart().sketch, {
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 100 },
        { x: 100, y: 0 },
      ],
    });
    const curve = lastCurve(sketch);
    sketch = { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e)) };
    sketch = addPoint(sketch, { x: 50, y: 50 });
    const id = sketch.entities.at(-1)!.id;
    sketch = addConstraint(sketch, { type: 'pointOnCurve', pointId: id, entityId: curve.id, parameter: 0.5 });
    const result = await solveCadDocument(document(sketch), { drag: { pointId: id, x: 80, y: 30 } });
    expect(result.sketches[0]!.status).toBe('solved');
    const c = result.document.parts[0]!.sketch.constraints[0]!;
    if (c.type !== 'pointOnCurve') throw Error();
    expect(c.parameter).toBeGreaterThan(0.5);
    const p = points(result.document.parts[0]!.sketch).get(id)!,
      q = evaluateCurvePoint(curve, points(sketch), c.parameter);
    expect(p.x).toBeCloseTo(q.x, 5);
    expect(p.y).toBeCloseTo(q.y, 5);
  });
  it('preserves explicit standalone points while deleting curve-owned helper points and constraints', () => {
    let sketch = addConic(createCadPart().sketch, { start: { x: 10, y: 0 }, end: { x: 100, y: 0 }, control: { x: 50, y: 60 } });
    const curve = lastCurve(sketch);
    sketch = addPoint(sketch, { x: 20, y: 15 });
    const id = sketch.entities.at(-1)!.id;
    const removed = removeEntity(sketch, curve.id);
    expect(removed.entities.some(e => e.id === id)).toBe(true);
    expect(removed.entities).toHaveLength(2);
  });
  it('rejects malformed spline basis and unsupported curve dimensions before native calls', () => {
    const sketch = addSpline(createCadPart().sketch, {
      points: [
        { x: 0, y: 0 },
        { x: 50, y: 50 },
        { x: 100, y: 0 },
      ],
    });
    const curve = lastCurve(sketch);
    if (curve.type !== 'spline') throw Error();
    curve.knots = [0, 1];
    expect(validateCadDocument(document(sketch)).some(d => d.code === 'invalid-spline')).toBe(true);
  });
  it('uses native endpoint tangency between a Bézier and a fixed horizontal line', async () => {
    let sketch = addLine(createCadPart().sketch, { x1: -20, y1: 0, x2: 0, y2: 0 });
    const line = lastCurve(sketch);
    sketch = { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e)) };
    sketch = addBezier(sketch, {
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 5 },
        { x: 70, y: 40 },
        { x: 100, y: 40 },
      ],
    });
    const curve = lastCurve(sketch);
    if (curve.type !== 'bezier') throw Error();
    sketch = addConstraint(sketch, { type: 'tangent', entityAId: line.id, entityBId: curve.id });
    const result = await solveCadDocument(document(sketch), { drag: { pointId: curve.controlPointIds[1]!, x: 35, y: 20 } });
    expect(result.sketches[0]!.status).toBe('solved');
    expect(points(result.document.parts[0]!.sketch).get(curve.controlPointIds[1]!)!.y).toBeCloseTo(0, 5);
  });

  it('rejects an exact conic-circle tangent contact hidden by inscribed export polygons', () => {
    let sketch = addConic(createCadPart().sketch, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, control: { x: 50, y: 60 } });
    sketch = addLine(sketch, { x1: 100, y1: 0, x2: 0, y2: 0 });
    sketch = addCircle(sketch, { x: 50, y: 40, radius: 10 });
    expect(evaluateCadDocument(document(sketch)).diagnostics.some(d => d.code === 'intersecting-profiles')).toBe(true);
  });
  it('allows an ordinary joined tangent curve and line without a false near-endpoint contact', () => {
    let sketch = addBezier(createCadPart().sketch, {
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 50, y: 30 },
        { x: 50, y: 50 },
      ],
    });
    sketch = addLine(sketch, { x1: 50, y1: 50, x2: -30, y2: 50 });
    sketch = addLine(sketch, { x1: -30, y1: 50, x2: -30, y2: 0 });
    sketch = addLine(sketch, { x1: -30, y1: 0, x2: 0, y2: 0 });
    expect(evaluateCadDocument(document(sketch)).diagnostics).toEqual([]);
  });

  it.each(['spline', 'bezier'] as const)('adds an editable %s control without changing the original analytic curve', async type => {
    const fits = [
      { x: 0, y: 0 },
      { x: 25, y: 50 },
      { x: 70, y: 35 },
      { x: 100, y: 0 },
    ];
    let sketch =
      type === 'spline' ? addSpline(createCadPart().sketch, { points: fits }) : addBezier(createCadPart().sketch, { points: fits });
    const curve = lastCurve(sketch);
    const before = Array.from({ length: 101 }, (_, i) => evaluateCurvePoint(curve, points(sketch), i / 100));
    sketch = insertCurveControlPoint(sketch, curve.id, 0.4);
    const after = sketch.entities.find(e => e.id === curve.id)!;
    if (after.type !== 'spline' && after.type !== 'bezier') throw Error();
    before.forEach((p, i) => {
      const q = evaluateCurvePoint(after, points(sketch), i / 100);
      expect(q.x).toBeCloseTo(p.x, 8);
      expect(q.y).toBeCloseTo(p.y, 8);
    });
    expect(after.controlPointIds.length).toBe(type === 'spline' ? 7 : 5);
    sketch = addLine(sketch, { x1: 100, y1: 0, x2: 0, y2: 0 });
    const result = await solveCadDocument(document(sketch));
    expect(result.status).toBe('solved');
    expect(parseCadDocument(result.document)).toEqual(result.document);
  });
  it('reports fully fixed native curve point and tangent contradictions', async () => {
    let sketch = addLine(createCadPart().sketch, { x1: -20, y1: 0, x2: 0, y2: 0 });
    const line = lastCurve(sketch);
    sketch = addConic(sketch, { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, control: { x: 50, y: 60 } });
    const curve = lastCurve(sketch);
    sketch = { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e)) };
    sketch = addConstraint(sketch, { type: 'tangent', entityAId: line.id, entityBId: curve.id });
    const result = await solveCadDocument(document(sketch));
    expect(result.status).toBe('conflict');
    expect(result.diagnostics[0]!.code).toBe('constraint-conflict');
  });

  it('keeps fit points and independent endpoint tangent handles separately editable', async () => {
    let sketch = addSpline(createCadPart().sketch, {
      points: [
        { x: 0, y: 0 },
        { x: 30, y: 30 },
        { x: 65, y: 15 },
        { x: 100, y: 0 },
      ],
    });
    const curve = lastCurve(sketch);
    if (curve.type !== 'spline') throw Error();
    expect(curve.controlPointIds).toHaveLength(6);
    const before = points(sketch),
      handles = [curve.controlPointIds[1]!, curve.controlPointIds.at(-2)!];
    sketch = addLine(sketch, { x1: 100, y1: 0, x2: 0, y2: 0 });
    const moved = await solveCadDocument(document(sketch), { drag: { pointId: curve.fitPointIds[1]!, x: 30, y: 55 } });
    expect(moved.sketches[0]!.status).toBe('solved');
    expect(moved.sketches[0]!.dof).toBe(10);
    const out = points(moved.document.parts[0]!.sketch);
    for (const id of handles) {
      expect(out.get(id)!.x).toBeCloseTo(before.get(id)!.x, 6);
      expect(out.get(id)!.y).toBeCloseTo(before.get(id)!.y, 6);
    }
    const tangentEdited = await solveCadDocument(moved.document, { drag: { pointId: handles[0]!, x: 20, y: 0 } });
    expect(tangentEdited.sketches[0]!.status).toBe('solved');
    const final = points(tangentEdited.document.parts[0]!.sketch);
    for (const id of curve.fitPointIds) {
      expect(final.get(id)!.x).toBeCloseTo(out.get(id)!.x, 6);
      expect(final.get(id)!.y).toBeCloseTo(out.get(id)!.y, 6);
    }
    expect(final.get(handles[0]!)!.y).toBeCloseTo(0, 6);
    expect(evaluateCurveTangent(curve, final, 0).y).toBeCloseTo(0, 6);
  });

  it('keeps a periodic fit spline closed while dragging its seam fit point through native equations', async () => {
    const sketch = addSpline(createCadPart().sketch, {
        points: [
          { x: 0, y: 30 },
          { x: 30, y: 0 },
          { x: 60, y: 30 },
          { x: 30, y: 60 },
          { x: 0, y: 30 },
        ],
      }),
      curve = lastCurve(sketch);
    if (curve.type !== 'spline') throw Error();
    expect(curve.closed).toBe(true);
    const moved = await solveCadDocument(document(sketch), { drag: { pointId: curve.fitPointIds[0]!, x: -10, y: 35 } });
    expect(moved.status).toBe('solved');
    const out = moved.document.parts[0]!.sketch,
      map = points(out),
      after = out.entities.find(e => e.id === curve.id)!;
    if (after.type !== 'spline') throw Error();
    expect(map.get(after.fitPointIds[0]!)!.x).toBeCloseTo(-10, 6);
    expect(map.get(after.fitPointIds[0]!)!.y).toBeCloseTo(35, 6);
    after.fitParameters.forEach((t, i) => {
      const p = evaluateCurvePoint(after, map, t),
        q = map.get(after.fitPointIds[i]!)!;
      expect(p.x).toBeCloseTo(q.x, 6);
      expect(p.y).toBeCloseTo(q.y, 6);
    });
  });

  it('rejects adding a fit point beyond the portable spline limit without changing source', () => {
    const sketch = addSpline(createCadPart().sketch, {
        points: Array.from({ length: 64 }, (_, i) => ({ x: i * 3, y: 20 + Math.sin(i / 5) * 5 })),
      }),
      curve = lastCurve(sketch),
      before = structuredClone(sketch);
    expect(() => insertCurveControlPoint(sketch, curve.id, 0.4)).toThrow(/64 fit points/);
    expect(sketch).toEqual(before);
  });
});
