import { describe, expect, it } from 'vitest';
import {
  addArc,
  addCircle,
  addConstraint,
  addPoint,
  addRectangle,
  constraintEntityIds,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  originId,
  parseCadDocument,
  removeEntity,
  solveCadDocument,
  updateDimension,
  validateCadDocument,
} from './index';
import type { CadDocument, CadPointEntity, CadSketch } from './types';

const getPoint = (document: CadDocument, id: string) =>
  document.parts[0]!.sketch.entities.find((e): e is CadPointEntity => e.id === id && e.type === 'point')!;
const withSketch = (sketch: CadSketch): CadDocument => {
  const document = createCadDocument();
  document.parts.push({ ...createCadPart(), sketch });
  return document;
};
function appendPoint(document: CadDocument, x: number, y: number, fixed = false): string {
  const part = document.parts[0]!;
  part.sketch = addPoint(part.sketch, { x, y, fixed });
  return part.sketch.entities.at(-1)!.id;
}
const widthDimension = (document: CadDocument) => document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;

describe('free sketch creation', () => {
  it('creates a free rectangle with removable joined corners and horizontal, parallel, and perpendicular relationships', async () => {
    let sketch = createCadPart().sketch;
    sketch = addRectangle(sketch, { x: 20, y: 15, width: 40, height: 30 });
    expect(sketch.constraints.map(c => c.type)).toEqual([
      'coincident',
      'coincident',
      'coincident',
      'coincident',
      'horizontal',
      'parallel',
      'parallel',
      'perpendicular',
    ]);
    const result = await solveCadDocument(withSketch(sketch));
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(4);
    const corner = sketch.entities.find((e): e is CadPointEntity => e.type === 'point' && e.x === 60 && e.y === 45)!;
    const moved = await solveCadDocument(result.document, { drag: { pointId: corner.id, x: 80, y: 55 } });
    expect(moved.status).toBe('solved');
    expect(getPoint(moved.document, corner.id).x).toBeCloseTo(80, 5);
    expect(getPoint(moved.document, corner.id).y).toBeCloseTo(55, 5);
  });

  it('anchors a rectangle through an explicit origin coincidence rather than a matching coordinate', async () => {
    let sketch = addRectangle(createCadPart().sketch, { x: 0, y: 0, width: 40, height: 30 });
    expect((await solveCadDocument(withSketch(sketch))).sketches[0]!.dof).toBe(4);
    const bottom = sketch.entities.find(entity => entity.type === 'line')!;
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: bottom.startId, pointBId: originId(sketch) });
    const result = await solveCadDocument(withSketch(sketch));
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(2);
  });

  it('keeps a free circle center and radius unconstrained until dimensions are requested', async () => {
    const sketch = addCircle(createCadPart().sketch, { x: 20, y: 15, radius: 8 });
    expect(sketch.constraints).toEqual([]);
    const result = await solveCadDocument(withSketch(sketch));
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(3);
  });

  it('constrains an intentionally entered circle size without silently fixing its location', async () => {
    const sketch = addCircle(createCadPart().sketch, { x: 20, y: 15, radius: 8, dimensioned: true });
    const circle = sketch.entities.find(e => e.type === 'circle')!;
    if (circle.type !== 'circle') throw new Error('Fixture');
    expect(sketch.constraints.map(c => c.type)).toEqual(['diameter']);
    const result = await solveCadDocument(withSketch(sketch), { drag: { pointId: circle.centerId, x: 55, y: 40 } });
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(2);
    expect(getPoint(result.document, circle.centerId)).toMatchObject({ x: 55, y: 40 });
    expect(result.document.parts[0]!.sketch.entities.find(e => e.id === circle.id)).toMatchObject({ radius: 8 });
  });

  it('adds explicit location dimensions only for a positioned creation request', async () => {
    const sketch = addCircle(createCadPart().sketch, { x: 20, y: 15, radius: 8, dimensioned: true, positioned: true });
    const result = await solveCadDocument(withSketch(sketch));
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(0);
    expect(sketch.constraints.map(c => c.type)).toEqual(['diameter', 'positionX', 'positionY']);
  });

  it('adds intentional rectangle size dimensions while leaving translation free', async () => {
    const sketch = addRectangle(createCadPart().sketch, { x: 20, y: 15, width: 40, height: 30, dimensioned: true });
    const result = await solveCadDocument(withSketch(sketch));
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(2);
    expect(sketch.constraints.some(c => c.type === 'positionX' || c.type === 'positionY')).toBe(false);
  });
});

describe('persistent point relations solved by PlaneGCS', () => {
  it('uses two right-edge drag targets to resize a free origin-anchored rectangle while preserving H/V', async () => {
    const part = createCadPart();
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 40, height: 30 });
    const right = part.sketch.entities.filter(e => e.type === 'line')[1]!;
    if (right.type !== 'line') throw new Error('Fixture');
    const bottom = part.sketch.entities.find(entity => entity.type === 'line')!;
    part.sketch = addConstraint(part.sketch, { type: 'coincident', pointAId: bottom.startId, pointBId: originId(part.sketch) });
    const result = await solveCadDocument(withSketch(part.sketch), {
      drag: [
        { pointId: right.startId, x: 70, y: 0 },
        { pointId: right.endId, x: 70, y: 30 },
      ],
    });
    expect(result.status).toBe('solved');
    expect(getPoint(result.document, right.startId)).toMatchObject({ x: 70, y: 0 });
    expect(getPoint(result.document, right.endId)).toMatchObject({ x: 70, y: 30 });
    expect(result.document.parts[0]!.sketch.entities.find(e => e.type === 'point' && e.fixed)).toMatchObject({ x: 0, y: 0 });
    expect(getPoint(result.document, bottom.startId)).toMatchObject({ x: 0, y: 0 });
    expect(result.document.parts[0]!.sketch.constraints).toEqual(part.sketch.constraints);
  });

  it('projects a dragged point onto an existing fixed line without moving the line', async () => {
    const document = createPlateDocument();
    const bottom = document.parts[0]!.sketch.entities.find(e => e.type === 'line')!;
    const p = appendPoint(document, 30, 5);
    document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, { type: 'pointOnLine', pointId: p, entityId: bottom.id });
    const result = await solveCadDocument(document, { drag: [{ pointId: p, x: 65, y: 20 }] });
    expect(result.status).toBe('solved');
    expect(getPoint(result.document, p).x).toBeCloseTo(65, 6);
    expect(getPoint(result.document, p).y).toBeCloseTo(0, 6);
    if (bottom.type !== 'line') throw new Error('Fixture');
    expect(getPoint(result.document, bottom.startId)).toMatchObject({ x: 0, y: 0 });
    expect(getPoint(result.document, bottom.endId)).toMatchObject({ x: 120, y: 0 });
  });

  it('keeps fully dimensioned geometry and its constraints unchanged for multiple drag targets', async () => {
    const document = createPlateDocument();
    const right = document.parts[0]!.sketch.entities.filter(e => e.type === 'line')[1]!;
    if (right.type !== 'line') throw new Error('Fixture');
    const result = await solveCadDocument(document, {
      drag: [
        { pointId: right.startId, x: 160, y: 10 },
        { pointId: right.endId, x: 160, y: 100 },
      ],
    });
    expect(result.status).toBe('solved');
    expect(getPoint(result.document, right.startId)).toMatchObject({ x: 120, y: 0 });
    expect(getPoint(result.document, right.endId)).toMatchObject({ x: 120, y: 80 });
    expect(result.document.parts[0]!.sketch.constraints).toEqual(document.parts[0]!.sketch.constraints);
  });

  it('rejects nonfinite coordinates in any drag target before solving', async () => {
    const document = createPlateDocument();
    const result = await solveCadDocument(document, {
      drag: [
        { pointId: 'missing', x: 10, y: 20 },
        { pointId: 'other', x: Number.NaN, y: 30 },
      ],
    });
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some(d => d.code === 'invalid-drag')).toBe(true);
    expect(result.sketches).toEqual([]);
  });

  it.each(['horizontalPoints', 'verticalPoints'] as const)(
    'keeps %s aligned through dimension edits and constrained dragging',
    async type => {
      let document = createPlateDocument();
      const a = appendPoint(document, 30, 20, true);
      const b = appendPoint(document, 70, 50);
      const dimensionType = type === 'horizontalPoints' ? 'distanceX' : 'distanceY';
      let sketch = addConstraint(document.parts[0]!.sketch, { type, pointAId: a, pointBId: b });
      sketch = addConstraint(sketch, { type: dimensionType, pointAId: a, pointBId: b, value: 35 });
      document.parts[0]!.sketch = sketch;
      const dimensionId = sketch.constraints.at(-1)!.id;
      const first = await solveCadDocument(document);
      expect(first.status).toBe('solved');
      expect(first.sketches[0]!.dof).toBe(0);
      const expected = type === 'horizontalPoints' ? { x: 65, y: 20 } : { x: 30, y: 55 };
      expect(getPoint(first.document, b)).toMatchObject(expected);
      document = updateDimension(first.document, dimensionId, 45);
      const edited = await solveCadDocument(document, { drag: { pointId: b, x: 90, y: 70 } });
      expect(edited.status).toBe('solved');
      expect(getPoint(edited.document, b)).toMatchObject(type === 'horizontalPoints' ? { x: 75, y: 20 } : { x: 30, y: 65 });
    }
  );

  it('keeps a point on a line when the referenced profile edge changes', async () => {
    const document = createPlateDocument();
    const right = document.parts[0]!.sketch.entities.filter(e => e.type === 'line')[1]!;
    const p = appendPoint(document, 115, 30);
    document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, { type: 'pointOnLine', pointId: p, entityId: right.id });
    const first = await solveCadDocument(document);
    expect(first.status).toBe('solved');
    expect(getPoint(first.document, p).x).toBeCloseTo(120, 7);
    const widened = await solveCadDocument(updateDimension(first.document, widthDimension(document).id, 160));
    expect(widened.status).toBe('solved');
    expect(getPoint(widened.document, p).x).toBeCloseTo(160, 7);
  });

  it('makes a standalone point the true midpoint and retains that relationship after resizing', async () => {
    const document = createPlateDocument();
    const top = document.parts[0]!.sketch.entities.filter(e => e.type === 'line')[2]!;
    const p = appendPoint(document, 50, 70);
    document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, { type: 'midpoint', pointId: p, entityId: top.id });
    const first = await solveCadDocument(document);
    expect(first.status).toBe('solved');
    expect(getPoint(first.document, p).x).toBeCloseTo(60, 7);
    expect(getPoint(first.document, p).y).toBeCloseTo(80, 7);
    const changed = await solveCadDocument(updateDimension(first.document, widthDimension(document).id, 160));
    expect(changed.status).toBe('solved');
    expect(getPoint(changed.document, p).x).toBeCloseTo(80, 7);
    expect(getPoint(changed.document, p).y).toBeCloseTo(80, 7);
    expect(changed.document.parts[0]!.sketch.constraints.at(-1)).toMatchObject({ type: 'midpoint', pointId: p, entityId: top.id });
  });

  it('keeps a point on a circle after changing its driving diameter', async () => {
    const document = createPlateDocument();
    const part = document.parts[0]!;
    part.sketch = addCircle(part.sketch, { x: 40, y: 40, radius: 10, dimensioned: true, positioned: true });
    const circle = part.sketch.entities.find(e => e.type === 'circle')!;
    if (circle.type !== 'circle') throw new Error('Fixture');
    const diameter = part.sketch.constraints.find(c => c.type === 'diameter')!;
    const p = appendPoint(document, 52, 40);
    part.sketch = addConstraint(part.sketch, { type: 'pointOnCircle', pointId: p, entityId: circle.id });
    const result = await solveCadDocument(updateDimension(document, diameter.id, 30));
    expect(result.status).toBe('solved');
    const center = getPoint(result.document, circle.centerId),
      onCircle = getPoint(result.document, p);
    expect(Math.hypot(onCircle.x - center.x, onCircle.y - center.y)).toBeCloseTo(15, 6);
    expect(onCircle.id).toBe(p);
  });

  it('dispatches a point on an arc to the native arc constraint while retaining stable source references', async () => {
    const document = createPlateDocument();
    const part = document.parts[0]!;
    part.sketch = addArc(part.sketch, { cx: 40, cy: 40, radius: 10, startAngle: 0, endAngle: Math.PI, construction: true });
    const arc = part.sketch.entities.find(e => e.type === 'arc')!;
    if (arc.type !== 'arc') throw new Error('Fixture');
    part.sketch.entities = part.sketch.entities.map(e =>
      e.type === 'point' && [arc.centerId, arc.startId].includes(e.id) ? { ...e, fixed: true } : e
    );
    const p = appendPoint(document, 40, 52);
    part.sketch = addConstraint(part.sketch, { type: 'pointOnCircle', pointId: p, entityId: arc.id });
    const first = await solveCadDocument(document);
    expect(first.status, JSON.stringify(first.diagnostics)).toBe('solved');
    expect(getPoint(first.document, p).y).toBeCloseTo(50, 6);
    expect(getPoint(first.document, p).x).toBeCloseTo(40, 6);
    expect(first.document.parts[0]!.sketch.constraints.at(-1)).toMatchObject({ pointId: p, entityId: arc.id });
  });

  it.each(['pointOnLine', 'pointOnCircle', 'midpoint'] as const)(
    'tracks both references of %s for validation, deletion and portable documents',
    type => {
      const document = createPlateDocument();
      const part = document.parts[0]!;
      if (type === 'pointOnCircle') part.sketch = addCircle(part.sketch, { x: 40, y: 40, radius: 10 });
      const curve = part.sketch.entities.find(e => e.type === (type === 'pointOnCircle' ? 'circle' : 'line'))!;
      const p = appendPoint(document, 40, 35);
      part.sketch = addConstraint(part.sketch, { type, pointId: p, entityId: curve.id });
      const relation = part.sketch.constraints.at(-1)!;
      expect(constraintEntityIds(relation)).toEqual([p, curve.id]);
      expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
      expect(validateCadDocument(document)).toEqual([]);
      expect(removeEntity(part.sketch, p).constraints.some(c => c.id === relation.id)).toBe(false);
      expect(removeEntity(part.sketch, curve.id).constraints.some(c => c.id === relation.id)).toBe(false);
      const missing = structuredClone(document);
      missing.parts[0]!.sketch.entities = missing.parts[0]!.sketch.entities.filter(e => e.id !== p);
      expect(validateCadDocument(missing).some(d => d.code === 'missing-reference' && d.constraintIds?.includes(relation.id))).toBe(true);
    }
  );

  it('rejects incorrect point/curve roles instead of sending malformed entities to WASM', async () => {
    const document = createPlateDocument();
    const line = document.parts[0]!.sketch.entities.find(e => e.type === 'line')!;
    document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, { type: 'pointOnLine', pointId: line.id, entityId: line.id });
    const result = await solveCadDocument(document);
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some(d => d.code === 'invalid-reference')).toBe(true);
    expect(result.sketches).toEqual([]);
  });

  it('preserves an explicitly constrained coincidence between independent points', async () => {
    const document = createPlateDocument();
    const a = appendPoint(document, 20, 30, true);
    const b = appendPoint(document, 25, 35);
    document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, { type: 'coincident', pointAId: a, pointBId: b });
    const result = await solveCadDocument(document, { drag: { pointId: b, x: 50, y: 50 } });
    expect(result.status).toBe('solved');
    expect(getPoint(result.document, b)).toMatchObject({ x: 20, y: 30 });
    expect(getPoint(result.document, a).id).not.toBe(getPoint(result.document, b).id);
  });
});
