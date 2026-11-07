import { describe, expect, it } from 'vitest';
import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addPoint,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  dimensionForSelection,
  measureDimension,
  parseCadDocument,
  removeEntity,
  resolveDimensionPlacement,
  setDimensionDriven,
  solveCadDocument,
  updateDimension,
  validateCadDocument,
  type CadDimension,
  type CadPointEntity,
  type CadSketch,
} from './index';
const documentOf = (sketch: CadSketch) => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });
const points = (sketch: CadSketch) => new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
const numeric = (sketch: CadSketch, id: string) => sketch.constraints.find(c => c.id === id)! as CadDimension;

describe('driven source dimensions', () => {
  it('frees the length, measures a native drag, and restores driving at the measured geometry as detached history commands', async () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 30, y2: 40 });
    const line = sketch.entities.at(-1)!;
    if (line.type !== 'line') throw Error();
    sketch = addConstraint(sketch, {
      type: 'distance',
      pointAId: line.startId,
      pointBId: line.endId,
      sourceEntityId: line.id,
      value: 50,
      labelPosition: { x: 5, y: 20 },
      expression: '5 * 10',
    });
    const original = documentOf(sketch),
      id = sketch.constraints.at(-1)!.id;
    const reference = setDimensionDriven(original, id, true);
    expect(reference.revision).toBe(original.revision + 1);
    expect(numeric(reference.parts[0]!.sketch, id)).toMatchObject({ driven: true, value: 50 });
    expect(numeric(reference.parts[0]!.sketch, id).expression).toBeUndefined();
    expect(updateDimension(reference, id, 999, '999')).toEqual(reference);
    const moved = await solveCadDocument(reference, { drag: { pointId: line.endId, x: 6, y: 8 } });
    expect(moved.sketches[0]!.dof).toBe(2);
    expect(numeric(moved.document.parts[0]!.sketch, id)).toMatchObject({
      driven: true,
      value: 10,
      sourceEntityId: line.id,
      labelPlacement: numeric(reference.parts[0]!.sketch, id).labelPlacement,
    });
    const label = resolveDimensionPlacement(moved.document.parts[0]!.sketch, numeric(moved.document.parts[0]!.sketch, id))!;
    expect(label.x).toBeCloseTo(-4.12, 6);
    expect(label.y).toBeCloseTo(7.84, 6);
    const driving = setDimensionDriven(moved.document, id, false),
      restored = await solveCadDocument(driving, { drag: { pointId: line.endId, x: 12, y: 16 } });
    expect(restored.sketches[0]!.dof).toBe(1);
    expect(measureDimension(restored.document.parts[0]!.sketch, numeric(restored.document.parts[0]!.sketch, id))).toBeCloseTo(10, 7);
    expect(numeric(restored.document.parts[0]!.sketch, id).driven).toBeUndefined();
    expect(parseCadDocument(JSON.parse(JSON.stringify(moved.document)))).toEqual(moved.document);
    expect(removeEntity(moved.document.parts[0]!.sketch, line.id).constraints.some(c => c.id === id)).toBe(false);
    expect(original.parts[0]!.sketch).toEqual(sketch);
  });

  it.each(['circle', 'arc'] as const)(
    'measures a %s radius changed by another native constraint instead of driving the stale reference value',
    async kind => {
      let sketch =
        kind === 'circle'
          ? addCircle(createCadPart().sketch, { x: 0, y: 0, radius: 10 })
          : addArc(createCadPart().sketch, { cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2 });
      const curve = sketch.entities.at(-1)!;
      sketch = addConstraint(sketch, { type: 'radius', entityId: curve.id, value: 999, driven: true });
      const radiusId = sketch.constraints.at(-1)!.id;
      sketch = addPoint(sketch, { x: 0, y: 20, fixed: true });
      const point = sketch.entities.at(-1)!;
      sketch = addConstraint(sketch, { type: 'pointArcDistance', pointId: point.id, entityId: curve.id, value: 5, side: 'outside' });
      const solved = await solveCadDocument(documentOf(sketch));
      expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
      expect(numeric(solved.document.parts[0]!.sketch, radiusId).value).toBeCloseTo(15, 7);
      expect(solved.sketches[0]!.dof).toBe(kind === 'circle' ? 0 : 2);
    }
  );

  it('removes every equation and auxiliary variable of compound reference dimensions', async () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 20, x2: 30, y2: 20 });
    const first = sketch.entities.at(-1)!;
    sketch = { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e)) };
    sketch = addLine(sketch, { x1: 5, y1: 28, x2: 25, y2: 28 });
    const second = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, { type: 'lineLineDistance', entityAId: first.id, entityBId: second.id, value: 1, driven: true });
    const id = sketch.constraints.at(-1)!.id,
      solved = await solveCadDocument(documentOf(sketch));
    expect(solved.sketches[0]!.status).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(4);
    expect(numeric(solved.document.parts[0]!.sketch, id).value).toBeCloseTo(8, 7);
  });

  it('refreshes a reference circular branch before it returns to driving', async () => {
    let sketch = addCircle(createCadPart().sketch, { x: 0, y: 0, radius: 10, dimensioned: true });
    const curve = sketch.entities.at(-1)!;
    sketch = addPoint(sketch, { x: 0, y: 5 });
    const point = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, {
      type: 'pointArcDistance',
      pointId: point.id,
      entityId: curve.id,
      value: 5,
      side: 'inside',
      driven: true,
    });
    const id = sketch.constraints.at(-1)!.id;
    sketch = addConstraint(addConstraint(sketch, { type: 'positionX', pointId: point.id, value: 0 }), {
      type: 'positionY',
      pointId: point.id,
      value: 15,
    });
    const solved = await solveCadDocument(documentOf(sketch));
    expect(solved.sketches[0]!.status).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(0);
    expect(numeric(solved.document.parts[0]!.sketch, id)).toMatchObject({ value: 5, side: 'outside', driven: true });
    const restored = await solveCadDocument(setDimensionDriven(solved.document, id, false));
    expect(restored.sketches[0]!.status, JSON.stringify(restored.diagnostics)).toBe('solved');
    expect(points(restored.document.parts[0]!.sketch).get(point.id)!.y).toBeCloseTo(15, 7);
  });

  it('does not allocate free native auxiliaries for a circular-pair reference and retains its owners', async () => {
    let sketch = addCircle(createCadPart().sketch, { x: 0, y: 0, radius: 10, dimensioned: true });
    const a = sketch.entities.at(-1)!;
    sketch = addCircle(sketch, { x: 30, y: 0, radius: 5, dimensioned: true, positioned: true });
    const b = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, {
      type: 'circleCircleDistance',
      entityAId: a.id,
      entityBId: b.id,
      value: 999,
      radiusASign: -1,
      radiusBSign: -1,
      direction: 1,
      driven: true,
    });
    const id = sketch.constraints.at(-1)!.id,
      solved = await solveCadDocument(documentOf(sketch));
    expect(solved.sketches[0]!.status).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(0);
    expect(numeric(solved.document.parts[0]!.sketch, id).value).toBeCloseTo(15, 7);
    expect(removeEntity(solved.document.parts[0]!.sketch, a.id).constraints.some(c => c.id === id)).toBe(false);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  });

  it('measures the retained angular wedge after another driver rotates its lines', async () => {
    let sketch = addLine(createCadPart().sketch, { x1: -14, y1: 0, x2: 0, y2: 0 });
    const first = sketch.entities.at(-1)!;
    sketch = { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e)) };
    sketch = addLine(sketch, { x1: 0, y1: 0, x2: 10, y2: 5 });
    const second = sketch.entities.at(-1)!;
    if (second.type !== 'line') throw Error();
    sketch = addConstraint(sketch, { type: 'distance', pointAId: second.startId, pointBId: second.endId, value: Math.hypot(10, 5) });
    const picks = { [first.id]: { x: -7, y: 0 }, [second.id]: { x: 5, y: 2.5 } };
    const result = dimensionForSelection(sketch, [first.id, second.id], { picks, placement: { x: -8, y: 2 } });
    if (!('constraint' in result)) throw Error();
    sketch = addConstraint(sketch, { ...result.constraint, driven: true });
    const id = sketch.constraints.at(-1)!.id;
    sketch = addConstraint(sketch, { type: 'angle', entityAId: first.id, entityBId: second.id, value: 45 });
    const solved = await solveCadDocument(documentOf(sketch));
    expect(solved.sketches[0]!.status).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(0);
    expect(numeric(solved.document.parts[0]!.sketch, id)).toMatchObject({ driven: true, reversedA: true, orientation: -1 });
    expect(numeric(solved.document.parts[0]!.sketch, id).value).toBeCloseTo(135, 7);
  });

  it('allows a zero reference length and rejects malformed portable driven metadata', () => {
    const part = createCadPart(),
      origin = part.sketch.entities[0]!;
    const document = documentOf(
      addConstraint(part.sketch, { type: 'distance', pointAId: origin.id, pointBId: origin.id, value: 0, driven: true })
    );
    expect(validateCadDocument(document).filter(d => d.severity === 'error')).toEqual([]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    const bad = structuredClone(document);
    (bad.parts[0]!.sketch.constraints[0] as unknown as { driven: unknown }).driven = 'yes';
    expect(() => parseCadDocument(bad)).toThrow('Invalid driven dimension flag');
  });
});

describe('dimension expression metadata', () => {
  it('updates or clears an expression even when the normalized numeric value is unchanged', () => {
    const document = createPlateDocument(),
      width = document.parts[0]!.sketch.constraints.find(c => c.type === 'distanceX')!;
    const formula = updateDimension(document, width.id, 120, ' 60 * 2 ');
    expect(numeric(formula.parts[0]!.sketch, width.id).expression).toBe('60 * 2');
    expect(formula.revision).toBe(document.revision + 1);
    const changed = updateDimension(formula, width.id, 120, '100 + 20');
    expect(changed.revision).toBe(formula.revision + 1);
    const plain = updateDimension(changed, width.id, 120);
    expect(plain.revision).toBe(changed.revision + 1);
    expect(numeric(plain.parts[0]!.sketch, width.id).expression).toBeUndefined();
    expect(parseCadDocument(JSON.parse(JSON.stringify(formula)))).toEqual(formula);
  });
});
