import {
  addConstraint,
  addLine,
  addPoint,
  createCadDocument,
  createCadPart,
  solveCadDocument,
  type CadPoint,
  type CadSketch,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { dragSnapConstraints, inferDragPoint } from './dragSnap';

const project = (point: CadPoint) => ({ x: point.x * 3, y: -point.y * 3 });
function example() {
  const document = createCadDocument();
  const part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 30, y2: 20 });
  part.sketch = addLine(part.sketch, { x1: 100, y1: 100, x2: 200, y2: 100 });
  document.parts.push(part);
  const [moving, target] = part.sketch.entities.filter(e => e.type === 'line');
  return { document, part, pointId: moving!.endId, otherEndId: moving!.startId, target: target! };
}
function moved(sketch: CadSketch, pointId: string, point: CadPoint): CadSketch {
  return { ...sketch, entities: sketch.entities.map(e => (e.id === pointId ? { ...e, ...point } : e)) };
}

describe('point dragging inference', () => {
  it('snaps to an external endpoint and keeps the coincidence after the target moves again', async () => {
    const { document, part, pointId, target } = example();
    const inference = inferDragPoint(part.sketch, pointId, { x: 100.5, y: 99.5 }, { project });
    expect(inference.snap?.targetPointId).toBe(target.startId);
    part.sketch = moved(part.sketch, pointId, inference.point);
    const constraints = dragSnapConstraints(part.sketch, pointId, inference, { project });
    expect(constraints).toEqual([{ type: 'coincident', pointAId: pointId, pointBId: target.startId }]);
    for (const constraint of constraints) part.sketch = addConstraint(part.sketch, constraint);
    const result = await solveCadDocument(document, { drag: { pointId: target.startId, x: 110, y: 120 } });
    expect(result.sketches[0]?.status).toBe('solved');
    const points = result.document.parts[0]!.sketch.entities;
    const a = points.find(e => e.id === pointId)!,
      b = points.find(e => e.id === target.startId)!;
    if (a.type !== 'point' || b.type !== 'point') throw new Error('Expected points');
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-6);
  });

  it('does not bind a snap when existing dimensions prevented the native preview from reaching it', () => {
    const { part, pointId } = example();
    const inference = inferDragPoint(part.sketch, pointId, { x: 100, y: 100 }, { project });
    expect(inference.snap).not.toBeNull();
    expect(dragSnapConstraints(part.sketch, pointId, inference, { project })).toEqual([]);
  });

  it('never attracts a dragged endpoint back through its own line or a coincident alias', () => {
    const { part, pointId } = example();
    part.sketch = addPoint(part.sketch, { x: 30, y: 20 });
    const alias = part.sketch.entities.at(-1)!;
    part.sketch = addConstraint(part.sketch, { type: 'coincident', pointAId: pointId, pointBId: alias.id });
    const inference = inferDragPoint(part.sketch, pointId, { x: 30.1, y: 20.1 }, { project });
    expect(inference.snap).toBeNull();
    const ownEnd = inferDragPoint(part.sketch, pointId, { x: 0, y: 0 }, { project });
    expect(ownEnd.snap).toBeNull();
  });

  it('retains a line midpoint relation, without adding it repeatedly on later drags', () => {
    const { part, pointId, target } = example();
    const inference = inferDragPoint(part.sketch, pointId, { x: 150.2, y: 100.1 }, { project });
    expect(inference.snap?.kind).toBe('midpoint');
    part.sketch = moved(part.sketch, pointId, inference.point);
    expect(dragSnapConstraints(part.sketch, pointId, inference, { project })).toEqual([{ type: 'midpoint', pointId, entityId: target.id }]);
    part.sketch = addConstraint(part.sketch, { type: 'midpoint', pointId, entityId: target.id });
    expect(dragSnapConstraints(part.sketch, pointId, inference, { project })).toEqual([]);
  });

  it('retains point-on-line contact independently from midpoint contact', () => {
    const { part, pointId, target } = example();
    const inference = inferDragPoint(part.sketch, pointId, { x: 120, y: 100.2 }, { project });
    expect(inference.snap?.kind).toBe('pointOnCurve');
    part.sketch = moved(part.sketch, pointId, inference.point);
    expect(dragSnapConstraints(part.sketch, pointId, inference, { project })).toEqual([
      { type: 'pointOnLine', pointId, entityId: target.id },
    ]);
  });

  it('uses the solved reference position and rejects duplicate transitive coincidences', () => {
    const { part, pointId, target } = example();
    const inference = inferDragPoint(part.sketch, pointId, { x: 100, y: 100 }, { project });
    part.sketch = moved(moved(part.sketch, pointId, { x: 105, y: 105 }), target.startId, { x: 105, y: 105 });
    expect(dragSnapConstraints(part.sketch, pointId, inference, { project })).toHaveLength(1);
    part.sketch = addPoint(part.sketch, { x: 105, y: 105 });
    const alias = part.sketch.entities.at(-1)!;
    part.sketch = addConstraint(part.sketch, { type: 'coincident', pointAId: pointId, pointBId: alias.id });
    part.sketch = addConstraint(part.sketch, { type: 'coincident', pointAId: alias.id, pointBId: target.startId });
    expect(dragSnapConstraints(part.sketch, pointId, inference, { project })).toEqual([]);
  });

  it('creates reached axis relations, respecting existing line orientation constraints', () => {
    const { part, pointId, otherEndId } = example();
    const inference = inferDragPoint(part.sketch, pointId, { x: 50, y: 0.5 }, { project });
    expect(inference.alignments.map(a => a.type)).toContain('horizontalPoints');
    part.sketch = moved(part.sketch, pointId, inference.point);
    expect(dragSnapConstraints(part.sketch, pointId, inference, { project })).toContainEqual({
      type: 'horizontalPoints',
      pointAId: otherEndId,
      pointBId: pointId,
    });
    const line = part.sketch.entities.find(e => e.type === 'line')!;
    part.sketch = addConstraint(part.sketch, { type: 'horizontal', entityId: line.id });
    expect(dragSnapConstraints(part.sketch, pointId, inference, { project })).toEqual([]);
  });

  it('suppresses inference completely when snap is disabled', () => {
    const { part, pointId } = example();
    const raw = { x: 100.5, y: 99.5 };
    const inference = inferDragPoint(part.sketch, pointId, raw, { project, enabled: false });
    expect(inference).toMatchObject({ point: raw, snap: null, alignments: [], guides: [] });
    expect(dragSnapConstraints(part.sketch, pointId, inference, { project })).toEqual([]);
  });
});
