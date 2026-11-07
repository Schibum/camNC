import { describe, expect, it } from 'vitest';
import {
  addCenterRectangle,
  addConstraint,
  addPoint,
  addRectangle,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  originId,
  parseCadDocument,
  removeConstraint,
  solveCadDocument,
} from './index';
import type { CadConstraint, CadLineEntity, CadPointEntity, CadSketch } from './types';

const documentOf = (sketch: CadSketch) => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });
const edgesOf = (sketch: CadSketch) =>
  sketch.entities.filter((entity): entity is CadLineEntity => entity.type === 'line' && !entity.construction);
const joinsOf = (sketch: CadSketch) =>
  sketch.constraints.filter((constraint): constraint is Extract<CadConstraint, { type: 'coincident' }> => constraint.type === 'coincident');
const point = (sketch: CadSketch, id: string) =>
  sketch.entities.find((entity): entity is CadPointEntity => entity.type === 'point' && entity.id === id)!;

describe('rectangle creation uses explicit corner topology', () => {
  it('creates eight independent edge endpoints and four joins without implicitly anchoring to the origin', async () => {
    const sketch = addRectangle(createCadPart().sketch, { x: 0, y: 0, width: 40, height: 30 });
    const edges = edgesOf(sketch);
    expect(new Set(edges.flatMap(edge => [edge.startId, edge.endId])).size).toBe(8);
    expect(joinsOf(sketch)).toHaveLength(4);
    expect(edges.some(edge => [edge.startId, edge.endId].includes(originId(sketch)))).toBe(false);
    expect(joinsOf(sketch).some(join => [join.pointAId, join.pointBId].includes(originId(sketch)))).toBe(false);
    const result = await solveCadDocument(documentOf(sketch));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(4);
  });

  it('never silently joins fixed external points at matching corner coordinates', async () => {
    let sketch = createCadPart().sketch;
    for (const [x, y] of [
      [20, 10],
      [60, 10],
      [60, 40],
      [20, 40],
    ])
      sketch = addPoint(sketch, { x: x!, y: y!, fixed: true });
    const existing = new Set(sketch.entities.map(entity => entity.id));
    const before = structuredClone(sketch);
    sketch = addRectangle(sketch, { x: 20, y: 10, width: 40, height: 30 });
    expect(joinsOf(sketch)).toHaveLength(4);
    expect(
      edgesOf(sketch)
        .flatMap(edge => [edge.startId, edge.endId])
        .some(id => existing.has(id))
    ).toBe(false);
    expect(joinsOf(sketch).some(join => existing.has(join.pointAId) || existing.has(join.pointBId))).toBe(false);
    expect(sketch.entities.filter(entity => existing.has(entity.id))).toEqual(before.entities);
    const result = await solveCadDocument(documentOf(sketch));
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(4);
  });

  it('keeps size dimension operands owned by their actual edge and serializes the joins', async () => {
    const sketch = addRectangle(createCadPart().sketch, { x: 20, y: 10, width: 40, height: 30, dimensioned: true, positioned: true });
    const [bottom, right] = edgesOf(sketch);
    expect(sketch.constraints.find(constraint => constraint.label === 'Width')).toMatchObject({
      pointAId: bottom!.startId,
      pointBId: bottom!.endId,
      sourceEntityId: bottom!.id,
    });
    expect(sketch.constraints.find(constraint => constraint.label === 'Height')).toMatchObject({
      pointAId: right!.startId,
      pointBId: right!.endId,
      sourceEntityId: right!.id,
    });
    const result = await solveCadDocument(documentOf(sketch));
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(0);
    expect(parseCadDocument(JSON.parse(JSON.stringify(result.document)))).toEqual(result.document);
  });

  it('deliberately joins the plate fixture to its origin without sharing an edge endpoint ID', async () => {
    const document = createPlateDocument({ width: 40, height: 30 });
    const sketch = document.parts[0]!.sketch;
    const bottom = edgesOf(sketch)[0]!;
    expect(bottom.startId).not.toBe(originId(sketch));
    expect(joinsOf(sketch)).toHaveLength(5);
    expect(joinsOf(sketch)).toContainEqual(expect.objectContaining({ pointAId: bottom.startId, pointBId: originId(sketch) }));
    const result = await solveCadDocument(document);
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(0);
  });

  it.each([
    { dimensioned: false, positioned: false, dof: 4 },
    { dimensioned: true, positioned: false, dof: 2 },
    { dimensioned: true, positioned: true, dof: 0 },
  ])('keeps an origin-centered rectangle independent until explicit intent is supplied: %j', async ({ dimensioned, positioned, dof }) => {
    const sketch = addCenterRectangle(createCadPart().sketch, { x: 0, y: 0, width: 40, height: 30, dimensioned, positioned });
    const midpoint = sketch.constraints.find(constraint => constraint.type === 'midpoint')!;
    if (midpoint.type !== 'midpoint') throw Error('Missing center relation');
    expect(midpoint.pointId).not.toBe(originId(sketch));
    expect(joinsOf(sketch)).toHaveLength(4);
    expect(new Set(edgesOf(sketch).flatMap(edge => [edge.startId, edge.endId])).size).toBe(8);
    const result = await solveCadDocument(documentOf(sketch));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(dof);
    expect(point(result.document.parts[0]!.sketch, midpoint.pointId)).toMatchObject({ x: 0, y: 0 });
  });

  it('attaches an independently created center only through an explicit external coincidence', async () => {
    let sketch = addPoint(createCadPart().sketch, { x: 25, y: 30, fixed: true });
    const externalId = sketch.entities.at(-1)!.id;
    sketch = addCenterRectangle(sketch, { x: 25, y: 30, width: 40, height: 20 });
    const midpoint = sketch.constraints.find(constraint => constraint.type === 'midpoint')!;
    if (midpoint.type !== 'midpoint') throw Error('Missing center relation');
    expect(midpoint.pointId).not.toBe(externalId);
    const free = await solveCadDocument(documentOf(sketch));
    expect(free.sketches[0]!.dof).toBe(4);
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: midpoint.pointId, pointBId: externalId });
    const anchored = await solveCadDocument(documentOf(sketch));
    expect(anchored.status).toBe('solved');
    expect(anchored.sketches[0]!.dof).toBe(2);
    expect(point(anchored.document.parts[0]!.sketch, midpoint.pointId)).toMatchObject({ x: 25, y: 30 });
    expect(point(anchored.document.parts[0]!.sketch, externalId)).toMatchObject({ x: 25, y: 30, fixed: true });
  });

  it('does not let construction diagonals secretly rejoin a deleted centered corner', async () => {
    let sketch = addCenterRectangle(createCadPart().sketch, { x: 0, y: 0, width: 40, height: 30, positioned: true });
    const edges = edgesOf(sketch);
    const incomingId = edges[1]!.endId,
      outgoingId = edges[2]!.startId;
    expect(incomingId).not.toBe(outgoingId);
    const join = joinsOf(sketch).find(
      constraint =>
        [constraint.pointAId, constraint.pointBId].includes(incomingId) && [constraint.pointAId, constraint.pointBId].includes(outgoingId)
    )!;
    expect(join).toBeDefined();
    sketch = removeConstraint(sketch, join.id);
    const result = await solveCadDocument(documentOf(sketch), {
      drag: [
        { pointId: incomingId, x: 35, y: 25 },
        { pointId: outgoingId, x: 20, y: 15 },
      ],
    });
    expect(result.sketches[0]!.status, JSON.stringify(result.diagnostics)).toBe('solved');
    const next = result.document.parts[0]!.sketch;
    expect(point(next, incomingId)).toMatchObject({ x: 35, y: 25 });
    expect(point(next, outgoingId)).toMatchObject({ x: 20, y: 15 });
    expect(next.entities.filter(entity => entity.type === 'line')).toHaveLength(6);
    expect(result.parts).toHaveLength(0);
  });
});
