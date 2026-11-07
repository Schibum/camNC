import {
  addArc,
  addCircle,
  addConstraint,
  addPoint,
  createCadDocument,
  createCadPart,
  offsetSketch,
  parseCadDocument,
  solveCadDocument,
  type CadArcEntity,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { trimSketchCurveAt } from './trimCurves';

const documentOf = (sketch: CadSketch) => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });
const point = (sketch: CadSketch, id: string) => sketch.entities.find((e): e is CadPointEntity => e.type === 'point' && e.id === id)!;
const offset = (sketch: CadSketch, sourceId: string) => {
  const result = offsetSketch(sketch, { entityIds: [sourceId], value: 5 });
  if (!result.ok) throw Error(result.message);
  return result;
};
async function native(sketch: CadSketch) {
  return solveCadDocument(documentOf(sketch));
}

describe('circular trim releases the owning Offset relation', () => {
  it('converts an Offset circle copy to an arc without an invalid circle member, preserving the source and other drivers', async () => {
    let sketch = addCircle(createCadPart().sketch, { x: 60, y: 60, radius: 20, dimensioned: true, positioned: true });
    const source = sketch.entities.find(e => e.type === 'circle')!;
    sketch = addCircle(sketch, { x: 150, y: 60, radius: 8, dimensioned: true, positioned: true });
    const unrelated = sketch.entities.filter(e => e.type === 'circle').at(-1)!;
    const copied = offset(sketch, source.id),
      copyId = copied.entityIds[0]!;
    const initial = await native(copied.sketch);
    expect(initial.sketches[0]!.status, JSON.stringify(initial.diagnostics)).toBe('solved');
    const accepted = initial.document.parts[0]!.sketch;
    sketch = addPoint(addPoint(accepted, { x: 45, y: 60 }), { x: 75, y: 60 });
    const before = structuredClone(sketch),
      trimmed = trimSketchCurveAt(sketch, copyId, { x: 60, y: 75 })!;
    const result = await native(trimmed);
    expect(result.sketches[0]?.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(result.diagnostics.some(d => d.code === 'invalid-reference')).toBe(false);
    const after = result.document.parts[0]!.sketch;
    expect(after.entities.find(e => e.id === copyId)).toMatchObject({ type: 'arc', radius: 15 });
    expect(after.constraints.some(c => c.id === copied.dimensionId)).toBe(false);
    for (const entity of [source, unrelated]) {
      expect(after.entities.find(e => e.id === entity.id)).toEqual(accepted.entities.find(e => e.id === entity.id));
      if (entity.type === 'circle') expect(point(after, entity.centerId)).toEqual(point(accepted, entity.centerId));
    }
    expect(after.constraints).toEqual(expect.arrayContaining(accepted.constraints.filter(c => c.id !== copied.dimensionId)));
    const portable = documentOf(after);
    expect(parseCadDocument(JSON.parse(JSON.stringify(portable)))).toEqual(portable);
    expect(sketch).toEqual(before);
  });

  it('trims an Offset arc copy without rotating its source endpoints or changing the source radius', async () => {
    let sketch = addArc(createCadPart().sketch, { cx: 60, cy: 60, radius: 20, startAngle: 0, endAngle: Math.PI });
    const source = sketch.entities.find((e): e is CadArcEntity => e.type === 'arc')!;
    sketch = {
      ...sketch,
      entities: sketch.entities.map(e => (e.id === source.centerId && e.type === 'point' ? { ...e, fixed: true } : e)),
    };
    sketch = addConstraint(sketch, { type: 'radius', entityId: source.id, value: 20, label: 'Source radius' });
    const copied = offset(sketch, source.id),
      copyId = copied.entityIds[0]!;
    const initial = await native(copied.sketch);
    expect(initial.sketches[0]!.status, JSON.stringify(initial.diagnostics)).toBe('solved');
    const accepted = initial.document.parts[0]!.sketch;
    sketch = addPoint(accepted, { x: 60, y: 75 });
    const before = structuredClone(sketch),
      trimmed = trimSketchCurveAt(sketch, copyId, { x: 70.6, y: 70.6 })!;
    const result = await native(trimmed);
    expect(result.sketches[0]!.status, JSON.stringify(result.diagnostics)).toBe('solved');
    const after = result.document.parts[0]!.sketch;
    expect(after.entities.find(e => e.id === copyId)).toMatchObject({ startAngle: Math.PI / 2, endAngle: Math.PI, radius: 15 });
    expect(point(after, source.startId).x).toBeCloseTo(point(accepted, source.startId).x, 6);
    expect(point(after, source.startId).y).toBeCloseTo(point(accepted, source.startId).y, 6);
    expect(point(after, source.endId).x).toBeCloseTo(point(accepted, source.endId).x, 6);
    expect(point(after, source.endId).y).toBeCloseTo(point(accepted, source.endId).y, 6);
    expect(after.entities.find(e => e.id === source.id)).toMatchObject({ radius: 20, startAngle: 0, endAngle: Math.PI });
    expect(after.constraints.some(c => c.id === copied.dimensionId)).toBe(false);
    expect(after.constraints).toEqual(expect.arrayContaining(accepted.constraints.filter(c => c.id !== copied.dimensionId)));
    expect(sketch).toEqual(before);
  });

  it('edits the trimmed arc radius without feeding that change back into its free source', async () => {
    let sketch = addArc(createCadPart().sketch, { cx: 60, cy: 60, radius: 20, startAngle: 0, endAngle: Math.PI });
    const source = sketch.entities.find((e): e is CadArcEntity => e.type === 'arc')!;
    sketch = {
      ...sketch,
      entities: sketch.entities.map(e => (e.id === source.centerId && e.type === 'point' ? { ...e, fixed: true } : e)),
    };
    const copied = offset(sketch, source.id),
      copyId = copied.entityIds[0]!;
    const initial = await native(copied.sketch);
    expect(initial.sketches[0]!.status, JSON.stringify(initial.diagnostics)).toBe('solved');
    const accepted = initial.document.parts[0]!.sketch;
    sketch = addPoint(accepted, { x: 60, y: 75 });
    let trimmed = trimSketchCurveAt(sketch, copyId, { x: 70.6, y: 70.6 })!;
    trimmed = addConstraint(trimmed, { type: 'radius', entityId: copyId, value: 12 });
    const result = await native(trimmed);
    expect(result.sketches[0]!.status, JSON.stringify(result.diagnostics)).toBe('solved');
    const after = result.document.parts[0]!.sketch;
    expect(after.entities.find(e => e.id === source.id)).toMatchObject({ radius: 20, startAngle: 0, endAngle: Math.PI });
    for (const id of [source.centerId, source.startId, source.endId]) {
      expect(point(after, id).x).toBeCloseTo(point(accepted, id).x, 6);
      expect(point(after, id).y).toBeCloseTo(point(accepted, id).y, 6);
    }
    expect(after.entities.find(e => e.id === copyId)).toMatchObject({ radius: 12 });
    expect(after.constraints.some(c => c.id === copied.dimensionId)).toBe(false);
  });
});
