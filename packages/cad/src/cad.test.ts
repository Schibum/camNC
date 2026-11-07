import { describe, expect, it } from 'vitest';
import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addRectangle,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  originId,
  parseCadDocument,
  polygonArea,
  removeEntity,
  solveCadDocument,
  updateDimension,
  updatePoint,
  validateCadDocument,
} from './index';
import type { CadDocument, CadPointEntity } from './types';

const bounds = (points: { x: number; y: number }[]) => ({
  width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)),
  height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)),
});
const point = (d: CadDocument, id: string) =>
  d.parts[0]!.sketch.entities.find((e): e is CadPointEntity => e.id === id && e.type === 'point')!;

describe('PlaneGCS CAD core', () => {
  it('solves a plate with cut holes and preserves source identity after resizing', async () => {
    const d = createPlateDocument({ width: 120, height: 80, thickness: 12 });
    const p = d.parts[0]!;
    p.sketch = addCircle(p.sketch, { x: 20, y: 20, radius: 4, dimensioned: true, positioned: true });
    p.sketch = addCircle(p.sketch, { x: 100, y: 60, radius: 4, dimensioned: true, positioned: true });
    const first = await solveCadDocument(d);
    expect(first.status).toBe('solved');
    expect(first.sketches[0]!.dof).toBe(0);
    expect(first.parts[0]!.holes).toHaveLength(2);
    expect(polygonArea(first.parts[0]!.outline)).toBeGreaterThan(0);
    expect(first.parts[0]!.holes.every(h => polygonArea(h) < 0)).toBe(true);
    const width = p.sketch.constraints.find(c => c.label === 'Width')!;
    const resized = await solveCadDocument(updateDimension(first.document, width.id, 150));
    expect(resized.status).toBe('solved');
    expect(bounds(resized.parts[0]!.outline).width).toBeCloseTo(150, 8);
    expect(bounds(resized.parts[0]!.outline).height).toBeCloseTo(80, 8);
    expect(resized.document.id).toBe(d.id);
    expect(resized.parts[0]!.partId).toBe(p.id);
    expect(resized.parts[0]!.loops.map(l => l.id)).toEqual(first.parts[0]!.loops.map(l => l.id));
    expect(resized.document.parts[0]!.sketch.entities.map(e => e.id)).toEqual(p.sketch.entities.map(e => e.id));
    expect(resized.document.revision).toBe(1);
    expect(d.revision).toBe(0);
    expect(bounds(first.parts[0]!.outline).width).toBe(120);
  });

  it('edits a real solver dimension for hole diameter and position', async () => {
    let d = createPlateDocument();
    d.parts[0]!.sketch = addCircle(d.parts[0]!.sketch, { x: 20, y: 20, radius: 4, dimensioned: true, positioned: true });
    const constraints = d.parts[0]!.sketch.constraints;
    const diameter = constraints.find(c => c.type === 'diameter')!;
    const centerX = constraints.find(c => c.label === 'Center X')!;
    d = updateDimension(updateDimension(d, diameter.id, 14), centerX.id, 40);
    const result = await solveCadDocument(d);
    expect(result.status).toBe('solved');
    const circle = result.document.parts[0]!.sketch.entities.find(e => e.type === 'circle')!;
    expect(circle.type === 'circle' && circle.radius).toBeCloseTo(7, 8);
    if (circle.type === 'circle') expect(point(result.document, circle.centerId).x).toBeCloseTo(40, 8);
  });

  it('identifies conflicting dimensions without mutating the input or producing cut geometry', async () => {
    const d = createPlateDocument();
    const p = d.parts[0]!;
    const width = p.sketch.constraints.find(c => c.type === 'distanceX')!;
    if (width.type !== 'distanceX') throw new Error('fixture');
    p.sketch = addConstraint(p.sketch, { type: 'distanceX', pointAId: width.pointAId, pointBId: width.pointBId, value: 200 });
    const snapshot = structuredClone(d);
    const result = await solveCadDocument(d);
    expect(result.status).toBe('conflict');
    expect(result.parts).toEqual([]);
    expect(result.diagnostics.some(e => e.code === 'constraint-conflict' && e.constraintIds?.includes(width.id))).toBe(true);
    expect(d).toEqual(snapshot);
  });

  it('uses temporary drag constraints while permanent dimensions take precedence', async () => {
    const d = createPlateDocument();
    const p = d.parts[0]!;
    const corner = p.sketch.entities.find((e): e is CadPointEntity => e.type === 'point' && e.x === 120 && e.y === 80)!;
    const result = await solveCadDocument(d, { drag: { pointId: corner.id, x: 150, y: 100 } });
    expect(result.status).toBe('solved');
    expect(point(result.document, corner.id).x).toBeCloseTo(120, 6);
    expect(point(result.document, corner.id).y).toBeCloseTo(80, 6);
    expect(result.document.parts[0]!.sketch.constraints.some(c => c.id.includes(':drag-'))).toBe(false);
  });

  it('drags a closed underconstrained quadrilateral and reports remaining degrees of freedom', async () => {
    const d = createCadDocument();
    const p = createCadPart();
    p.sketch = addRectangle(p.sketch, { x: 20, y: 20, width: 30, height: 20 });
    // Keep its four explicit joints, but release the rectangular shape relationships.
    p.sketch.constraints = p.sketch.constraints.filter(constraint => constraint.type === 'coincident');
    d.parts.push(p);
    const corner = p.sketch.entities.find((e): e is CadPointEntity => e.type === 'point' && e.x === 50 && e.y === 40)!;
    const result = await solveCadDocument(d, { drag: { pointId: corner.id, x: 60, y: 50 } });
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBeGreaterThan(0);
    expect(point(result.document, corner.id).x).toBeCloseTo(60, 5);
    expect(result.diagnostics.some(e => e.code === 'underconstrained')).toBe(true);
  });

  it('solves arcs in a closed outline and excludes construction geometry from cuts', async () => {
    const d = createCadDocument();
    const p = createCadPart();
    p.sketch = addLine(p.sketch, { x1: 0, y1: 0, x2: 60, y2: 0 });
    p.sketch = addArc(p.sketch, { cx: 60, cy: 20, radius: 20, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
    p.sketch = addLine(p.sketch, { x1: 60, y1: 40, x2: 0, y2: 40 });
    p.sketch = addLine(p.sketch, { x1: 0, y1: 40, x2: 0, y2: 0 });
    p.sketch = addLine(p.sketch, { x1: 10, y1: 10, x2: 20, y2: 20, construction: true });
    d.parts.push(p);
    const result = await solveCadDocument(d);
    expect(result.status).toBe('solved');
    expect(result.parts[0]!.loops).toHaveLength(1);
    expect(result.parts[0]!.outline.length).toBeGreaterThan(10);
    expect(bounds(result.parts[0]!.outline).height).toBeCloseTo(40, 6);
  });

  it('keeps the origin fixed through point edits and deletion', () => {
    const d = createPlateDocument();
    const p = d.parts[0]!;
    const origin = originId(p.sketch);
    expect(updatePoint(d, origin, { x: 2, y: 3 })).toEqual(d);
    expect(removeEntity(p.sketch, origin)).toEqual(p.sketch);
    expect(validateCadDocument(d)).toEqual([]);
  });
});

describe('profile validation and source documents', () => {
  it('rejects an open chain and never hands partial geometry to CAM', () => {
    const d = createPlateDocument();
    const sketch = d.parts[0]!.sketch;
    const line = sketch.entities.find(e => e.type === 'line')!;
    d.parts[0]!.sketch = removeEntity(sketch, line.id);
    const result = evaluateCadDocument(d);
    expect(result.parts).toEqual([]);
    expect(result.diagnostics.some(d => d.code === 'open-profile')).toBe(true);
    expect(validateCadDocument(d).some(d => d.code === 'missing-reference')).toBe(false);
  });

  it('rejects crossing loops, disconnected outlines and nested solid islands', () => {
    const outside = createPlateDocument();
    outside.parts[0]!.sketch = addCircle(outside.parts[0]!.sketch, { x: 150, y: 30, radius: 10 });
    expect(evaluateCadDocument(outside).diagnostics.some(d => d.code === 'disconnected-profile')).toBe(true);
    const crossing = createPlateDocument();
    crossing.parts[0]!.sketch = addCircle(crossing.parts[0]!.sketch, { x: 120, y: 30, radius: 10 });
    expect(evaluateCadDocument(crossing).diagnostics.some(d => d.code === 'intersecting-profiles')).toBe(true);
    const nested = createPlateDocument();
    nested.parts[0]!.sketch = addCircle(addCircle(nested.parts[0]!.sketch, { x: 30, y: 30, radius: 15 }), { x: 30, y: 30, radius: 5 });
    expect(evaluateCadDocument(nested).diagnostics.some(d => d.code === 'nested-island')).toBe(true);
  });

  it('rejects self-intersecting cut contours', () => {
    const d = createCadDocument();
    const p = createCadPart();
    for (const [x1, y1, x2, y2] of [
      [0, 0, 40, 40],
      [40, 40, 0, 40],
      [0, 40, 40, 0],
      [40, 0, 0, 0],
    ]) {
      p.sketch = addLine(p.sketch, { x1: x1!, y1: y1!, x2: x2!, y2: y2! });
    }
    d.parts.push(p);
    expect(evaluateCadDocument(d).diagnostics.some(d => d.code === 'self-intersection')).toBe(true);
  });

  it('detects analytic tangency even when circular tessellation misses the contact angle', () => {
    const d = createCadDocument();
    const part = createCadPart();
    for (const [x1, y1, x2, y2] of [
      [0, 0, 100, 0],
      [100, 0, 0, 100],
      [0, 100, 0, 0],
    ]) {
      part.sketch = addLine(part.sketch, { x1: x1!, y1: y1!, x2: x2!, y2: y2! });
    }
    // Center-to-diagonal distance is exactly 7; the inscribed polygon falls short of the tangent.
    const coordinate = (100 - 7 * Math.sqrt(2)) / 2;
    part.sketch = addCircle(part.sketch, { x: coordinate, y: coordinate, radius: 7 });
    d.parts.push(part);
    expect(evaluateCadDocument(d).diagnostics.some(d => d.code === 'intersecting-profiles')).toBe(true);
  });

  it('rejects nonfinite/negative dimensions and broken references before loading WASM', async () => {
    let d = createPlateDocument();
    d.parts[0]!.sketch = addCircle(d.parts[0]!.sketch, { x: 20, y: 20, radius: 4, dimensioned: true });
    const diameter = d.parts[0]!.sketch.constraints.find(c => c.type === 'diameter')!;
    const bad = await solveCadDocument(updateDimension(d, diameter.id, -2));
    expect(bad.status).toBe('invalid');
    expect(bad.diagnostics.some(d => d.code === 'invalid-dimension')).toBe(true);
    d = updateDimension(d, diameter.id, Number.NaN);
    expect(validateCadDocument(d).some(d => d.code === 'invalid-dimension')).toBe(true);
    d.parts[0]!.sketch = addConstraint(d.parts[0]!.sketch, { type: 'horizontal', entityId: 'missing' });
    expect(validateCadDocument(d).some(d => d.code === 'missing-reference')).toBe(true);
  });

  it('round trips serializable source and rejects duplicate identity', () => {
    const d = createPlateDocument();
    expect(parseCadDocument(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(() => parseCadDocument({ ...d, version: 2 })).toThrow('Invalid CAD document');
    d.parts[0]!.sketch.entities.push({ ...d.parts[0]!.sketch.entities[0]! });
    expect(() => parseCadDocument(d)).toThrow('unique');
  });

  it('rejects malformed nested source fields and does not mistake a string for a reference', () => {
    const d = createPlateDocument();
    const broken = JSON.parse(JSON.stringify(d));
    broken.parts[0].sketch.entities.find((e: { type: string }) => e.type === 'line').startId = 42;
    expect(() => parseCadDocument(broken)).toThrow('references');
    const coordinate = JSON.parse(JSON.stringify(d));
    coordinate.parts[0].sketch.entities[0].x = '0';
    expect(() => parseCadDocument(coordinate)).toThrow('finite');
  });

  it('normalizes solved open sketch constraints without accepting an open cut profile', async () => {
    const d = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 20, y2: 5 });
    const line = part.sketch.entities.find(e => e.type === 'line')!;
    part.sketch = addConstraint(part.sketch, { type: 'horizontal', entityId: line.id });
    d.parts.push(part);
    const result = await solveCadDocument(d);
    expect(result.status).toBe('invalid');
    expect(result.sketches[0]!.status).toBe('solved');
    if (line.type === 'line') expect(point(result.document, line.endId).y).toBeCloseTo(0, 8);
    expect(result.parts).toHaveLength(0);
  });
});
