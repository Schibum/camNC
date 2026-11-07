import {
  addConstraint,
  addPoint,
  createPlateDocument,
  solveCadDocument,
  updateDimension,
  type CadDocument,
  type CadEntity,
  type CadPoint,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
import { describe, expect, it, vi } from 'vitest';
import { inferDrawingPoint, inferredPointConstraints } from './drawingInference';

const point = (id: string, x: number, y: number): CadPointEntity => ({ id, type: 'point', x, y });
const sketch = (...entities: CadEntity[]): CadSketch => ({ id: 'sketch', entities, constraints: [] });
const identity = { project: (p: CadPoint) => ({ ...p }) };
const dualReferences = () => sketch(point('horizontal-source', 0, 60), point('vertical-source', 80, -20));

describe('drawing alignment inference', () => {
  it('finds an off-geometry horizontal alignment and retains its guide source identity', () => {
    const result = inferDrawingPoint(sketch(point('reference', 0, 0)), { x: 100, y: 6 }, identity);
    expect(result.point).toEqual({ x: 100, y: 0 });
    expect(result.snap).toBeNull();
    expect(result.alignments).toEqual([
      { type: 'horizontalPoints', sourcePointId: 'reference', sourcePoint: { x: 0, y: 0 }, distancePx: 6 },
    ]);
    expect(result.guides).toEqual([{ axis: 'horizontal', sourcePointId: 'reference', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }]);
  });

  it('combines independent horizontal and vertical references before a point is created', () => {
    const result = inferDrawingPoint(dualReferences(), { x: 84, y: 63 }, identity);
    expect(result.point).toEqual({ x: 80, y: 60 });
    expect(result.alignments.map(a => [a.type, a.sourcePointId])).toEqual([
      ['horizontalPoints', 'horizontal-source'],
      ['verticalPoints', 'vertical-source'],
    ]);
    expect(result.guides).toEqual([
      { axis: 'horizontal', sourcePointId: 'horizontal-source', from: { x: 0, y: 60 }, to: { x: 80, y: 60 } },
      { axis: 'vertical', sourcePointId: 'vertical-source', from: { x: 80, y: -20 }, to: { x: 80, y: 60 } },
    ]);
  });

  it('ranks unpreferred candidates by axis correction, then source proximity, independent of entity order', () => {
    const source = sketch(point('nearby', 80, 55), point('closer-axis', 0, 59));
    for (const entities of [source.entities, [...source.entities].reverse()]) {
      expect(inferDrawingPoint({ ...source, entities }, { x: 90, y: 62 }, identity).alignments[0]?.sourcePointId).toBe('closer-axis');
    }
    const tied = sketch(point('far', 0, 58), point('near', 80, 66));
    expect(inferDrawingPoint(tied, { x: 90, y: 62 }, identity).alignments[0]?.sourcePointId).toBe('near');
    const exactTie = sketch(point('b', 0, 58), point('a', 0, 66));
    expect(inferDrawingPoint(exactTie, { x: 90, y: 62 }, identity).alignments[0]?.sourcePointId).toBe('a');
  });

  it('keeps an exact endpoint contact stronger than a preferred remote alignment', () => {
    const source = sketch(point('end', 100, 100), point('other', 140, 140), point('axis', 0, 106), {
      id: 'line',
      type: 'line',
      startId: 'end',
      endId: 'other',
    });
    const result = inferDrawingPoint(source, { x: 105, y: 106 }, { ...identity, preferredPointIds: ['axis'] });
    expect(result.snap).toMatchObject({ kind: 'endpoint', targetPointId: 'end' });
    expect(result.point).toEqual({ x: 100, y: 100 });
    expect(result.alignments).toEqual([]);
    expect(result.guides).toEqual([]);
  });

  it.each([
    ['midpoint', 48],
    ['pointOnCurve', 25],
  ] as const)('does not pull a %s contact off its curve', (kind, x) => {
    const source = sketch(point('start', 0, 0), point('end', 100, 0), point('preferred-axis', 200, 4), {
      id: 'line',
      type: 'line',
      startId: 'start',
      endId: 'end',
    });
    const result = inferDrawingPoint(source, { x, y: 4 }, { ...identity, preferredPointIds: ['preferred-axis'] });
    expect(result.snap?.kind).toBe(kind);
    expect(result.point.y).toBe(0);
    expect(result.alignments).toEqual([]);
  });

  it('returns the exact raw point with no proposals or projection when Snap is off', () => {
    const project = vi.fn(identity.project),
      raw = { x: 84.4, y: 63.3 };
    const result = inferDrawingPoint(dualReferences(), raw, {
      project,
      enabled: false,
      lockedAxes: { x: 0, y: 0 },
      preferredPointIds: ['horizontal-source'],
    });
    expect(result).toEqual({ point: raw, snap: null, alignments: [], guides: [] });
    expect(result.point).not.toBe(raw);
    expect(project).not.toHaveBeenCalled();
  });

  it('uses the fixed origin as an ordinary persistent alignment reference', () => {
    const source = sketch({ ...point('sketch:origin', 0, 0), fixed: true, construction: true });
    const result = inferDrawingPoint(source, { x: 100, y: 7 }, identity);
    expect(result.point).toEqual({ x: 100, y: 0 });
    expect(result.alignments[0]?.sourcePointId).toBe('sketch:origin');
  });

  it.each([0.1, 1, 25, 100])('keeps the axis tolerance in CSS pixels at zoom %s, including Y inversion and translation', scale => {
    const source = sketch(point('reference', 0, 0));
    const options = { project: (p: CadPoint) => ({ x: p.x * scale + 200, y: 300 - p.y * scale }) };
    expect(inferDrawingPoint(source, { x: 100 / scale, y: 7.9 / scale }, options).point.y).toBe(0);
    expect(inferDrawingPoint(source, { x: 100 / scale, y: 8.1 / scale }, options).alignments).toEqual([]);
  });

  it('does not fabricate a high-zoom alignment by rounding a raw coordinate first', () => {
    const result = inferDrawingPoint(
      sketch(point('reference', 0, 0)),
      { x: 100, y: 0.49 },
      { project: p => ({ x: p.x * 100, y: -p.y * 100 }) }
    );
    expect(result.point).toEqual({ x: 100, y: 0.49 });
    expect(result.alignments).toEqual([]);
  });

  it('excludes a moving point from contact and alignment even when it is preferred', () => {
    const source = sketch(point('own', 80, 60), point('external', 0, 60));
    const result = inferDrawingPoint(source, { x: 82, y: 62 }, { ...identity, excludePointIds: ['own'], preferredPointIds: ['own'] });
    expect(result.snap).toBeNull();
    expect(result.point).toEqual({ x: 82, y: 60 });
    expect(result.alignments.map(a => a.sourcePointId)).toEqual(['external']);
  });

  it('shares point eligibility with picking, excluding solely owned references while retaining shared points', () => {
    const source = sketch(point('shared', 0, 20), point('end', 20, 30), { id: 'excluded', type: 'line', startId: 'shared', endId: 'end' });
    const options = { ...identity, excludeEntityIds: ['excluded'] };
    expect(inferDrawingPoint(source, { x: 100, y: 23 }, options).alignments).toEqual([]);
    source.entities.push(point('other', 20, 100), { id: 'remaining', type: 'line', startId: 'shared', endId: 'other' });
    expect(inferDrawingPoint(source, { x: 100, y: 23 }, options).alignments[0]?.sourcePointId).toBe('shared');
  });

  it('infers from circular centers and arc endpoints without needing to hover on geometry', () => {
    const circular = sketch(point('center', 40, 30), { id: 'circle', type: 'circle', centerId: 'center', radius: 10 });
    expect(inferDrawingPoint(circular, { x: 100, y: 33 }, identity).alignments[0]?.sourcePointId).toBe('center');
    const arc = sketch(point('center', 40, 40), point('start', 50, 40), point('end', 40, 50), {
      id: 'arc',
      type: 'arc',
      centerId: 'center',
      startId: 'start',
      endId: 'end',
      radius: 10,
      startAngle: 0,
      endAngle: Math.PI / 2,
    });
    expect(inferDrawingPoint(arc, { x: 100, y: 43 }, identity).alignments[0]?.sourcePointId).toBe('start');
  });

  it('prioritizes the newest eligible wake-up reference, without accepting references outside tolerance', () => {
    const source = sketch(point('newest', 0, 7), point('older', 10, 3), point('outside', 20, 20));
    const options = { ...identity, preferredPointIds: ['outside', 'newest', 'older'] };
    expect(inferDrawingPoint(source, { x: 100, y: 2 }, options).point.y).toBe(7);
    expect(inferDrawingPoint(source, { x: 100, y: 2 }, { ...options, preferredPointIds: ['older', 'newest'] }).point.y).toBe(3);
    expect(inferDrawingPoint(source, { x: 100, y: 2 }, { ...options, excludePointIds: ['newest'] }).point.y).toBe(3);
  });

  it('retains a locked orientation axis while accepting an independent alignment and only exact matching references', () => {
    const source = sketch(point('preferred-but-incompatible', 0, 5), point('exact-horizontal', 20, 0), point('vertical', 103, 50));
    const result = inferDrawingPoint(
      source,
      { x: 100, y: 6 },
      { ...identity, lockedAxes: { y: 0 }, preferredPointIds: ['preferred-but-incompatible'] }
    );
    expect(result.point).toEqual({ x: 103, y: 0 });
    expect(result.alignments.map(a => a.sourcePointId)).toEqual(['exact-horizontal', 'vertical']);
    expect(result.alignments.map(a => a.distancePx)).toEqual([0, 3]);
  });

  it('keeps both tangent-locked coordinates and does not add approximate external relations', () => {
    const source = sketch(point('almost', 102, 24), point('horizontal', 0, 25), point('vertical', 100, 100));
    const result = inferDrawingPoint(
      source,
      { x: 105, y: 27 },
      { ...identity, directSnap: null, lockedAxes: { x: 100, y: 25 }, preferredPointIds: ['almost'] }
    );
    expect(result.point).toEqual({ x: 100, y: 25 });
    expect(result.alignments.map(a => a.sourcePointId)).toEqual(['horizontal', 'vertical']);
  });

  it('can reuse a precomputed contact or explicitly skip duplicate contact picking', () => {
    const source = sketch(point('endpoint', 0, 0));
    const result = inferDrawingPoint(source, { x: 3, y: 4 }, { ...identity, directSnap: null });
    expect(result.snap).toBeNull();
    expect(result.alignments).toHaveLength(2);
    const snap = { kind: 'point' as const, point: { x: 20, y: 30 }, screenPoint: { x: 20, y: 30 }, distancePx: 1, targetPointId: 'known' };
    expect(inferDrawingPoint(source, { x: 21, y: 30 }, { ...identity, directSnap: snap })).toMatchObject({
      point: snap.point,
      snap,
      alignments: [],
    });
  });

  it('does not mutate the source and ignores nonfinite geometry/projections', () => {
    const source = sketch(point('invalid', NaN, 0), point('construction', 0, 20));
    source.entities[1]!.construction = true;
    const before = structuredClone(source);
    expect(inferDrawingPoint(source, { x: 100, y: 23 }, { ...identity, includeConstruction: false }).alignments).toEqual([]);
    expect(inferDrawingPoint(source, { x: 100, y: 23 }, { project: () => ({ x: NaN, y: 0 }) }).alignments).toEqual([]);
    const result = inferDrawingPoint(source, { x: 100, y: 23 }, identity);
    result.guides[0]!.from.x = 1000;
    expect(source).toEqual(before);
  });
});

describe('persistent drawing-inference proposals', () => {
  it('binds both axes to concrete point IDs and skips duplicate, coincident, self and missing references', () => {
    const source = dualReferences(),
      result = inferDrawingPoint(source, { x: 84, y: 63 }, identity);
    source.entities.push(point('new', 80, 60));
    expect(inferredPointConstraints(result, 'new', source)).toEqual([
      { type: 'horizontalPoints', pointAId: 'horizontal-source', pointBId: 'new' },
      { type: 'verticalPoints', pointAId: 'vertical-source', pointBId: 'new' },
    ]);
    source.constraints.push({ id: 'existing', type: 'horizontalPoints', pointAId: 'new', pointBId: 'horizontal-source' });
    expect(inferredPointConstraints(result, 'new', source)).toEqual([
      { type: 'verticalPoints', pointAId: 'vertical-source', pointBId: 'new' },
    ]);
    source.constraints = [{ id: 'coincident', type: 'coincident', pointAId: 'new', pointBId: 'horizontal-source' }];
    expect(inferredPointConstraints(result, 'new', source)).toHaveLength(1);
    expect(inferredPointConstraints(result, 'horizontal-source', source).every(c => !('pointAId' in c) || c.pointAId !== c.pointBId)).toBe(
      true
    );
    expect(inferredPointConstraints(result, 'missing', source)).toEqual([]);
    expect(inferredPointConstraints(result, '', source)).toEqual([]);
  });

  it('does not duplicate a line H/V constraint on the same endpoint pair', () => {
    const source = sketch(point('start', 0, 0), point('end', 100, 0), { id: 'line', type: 'line', startId: 'start', endId: 'end' });
    source.constraints.push({ id: 'horizontal-line', type: 'horizontal', entityId: 'line' });
    const result = inferDrawingPoint(
      source,
      { x: 100, y: 3 },
      { ...identity, excludePointIds: ['end'], includeCurves: false, includeMidpoints: false }
    );
    expect(result.alignments[0]?.sourcePointId).toBe('start');
    expect(inferredPointConstraints(result, 'end', source)).toEqual([]);
  });

  it.each(['horizontalPoints', 'verticalPoints'] as const)(
    'persists %s through a source driving-dimension edit using actual PlaneGCS WASM',
    async type => {
      let document: CadDocument = createPlateDocument({ width: 160, height: 100 });
      let part = document.parts[0]!;
      part.sketch = addPoint(part.sketch, { x: 20, y: 30 });
      const sourceId = part.sketch.entities.at(-1)!.id;
      part.sketch = addConstraint(part.sketch, { type: 'positionX', pointId: sourceId, value: 20 });
      part.sketch = addConstraint(part.sketch, { type: 'positionY', pointId: sourceId, value: 30 });
      const editedCoordinate = type === 'horizontalPoints' ? 'positionY' : 'positionX';
      const sourceDimension = part.sketch.constraints.find(c => c.type === editedCoordinate && 'pointId' in c && c.pointId === sourceId)!;
      const raw = type === 'horizontalPoints' ? { x: 110, y: 32 } : { x: 22, y: 80 };
      const result = inferDrawingPoint(part.sketch, raw, identity);
      expect(result.alignments.map(a => a.type)).toEqual([type]);
      part.sketch = addPoint(part.sketch, result.point);
      const createdId = part.sketch.entities.at(-1)!.id;
      for (const constraint of inferredPointConstraints(result, createdId, part.sketch))
        part.sketch = addConstraint(part.sketch, constraint);
      part.sketch = addConstraint(part.sketch, {
        type: type === 'horizontalPoints' ? 'positionX' : 'positionY',
        pointId: createdId,
        value: type === 'horizontalPoints' ? 110 : 80,
      });
      const first = await solveCadDocument(document);
      expect(first.status, JSON.stringify(first.diagnostics)).toBe('solved');
      document = updateDimension(first.document, sourceDimension.id, 50);
      const moved = await solveCadDocument(document);
      expect(moved.status, JSON.stringify(moved.diagnostics)).toBe('solved');
      part = moved.document.parts[0]!;
      const created = part.sketch.entities.find((e): e is CadPointEntity => e.id === createdId && e.type === 'point')!;
      expect(type === 'horizontalPoints' ? created.y : created.x).toBeCloseTo(50, 6);
      expect(part.sketch.constraints.some(c => c.type === type && c.pointAId === sourceId && c.pointBId === createdId)).toBe(true);
      expect(moved.parts[0]!.loops[0]!.id).toBe(first.parts[0]!.loops[0]!.id);
    }
  );
});
