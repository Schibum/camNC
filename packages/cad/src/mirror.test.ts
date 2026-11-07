import { describe, expect, it } from 'vitest';
import {
  addArc,
  addBezier,
  addCircle,
  addConic,
  addConstraint,
  addLine,
  addPoint,
  addSpline,
  createCadDocument,
  createCadPart,
  mirrorSketchEntities,
  parseCadDocument,
  removeEntity,
  solveCadDocument,
  updateDimension,
  type CadPointEntity,
  type CadSketch,
} from './index';

const documentOf = (sketch: CadSketch) => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });
const points = (sketch: CadSketch) => new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
const freeze = (sketch: CadSketch) => ({ ...sketch, entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e)) });
function mirrored(sketch: CadSketch, ids: string[], axisId: string) {
  const result = mirrorSketchEntities(sketch, { entityIds: ids, axisId });
  if (!result.ok) throw Error(result.message);
  return result;
}
function fixture() {
  const sketch = addLine(createCadPart().sketch, { x1: 0, y1: -20, x2: 0, y2: 20, construction: true });
  return { sketch: freeze(sketch), axisId: sketch.entities.at(-1)!.id };
}

describe('linked native Mirror', () => {
  it.each(['axis-endpoint', 'point-on-axis', 'free-aligned'] as const)(
    'keeps a %s source point nonsingular without adding source fixation',
    async kind => {
      const base = fixture();
      let sketch: CadSketch = base.sketch;
      const axis = sketch.entities.find(e => e.id === base.axisId)!;
      if (axis.type !== 'line') throw Error();
      let pointId = axis.startId;
      if (kind !== 'axis-endpoint') {
        sketch = addPoint(sketch, { x: 0, y: 5 });
        pointId = sketch.entities.at(-1)!.id;
        if (kind === 'point-on-axis') sketch = addConstraint(sketch, { type: 'pointOnLine', pointId, entityId: axis.id });
      }
      const original = structuredClone(sketch),
        result = mirrored(sketch, [pointId], axis.id);
      const solved = await solveCadDocument(documentOf(result.sketch));
      expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
      expect(solved.sketches[0]!.dof).toBe(kind === 'axis-endpoint' ? 0 : kind === 'point-on-axis' ? 1 : 2);
      expect(result.sketch.entities.slice(0, original.entities.length)).toEqual(original.entities);
      expect(solved.document.parts[0]!.sketch.constraints).toEqual(result.sketch.constraints);
      if (kind === 'free-aligned') {
        const dragged = await solveCadDocument(solved.document, { drag: { pointId, x: 7, y: 8 } });
        expect(dragged.sketches[0]!.status, JSON.stringify(dragged.diagnostics)).toBe('solved');
        const map = points(dragged.document.parts[0]!.sketch),
          source = map.get(pointId)!,
          copy = map.get(result.entityIds[0]!)!;
        expect(source.x).toBeCloseTo(7, 6);
        expect(copy.x).toBeCloseTo(-7, 6);
        expect(copy.y).toBeCloseTo(source.y, 6);
      }
    }
  );

  it('mirrors an open half-profile whose two seam vertices are the fixed axis endpoints', async () => {
    const base = fixture();
    let sketch = addLine(base.sketch, { x1: 0, y1: -20, x2: 30, y2: -20 });
    const bottom = sketch.entities.at(-1)!;
    sketch = addLine(sketch, { x1: 30, y1: -20, x2: 30, y2: 20 });
    const right = sketch.entities.at(-1)!;
    sketch = addLine(sketch, { x1: 30, y1: 20, x2: 0, y2: 20 });
    const top = sketch.entities.at(-1)!;
    for (const [entityId, type] of [
      [bottom.id, 'horizontal'],
      [right.id, 'vertical'],
      [top.id, 'horizontal'],
    ] as const)
      sketch = addConstraint(sketch, { type, entityId });
    const result = mirrored(sketch, [bottom.id, right.id, top.id], base.axisId);
    const solved = await solveCadDocument(documentOf(result.sketch));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(1);
    expect(solved.parts[0]!.outline).toHaveLength(6);
  });

  it('conditions a rotated-axis seam without pinning the free source or publishing its registration perturbation', async () => {
    let sketch: CadSketch = freeze(addLine(createCadPart().sketch, { x1: -20, y1: -20, x2: 20, y2: 20, construction: true }));
    const axisId = sketch.entities.at(-1)!.id;
    sketch = addPoint(sketch, { x: 5, y: 5 });
    const sourceId = sketch.entities.at(-1)!.id,
      result = mirrored(sketch, [sourceId], axisId);
    const before = structuredClone(result.sketch);
    const initial = await solveCadDocument(documentOf(result.sketch), { classifyEntities: true });
    expect(initial.sketches[0]!.status, JSON.stringify(initial.diagnostics)).toBe('solved');
    expect(initial.sketches[0]!.dof).toBe(2);
    expect(points(initial.document.parts[0]!.sketch).get(sourceId)).toMatchObject({ x: 5, y: 5 });
    expect(points(initial.document.parts[0]!.sketch).get(result.entityIds[0]!)!.x).toBeCloseTo(5, 8);
    expect(initial.sketches[0]!.entityStatus?.[sourceId]).toBe('underconstrained');
    expect(result.sketch).toEqual(before);
    const moved = await solveCadDocument(initial.document, { drag: { pointId: sourceId, x: 7, y: 8 } });
    expect(moved.sketches[0]!.status, JSON.stringify(moved.diagnostics)).toBe('solved');
    const copy = points(moved.document.parts[0]!.sketch).get(result.entityIds[0]!)!;
    expect(copy.x).toBeCloseTo(8, 6);
    expect(copy.y).toBeCloseTo(7, 6);
  });
  it('keeps copied line geometry linked to source edits without adding free parameters', async () => {
    const base = fixture();
    let sketch = addLine(base.sketch, { x1: 10, y1: 4, x2: 30, y2: 4 });
    const source = sketch.entities.at(-1)!;
    if (source.type !== 'line') throw Error();
    sketch = addConstraint(sketch, { type: 'positionX', pointId: source.startId, value: 10 });
    const driver = sketch.constraints.at(-1)!;
    sketch = addConstraint(sketch, { type: 'positionY', pointId: source.startId, value: 4 });
    sketch = addConstraint(sketch, { type: 'horizontal', entityId: source.id });
    sketch = addConstraint(sketch, {
      type: 'distanceX',
      pointAId: source.startId,
      pointBId: source.endId,
      sourceEntityId: source.id,
      value: 20,
    });
    const result = mirrored(sketch, [source.id], base.axisId);
    const solved = await solveCadDocument(updateDimension(documentOf(result.sketch), driver.id, 15));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(0);
    const output = solved.document.parts[0]!.sketch,
      copy = output.entities.find(e => e.id === result.entityIds[0])!;
    if (copy.type !== 'line') throw Error();
    expect(points(output).get(copy.startId)!.x).toBeCloseTo(-15, 7);
    expect(points(output).get(copy.endId)!.x).toBeCloseTo(-35, 7);
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
    expect(removeEntity(output, base.axisId).constraints.some(c => c.type === 'symmetricPoints')).toBe(false);
  });

  it('links circular radius and reflects an arc with preserved counterclockwise sweep', async () => {
    const base = fixture();
    let sketch = addCircle(base.sketch, { x: 20, y: 3, radius: 5 });
    const circle = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, { type: 'radius', entityId: circle.id, value: 5 });
    const radiusId = sketch.constraints.at(-1)!.id;
    sketch = addArc(sketch, { cx: 20, cy: 25, radius: 5, startAngle: 0.3, endAngle: 4.2 });
    const arc = sketch.entities.at(-1)!;
    const result = mirrored(freeze(sketch), [circle.id, arc.id], base.axisId);
    const solved = await solveCadDocument(updateDimension(documentOf(result.sketch), radiusId, 8));
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    const output = solved.document.parts[0]!.sketch;
    const copyCircle = output.entities.find(e => e.id === result.entityIds[0])!,
      copyArc = output.entities.find(e => e.id === result.entityIds[1])!;
    if (copyCircle.type !== 'circle' || copyArc.type !== 'arc' || arc.type !== 'arc') throw Error();
    expect(copyCircle.radius).toBeCloseTo(8, 7);
    expect(copyArc.endAngle - copyArc.startAngle).toBeCloseTo(3.9, 7);
    expect(points(output).get(copyArc.startId)!.x).toBeCloseTo(-points(sketch).get(arc.endId)!.x, 6);
    expect(
      result.sketch.entities
        .filter(e => result.createdEntityIds.includes(e.id) && e.type === 'point')
        .every(e => !('fixed' in e && e.fixed))
    ).toBe(true);
  });

  it.each(['conic', 'bezier', 'spline'] as const)('rejects %s atomically until descriptor-edit ownership can stay linked', kind => {
    const base = fixture();
    const sketch =
      kind === 'conic'
        ? addConic(base.sketch, { start: { x: 10, y: 5 }, end: { x: 30, y: 5 }, control: { x: 20, y: 20 }, rho: 0.4 })
        : kind === 'bezier'
          ? addBezier(base.sketch, {
              points: [
                { x: 10, y: 5 },
                { x: 15, y: 15 },
                { x: 25, y: 0 },
                { x: 30, y: 5 },
              ],
            })
          : addSpline(base.sketch, {
              points: [
                { x: 10, y: 5 },
                { x: 20, y: 15 },
                { x: 30, y: 5 },
              ],
            });
    const original = JSON.stringify(sketch);
    const result = mirrorSketchEntities(sketch, { entityIds: [sketch.entities.at(-1)!.id], axisId: base.axisId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not supported yet/);
    expect(JSON.stringify(sketch)).toBe(original);
  });

  it('copies one logical junction for transitively coincident source endpoints', () => {
    const base = fixture();
    let sketch = addLine(base.sketch, { x1: 10, y1: 1, x2: 20, y2: 2 });
    const first = sketch.entities.at(-1)!;
    sketch = addLine(sketch, { x1: 20.01, y1: 2, x2: 30, y2: 3 });
    const second = sketch.entities.at(-1)!;
    if (first.type !== 'line' || second.type !== 'line') throw Error();
    sketch = addConstraint(sketch, { type: 'coincident', pointAId: first.endId, pointBId: second.startId });
    const result = mirrored(sketch, [first.id, second.id], base.axisId),
      [a, b] = result.entityIds.map(id => result.sketch.entities.find(e => e.id === id)!);
    if (!a || !b || a.type !== 'line' || b.type !== 'line') throw Error();
    expect(a.endId).toBe(b.startId);
    expect(result.constraintIds).toHaveLength(3);
  });

  it('rejects invalid inputs atomically', () => {
    const { sketch, axisId } = fixture(),
      original = JSON.stringify(sketch);
    expect(mirrorSketchEntities(sketch, { axisId, entityIds: [axisId] }).ok).toBe(false);
    expect(mirrorSketchEntities(sketch, { axisId, entityIds: ['missing'] }).ok).toBe(false);
    expect(JSON.stringify(sketch)).toBe(original);
  });

  it('detects contradictory fully fixed symmetry rather than silently accepting native omitted equations', async () => {
    const base = fixture();
    let sketch = addLine(base.sketch, { x1: 10, y1: 5, x2: 20, y2: 5 });
    const result = mirrored(freeze(sketch), [sketch.entities.at(-1)!.id], base.axisId);
    sketch = freeze(result.sketch);
    const copy = sketch.entities.find(e => e.id === result.entityIds[0])!;
    if (copy.type !== 'line') throw Error();
    const valid = await solveCadDocument(documentOf(sketch));
    expect(valid.sketches[0]!.status).toBe('solved');
    sketch = { ...sketch, entities: sketch.entities.map(e => (e.id === copy.startId && e.type === 'point' ? { ...e, x: e.x + 1 } : e)) };
    const failed = await solveCadDocument(documentOf(sketch));
    expect(failed.sketches[0]!.status).toBe('conflict');
    expect(failed.diagnostics.some(d => d.constraintIds?.some(id => result.constraintIds.includes(id)))).toBe(true);
  });
});
