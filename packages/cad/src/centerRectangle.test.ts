import { describe, expect, it } from 'vitest';
import {
  addCenterRectangle,
  addConstraint,
  addPoint,
  createCadDocument,
  createCadPart,
  originId,
  parseCadDocument,
  solveCadDocument,
  updateDimension,
} from './index';
import type { CadDocument, CadPointEntity, CadSketch } from './types';

const withSketch = (sketch: CadSketch): CadDocument => ({
  ...createCadDocument(),
  parts: [{ ...createCadPart(), sketch }],
});
const point = (sketch: CadSketch, id: string) => sketch.entities.find((e): e is CadPointEntity => e.id === id && e.type === 'point')!;
const corner = (sketch: CadSketch, x: number, y: number) =>
  sketch.entities.find((e): e is CadPointEntity => e.type === 'point' && e.x === x && e.y === y)!;
const centerOf = (sketch: CadSketch) => {
  const midpoint = sketch.constraints.find(constraint => constraint.type === 'midpoint');
  if (midpoint?.type !== 'midpoint') throw new Error('Missing center relation');
  return midpoint.pointId;
};

describe('persistent center rectangles solved by PlaneGCS', () => {
  it('keeps an origin-centered free rectangle centered when a corner resizes it', async () => {
    let sketch = addCenterRectangle(createCadPart().sketch, { x: 0, y: 0, width: 40, height: 30 });
    const center = centerOf(sketch),
      topRight = corner(sketch, 20, 15),
      bottomLeft = corner(sketch, -20, -15);
    expect(sketch.constraints.map(c => c.type)).toEqual([
      'coincident',
      'coincident',
      'coincident',
      'coincident',
      'horizontal',
      'parallel',
      'parallel',
      'perpendicular',
      'midpoint',
    ]);
    expect(sketch.constraints.at(-1)).toMatchObject({ pointId: center });
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: center, pointBId: originId(sketch) });
    const first = await solveCadDocument(withSketch(sketch));
    expect(first.status, JSON.stringify(first.diagnostics)).toBe('solved');
    expect(first.sketches[0]!.dof).toBe(2);
    const moved = await solveCadDocument(first.document, { drag: { pointId: topRight.id, x: 35, y: 25 } });
    expect(moved.status, JSON.stringify(moved.diagnostics)).toBe('solved');
    const next = moved.document.parts[0]!.sketch;
    expect(point(next, center).x).toBeCloseTo(0, 8);
    expect(point(next, center).y).toBeCloseTo(0, 8);
    expect(point(next, originId(sketch))).toMatchObject({ x: 0, y: 0, fixed: true });
    expect(point(next, topRight.id).x).toBeCloseTo(35, 6);
    expect(point(next, topRight.id).y).toBeCloseTo(25, 6);
    expect(point(next, bottomLeft.id).x).toBeCloseTo(-35, 6);
    expect(point(next, bottomLeft.id).y).toBeCloseTo(-25, 6);
    expect(next.constraints).toEqual(sketch.constraints);
    expect(moved.sketches[0]!.dof).toBe(2);
  });

  it('fully constrains numeric creation at the origin and preserves its center through dimension edits', async () => {
    const sketch = addCenterRectangle(createCadPart().sketch, { x: 0, y: 0, width: 40, height: 30, dimensioned: true, positioned: true });
    const first = await solveCadDocument(withSketch(sketch));
    expect(first.status).toBe('solved');
    expect(first.sketches[0]!.dof).toBe(0);
    const width = sketch.constraints.find(c => c.label === 'Width')!;
    const topRight = corner(sketch, 20, 15),
      bottomLeft = corner(sketch, -20, -15);
    const resized = await solveCadDocument(updateDimension(first.document, width.id, 60));
    expect(resized.status).toBe('solved');
    expect(resized.sketches[0]!.dof).toBe(0);
    const next = resized.document.parts[0]!.sketch;
    expect(point(next, topRight.id).x).toBeCloseTo(30, 6);
    expect(point(next, bottomLeft.id).x).toBeCloseTo(-30, 6);
    expect(point(next, originId(sketch))).toMatchObject({ x: 0, y: 0 });
  });

  it('explicitly joins a clicked standalone point and retains its fixed center relation while resizing', async () => {
    let sketch = addPoint(createCadPart().sketch, { x: 25, y: 30, fixed: true });
    const externalId = sketch.entities.at(-1)!.id;
    sketch = addCenterRectangle(sketch, { x: 25, y: 30, width: 40, height: 20 });
    const centerId = centerOf(sketch);
    expect(centerId).not.toBe(externalId);
    expect(sketch.entities.filter(e => e.type === 'point' && e.x === 25 && e.y === 30)).toHaveLength(2);
    expect(sketch.constraints.find(c => c.type === 'midpoint')).toMatchObject({ pointId: centerId });
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: centerId, pointBId: externalId });
    const topRight = corner(sketch, 45, 40),
      bottomLeft = corner(sketch, 5, 20);
    const result = await solveCadDocument(withSketch(sketch), { drag: { pointId: topRight.id, x: 60, y: 55 } });
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(2);
    const next = result.document.parts[0]!.sketch;
    expect(point(next, centerId)).toMatchObject({ x: 25, y: 30 });
    expect(point(next, externalId)).toMatchObject({ x: 25, y: 30, fixed: true });
    expect(point(next, bottomLeft.id).x).toBeCloseTo(-10, 6);
    expect(point(next, bottomLeft.id).y).toBeCloseTo(5, 6);
    expect(parseCadDocument(JSON.parse(JSON.stringify(result.document)))).toEqual(result.document);
  });

  it('positions the center instead of a corner and leaves the size free', async () => {
    const sketch = addCenterRectangle(createCadPart().sketch, { x: 25, y: 30, width: 40, height: 20, positioned: true });
    const centerId = corner(sketch, 25, 30).id;
    expect(sketch.constraints.filter(c => c.type === 'positionX' || c.type === 'positionY')).toEqual([
      expect.objectContaining({ type: 'positionX', pointId: centerId, value: 25 }),
      expect.objectContaining({ type: 'positionY', pointId: centerId, value: 30 }),
    ]);
    const result = await solveCadDocument(withSketch(sketch));
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(2);
  });

  it('leaves an unpositioned numeric center rectangle free to translate', async () => {
    const sketch = addCenterRectangle(createCadPart().sketch, { x: 25, y: 30, width: 40, height: 20, dimensioned: true });
    const centerId = corner(sketch, 25, 30).id;
    const result = await solveCadDocument(withSketch(sketch), { drag: { pointId: centerId, x: 50, y: 60 } });
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(2);
    const next = result.document.parts[0]!.sketch;
    expect(point(next, centerId).x).toBeCloseTo(50, 6);
    expect(point(next, centerId).y).toBeCloseTo(60, 6);
    const edges = next.entities.filter(e => e.type === 'line' && !e.construction);
    const bottom = edges[0]!;
    if (bottom.type !== 'line') throw new Error('Missing rectangle edge');
    expect(point(next, bottom.endId).x - point(next, bottom.startId).x).toBeCloseTo(40, 6);
  });

  it('excludes both construction diagonals from the evaluated cutting profile', async () => {
    const sketch = addCenterRectangle(createCadPart().sketch, { x: 0, y: 0, width: 40, height: 30 });
    expect(sketch.entities.filter(e => e.type === 'line' && e.construction)).toHaveLength(2);
    const result = await solveCadDocument(withSketch(sketch));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.holes).toEqual([]);
    expect(result.parts[0]!.loops).toHaveLength(1);
    expect(result.parts[0]!.loops[0]!.entityIds).toHaveLength(4);
    expect(result.parts[0]!.loops[0]!.entityIds.every(id => !sketch.entities.find(e => e.id === id)!.construction)).toBe(true);
  });
});
