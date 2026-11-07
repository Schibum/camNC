import { describe, expect, it } from 'vitest';
import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addPoint,
  createCadDocument,
  createCadPart,
  dimensionAngleWitness,
  dimensionForSelection,
  dimensionValueError,
  dimensionWitnessPoints,
  parseCadDocument,
  removeEntity,
  solveCadDocument,
  updateDimension,
  type CadDimension,
  type CadPointEntity,
  type CadSketch,
} from './index';

const mapPoints = (sketch: CadSketch) =>
  new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
const documentOf = (sketch: CadSketch) => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });
function circular(sketch: CadSketch, kind: 'arc' | 'circle', x: number, y: number, radius: number) {
  const next =
    kind === 'arc' ? addArc(sketch, { cx: x, cy: y, radius, startAngle: 0, endAngle: Math.PI }) : addCircle(sketch, { x, y, radius });
  const curve = next.entities.at(-1)!;
  if (curve.type !== 'arc' && curve.type !== 'circle') throw Error();
  return { sketch: addConstraint(next, { type: 'radius', entityId: curve.id, value: radius }), curve };
}
const proposal = (sketch: CadSketch, ids: string[], options?: Parameters<typeof dimensionForSelection>[2]) => {
  const result = dimensionForSelection(sketch, ids, options);
  if (!('constraint' in result)) throw Error(result.message);
  return result.constraint;
};
const fixedPoint = (sketch: CadSketch, id: string) => ({
  ...sketch,
  entities: sketch.entities.map(e => (e.id === id && e.type === 'point' ? { ...e, fixed: true } : e)),
});

describe('native circular dimension pairs', () => {
  it.each(['circle', 'arc'] as const)('measures and edits the near %s rim from a point on either side of the support', async kind => {
    for (const side of ['inside', 'outside'] as const) {
      const fixture = circular(createCadPart().sketch, kind, 40, 40, 10);
      let sketch = fixedPoint(fixture.sketch, fixture.curve.centerId);
      sketch = addPoint(sketch, { x: 40, y: side === 'inside' ? 45 : 55 });
      const point = sketch.entities.at(-1)!;
      sketch = addConstraint(sketch, { type: 'positionX', pointId: point.id, value: 40 });
      const dimension = proposal(sketch, [point.id, fixture.curve.id]);
      expect(dimension).toMatchObject({ type: 'pointArcDistance', side, radiusSide: 'near', value: 5 });
      expect(proposal(sketch, [fixture.curve.id, point.id])).toEqual(dimension);
      const input = documentOf(addConstraint(sketch, dimension)),
        id = input.parts[0]!.sketch.constraints.at(-1)!.id;
      const solved = await solveCadDocument(updateDimension(input, id, 8));
      expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
      const output = solved.document.parts[0]!.sketch;
      expect(mapPoints(output).get(point.id)!.y).toBeCloseTo(side === 'inside' ? 42 : 58, 6);
      expect((output.entities.find(e => e.id === fixture.curve.id) as typeof fixture.curve).radius).toBeCloseTo(10, 7);
      expect(
        dimensionWitnessPoints(output, output.constraints.at(-1)! as CadDimension)!.reduce(
          (length, p, i, all) => (i ? Math.hypot(p.x - all[0]!.x, p.y - all[0]!.y) : length),
          0
        )
      ).toBeCloseTo(8, 6);
      expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
      expect(removeEntity(output, fixture.curve.id).constraints.some(c => c.id === id)).toBe(false);
    }
  });

  it('keeps a far-side point/arc witness selected instead of changing it to the nearest rim', async () => {
    const fixture = circular(createCadPart().sketch, 'arc', 40, 40, 10);
    let sketch = fixedPoint(fixture.sketch, fixture.curve.centerId);
    sketch = addPoint(sketch, { x: 40, y: 55 });
    const point = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, { type: 'positionX', pointId: point.id, value: 40 });
    const dimension = proposal(sketch, [point.id, fixture.curve.id], { picks: { [fixture.curve.id]: { x: 40, y: 30 } } });
    expect(dimension).toMatchObject({ type: 'pointArcDistance', radiusSide: 'far', value: 25 });
    const input = documentOf(addConstraint(sketch, dimension)),
      id = input.parts[0]!.sketch.constraints.at(-1)!.id;
    const solved = await solveCadDocument(updateDimension(input, id, 28));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(mapPoints(solved.document.parts[0]!.sketch).get(point.id)!.y).toBeCloseTo(58, 6);
  });

  it.each(['circle', 'arc'] as const)('edits a line/%s surface gap without constraining the center distance as the gap', async kind => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 20, x2: 60, y2: 20 });
    const line = sketch.entities.at(-1)!;
    sketch = { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e)) };
    const fixture = circular(sketch, kind, 30, 45, 10);
    sketch = addConstraint(fixture.sketch, { type: 'positionX', pointId: fixture.curve.centerId, value: 30 });
    const dimension = proposal(sketch, [line.id, fixture.curve.id]);
    expect(dimension).toMatchObject({ type: 'lineCircleDistance', side: 'outside', value: 15 });
    const input = documentOf(addConstraint(sketch, dimension)),
      id = input.parts[0]!.sketch.constraints.at(-1)!.id;
    const solved = await solveCadDocument(updateDimension(input, id, 22));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(mapPoints(solved.document.parts[0]!.sketch).get(fixture.curve.centerId)!.y).toBeCloseTo(52, 6);
  });

  it.each([
    [10, 25, -1, -1, 15],
    [-10, 25, 1, -1, 35],
    [10, 35, -1, 1, 25],
    [-10, 35, 1, 1, 45],
  ] as const)('retains picked arc witnesses %s/%s and edits D%sr1%sr2', async (pickA, pickB, radiusASign, radiusBSign, value) => {
    const first = circular(createCadPart().sketch, 'arc', 0, 20, 10);
    const second = circular(fixedPoint(first.sketch, first.curve.centerId), 'arc', 30, 20, 5);
    const sketch = addConstraint(second.sketch, { type: 'positionY', pointId: second.curve.centerId, value: 20 });
    const dimension = proposal(sketch, [first.curve.id, second.curve.id], {
      picks: { [first.curve.id]: { x: pickA, y: 20 }, [second.curve.id]: { x: pickB, y: 20 } },
    });
    expect(dimension).toMatchObject({ type: 'circleCircleDistance', radiusASign, radiusBSign, direction: 1, value });
    const input = documentOf(addConstraint(sketch, dimension)),
      id = input.parts[0]!.sketch.constraints.at(-1)!.id;
    const solved = await solveCadDocument(updateDimension(input, id, value + 5));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    const output = solved.document.parts[0]!.sketch;
    expect(mapPoints(output).get(second.curve.centerId)!.x).toBeCloseTo(35, 6);
    expect((output.entities.find(e => e.id === first.curve.id) as typeof first.curve).radius).toBeCloseTo(10, 7);
    expect((output.entities.find(e => e.id === second.curve.id) as typeof second.curve).radius).toBeCloseTo(5, 7);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  });

  it.each([
    ['circle', 'circle'],
    ['arc', 'circle'],
    ['circle', 'arc'],
  ] as const)('solves mixed circular support types %s/%s using their own radius parameters', async (kindA, kindB) => {
    const first = circular(createCadPart().sketch, kindA, 0, 20, 10);
    const second = circular(fixedPoint(first.sketch, first.curve.centerId), kindB, 30, 20, 5);
    const sketch = addConstraint(second.sketch, { type: 'positionY', pointId: second.curve.centerId, value: 20 });
    const input = documentOf(addConstraint(sketch, proposal(sketch, [first.curve.id, second.curve.id]))),
      id = input.parts[0]!.sketch.constraints.at(-1)!.id;
    const solved = await solveCadDocument(updateDimension(input, id, 20));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(mapPoints(solved.document.parts[0]!.sketch).get(second.curve.centerId)!.x).toBeCloseTo(35, 6);
  });

  it.each([
    ['near', 25, 8, 22],
    ['far', 45, 40, 50],
  ] as const)('preserves a line/arc %s witness and its signed radial branch', async (radiusSide, centerY, value, expectedY) => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 20, x2: 60, y2: 20 });
    const line = sketch.entities.at(-1)!;
    sketch = { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e)) };
    const fixture = circular(sketch, 'arc', 30, centerY, 10);
    sketch = addConstraint(fixture.sketch, { type: 'positionX', pointId: fixture.curve.centerId, value: 30 });
    const dimension = proposal(sketch, [line.id, fixture.curve.id], {
      picks: { [fixture.curve.id]: { x: 30, y: centerY + (radiusSide === 'far' ? 10 : -10) } },
    });
    expect(dimension).toMatchObject({ type: 'lineCircleDistance', radiusSide });
    const input = documentOf(addConstraint(sketch, dimension)),
      id = input.parts[0]!.sketch.constraints.at(-1)!.id;
    const solved = await solveCadDocument(updateDimension(input, id, value));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(mapPoints(solved.document.parts[0]!.sketch).get(fixture.curve.centerId)!.y).toBeCloseTo(expectedY, 6);
  });

  it('reports a real impossible inside gap instead of silently moving the point outside the circle', async () => {
    const fixture = circular(createCadPart().sketch, 'circle', 40, 40, 10);
    let sketch = fixedPoint(fixture.sketch, fixture.curve.centerId);
    sketch = addPoint(sketch, { x: 40, y: 45 });
    const point = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, { type: 'positionX', pointId: point.id, value: 40 });
    const input = documentOf(addConstraint(sketch, proposal(sketch, [point.id, fixture.curve.id]))),
      id = input.parts[0]!.sketch.constraints.at(-1)!.id;
    const impossible = updateDimension(input, id, 12),
      solved = await solveCadDocument(impossible);
    expect(solved.sketches[0]!.status).not.toBe('solved');
    expect(solved.document.parts[0]!.sketch).toEqual(impossible.parts[0]!.sketch);
  });
});

describe('dimension placement and angular branch persistence', () => {
  it('chooses horizontal, vertical, or aligned point distance at placement, with positive default axis values', () => {
    let sketch = addPoint(createCadPart().sketch, { x: 45, y: -35 });
    const a = sketch.entities.at(-1)!.id;
    sketch = addPoint(sketch, { x: 52, y: -41 });
    const b = sketch.entities.at(-1)!.id;
    expect(proposal(sketch, [a, b], { placement: { x: 48.5, y: -32 } })).toMatchObject({ type: 'distanceX', value: 7 });
    expect(proposal(sketch, [a, b], { placement: { x: 40, y: -38 } })).toMatchObject({
      type: 'distanceY',
      pointAId: b,
      pointBId: a,
      value: 6,
    });
    expect(proposal(sketch, [a, b], { placement: { x: 60, y: -30 } })).toMatchObject({ type: 'distance', value: Math.hypot(7, 6) });
  });

  it.each([
    [8, 2, false],
    [-8, 2, true],
    [-8, -2, false],
    [8, -2, true],
  ] as const)('persists the selected angular quadrant %s,%s through value editing', async (x, y, obtuse) => {
    let sketch = addLine(createCadPart().sketch, { x1: -14, y1: 0, x2: 0, y2: 0 });
    const first = sketch.entities.at(-1)!;
    sketch = { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e)) };
    sketch = addLine(sketch, { x1: 0, y1: 0, x2: 10, y2: 5 });
    const second = sketch.entities.at(-1)!;
    if (second.type !== 'line') throw Error();
    sketch = addConstraint(sketch, { type: 'distance', pointAId: second.startId, pointBId: second.endId, value: Math.hypot(10, 5) });
    const picks = { [first.id]: { x: -7, y: 0 }, [second.id]: { x: 5, y: 2.5 } };
    const initial = proposal(sketch, [first.id, second.id], { picks });
    expect(initial.value).toBeCloseTo(153.434948822922, 7);
    const dimension = proposal(sketch, [first.id, second.id], { picks, placement: { x, y } });
    expect(dimension.value).toBeCloseTo(obtuse ? 153.434948822922 : 26.565051177078, 7);
    if (dimension.type !== 'angle') throw Error();
    const witness = dimensionAngleWitness(sketch, dimension)!;
    expect((Math.abs(witness.sweep) * 180) / Math.PI).toBeCloseTo(dimension.value, 8);
    const input = documentOf(addConstraint(sketch, dimension)),
      id = input.parts[0]!.sketch.constraints.at(-1)!.id;
    const solved = await solveCadDocument(updateDimension(input, id, obtuse ? 135 : 45));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    const end = mapPoints(solved.document.parts[0]!.sketch).get(second.endId)!;
    expect(end.x).toBeCloseTo(Math.hypot(10, 5) / Math.sqrt(2), 6);
    expect(end.y).toBeCloseTo(end.x, 6);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  });

  it('shares numeric-domain validation between the editor and portable source', () => {
    for (const type of [
      'pointLineDistance',
      'lineLineDistance',
      'pointArcDistance',
      'lineCircleDistance',
      'circleCircleDistance',
    ] as const) {
      expect(dimensionValueError({ type }, 0)).toBeNull();
      expect(dimensionValueError({ type }, -1)).toBeTruthy();
    }
    for (const type of ['distanceX', 'distanceY', 'positionX', 'positionY', 'angle'] as const)
      expect(dimensionValueError({ type }, -25)).toBeNull();
    for (const type of ['distance', 'radius', 'diameter'] as const) expect(dimensionValueError({ type }, 0)).toBeTruthy();
    expect(dimensionValueError({ type: 'angle' }, NaN)).toBeTruthy();
  });
});
