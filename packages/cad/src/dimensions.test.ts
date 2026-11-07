import { describe, expect, it } from 'vitest';
import {
  addBezier,
  addCircle,
  addConstraint,
  addLine,
  addPoint,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  dimensionForSelection,
  dimensionWitnessPoints,
  parseCadDocument,
  removeEntity,
  solveCadDocument,
  updateDimension,
  validateCadDocument,
  type CadDimension,
  type CadDocument,
  type CadPointEntity,
  type CadSketch,
} from './index';

const points = (sketch: CadSketch) =>
  new Map(sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point]));
const docWith = (sketch: CadSketch): CadDocument => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });
function pointLineFixture(y = 12) {
  let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 20, x2: 30, y2: 20 });
  const line = sketch.entities.find(entity => entity.type === 'line')!;
  sketch = { ...sketch, entities: sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity)) };
  sketch = addPoint(sketch, { x: 9, y: 20 + y });
  return { sketch, line, point: sketch.entities.at(-1)! as CadPointEntity };
}

describe('dimension selection contract', () => {
  it('resolves a point-line pair in either selection order and measures the infinite perpendicular support', () => {
    const { sketch, line, point } = pointLineFixture();
    const before = structuredClone(sketch);
    for (const ids of [
      [point.id, line.id],
      [line.id, point.id],
    ])
      expect(dimensionForSelection(sketch, ids)).toMatchObject({
        constraint: { type: 'pointLineDistance', pointId: point.id, entityId: line.id, value: 12 },
      });
    expect(sketch).toEqual(before);
    const extended = { ...sketch, entities: sketch.entities.map(entity => (entity.id === point.id ? { ...point, x: -10 } : entity)) };
    const dimension = dimensionForSelection(extended, [point.id, line.id]);
    if (!('constraint' in dimension)) throw Error();
    expect(dimensionWitnessPoints(extended, dimension.constraint)).toEqual([
      { x: -10, y: 20 },
      { ...point, x: -10 },
    ]);
  });

  it('reuses an existing rectangle width rather than creating a redundant line Length', () => {
    const document = createPlateDocument(),
      sketch = document.parts[0]!.sketch;
    const width = sketch.constraints.find(c => c.type === 'distanceX')!;
    if (!('sourceEntityId' in width) || !width.sourceEntityId) throw Error('Fixture width needs an owner.');
    expect(dimensionForSelection(sketch, [width.sourceEntityId])).toMatchObject({ existingConstraintId: width.id, constraint: width });
  });

  it('rejects unsupported pairs explicitly instead of dimensioning only the first entity', () => {
    const { sketch, line, point } = pointLineFixture();
    const circular = addCircle(sketch, { x: 60, y: 40, radius: 10 }),
      circle = circular.entities.at(-1)!;
    const unsupported = addBezier(circular, {
      points: [
        { x: 50, y: 30 },
        { x: 70, y: 40 },
      ],
    });
    expect(dimensionForSelection(unsupported, [line.id, unsupported.entities.at(-1)!.id])).toHaveProperty('message');
    expect(dimensionForSelection(circular, [point.id])).toHaveProperty('message');
    expect(dimensionForSelection(circular, [line.id, point.id], { mode: 'angle' })).toHaveProperty('message');
  });

  it('chooses a normal distance for parallel lines and an angle for intersecting lines', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 10, x2: 30, y2: 10 });
    sketch = addLine(sketch, { x1: 4, y1: 24, x2: 34, y2: 24 });
    const lines = sketch.entities.filter(entity => entity.type === 'line');
    expect(
      dimensionForSelection(
        sketch,
        lines.map(line => line.id)
      )
    ).toMatchObject({ constraint: { type: 'lineLineDistance', value: 14 } });
    sketch = addLine(sketch, { x1: 0, y1: 10, x2: 20, y2: 30 });
    expect(dimensionForSelection(sketch, [lines[0]!.id, sketch.entities.at(-1)!.id])).toMatchObject({
      constraint: { type: 'angle', value: 45 },
    });
  });
});

describe('native normal distance dimensions', () => {
  it.each([-1, 1])('edits a point-line distance on side %s without fixing the sliding coordinate', async side => {
    const { sketch, line, point } = pointLineFixture(side * 12);
    const result = dimensionForSelection(sketch, [point.id, line.id]);
    if (!('constraint' in result)) throw Error(result.message);
    const source = docWith(addConstraint(sketch, result.constraint));
    const id = source.parts[0]!.sketch.constraints.at(-1)!.id;
    const solved = await solveCadDocument(updateDimension(source, id, 25));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(1);
    const p = points(solved.document.parts[0]!.sketch).get(point.id)!;
    expect(p.x).toBeCloseTo(9, 7);
    expect(p.y).toBeCloseTo(20 + side * 25, 7);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
    expect(source.parts[0]!.sketch.constraints.at(-1)).toMatchObject({ value: 12 });
  });

  it('keeps implicit parallelism when editing a line-line distance', async () => {
    const fixture = pointLineFixture();
    let sketch = removeEntity(fixture.sketch, fixture.point.id);
    sketch = addLine(sketch, { x1: 5, y1: 32, x2: 25, y2: 32 });
    const second = sketch.entities.at(-1)!;
    const result = dimensionForSelection(sketch, [fixture.line.id, second.id]);
    if (!('constraint' in result)) throw Error(result.message);
    const source = docWith(addConstraint(sketch, result.constraint));
    const dimension = source.parts[0]!.sketch.constraints.at(-1)! as CadDimension;
    const solved = await solveCadDocument(updateDimension(source, dimension.id, 25));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(2);
    const output = solved.document.parts[0]!.sketch,
      map = points(output);
    if (second.type !== 'line') throw Error();
    expect(map.get(second.startId)!.y).toBeCloseTo(45, 7);
    expect(map.get(second.endId)!.y).toBeCloseTo(45, 7);
    expect(removeEntity(output, second.id).constraints.some(c => c.id === dimension.id)).toBe(false);
    expect(removeEntity(output, fixture.line.id).constraints.some(c => c.id === dimension.id)).toBe(false);
  });

  it('accepts zero normal distance and catches an incompatible fully fixed point-line dimension', async () => {
    const { sketch, line, point } = pointLineFixture();
    const zero = addConstraint(sketch, { type: 'pointLineDistance', pointId: point.id, entityId: line.id, value: 0 });
    const solved = await solveCadDocument(docWith(zero));
    expect(solved.sketches[0]!.status).toBe('solved');
    expect(points(solved.document.parts[0]!.sketch).get(point.id)!.y).toBeCloseTo(20, 7);
    const fixed = { ...sketch, entities: sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity)) };
    const wrong = docWith(addConstraint(fixed, { type: 'pointLineDistance', pointId: point.id, entityId: line.id, value: 25 }));
    const failed = await solveCadDocument(wrong);
    expect(failed.sketches[0]!.status).toBe('conflict');
    expect(failed.diagnostics.find(d => d.code === 'constraint-conflict')!.constraintIds).toContain(
      wrong.parts[0]!.sketch.constraints.at(-1)!.id
    );
    expect(failed.document.parts[0]!.sketch).toEqual(wrong.parts[0]!.sketch);
  });

  it('validates normal-distance references and finite nonnegative values before native solving', () => {
    const { sketch, line, point } = pointLineFixture();
    for (const value of [-1, Infinity, NaN]) {
      const bad = docWith(addConstraint(sketch, { type: 'pointLineDistance', pointId: point.id, entityId: line.id, value }));
      expect(validateCadDocument(bad).some(d => d.code === 'invalid-dimension')).toBe(true);
    }
    const bad = docWith(addConstraint(sketch, { type: 'pointLineDistance', pointId: line.id, entityId: point.id, value: 2 }));
    expect(validateCadDocument(bad).some(d => d.code === 'invalid-reference')).toBe(true);
  });
});
