import { describe, expect, it } from 'vitest';
import { addArc, addBezier, addCircle, addConstraint, addLine, addPoint, addSpline, createCadPart, newCadId, originId } from './document';
import { evaluateCurvePoint } from './curves';
import { extendSketchCurve, type CadExtendOptions } from './extend';
import type { CadArcEntity, CadLineEntity, CadPointEntity, CadSketch } from './types';

const point = (sketch: CadSketch, id: string) =>
  sketch.entities.find((entity): entity is CadPointEntity => entity.id === id && entity.type === 'point')!;
const lines = (sketch: CadSketch) => sketch.entities.filter((entity): entity is CadLineEntity => entity.type === 'line');
const arc = (sketch: CadSketch) => sketch.entities.find((entity): entity is CadArcEntity => entity.type === 'arc')!;
const seed = () => addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 10, y2: 0 });
function apply(sketch: CadSketch, options: CadExtendOptions) {
  const result = extendSketchCurve(sketch, options);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe('atomic endpoint extension', () => {
  it('passes through the construction origin when a free target lies beyond it', () => {
    const sketch = addLine(createCadPart().sketch, { x1: -20, y1: 0, x2: -10, y2: 0 });
    const source = lines(sketch)[0]!;
    const result = apply(sketch, { entityId: source.id, end: 'end', target: { x: 30, y: 0 } });
    expect(result.point).toEqual({ x: 30, y: 0 });
    expect(result.boundaryId).toBeUndefined();
    expect(result.sketch.constraints.some(c => 'pointBId' in c && c.pointBId === originId(sketch))).toBe(false);
  });

  it('retains an explicitly chosen construction guide as a persistent boundary', () => {
    const sketch = addLine(seed(), { x1: 20, y1: -5, x2: 20, y2: 5, construction: true });
    const [source, guide] = lines(sketch);
    const result = apply(sketch, { entityId: source!.id, end: 'end', target: { x: 20, y: 4 }, boundaryId: guide!.id });
    expect(result.point).toEqual({ x: 20, y: 0 });
    expect(result.boundaryId).toBe(guide!.id);
    expect(result.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnLine', pointId: result.pointId, entityId: guide!.id })
    );
  });

  it('attaches to the origin when it is explicitly chosen as the boundary', () => {
    const sketch = addLine(createCadPart().sketch, { x1: -20, y1: 0, x2: -10, y2: 0 });
    const result = apply(sketch, { entityId: lines(sketch)[0]!.id, end: 'end', target: { x: 0, y: 0 }, boundaryId: originId(sketch) });
    expect(result.boundaryId).toBe(originId(sketch));
    expect(result.pointId).toBe(originId(sketch));
  });

  it('projects a free target onto the unchanged line support, removes its owned length, and never mutates the source', () => {
    let sketch = seed();
    const line = lines(sketch)[0]!;
    sketch = addConstraint(sketch, { type: 'horizontal', entityId: line.id });
    sketch = addConstraint(sketch, {
      type: 'distance',
      pointAId: line.startId,
      pointBId: line.endId,
      sourceEntityId: line.id,
      value: 10,
      label: 'Length',
    });
    const driver = sketch.constraints.at(-1)!;
    const before = structuredClone(sketch);
    const result = apply(sketch, { entityId: line.id, end: 'end', target: { x: 25, y: 6 } });
    const retained = lines(result.sketch)[0]!;
    expect(sketch).toEqual(before);
    expect(retained.id).toBe(line.id);
    expect(retained.startId).toBe(line.startId);
    expect(retained.endId).not.toBe(line.endId);
    expect(point(result.sketch, retained.endId)).toMatchObject({ x: 25, y: 0, standalone: false });
    expect(result.removedConstraintIds).toEqual([driver.id]);
    expect(result.sketch.constraints.some(constraint => constraint.type === 'horizontal')).toBe(true);
    expect(result.changedEntityIds).toContain(line.id);
  });

  it('keeps the initially selected start, and previews deletion when it crosses the opposite end', () => {
    const sketch = seed(),
      line = lines(sketch)[0]!;
    const left = apply(sketch, { entityId: line.id, end: 'start', target: { x: -15, y: 3 } });
    expect(point(left.sketch, lines(left.sketch)[0]!.startId)).toMatchObject({ x: -15, y: 0 });
    expect(lines(left.sketch)[0]!.endId).toBe(line.endId);
    const crossed = apply(sketch, { entityId: line.id, end: 'start', target: { x: 20, y: 0 } });
    expect(crossed.kind).toBe('delete');
    expect(crossed.removedEntityIds).toContain(line.id);
    expect(lines(crossed.sketch)).toHaveLength(0);
    expect(sketch.entities.some(entity => entity.id === line.id)).toBe(true);
  });

  it('stops at the nearest finite boundary and adds a persistent contact rather than using the cursor coordinate', () => {
    let sketch = addLine(seed(), { x1: 20, y1: -5, x2: 20, y2: 5 });
    sketch = addLine(sketch, { x1: 30, y1: -5, x2: 30, y2: 5 });
    const [source, first, later] = lines(sketch);
    const result = apply(sketch, { entityId: source!.id, end: 'end', target: { x: 30, y: 4 }, boundaryId: later!.id });
    expect(result.point).toEqual({ x: 20, y: 0 });
    expect(result.boundaryId).toBe(first!.id);
    expect(result.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnLine', pointId: result.pointId, entityId: first!.id })
    );
    expect(result.sketch.entities.find(entity => entity.id === later!.id)).toEqual(later);
  });

  it('uses an explicit off-axis boundary pick even when the contact lies beyond the pointer projection', () => {
    const sketch = addLine(seed(), { x1: 20, y1: 0, x2: 15, y2: 10 });
    const [source, boundary] = lines(sketch);
    const result = apply(sketch, { entityId: source!.id, end: 'end', target: { x: 15, y: 10 }, boundaryId: boundary!.id });
    expect(result.point).toEqual({ x: 20, y: 0 });
    expect(lines(result.sketch)[0]!.endId).toBe(boundary!.startId);
  });

  it('ignores an ordinary construction guide before the nearest finite boundary', () => {
    let sketch = addLine(seed(), { x1: 15, y1: -5, x2: 15, y2: 5, construction: true });
    sketch = addLine(sketch, { x1: 20, y1: -5, x2: 20, y2: 5 });
    const [source, guide, boundary] = lines(sketch);
    const before = structuredClone(sketch);
    const result = apply(sketch, { entityId: source!.id, end: 'end', target: { x: 30, y: 0 } });
    expect(result.point).toEqual({ x: 20, y: 0 });
    expect(result.boundaryId).toBe(boundary!.id);
    expect(result.sketch.constraints.some(c => c.type === 'pointOnLine' && c.entityId === guide!.id)).toBe(false);
    expect(sketch).toEqual(before);
  });

  it('passes an owned white-handle guide without treating it as a finite boundary or changing its parent', () => {
    let sketch = addLine(seed(), { x1: 30, y1: -5, x2: 30, y2: 5 });
    const [source, boundary] = lines(sketch);
    sketch = addSpline(sketch, {
      points: [
        { x: 15, y: 20 },
        { x: 20, y: 100 },
        { x: 25, y: 20 },
      ],
    });
    const spline = sketch.entities.find(e => e.type === 'spline')!;
    const controls = [
      { id: spline.controlPointIds[1]!, x: 15, y: -5 },
      { id: spline.controlPointIds[2]!, x: 20, y: 300 },
      { id: spline.controlPointIds[3]!, x: 25, y: 80 },
    ];
    sketch.entities = sketch.entities.map(e =>
      e.type === 'point' && controls.some(p => p.id === e.id) ? { ...e, ...controls.find(p => p.id === e.id)! } : e
    );
    const map = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
    const fits = spline.fitPointIds.map((id, i) => ({ id, ...evaluateCurvePoint(spline, map, spline.fitParameters[i]!) }));
    sketch.entities = sketch.entities.map(e =>
      e.type === 'point' && fits.some(p => p.id === e.id) ? { ...e, ...fits.find(p => p.id === e.id)! } : e
    );
    // The white segment crosses y=0 at x=15, while the true curve stays above
    // the support. This models a visible guide, rather than hiding a real stop.
    expect(Array.from({ length: 101 }, (_, i) => evaluateCurvePoint(spline, map, i / 100).y).every(y => y > 1)).toBe(true);
    const before = structuredClone(sketch);
    const result = apply(sketch, { entityId: source!.id, end: 'end', target: { x: 40, y: 0 } });
    expect(result.point).toEqual({ x: 30, y: 0 });
    expect(result.boundaryId).toBe(boundary!.id);
    expect(result.sketch.entities.find(e => e.id === spline.id)).toEqual(spline);
    expect(sketch).toEqual(before);
  });

  it('ignores an off-segment supporting-line intersection', () => {
    const sketch = addLine(seed(), { x1: 20, y1: 10, x2: 20, y2: 20 });
    const source = lines(sketch)[0]!;
    expect(apply(sketch, { entityId: source.id, end: 'end', target: { x: 30, y: 0 } }).point).toEqual({ x: 30, y: 0 });
  });

  it('accepts standalone point boundaries and reuses their identities', () => {
    const sketch = addPoint(seed(), { x: 16, y: 0 });
    const source = lines(sketch)[0]!,
      boundary = sketch.entities.at(-1)!;
    const result = apply(sketch, { entityId: source.id, end: 'end', target: { x: 25, y: 0 } });
    expect(result.pointId).toBe(boundary.id);
    expect(result.boundaryId).toBe(boundary.id);
  });

  it('dispatches circular and true rational boundaries through the shared exact contact implementation', () => {
    const circleSketch = addCircle(seed(), { x: 20, y: 0, radius: 3 });
    expect(apply(circleSketch, { entityId: lines(circleSketch)[0]!.id, end: 'end', target: { x: 30, y: 0 } }).point?.x).toBeCloseTo(17, 8);
    const bezierSketch = addBezier(seed(), {
      points: [
        { x: 20, y: -5 },
        { x: 16, y: 0 },
        { x: 20, y: 5 },
      ],
    });
    const result = apply(bezierSketch, { entityId: lines(bezierSketch)[0]!.id, end: 'end', target: { x: 30, y: 0 } });
    expect(result.point?.x).toBeCloseTo(18, 5);
    expect(result.sketch.constraints).toContainEqual(expect.objectContaining({ type: 'pointOnCurve', pointId: result.pointId }));
  });

  it('detaches a shared endpoint without moving its neighbor and preserves the old support attachment', () => {
    let sketch = addLine(seed(), { x1: 10, y1: 0, x2: 10, y2: 10 });
    const [source, neighbor] = lines(sketch);
    const shared = source!.endId;
    sketch = addConstraint(sketch, { type: 'horizontal', entityId: source!.id });
    const before = structuredClone(sketch);
    const result = apply(sketch, { entityId: source!.id, end: 'end', target: { x: 20, y: 0 } });
    expect(result.sketch.entities.find(entity => entity.id === neighbor!.id)).toEqual(neighbor);
    expect(point(result.sketch, shared)).toEqual(point(before, shared));
    expect(result.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnLine', pointId: shared, entityId: source!.id })
    );
  });

  it('removes blocking equal-length and offset groups while retaining unrelated drivers', () => {
    let sketch = addLine(seed(), { x1: 0, y1: 20, x2: 10, y2: 20 });
    const [source, neighbor] = lines(sketch);
    sketch = addConstraint(sketch, { type: 'equal', entityAId: source!.id, entityBId: neighbor!.id });
    sketch = addConstraint(sketch, {
      type: 'distance',
      pointAId: neighbor!.startId,
      pointBId: neighbor!.endId,
      sourceEntityId: neighbor!.id,
      value: 10,
    });
    const owned = sketch.constraints[0]!,
      unrelated = sketch.constraints[1]!;
    const group = {
      id: newCadId(),
      type: 'offset' as const,
      value: 20,
      members: [{ kind: 'line' as const, sourceId: source!.id, targetId: neighbor!.id, side: 1 as const, endpoints: true }],
    };
    sketch.constraints.push(group);
    const result = apply(sketch, { entityId: source!.id, end: 'end', target: { x: 18, y: 0 } });
    expect(result.removedConstraintIds).toEqual(expect.arrayContaining([owned.id, group.id]));
    expect(result.sketch.constraints).toContainEqual(unrelated);
  });

  it('converts a surviving midpoint attachment into a support relation without pulling its point', () => {
    let sketch = addPoint(seed(), { x: 5, y: 0 });
    const source = lines(sketch)[0]!,
      midpoint = sketch.entities.at(-1)!;
    sketch = addConstraint(sketch, { type: 'midpoint', pointId: midpoint.id, entityId: source.id });
    const result = apply(sketch, { entityId: source.id, end: 'end', target: { x: 20, y: 0 } });
    // The explicit point is itself a boundary only when crossed, not while extending beyond the old end.
    expect(point(result.sketch, midpoint.id)).toMatchObject({ x: 5, y: 0 });
    expect(result.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnLine', pointId: midpoint.id, entityId: source.id })
    );
    expect(result.sketch.constraints.some(constraint => constraint.type === 'midpoint')).toBe(false);
  });

  it('extends either arc endpoint on the original circle and preserves its radius driver', () => {
    let sketch = addArc(createCadPart().sketch, { cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2 });
    const source = arc(sketch);
    sketch = addConstraint(sketch, { type: 'radius', entityId: source.id, value: 10 });
    const end = apply(sketch, { entityId: source.id, end: 'end', target: { x: -50, y: 0 } });
    expect(arc(end.sketch)).toMatchObject({ centerId: source.centerId, radius: 10, startAngle: 0, endAngle: Math.PI });
    expect(end.point?.x).toBeCloseTo(-10, 8);
    expect(end.sketch.constraints).toEqual(sketch.constraints);
    const start = apply(sketch, { entityId: source.id, end: 'start', target: { x: 0, y: -20 } });
    expect(start.point?.y).toBeCloseTo(-10, 8);
    expect(arc(start.sketch).endId).toBe(source.endId);
  });

  it('stops an arc on the first finite contact in the selected extension sweep', () => {
    let sketch = addArc(createCadPart().sketch, { cx: 0, cy: 0, radius: 10, startAngle: Math.PI, endAngle: 2 * Math.PI });
    const source = arc(sketch);
    sketch = addLine(sketch, { x1: -2, y1: 6, x2: 10, y2: 6 });
    sketch = addLine(sketch, { x1: -2, y1: 8, x2: 10, y2: 8 });
    const first = lines(sketch)[0]!;
    const result = apply(sketch, { entityId: source.id, end: 'end', target: { x: 0, y: 10 } });
    expect(result.point?.x).toBeCloseTo(8, 7);
    expect(result.point?.y).toBeCloseTo(6, 7);
    expect(result.boundaryId).toBe(first.id);
    expect(result.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnLine', pointId: result.pointId, entityId: first.id })
    );
  });

  it('converts full-circle completion to a real circle with the same entity ID', () => {
    const sketch = addArc(createCadPart().sketch, { cx: 20, cy: 20, radius: 10, startAngle: 0, endAngle: Math.PI });
    const source = arc(sketch);
    const result = apply(sketch, { entityId: source.id, end: 'end', target: { x: 30, y: 20 } });
    expect(result.kind).toBe('circle');
    expect(result.sketch.entities.find(entity => entity.id === source.id)).toMatchObject({
      type: 'circle',
      centerId: source.centerId,
      radius: 10,
    });
    expect(result.createdEntityIds).toEqual([]);
  });

  it.each([
    { x: Number.NaN, y: 0 },
    { x: Infinity, y: 0 },
    { x: 10, y: 5 },
  ])('rejects malformed/no-op line target %j without changing source', target => {
    const sketch = seed(),
      before = structuredClone(sketch);
    expect(extendSketchCurve(sketch, { entityId: lines(sketch)[0]!.id, end: 'end', target }).ok).toBe(false);
    expect(sketch).toEqual(before);
  });

  it('rejects a selected boundary with no finite intersection and does not fall back to free geometry', () => {
    const sketch = addLine(seed(), { x1: 20, y1: 10, x2: 20, y2: 20 });
    const [source, boundary] = lines(sketch);
    expect(extendSketchCurve(sketch, { entityId: source!.id, end: 'end', target: { x: 20, y: 15 }, boundaryId: boundary!.id }).ok).toBe(
      false
    );
  });
  it('refuses collinear overlapping boundaries instead of manufacturing an arbitrary trim point', () => {
    const sketch = addLine(seed(), { x1: 15, y1: 0, x2: 25, y2: 0 });
    const before = structuredClone(sketch);
    const result = extendSketchCurve(sketch, { entityId: lines(sketch)[0]!.id, end: 'end', target: { x: 30, y: 0 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/overlap/);
    expect(sketch).toEqual(before);
  });

  it('retains a persistent finite-boundary witness when completing an arc to a full circle', () => {
    let sketch = addArc(createCadPart().sketch, { cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI });
    const source = arc(sketch);
    sketch = addLine(sketch, { x1: 10, y1: -5, x2: 10, y2: 5 });
    const boundary = lines(sketch)[0]!;
    const result = apply(sketch, { entityId: source.id, end: 'end', target: { x: 10, y: 0 }, boundaryId: boundary.id });
    expect(result.kind).toBe('circle');
    expect(result.sketch.entities.some(entity => entity.id === result.pointId)).toBe(true);
    expect(result.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnCircle', pointId: result.pointId, entityId: source.id })
    );
    expect(result.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnLine', pointId: result.pointId, entityId: boundary.id })
    );
  });
});
