import { describe, expect, it } from 'vitest';
import {
  addBezier,
  addConic,
  addConstraint,
  addLine,
  addPoint,
  addSpline,
  createCadDocument,
  createCadPart,
  evaluateCurveTangent,
  filletLineCorners,
  pointEquivalence,
  resolveFilletCorners,
  solveCadDocument,
  validateCadDocument,
  type CadConstraint,
  type CadPointEntity,
  type CadSketch,
} from './index';
const points = (sketch: CadSketch) =>
  new Map(sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point]));
const document = (sketch: CadSketch) => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });

describe('logical point equivalence', () => {
  it('indexes transitive cycles deterministically without joining unrelated points or rewriting source', () => {
    const constraints: CadConstraint[] = [
      { id: 'ca', type: 'coincident', pointAId: 'c', pointBId: 'a' },
      { id: 'bc', type: 'coincident', pointAId: 'b', pointBId: 'c' },
      { id: 'ab', type: 'coincident', pointAId: 'a', pointBId: 'b' },
      { id: 'axis', type: 'horizontalPoints', pointAId: 'a', pointBId: 'd' },
    ];
    const before = structuredClone(constraints),
      index = pointEquivalence(constraints);
    expect(index.canonical('c')).toBe('a');
    expect(index.members('b')).toEqual(['a', 'b', 'c']);
    expect(index.equivalent('c', 'b')).toBe(true);
    expect(index.equivalent('a', 'd')).toBe(false);
    expect(index.members('unknown')).toEqual(['unknown']);
    expect(index.expand(['c', 'd'])).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(index.match(['x', 'b'], ['d', 'c'])).toEqual(['b', 'c']);
    expect(index.match(['x'], ['c'])).toBeUndefined();
    expect(pointEquivalence([...constraints].reverse()).members('a')).toEqual(index.members('a'));
    expect(constraints).toEqual(before);
  });

  it('fillets a transitive native joined corner while retaining its separate point and dimension identities', async () => {
    let sketch = addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 60, y2: 20 });
    const first = sketch.entities.find(entity => entity.type === 'line')!;
    sketch = addLine(sketch, { x1: 80, y1: 30, x2: 80, y2: 90 });
    const second = sketch.entities.filter(entity => entity.type === 'line')[1]!;
    sketch = addPoint(sketch, { x: 60, y: 20 });
    const bridge = sketch.entities.at(-1)!;
    sketch.entities = sketch.entities.map(entity => (entity.id === first.startId ? { ...entity, fixed: true } : entity));
    for (const relation of [
      { id: 'first-horizontal', type: 'horizontal', entityId: first.id },
      { id: 'second-vertical', type: 'vertical', entityId: second.id },
      { id: 'owned-length', type: 'distance', pointAId: first.startId, pointBId: first.endId, sourceEntityId: first.id, value: 50 },
      { id: 'join-a', type: 'coincident', pointAId: first.endId, pointBId: bridge.id },
      { id: 'join-b', type: 'coincident', pointAId: bridge.id, pointBId: second.startId },
    ] as CadConstraint[])
      sketch = addConstraint(sketch, relation);
    const joined = await solveCadDocument(document(sketch));
    expect(joined.sketches[0]!.status).toBe('solved');
    const source = joined.document.parts[0]!.sketch,
      before = structuredClone(source);
    const resolved = resolveFilletCorners(source, [first.endId, bridge.id, second.startId]);
    expect(resolved.ok).toBe(true);
    expect(resolved.cornerPointIds).toHaveLength(1);
    const filleted = filletLineCorners(source, { cornerPointIds: resolved.cornerPointIds, radius: 5 });
    expect(filleted.ok).toBe(true);
    if (!filleted.ok) throw Error(filleted.message);
    expect(source).toEqual(before);
    expect(filleted.sketch.constraints.find(constraint => constraint.id === 'owned-length')).toEqual(
      source.constraints.find(constraint => constraint.id === 'owned-length')
    );
    expect(filleted.sketch.constraints.filter(constraint => ['join-a', 'join-b'].includes(constraint.id))).toEqual(
      source.constraints.filter(constraint => ['join-a', 'join-b'].includes(constraint.id))
    );
    for (const id of [first.endId, bridge.id, second.startId])
      expect(points(filleted.sketch).get(id)).toMatchObject({ construction: true });
    const solved = await solveCadDocument(document(filleted.sketch));
    expect(solved.sketches[0]!.status).toBe('solved');
    const out = solved.document.parts[0]!.sketch;
    for (const id of [first.endId, bridge.id, second.startId]) {
      expect(points(out).get(id)!.x).toBeCloseTo(60, 5);
      expect(points(out).get(id)!.y).toBeCloseTo(20, 5);
    }
    expect(out.constraints.find(constraint => constraint.id === 'owned-length')).toMatchObject({ value: 50, sourceEntityId: first.id });
    expect(out.entities.some(entity => entity.id === first.id)).toBe(true);
    expect(out.entities.some(entity => entity.id === second.id)).toBe(true);
    expect(out.entities.find(entity => entity.type === 'arc')).toMatchObject({ radius: 5 });
  });

  it.each(['conic', 'bezier', 'spline'] as const)(
    'solves %s tangency through distinct transitively coincident endpoint IDs',
    async type => {
      let sketch = addLine(createCadPart().sketch, { x1: -20, y1: 0, x2: 0, y2: 0 });
      const line = sketch.entities.find(entity => entity.type === 'line')!;
      sketch.entities = sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity));
      const sourcePoints = [
        { x: 5, y: 5 },
        { x: 30, y: 15 },
        { x: 70, y: 40 },
        { x: 100, y: 40 },
      ];
      sketch =
        type === 'conic'
          ? addConic(sketch, { start: sourcePoints[0]!, end: sourcePoints[3]!, control: sourcePoints[1]! })
          : (type === 'bezier' ? addBezier : addSpline)(sketch, { points: sourcePoints });
      const curve = sketch.entities.at(-1)!;
      if (curve.type !== 'conic' && curve.type !== 'bezier' && curve.type !== 'spline') throw Error();
      expect(curve.startId).not.toBe(line.endId);
      sketch = addPoint(sketch, { x: 0, y: 0 });
      const bridge = sketch.entities.at(-1)!;
      sketch = addConstraint(sketch, { id: 'join-line', type: 'coincident', pointAId: line.endId, pointBId: bridge.id });
      sketch = addConstraint(sketch, { id: 'join-curve', type: 'coincident', pointAId: bridge.id, pointBId: curve.startId });
      sketch = addConstraint(sketch, { id: 'source-dimension', type: 'positionX', pointId: curve.endId, value: 100 });
      sketch = addConstraint(sketch, { id: 'joint-tangent', type: 'tangent', entityAId: line.id, entityBId: curve.id });
      expect(validateCadDocument(document(sketch))).toEqual([]);
      const result = await solveCadDocument(document(sketch));
      expect(result.sketches[0]!.status).toBe('solved');
      const out = result.document.parts[0]!.sketch,
        map = points(out);
      expect(map.get(curve.startId)!.x).toBeCloseTo(0, 5);
      expect(map.get(curve.startId)!.y).toBeCloseTo(0, 5);
      const tangent = evaluateCurveTangent(curve, map, 0);
      expect(Math.abs(tangent.y) / Math.hypot(tangent.x, tangent.y)).toBeLessThan(1e-6);
      expect(out.constraints.find(constraint => constraint.id === 'source-dimension')).toEqual(
        sketch.constraints.find(constraint => constraint.id === 'source-dimension')
      );
      expect(out.entities.map(entity => entity.id)).toEqual(sketch.entities.map(entity => entity.id));
    }
  );

  it('shares native endpoint-normal cache references across two independent rational curves without merging source points', async () => {
    let sketch = addBezier(createCadPart().sketch, {
      points: [
        { x: -60, y: -40 },
        { x: -40, y: -40 },
        { x: -20, y: 0 },
        { x: 0, y: 0 },
      ],
    });
    const left = sketch.entities.find(entity => entity.type === 'bezier')!;
    sketch.entities = sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity));
    sketch = addConic(sketch, { start: { x: 5, y: 5 }, end: { x: 80, y: 40 }, control: { x: 20, y: 10 } });
    const right = sketch.entities.find(entity => entity.type === 'conic')!;
    sketch = addConstraint(sketch, { id: 'rational-joint', type: 'coincident', pointAId: left.endId, pointBId: right.startId });
    sketch = addConstraint(sketch, { id: 'rational-tangent', type: 'tangent', entityAId: left.id, entityBId: right.id });
    const solved = await solveCadDocument(document(sketch));
    expect(solved.sketches[0]!.status).toBe('solved');
    const out = solved.document.parts[0]!.sketch,
      map = points(out);
    const a = evaluateCurveTangent(left, map, 1),
      b = evaluateCurveTangent(right, map, 0);
    expect(Math.abs(a.x * b.y - a.y * b.x) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))).toBeLessThan(1e-6);
    expect(out.entities.map(entity => entity.id)).toEqual(sketch.entities.map(entity => entity.id));
    expect(out.constraints.map(constraint => constraint.id)).toEqual(sketch.constraints.map(constraint => constraint.id));
  });
});
