import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addConstraint,
  addLine,
  addSpline,
  createCadDocument,
  createCadPart,
  dimensionForSelection,
  entityPointIds,
  evaluateCadDocument,
  extendSketchCurve,
  insertCurveControlPoint,
  isOwnedSplineHandle,
  isSplineTangentHandle,
  mirrorSketchEntities,
  offsetSketch,
  parseCadDocument,
  removeEntity,
  setSketchConstruction,
  solveCadDocument,
  splineHandleId,
  splineHandleOwner,
  validateCadDocument,
  withSplineHandleSegments,
  type CadPointEntity,
  type CadSketch,
} from './index';

const documentOf = (sketch: CadSketch) => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });
const pointMap = (sketch: CadSketch) => new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
function fixture() {
  const sketch = addSpline(createCadPart().sketch, {
    points: [
      { x: 10, y: 10 },
      { x: 50, y: 75 },
      { x: 100, y: 65 },
      { x: 140, y: 15 },
    ],
  });
  const curve = sketch.entities.at(-1)!;
  if (curve.type !== 'spline') throw Error();
  return { sketch, curve };
}
const fixedFits = (sketch: CadSketch, ids: readonly string[]): CadSketch => ({
  ...sketch,
  entities: sketch.entities.map(e => (e.type === 'point' && ids.includes(e.id) ? { ...e, fixed: true } : e)),
});
async function solved(sketch: CadSketch) {
  const result = await solveCadDocument(documentOf(sketch));
  expect(result.sketches[0]!.status, JSON.stringify(result.diagnostics)).toBe('solved');
  return result;
}

describe('owned spline tangent handles', () => {
  it('adds two stable construction references with no new points, equations or native freedom', async () => {
    const { sketch, curve } = fixture(),
      handles = sketch.entities.filter(isOwnedSplineHandle);
    expect(handles).toHaveLength(2);
    expect(sketch.entities.at(-1)?.id).toBe(curve.id);
    expect(handles.map(h => h.id)).toEqual([splineHandleId(curve.id, 'start'), splineHandleId(curve.id, 'end')]);
    expect(handles[0]).toMatchObject({ startId: curve.startId, endId: curve.controlPointIds[1], construction: true });
    expect(handles[1]).toMatchObject({ startId: curve.endId, endId: curve.controlPointIds.at(-2), construction: true });
    const baseline = { ...sketch, entities: sketch.entities.filter(e => !isOwnedSplineHandle(e)) };
    expect(baseline.entities.filter(e => e.type === 'point')).toEqual(sketch.entities.filter(e => e.type === 'point'));
    const result = await solved(fixedFits(sketch, curve.fitPointIds));
    expect(result.sketches[0]!.dof).toBe(4);
    expect(result.document.parts[0]!.sketch.constraints).toEqual(sketch.constraints);
    expect(withSplineHandleSegments(baseline)).toEqual(sketch);
    expect(withSplineHandleSegments(sketch)).toBe(sketch);
    expect(parseCadDocument(documentOf(baseline)).parts[0]!.sketch).toEqual(sketch);
  });

  it.each(['horizontal', 'vertical'] as const)('constrains a real segment %s through ordinary line operands', async type => {
    const { sketch: initial, curve } = fixture(),
      handleId = splineHandleId(curve.id, 'start');
    const sketch = addConstraint(fixedFits(initial, curve.fitPointIds), { type, entityId: handleId });
    const result = await solved(sketch),
      points = pointMap(result.document.parts[0]!.sketch);
    const a = points.get(curve.startId)!,
      b = points.get(curve.controlPointIds[1]!)!;
    expect(type === 'horizontal' ? b.y : b.x).toBeCloseTo(type === 'horizontal' ? a.y : a.x, 6);
    expect(result.sketches[0]!.dof).toBe(3);
  });

  it.each(['parallel', 'equal', 'angle'] as const)('uses the same native %s relation as an ordinary line', async type => {
    const { sketch: initial, curve } = fixture(),
      handleId = splineHandleId(curve.id, 'start');
    let sketch = addLine(fixedFits(initial, curve.fitPointIds), { x1: -50, y1: 100, x2: 0, y2: 100 });
    const line = sketch.entities.at(-1)!;
    sketch = fixedFits(sketch, entityPointIds(line));
    sketch = addConstraint(
      sketch,
      type === 'angle' ? { type, entityAId: line.id, entityBId: handleId, value: 45 } : { type, entityAId: line.id, entityBId: handleId }
    );
    const result = await solved(sketch),
      points = pointMap(result.document.parts[0]!.sketch);
    const a = points.get(curve.startId)!,
      b = points.get(curve.controlPointIds[1]!)!,
      dx = b.x - a.x,
      dy = b.y - a.y;
    if (type === 'parallel') expect(dy).toBeCloseTo(0, 6);
    else if (type === 'equal') expect(Math.hypot(dx, dy)).toBeCloseTo(50, 6);
    else expect((Math.atan2(dy, dx) * 180) / Math.PI).toBeCloseTo(45, 6);
    expect(result.sketches[0]!.dof).toBe(3);
  });

  it('retains circle tangency on the true endpoint tangent segment', async () => {
    const { sketch: initial, curve } = fixture(),
      handleId = splineHandleId(curve.id, 'start');
    let sketch = addCircle(fixedFits(initial, curve.fitPointIds), { x: 50, y: 40, radius: 10 });
    const circle = sketch.entities.at(-1)!;
    if (circle.type !== 'circle') throw Error();
    sketch = fixedFits(sketch, [circle.centerId]);
    sketch = addConstraint(sketch, { type: 'radius', entityId: circle.id, value: 10 });
    sketch = addConstraint(sketch, { type: 'tangent', entityAId: handleId, entityBId: circle.id });
    const result = await solved(sketch),
      points = pointMap(result.document.parts[0]!.sketch);
    const a = points.get(curve.startId)!,
      b = points.get(curve.controlPointIds[1]!)!;
    expect(Math.abs((b.x - a.x) * (40 - a.y) - (b.y - a.y) * (50 - a.x)) / Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(10, 6);
    expect(result.sketches[0]!.dof).toBe(3);
  });

  it('keeps segment length dimensions distinct from explicit white-point separation', () => {
    const { sketch, curve } = fixture(),
      helper = splineHandleId(curve.id, 'start');
    const line = dimensionForSelection(sketch, [helper]);
    expect('constraint' in line && line.constraint).toMatchObject({
      type: 'distance',
      sourceEntityId: helper,
      pointAId: curve.startId,
      pointBId: curve.controlPointIds[1],
    });
    const pointOnly = dimensionForSelection(sketch, [curve.controlPointIds[1]!]);
    expect('constraint' in pointOnly).toBe(false);
    const points = dimensionForSelection(sketch, [curve.controlPointIds[1]!, curve.fitPointIds[1]!], { mode: 'distance' });
    expect('constraint' in points && points.constraint).toMatchObject({ type: 'distance' });
    expect('constraint' in points && 'sourceEntityId' in points.constraint).toBe(false);
  });
  it('preserves the logical last white handle identity when inserting in the final span', () => {
    const { sketch, curve } = fixture(),
      old = curve.controlPointIds.at(-2)!;
    const next = insertCurveControlPoint(sketch, curve.id, 0.9);
    const refined = next.entities.find(e => e.id === curve.id)!;
    if (refined.type !== 'spline') throw Error();
    expect(refined.controlPointIds.at(-2)).toBe(old);
  });

  it('never rewrites a fixed white handle coordinate during knot refinement', () => {
    const { sketch, curve } = fixture(),
      id = curve.controlPointIds[1]!;
    const fixed = { ...sketch, entities: sketch.entities.map(e => (e.id === id && e.type === 'point' ? { ...e, fixed: true } : e)) };
    const next = insertCurveControlPoint(fixed, curve.id, 0.1);
    expect(pointMap(next).get(id)).toEqual(pointMap(fixed).get(id));
  });

  it('retains a measured last-handle driver on the visible handle after insertion', async () => {
    const { sketch: initial, curve } = fixture();
    let sketch: CadSketch = {
      ...initial,
      entities: initial.entities.map(e => (e.type === 'point' && curve.fitPointIds.includes(e.id) ? { ...e, fixed: true } : e)),
    };
    sketch = addConstraint(sketch, { type: 'distance', pointAId: curve.endId, pointBId: curve.controlPointIds.at(-2)!, value: 40 });
    const before = await solveCadDocument(documentOf(sketch));
    expect(before.sketches[0]!.status).toBe('solved');
    const inserted = insertCurveControlPoint(before.document.parts[0]!.sketch, curve.id, 0.9);
    const after = await solveCadDocument(documentOf(inserted));
    expect(after.sketches[0]!.status, JSON.stringify(after.diagnostics)).toBe('solved');
    const output = after.document.parts[0]!.sketch,
      refined = output.entities.find(e => e.id === curve.id)!;
    if (refined.type !== 'spline') throw Error();
    const points = pointMap(output),
      a = points.get(refined.endId)!,
      b = points.get(refined.controlPointIds.at(-2)!)!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(40, 6);
  });

  it('retains both owned Length drivers and source identities through first/last insertion, serialization and Undo snapshots', async () => {
    const { sketch: initial, curve } = fixture();
    let sketch = fixedFits(initial, curve.fitPointIds);
    for (const [end, value] of [
      ['start', 50],
      ['end', 40],
    ] as const) {
      const proposal = dimensionForSelection(sketch, [splineHandleId(curve.id, end)]);
      if (!('constraint' in proposal)) throw Error(proposal.message);
      sketch = addConstraint(sketch, { ...proposal.constraint, value });
    }
    let result = await solved(sketch),
      document = result.document;
    const history = structuredClone(document),
      constraintIds = sketch.constraints.map(c => c.id);
    for (const parameter of [0.1, 0.9]) {
      const inserted = insertCurveControlPoint(document.parts[0]!.sketch, curve.id, parameter);
      result = await solved(inserted);
      document = result.document;
      const output = document.parts[0]!.sketch,
        parent = output.entities.find(e => e.id === curve.id)!;
      if (parent.type !== 'spline') throw Error();
      expect(parent.controlPointIds[1]).toBe(curve.controlPointIds[1]);
      expect(parent.controlPointIds.at(-2)).toBe(curve.controlPointIds.at(-2));
      expect(output.constraints.map(c => c.id)).toEqual(constraintIds);
      const points = pointMap(output);
      for (const [aId, bId, value] of [
        [parent.startId, parent.controlPointIds[1]!, 50],
        [parent.endId, parent.controlPointIds.at(-2)!, 40],
      ] as const) {
        const a = points.get(aId)!,
          b = points.get(bId)!;
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(value, 6);
      }
      for (const id of curve.fitPointIds) expect(points.get(id)).toEqual(pointMap(history.parts[0]!.sketch).get(id));
    }
    expect(parseCadDocument(JSON.parse(JSON.stringify(document)))).toEqual(document);
    expect((await solved(history.parts[0]!.sketch)).document.parts[0]!.sketch).toEqual(history.parts[0]!.sketch);
  });

  it('retains Equal magnitude during insertion while permitting the spline to change shape', async () => {
    const { sketch: initial, curve } = fixture();
    let sketch = addLine(fixedFits(initial, curve.fitPointIds), { x1: -100, y1: 100, x2: -50, y2: 100 });
    const reference = sketch.entities.at(-1)!;
    sketch = fixedFits(sketch, entityPointIds(reference));
    for (const end of ['start', 'end'] as const)
      sketch = addConstraint(sketch, { type: 'equal', entityAId: splineHandleId(curve.id, end), entityBId: reference.id });
    const before = await solved(sketch);
    let output = before.document.parts[0]!.sketch;
    for (const parameter of [0.1, 0.9])
      output = (await solved(insertCurveControlPoint(output, curve.id, parameter))).document.parts[0]!.sketch;
    const points = pointMap(output);
    for (const end of ['start', 'end'] as const) {
      const helper = output.entities.find(e => e.id === splineHandleId(curve.id, end))!;
      if (helper.type !== 'line') throw Error();
      const a = points.get(helper.startId)!,
        b = points.get(helper.endId)!;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(50, 6);
    }
  });

  it('protects points and segments from direct Delete/Q and rejects destructive modification commands', () => {
    const { sketch, curve } = fixture(),
      before = JSON.stringify(sketch),
      helper = splineHandleId(curve.id, 'start');
    for (const id of [helper, curve.controlPointIds[1]!]) {
      expect(isSplineTangentHandle(sketch, id)).toBe(true);
      expect(splineHandleOwner(sketch, id)).toEqual({ type: 'splineHandle', splineId: curve.id, end: 'start' });
      expect(removeEntity(sketch, id)).toBe(sketch);
      expect(setSketchConstruction(sketch, [id], false)).toBe(sketch);
    }
    expect(extendSketchCurve(sketch, { entityId: helper, end: 'end', target: { x: 100, y: 100 } }).ok).toBe(false);
    expect(offsetSketch(sketch, { entityIds: [helper], value: 5 }).ok).toBe(false);
    expect(mirrorSketchEntities(sketch, { entityIds: [helper], axisId: splineHandleId(curve.id, 'end') }).ok).toBe(false);
    expect(JSON.stringify(sketch)).toBe(before);
  });

  it('cascades helper dimensions/relations with the parent while preserving an external shared endpoint and standalone point', () => {
    const { sketch: initial, curve } = fixture();
    let sketch = addLine(initial, { x1: 140, y1: 15, x2: 180, y2: 15 });
    const external = sketch.entities.at(-1)!;
    if (external.type !== 'line') throw Error();
    sketch = addConstraint(sketch, { type: 'horizontal', entityId: splineHandleId(curve.id, 'start') });
    sketch = addConstraint(sketch, {
      type: 'distance',
      sourceEntityId: splineHandleId(curve.id, 'end'),
      pointAId: curve.endId,
      pointBId: curve.controlPointIds.at(-2)!,
      value: 40,
    });
    const removed = removeEntity(sketch, curve.id);
    expect(removed.entities.some(isOwnedSplineHandle)).toBe(false);
    expect(removed.entities.some(e => e.id === external.id)).toBe(true);
    expect(removed.entities.some(e => e.id === curve.endId)).toBe(true);
    expect(removed.entities.some(e => e.id === curve.controlPointIds[1])).toBe(false);
    expect(removed.constraints).toEqual([]);
  });

  it('validates and round-trips ownership, rejects malformed or retargeted helpers, and adds no cut-profile edges', () => {
    const { sketch: initial, curve } = fixture();
    const closed = addLine(initial, { x1: 140, y1: 15, x2: 10, y2: 10 }),
      doc = documentOf(closed);
    expect(parseCadDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const evaluated = evaluateCadDocument(doc);
    expect(evaluated.parts[0]!.loops[0]!.entityIds).not.toContain(splineHandleId(curve.id, 'start'));
    const malformed = structuredClone(doc),
      helper = malformed.parts[0]!.sketch.entities.find(e => e.id === splineHandleId(curve.id, 'start'))!;
    if (helper.type !== 'line') throw Error();
    helper.endId = curve.fitPointIds[1]!;
    expect(validateCadDocument(malformed).some(d => d.code === 'invalid-spline-handle')).toBe(true);
    expect(() => parseCadDocument(malformed)).toThrow(/adjacent pole/);
  });

  it.each(['missing-parent', 'wrong-type', 'wrong-end', 'wrong-id', 'not-construction', 'closed-parent'] as const)(
    'rejects malformed helper ownership: %s',
    kind => {
      const { sketch, curve } = fixture(),
        document = documentOf(sketch);
      const helper = sketch.entities.find(e => e.id === splineHandleId(curve.id, 'start'))!;
      if (!isOwnedSplineHandle(helper)) throw Error();
      if (kind === 'missing-parent') helper.owner.splineId = 'missing';
      if (kind === 'wrong-type') (helper.owner as { type: string }).type = 'other';
      if (kind === 'wrong-end') (helper.owner as { end: string }).end = 'middle';
      if (kind === 'wrong-id') helper.id = 'wrong-helper-id';
      if (kind === 'not-construction') helper.construction = false;
      if (kind === 'closed-parent') curve.closed = true;
      expect(validateCadDocument(document).some(d => d.code === 'invalid-spline-handle')).toBe(true);
      expect(() => parseCadDocument(document)).toThrow();
    }
  );

  it('keeps protected handles construction during a mixed selection toggle', () => {
    const { sketch: initial, curve } = fixture();
    const sketch = addLine(initial, { x1: -20, y1: 50, x2: -10, y2: 50 });
    const line = sketch.entities.at(-1)!,
      helperId = splineHandleId(curve.id, 'start'),
      whiteId = curve.controlPointIds[1]!;
    const selected = [helperId, whiteId, line.id];
    const construction = setSketchConstruction(sketch, selected, true);
    expect(construction.entities.find(e => e.id === line.id)?.construction).toBe(true);
    const regular = setSketchConstruction(construction, selected, false);
    expect(regular.entities.find(e => e.id === line.id)?.construction).toBe(false);
    expect(regular.entities.find(e => e.id === helperId)?.construction).toBe(true);
    expect(regular.entities.find(e => e.id === whiteId)?.construction).toBe(true);
    expect(validateCadDocument(documentOf(regular))).toEqual([]);
  });

  it('allows a collapsed owned tangent segment without exempting an ordinary zero-length line', async () => {
    const { sketch, curve } = fixture(),
      endpoint = pointMap(sketch).get(curve.startId)!;
    const collapsed: CadSketch = {
      ...sketch,
      entities: sketch.entities.map(e =>
        e.id === curve.controlPointIds[1] && e.type === 'point' ? { ...e, x: endpoint.x, y: endpoint.y } : e
      ),
    };
    expect(validateCadDocument(documentOf(collapsed)).some(d => d.code === 'zero-length')).toBe(false);
    expect((await solved(collapsed)).sketches[0]!.status).toBe('solved');
    const normal = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 20, y2: 20 });
    expect(validateCadDocument(documentOf(normal)).some(d => d.code === 'zero-length')).toBe(true);
  });
});
