import { describe, expect, it } from 'vitest';
import {
  addArc,
  addCircle,
  addConic,
  addLine,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  parseCadDocument,
  removeConstraint,
  solveCadDocument,
  updateDimension,
  validateCadDocument,
} from './index';
import { offsetSketch } from './offset';
import type { CadDocument, CadLineEntity, CadPointEntity, CadSketch } from './types';

const lines = (sketch: CadSketch) =>
  sketch.entities.filter((entity): entity is CadLineEntity => entity.type === 'line' && !entity.construction);
const point = (sketch: CadSketch, id: string) =>
  sketch.entities.find((entity): entity is CadPointEntity => entity.type === 'point' && entity.id === id)!;
function apply(sketch: CadSketch, entityIds: string[], value = 12, wholeLoop = false) {
  const result = offsetSketch(sketch, { entityIds, value, wholeLoop });
  if (!result.ok) throw new Error(result.message);
  return result;
}
function documentFor(sketch: CadSketch): CadDocument {
  const document = createCadDocument();
  document.parts.push({ ...createCadPart(), sketch });
  return document;
}
function bounds(sketch: CadSketch, ids: string[]) {
  const selected = sketch.entities.filter((entity): entity is CadLineEntity => entity.type === 'line' && ids.includes(entity.id));
  const points = selected.flatMap(line => [point(sketch, line.startId), point(sketch, line.endId)]);
  return {
    x0: Math.min(...points.map(p => p.x)),
    y0: Math.min(...points.map(p => p.y)),
    x1: Math.max(...points.map(p => p.x)),
    y1: Math.max(...points.map(p => p.y)),
  };
}
function fixPoints(sketch: CadSketch): CadSketch {
  return { ...sketch, entities: sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity)) };
}
function expectBounds(sketch: CadSketch, ids: string[], expected: ReturnType<typeof bounds>) {
  const actual = bounds(sketch, ids);
  for (const key of ['x0', 'y0', 'x1', 'y1'] as const) expect(actual[key]).toBeCloseTo(expected[key], 8);
}
async function solved(document: CadDocument) {
  const result = await solveCadDocument(document);
  expect(result.sketches[0]?.status, JSON.stringify(result.diagnostics)).toBe('solved');
  return result;
}

describe('linked Offset command', () => {
  it('offsets only one selected finite edge by default, without fixing or reusing its copied points', async () => {
    const source = createPlateDocument({ width: 120, height: 80 });
    const before = structuredClone(source);
    const edge = lines(source.parts[0]!.sketch)[0]!;
    const result = apply(source.parts[0]!.sketch, [edge.id], 5);
    expect(source).toEqual(before);
    expect(result.sourceIds).toEqual([edge.id]);
    expect(result.entityIds).toHaveLength(1);
    expect(bounds(result.sketch, result.entityIds)).toEqual({ x0: 0, y0: 5, x1: 120, y1: 5 });
    const copy = result.sketch.entities.find(entity => entity.id === result.entityIds[0]) as CadLineEntity;
    expect([copy.startId, copy.endId]).not.toContain(edge.startId);
    expect([copy.startId, copy.endId]).not.toContain(edge.endId);
    expect(point(result.sketch, copy.startId).fixed).toBeUndefined();
    expect(result.sketch.constraints.at(-1)).toMatchObject({
      type: 'offset',
      label: 'Offset',
      value: 5,
      members: [{ kind: 'line', sourceId: edge.id, targetId: copy.id, side: 1, endpoints: true }],
    });
    await solved({ ...source, parts: [{ ...source.parts[0]!, sketch: result.sketch }] });
  });

  it('copies a selected closed rectangle inward with one shared driver and preserves every source dimension', async () => {
    const document = createPlateDocument({ width: 120, height: 80 });
    const source = structuredClone(document.parts[0]!.sketch);
    const result = apply(
      source,
      lines(source).map(line => line.id)
    );
    expect(result.entityIds).toHaveLength(4);
    expect(bounds(result.sketch, result.entityIds)).toEqual({ x0: 12, y0: 12, x1: 108, y1: 68 });
    expect(result.sketch.constraints.slice(0, source.constraints.length)).toEqual(source.constraints);
    expect(result.sketch.entities.slice(0, source.entities.length)).toEqual(source.entities);
    expect(result.sketch.constraints.filter(constraint => constraint.type === 'offset')).toHaveLength(1);
    const added = result.sketch.entities.filter(entity => !source.entities.some(original => original.id === entity.id));
    expect(added.filter(entity => entity.type === 'point')).toHaveLength(4);
    document.parts[0]!.sketch = result.sketch;
    expect(validateCadDocument(document)).toEqual([]);
    const native = await solved(document);
    expect(native.status, JSON.stringify(native.diagnostics)).toBe('solved');
    expect(native.parts[0]!.holes).toHaveLength(1);
    expect(native.sketches[0]!.dof).toBe(0);
    expect(parseCadDocument(JSON.parse(JSON.stringify(native.document)))).toEqual(native.document);
  });

  it('edits the shared value, reverses its sign, and follows a later source Width edit natively', async () => {
    const document = createPlateDocument({ width: 120, height: 80 });
    const result = apply(
      document.parts[0]!.sketch,
      lines(document.parts[0]!.sketch).map(line => line.id)
    );
    document.parts[0]!.sketch = result.sketch;
    const initial = await solved(document);
    const inward = await solved(updateDimension(initial.document, result.dimensionId, 8));
    expectBounds(inward.document.parts[0]!.sketch, result.entityIds, { x0: 8, y0: 8, x1: 112, y1: 72 });
    const outward = await solved(updateDimension(inward.document, result.dimensionId, -12));
    expectBounds(outward.document.parts[0]!.sketch, result.entityIds, { x0: -12, y0: -12, x1: 132, y1: 92 });
    const width = outward.document.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    const resized = await solved(updateDimension(outward.document, width.id, 160));
    expectBounds(resized.document.parts[0]!.sketch, result.entityIds, { x0: -12, y0: -12, x1: 172, y1: 92 });
    expect(resized.sketches[0]!.dof).toBe(0);
    expect(resized.document.parts[0]!.sketch.constraints.find(constraint => constraint.id === result.dimensionId)).toMatchObject({
      value: -12,
    });
  });

  it('expands a connected loop only when wholeLoop is explicitly requested', () => {
    const sketch = createPlateDocument().parts[0]!.sketch;
    const id = lines(sketch)[0]!.id;
    expect(apply(sketch, [id], 5).sourceIds).toEqual([id]);
    expect(apply(sketch, [id], 5, true).sourceIds).toEqual(lines(sketch).map(line => line.id));
  });

  it('keeps a tilted finite copy endpoint-for-endpoint on its source-left normal', async () => {
    const sketch = fixPoints(addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 70, y2: 100 }));
    const result = apply(sketch, [lines(sketch)[0]!.id], 10);
    const copy = result.sketch.entities.find(entity => entity.id === result.entityIds[0]) as CadLineEntity;
    expect(point(result.sketch, copy.startId).x).toBeCloseTo(2, 10);
    expect(point(result.sketch, copy.startId).y).toBeCloseTo(26, 10);
    expect(point(result.sketch, copy.endId)).toMatchObject({ x: 62, y: 106 });
    const native = await solved(documentFor(result.sketch));
    expect(point(native.document.parts[0]!.sketch, copy.startId).x).toBeCloseTo(2, 8);
    expect(point(native.document.parts[0]!.sketch, copy.endId).y).toBeCloseTo(106, 8);
  });

  it('creates a concentric circle with a fresh free center and linked signed radius', async () => {
    const document = createCadDocument(),
      part = createCadPart();
    document.parts.push(part);
    part.sketch = addCircle(part.sketch, { x: 40, y: 50, radius: 20, dimensioned: true, positioned: true });
    const circle = part.sketch.entities.find(entity => entity.type === 'circle')!;
    if (circle.type !== 'circle') throw new Error('Expected source circle');
    const result = apply(part.sketch, [circle.id], 5);
    part.sketch = result.sketch;
    const target = part.sketch.entities.find(entity => entity.id === result.entityIds[0])!;
    if (target.type !== 'circle') throw new Error('Expected copied circle');
    expect(target.centerId).not.toBe(circle.centerId);
    expect(point(part.sketch, target.centerId).fixed).toBeUndefined();
    expect(target.radius).toBe(15);
    const native = await solved(document);
    expect(native.sketches[0]!.dof).toBe(0);
    const outward = await solved(updateDimension(native.document, result.dimensionId, -5));
    expect(outward.document.parts[0]!.sketch.entities.find(entity => entity.id === target.id)).toMatchObject({ radius: 25 });
    const diameter = outward.document.parts[0]!.sketch.constraints.find(constraint => constraint.type === 'diameter')!;
    const resized = await solved(updateDimension(outward.document, diameter.id, 60));
    expect(resized.document.parts[0]!.sketch.entities.find(entity => entity.id === target.id)).toMatchObject({ radius: 35 });
  });

  it('does not add freedom or fix the location of an otherwise free source circle', async () => {
    const sketch = addCircle(createCadPart().sketch, { x: 40, y: 50, radius: 20 });
    const before = await solved(documentFor(sketch));
    const circle = sketch.entities.find(entity => entity.type === 'circle')!;
    const result = apply(sketch, [circle.id], 5);
    const native = await solved(documentFor(result.sketch));
    expect(before.sketches[0]!.dof).toBe(3);
    expect(native.sketches[0]!.dof).toBe(before.sketches[0]!.dof);
    for (const entity of native.document.parts[0]!.sketch.entities)
      if (entity.type === 'point' && entity.id !== `${sketch.id}:origin`) expect(entity.fixed).not.toBe(true);
  });

  it('links an isolated arc radius and both endpoint directions without fixing its copied center', async () => {
    let sketch = addArc(createCadPart().sketch, { cx: 50, cy: 50, radius: 20, startAngle: 0, endAngle: Math.PI / 2 });
    sketch = fixPoints(sketch);
    const arc = sketch.entities.find(entity => entity.type === 'arc')!;
    const result = apply(sketch, [arc.id], 5);
    const target = result.sketch.entities.find(entity => entity.id === result.entityIds[0])!;
    if (target.type !== 'arc') throw new Error('Expected copied arc');
    expect(target).toMatchObject({ radius: 15, startAngle: 0, endAngle: Math.PI / 2 });
    expect(point(result.sketch, target.centerId).fixed).toBeUndefined();
    const native = await solved(documentFor(result.sketch));
    const outward = await solved(updateDimension(native.document, result.dimensionId, -5));
    const copy = outward.document.parts[0]!.sketch.entities.find(entity => entity.id === target.id)!;
    expect(copy).toMatchObject({ radius: 25 });
    if (copy.type !== 'arc') throw new Error('Missing copied arc');
    expect(point(outward.document.parts[0]!.sketch, copy.startId).x).toBeCloseTo(75, 7);
    expect(point(outward.document.parts[0]!.sketch, copy.endId).y).toBeCloseTo(75, 7);
  });

  it('offsets a closed line/arc capsule and keeps the shared tangent junctions closed after an edit', async () => {
    let sketch = createCadPart().sketch;
    sketch = addLine(sketch, { x1: 20, y1: 0, x2: 100, y2: 0 });
    sketch = addArc(sketch, { cx: 100, cy: 20, radius: 20, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
    sketch = addLine(sketch, { x1: 100, y1: 40, x2: 20, y2: 40 });
    sketch = addArc(sketch, { cx: 20, cy: 20, radius: 20, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5 });
    sketch = fixPoints(sketch);
    const ids = sketch.entities.filter(entity => entity.type !== 'point').map(entity => entity.id);
    const result = apply(sketch, ids, 5);
    const constraint = result.sketch.constraints.find(c => c.id === result.dimensionId)!;
    if (constraint.type !== 'offset') throw new Error('Missing offset');
    expect(constraint.members).toHaveLength(4);
    expect(constraint.members.filter(member => member.kind === 'arc').every(member => 'endpoints' in member && !member.endpoints)).toBe(
      true
    );
    const native = await solved(documentFor(result.sketch));
    expect(native.status, JSON.stringify(native.diagnostics)).toBe('solved');
    const edited = await solved(updateDimension(native.document, result.dimensionId, 8));
    expect(edited.status, JSON.stringify(edited.diagnostics)).toBe('solved');
    expect(
      edited.document.parts[0]!.sketch.entities.filter(entity => entity.type === 'arc' && result.entityIds.includes(entity.id)).every(
        arc => arc.type === 'arc' && Math.abs(arc.radius - 12) < 1e-6
      )
    ).toBe(true);
  });

  it('follows explicit tangent capsule radius and length edits without fixing its free source placement', async () => {
    let sketch = createCadPart().sketch;
    sketch = addLine(sketch, { x1: 20, y1: 0, x2: 100, y2: 0 });
    sketch = addArc(sketch, { cx: 100, cy: 20, radius: 20, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
    sketch = addLine(sketch, { x1: 100, y1: 40, x2: 20, y2: 40 });
    sketch = addArc(sketch, { cx: 20, cy: 20, radius: 20, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5 });
    const edges = sketch.entities.filter(entity => entity.type !== 'point');
    const [bottom, right, top, left] = edges;
    if (bottom?.type !== 'line' || right?.type !== 'arc' || top?.type !== 'line' || left?.type !== 'arc')
      throw new Error('Invalid capsule fixture');
    sketch.constraints.push(
      { id: 'bottom-horizontal', type: 'horizontal', entityId: bottom.id },
      { id: 'caps-equal', type: 'equal', entityAId: right.id, entityBId: left.id },
      { id: 'source-radius', type: 'radius', entityId: right.id, value: 20 },
      { id: 'source-length', type: 'distance', pointAId: bottom.startId, pointBId: bottom.endId, sourceEntityId: bottom.id, value: 80 },
      ...[
        [bottom, right],
        [top, right],
        [top, left],
        [bottom, left],
      ].map(([a, b], index) => ({ id: `source-tangent-${index}`, type: 'tangent' as const, entityAId: a!.id, entityBId: b!.id }))
    );
    const initial = await solved(documentFor(sketch));
    const sourceIds = initial.document.parts[0]!.sketch.constraints.map(constraint => constraint.id);
    const result = apply(
      initial.document.parts[0]!.sketch,
      edges.map(edge => edge.id),
      5
    );
    const native = await solved({ ...initial.document, parts: [{ ...initial.document.parts[0]!, sketch: result.sketch }] });
    expect(native.sketches[0]!.dof).toBe(initial.sketches[0]!.dof);
    expect(native.sketches[0]!.dof).toBe(2);
    const radius = await solved(updateDimension(native.document, 'source-radius', 25));
    const length = await solved(updateDimension(radius.document, 'source-length', 100));
    const offset = await solved(updateDimension(length.document, result.dimensionId, 8));
    expect(offset.status, JSON.stringify(offset.diagnostics)).toBe('solved');
    expect(offset.sketches[0]!.dof).toBe(2);
    const source = offset.document.parts[0]!.sketch;
    expect(source.constraints.filter(constraint => constraint.id !== result.dimensionId).map(constraint => constraint.id)).toEqual(
      sourceIds
    );
    for (const entity of source.entities) {
      if (entity.type === 'arc' && result.entityIds.includes(entity.id)) expect(entity.radius).toBeCloseTo(17, 7);
      if (entity.type === 'point' && entity.id !== `${sketch.id}:origin`) expect(entity.fixed).not.toBe(true);
    }
  });

  it('allows non-tangent line/arc miter intersections without incorrectly retaining the old arc endpoint angles', async () => {
    let sketch = createCadPart().sketch;
    sketch = addLine(sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    sketch = addArc(sketch, { cx: 100, cy: 40, radius: 40, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
    sketch = addLine(sketch, { x1: 100, y1: 80, x2: 0, y2: 40 });
    sketch = addLine(sketch, { x1: 0, y1: 40, x2: 0, y2: 0 });
    sketch = fixPoints(sketch);
    const result = apply(
      sketch,
      sketch.entities.filter(entity => entity.type !== 'point').map(entity => entity.id),
      5
    );
    const arc = result.sketch.entities.find(entity => entity.type === 'arc' && result.entityIds.includes(entity.id))!;
    if (arc.type !== 'arc') throw new Error('Missing target arc');
    expect(Math.abs(arc.endAngle - Math.PI / 2)).toBeGreaterThan(0.01);
    const native = await solved(documentFor(result.sketch));
    expect(native.status, JSON.stringify(native.diagnostics)).toBe('solved');
    expect(native.sketches[0]!.dof).toBe(0);
  });

  it('uses transitive coincident endpoint identities without merging or replacing source references', async () => {
    const document = createPlateDocument({ width: 120, height: 80 });
    const sketch = document.parts[0]!.sketch;
    const edge = lines(sketch)[1]!;
    const original = point(sketch, edge.startId);
    const aliasA = { ...original, id: 'offset-alias-a', fixed: false },
      aliasB = { ...original, id: 'offset-alias-b', fixed: false };
    sketch.entities.push(aliasA, aliasB);
    sketch.entities = sketch.entities.map(entity => (entity.id === edge.id ? { ...edge, startId: aliasB.id } : entity));
    sketch.constraints = sketch.constraints.map(constraint =>
      constraint.type === 'distanceY' && constraint.sourceEntityId === edge.id ? { ...constraint, pointAId: aliasB.id } : constraint
    );
    sketch.constraints.push(
      { id: 'coincident-a', type: 'coincident', pointAId: original.id, pointBId: aliasA.id },
      { id: 'coincident-b', type: 'coincident', pointAId: aliasA.id, pointBId: aliasB.id }
    );
    const before = structuredClone(sketch);
    const result = apply(
      sketch,
      lines(sketch).map(line => line.id)
    );
    expect(sketch).toEqual(before);
    expect(result.sketch.entities.slice(0, sketch.entities.length)).toEqual(sketch.entities);
    document.parts[0]!.sketch = result.sketch;
    const native = await solved(document);
    expect(native.status, JSON.stringify(native.diagnostics)).toBe('solved');
    expectBounds(native.document.parts[0]!.sketch, result.entityIds, { x0: 12, y0: 12, x1: 108, y1: 68 });
  });

  it('releases all copy equations when its single group dimension is deleted', async () => {
    const document = createPlateDocument();
    const result = apply(
      document.parts[0]!.sketch,
      lines(document.parts[0]!.sketch).map(line => line.id)
    );
    document.parts[0]!.sketch = result.sketch;
    const native = await solved(document);
    expect(native.sketches[0]!.dof).toBe(0);
    const detached = removeConstraint(native.document.parts[0]!.sketch, result.dimensionId);
    const released = await solved({ ...native.document, parts: [{ ...native.document.parts[0]!, sketch: detached }] });
    expect(released.sketches[0]!.dof).toBe(8);
    expect(released.document.parts[0]!.sketch.entities.filter(entity => result.entityIds.includes(entity.id))).toHaveLength(4);
  });

  it('keeps inward semantics when source edge directions are reversed', async () => {
    const document = createPlateDocument({ width: 120, height: 80 });
    const sketch = document.parts[0]!.sketch;
    sketch.entities = sketch.entities.map(entity =>
      entity.type === 'line' ? { ...entity, startId: entity.endId, endId: entity.startId } : entity
    );
    const result = apply(
      sketch,
      lines(sketch).map(line => line.id),
      5
    );
    expectBounds(result.sketch, result.entityIds, { x0: 5, y0: 5, x1: 115, y1: 75 });
    document.parts[0]!.sketch = result.sketch;
    const native = await solved(document);
    expect(native.sketches[0]!.dof).toBe(0);
  });

  it.each([
    [Math.PI / 3, 1],
    [-Math.PI / 2, -1],
  ])('offsets a rotated/reflected closed triangle without a global-axis assumption (%s,%s)', async (rotation, reflection) => {
    let sketch = createCadPart().sketch;
    const source = [
      [0, 0],
      [100, 0],
      [30, 80],
      [0, 0],
    ];
    const transform = ([x, y]: number[]) => ({
      x: x! * Math.cos(rotation!) - y! * reflection! * Math.sin(rotation!),
      y: x! * Math.sin(rotation!) + y! * reflection! * Math.cos(rotation!),
    });
    for (let i = 0; i < source.length - 1; i++) {
      const a = transform(source[i]!),
        b = transform(source[i + 1]!);
      sketch = addLine(sketch, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    sketch = fixPoints(sketch);
    const result = apply(
      sketch,
      lines(sketch).map(line => line.id),
      4
    );
    const native = await solved(documentFor(result.sketch));
    expect(native.status, JSON.stringify(native.diagnostics)).toBe('solved');
    expect(native.sketches[0]!.dof).toBe(0);
  });

  it('offsets a concave closed loop without reversing its narrow leg', async () => {
    let sketch = createCadPart().sketch;
    const vertices = [
      [0, 0],
      [100, 0],
      [100, 100],
      [60, 100],
      [60, 40],
      [0, 40],
      [0, 0],
    ];
    for (let i = 0; i < vertices.length - 1; i++) {
      const a = vertices[i]!,
        b = vertices[i + 1]!;
      sketch = addLine(sketch, { x1: a[0]!, y1: a[1]!, x2: b[0]!, y2: b[1]! });
    }
    sketch = fixPoints(sketch);
    const result = apply(
      sketch,
      lines(sketch).map(line => line.id),
      5
    );
    expectBounds(result.sketch, result.entityIds, { x0: 5, y0: 5, x1: 95, y1: 95 });
    const native = await solved(documentFor(result.sketch));
    expect(native.status, JSON.stringify(native.diagnostics)).toBe('solved');
    expect(native.sketches[0]!.dof).toBe(0);
    expect(offsetSketch(sketch, { entityIds: lines(sketch).map(line => line.id), value: 20 }).ok).toBe(false);
  });

  it('rejects an entire mixed selection when one circle would collapse, without partially adding the other copy', () => {
    let sketch = createCadPart().sketch;
    sketch = addCircle(sketch, { x: 0, y: 0, radius: 30 });
    sketch = addCircle(sketch, { x: 100, y: 0, radius: 5 });
    const before = structuredClone(sketch);
    const result = offsetSketch(sketch, {
      entityIds: sketch.entities.filter(entity => entity.type === 'circle').map(entity => entity.id),
      value: 10,
    });
    expect(result.ok).toBe(false);
    expect(sketch).toEqual(before);
  });

  it('refuses invalid source coordinates and an explicitly requested branched loop', () => {
    let sketch = createPlateDocument().parts[0]!.sketch;
    const first = lines(sketch)[0]!;
    const malformed = {
      ...sketch,
      entities: sketch.entities.map(entity =>
        entity.id === first.endId && entity.type === 'point' ? { ...entity, x: Number.NaN } : entity
      ),
    };
    const before = structuredClone(malformed);
    expect(offsetSketch(malformed, { entityIds: [first.id], value: 5 }).ok).toBe(false);
    expect(malformed).toEqual(before);
    sketch = addLine(sketch, { x1: 0, y1: 0, x2: -20, y2: -20 });
    expect(offsetSketch(sketch, { entityIds: [first.id], value: 5, wholeLoop: true }).ok).toBe(false);
    expect(offsetSketch(sketch, { entityIds: [first.id], value: 5 }).ok).toBe(true);
  });

  it.each([40, 50, 70])('rejects a collapsed or reversed rectangle at offset %s atomically', value => {
    const sketch = createPlateDocument({ width: 120, height: 80 }).parts[0]!.sketch;
    const before = structuredClone(sketch);
    const result = offsetSketch(sketch, { entityIds: lines(sketch).map(line => line.id), value });
    expect(result.ok).toBe(false);
    expect(sketch).toEqual(before);
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid distance %s without modifying source', value => {
    const sketch = createPlateDocument().parts[0]!.sketch;
    const before = structuredClone(sketch);
    expect(offsetSketch(sketch, { entityIds: [lines(sketch)[0]!.id], value }).ok).toBe(false);
    expect(sketch).toEqual(before);
  });

  it('rejects an oversized circular radius and an unsupported or partial connected selection', () => {
    let sketch = addCircle(createCadPart().sketch, { x: 40, y: 50, radius: 20 });
    const circle = sketch.entities.find(entity => entity.type === 'circle')!;
    const before = structuredClone(sketch);
    expect(offsetSketch(sketch, { entityIds: [circle.id], value: 20 }).ok).toBe(false);
    expect(sketch).toEqual(before);
    sketch = addConic(sketch, { start: { x: 0, y: 0 }, end: { x: 60, y: 0 }, control: { x: 30, y: 40 } });
    expect(offsetSketch(sketch, { entityIds: [sketch.entities.at(-1)!.id], value: 5 }).ok).toBe(false);
    const rectangle = createPlateDocument().parts[0]!.sketch;
    expect(
      offsetSketch(rectangle, {
        entityIds: lines(rectangle)
          .slice(0, 2)
          .map(line => line.id),
        value: 5,
      }).ok
    ).toBe(false);
    expect(offsetSketch(rectangle, { entityIds: ['missing'], value: 5 }).ok).toBe(false);
    expect(offsetSketch(rectangle, { entityIds: [], value: 5 }).ok).toBe(false);
  });
});
