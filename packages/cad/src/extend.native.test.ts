import { expect, it } from 'vitest';
import {
  addArc,
  addBezier,
  addConstraint,
  addLine,
  addPoint,
  createCadDocument,
  createCadPart,
  newCadId,
  parseCadDocument,
} from './document';
import { extendSketchCurve, type CadExtendOptions } from './extend';
import { evaluateCadDocument, polygonArea, validateCadDocument } from './geometry';
import { solveCadDocument } from './solver';
import type { CadArcEntity, CadDocument, CadLineEntity, CadPointEntity, CadSketch } from './types';
const point = (sketch: CadSketch, id: string) =>
  sketch.entities.find((entity): entity is CadPointEntity => entity.id === id && entity.type === 'point')!;
const lines = (sketch: CadSketch) => sketch.entities.filter((entity): entity is CadLineEntity => entity.type === 'line');
function document(sketch: CadSketch): CadDocument {
  return { ...createCadDocument('Extended'), parts: [{ ...createCadPart(), sketch }] };
}
function apply(sketch: CadSketch, options: CadExtendOptions) {
  const result = extendSketchCurve(sketch, options);
  if (!result.ok) throw new Error(result.message);
  expect(validateCadDocument(document(result.sketch))).toEqual([]);
  return result;
}
async function solve(sketch: CadSketch) {
  const solved = await solveCadDocument(document(sketch));
  expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  return solved;
}

it('keeps an ordinary extension attached while its explicitly picked construction guide moves', async () => {
  let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 10, y2: 0 });
  sketch = addLine(sketch, { x1: 20, y1: -5, x2: 20, y2: 5, construction: true });
  const [source, guide] = lines(sketch);
  sketch = addConstraint(sketch, { type: 'horizontal', entityId: source!.id });
  for (const id of [guide!.startId, guide!.endId]) point(sketch, id).fixed = true;
  const changed = apply(sketch, { entityId: source!.id, end: 'end', target: { x: 20, y: 3 }, boundaryId: guide!.id });
  expect(changed.boundaryId).toBe(guide!.id);
  expect(changed.sketch.constraints).toContainEqual(
    expect.objectContaining({ type: 'pointOnLine', pointId: changed.pointId, entityId: guide!.id })
  );
  const before = await solve(changed.sketch);
  const moved = structuredClone(before.document.parts[0]!.sketch);
  for (const id of [guide!.startId, guide!.endId]) point(moved, id).x = 30;
  const after = await solve(moved);
  expect(point(after.document.parts[0]!.sketch, changed.pointId!)).toMatchObject({ x: expect.closeTo(30, 7), y: expect.closeTo(0, 7) });
  expect(point(after.document.parts[0]!.sketch, source!.startId)).toMatchObject({ x: 0, y: 0 });
});

it('native solve preserves neighbors and the driving boundary contact after extending a dimensioned line', async () => {
  let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 10, y2: 0 });
  sketch = addLine(sketch, { x1: 20, y1: -5, x2: 20, y2: 5 });
  const [source, boundary] = lines(sketch);
  sketch = addConstraint(sketch, { type: 'horizontal', entityId: source!.id });
  sketch = addConstraint(sketch, {
    type: 'distance',
    pointAId: source!.startId,
    pointBId: source!.endId,
    sourceEntityId: source!.id,
    value: 10,
    label: 'Length',
  });
  for (const id of [boundary!.startId, boundary!.endId]) point(sketch, id).fixed = true;
  const changed = apply(sketch, { entityId: source!.id, end: 'end', target: { x: 25, y: 4 }, boundaryId: boundary!.id });
  const solved = await solve(changed.sketch);
  const current = solved.document.parts[0]!.sketch;
  expect(point(current, changed.pointId!)).toMatchObject({ x: 20, y: 0 });
  expect(point(current, boundary!.startId)).toMatchObject({ x: 20, y: -5 });
  expect(point(current, boundary!.endId)).toMatchObject({ x: 20, y: 5 });
  expect(current.constraints.some(constraint => 'sourceEntityId' in constraint && constraint.sourceEntityId === source!.id)).toBe(false);
  const movedBoundary = structuredClone(current);
  for (const id of [boundary!.startId, boundary!.endId]) point(movedBoundary, id).x = 24;
  const followed = await solve(movedBoundary);
  expect(point(followed.document.parts[0]!.sketch, changed.pointId!).x).toBeCloseTo(24, 7);
});

it('native solve retains tangent line/arc support while the old joined endpoint becomes interior', async () => {
  let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 10, y2: 0 });
  sketch = addArc(sketch, { cx: 10, cy: 10, radius: 10, startAngle: -Math.PI / 2, endAngle: 0 });
  const source = lines(sketch)[0]!,
    neighbor = sketch.entities.find((entity): entity is CadArcEntity => entity.type === 'arc')!;
  point(sketch, neighbor.centerId).fixed = true;
  sketch = addConstraint(sketch, { type: 'horizontal', entityId: source.id });
  sketch = addConstraint(sketch, { type: 'tangent', entityAId: source.id, entityBId: neighbor.id });
  sketch = addConstraint(sketch, { type: 'radius', entityId: neighbor.id, value: 10 });
  const before = structuredClone(sketch);
  const changed = apply(sketch, { entityId: source.id, end: 'end', target: { x: 25, y: 0 } });
  const solved = await solve(changed.sketch);
  const current = solved.document.parts[0]!.sketch;
  expect(point(current, changed.pointId!).x).toBeCloseTo(25, 7);
  for (const id of [neighbor.centerId, neighbor.startId, neighbor.endId]) {
    expect(point(current, id).x).toBeCloseTo(point(before, id).x, 7);
    expect(point(current, id).y).toBeCloseTo(point(before, id).y, 7);
  }
  expect(current.constraints).toContainEqual(expect.objectContaining({ type: 'tangent', entityAId: source.id, entityBId: neighbor.id }));
});

it('native solve preserves transitive coincidence aliases when detaching a shared junction', async () => {
  let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 10, y2: 0 });
  const source = lines(sketch)[0]!;
  const alias = { id: newCadId(), type: 'point' as const, x: 10, y: 0 };
  const far = { id: newCadId(), type: 'point' as const, x: 10, y: 10, fixed: true };
  const neighbor = { id: newCadId(), type: 'line' as const, startId: alias.id, endId: far.id };
  sketch = { ...sketch, entities: [...sketch.entities, alias, far, neighbor] };
  point(sketch, source.endId).fixed = true;
  sketch = addConstraint(sketch, { type: 'coincident', pointAId: source.endId, pointBId: alias.id });
  sketch = addConstraint(sketch, { type: 'horizontal', entityId: source.id });
  const changed = apply(sketch, { entityId: source.id, end: 'end', target: { x: 20, y: 0 } });
  const solved = await solve(changed.sketch);
  const current = solved.document.parts[0]!.sketch;
  expect(point(current, alias.id)).toMatchObject({ x: 10, y: 0 });
  expect(current.constraints).toContainEqual(expect.objectContaining({ type: 'coincident', pointAId: source.endId, pointBId: alias.id }));
  expect(current.constraints).toContainEqual(expect.objectContaining({ type: 'pointOnLine', pointId: source.endId, entityId: source.id }));
  expect(point(current, changed.pointId!)).toMatchObject({ x: 20, y: 0 });
});

it('native full-circle completion remains a closed exportable profile with radius and standalone point attachment', async () => {
  let sketch = addPoint(createCadPart().sketch, { x: 10, y: 0 });
  const explicit = sketch.entities.at(-1)!;
  sketch = addArc(sketch, { cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI });
  const source = sketch.entities.find((entity): entity is CadArcEntity => entity.type === 'arc')!;
  sketch = addConstraint(sketch, { type: 'radius', entityId: source.id, value: 10 });
  const changed = apply(sketch, { entityId: source.id, end: 'end', target: { x: 10, y: 0 } });
  expect(changed.kind).toBe('circle');
  expect(changed.sketch.entities).toContainEqual(explicit);
  expect(changed.sketch.constraints).toContainEqual(
    expect.objectContaining({ type: 'pointOnCircle', pointId: explicit.id, entityId: source.id })
  );
  const solved = await solve(changed.sketch);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.parts[0]!.loops[0]!.entityIds).toEqual([source.id]);
  expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
});

it('native extension closes a real four-edge gap into one machinable profile using the existing origin identity', async () => {
  let sketch = createCadPart().sketch;
  for (const [x1, y1, x2, y2] of [
    [0, 0, 20, 0],
    [20, 0, 20, 10],
    [20, 10, 0, 10],
    [0, 10, 0, 3],
  ])
    sketch = addLine(sketch, { x1: x1!, y1: y1!, x2: x2!, y2: y2! });
  const source = lines(sketch).at(-1)!;
  const changed = apply(sketch, { entityId: source.id, end: 'end', target: { x: 0, y: -5 } });
  const solved = await solve(changed.sketch);
  expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
  expect(solved.parts[0]!.loops[0]!.entityIds).toHaveLength(4);
  expect(Math.abs(polygonArea(solved.parts[0]!.outline))).toBeCloseTo(200, 7);
  expect(evaluateCadDocument(solved.document).diagnostics).toEqual([]);
});

it('native rational boundary contact persists on the true Bezier curve after extension', async () => {
  let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 10, y2: 0 });
  const source = lines(sketch)[0]!;
  sketch = addBezier(sketch, {
    points: [
      { x: 20, y: -5 },
      { x: 16, y: 0 },
      { x: 20, y: 5 },
    ],
  });
  const boundary = sketch.entities.find(entity => entity.type === 'bezier')!;
  if (boundary.type !== 'bezier') throw Error('Missing boundary');
  for (const id of boundary.controlPointIds) point(sketch, id).fixed = true;
  sketch = addConstraint(sketch, { type: 'horizontal', entityId: source.id });
  const changed = apply(sketch, { entityId: source.id, end: 'end', target: { x: 30, y: 0 } });
  expect(changed.sketch.constraints).toContainEqual(
    expect.objectContaining({ type: 'pointOnCurve', entityId: boundary.id, pointId: changed.pointId })
  );
  const solved = await solve(changed.sketch);
  const current = solved.document.parts[0]!.sketch;
  expect(point(current, changed.pointId!).x).toBeCloseTo(18, 6);
  expect(point(current, changed.pointId!).y).toBeCloseTo(0, 6);
  for (const id of boundary.controlPointIds) expect(point(current, id)).toEqual(point(sketch, id));
});
