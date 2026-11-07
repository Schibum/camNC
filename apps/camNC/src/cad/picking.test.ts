import type { CadEntity, CadSketch } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { pickSketchPoint, pickSketchSnap } from './picking';

const point = (id: string, x: number, y: number): CadEntity => ({ id, type: 'point', x, y });
const line = (id: string, startId: string, endId: string): CadEntity => ({ id, type: 'line', startId, endId });
const sketch = (...entities: CadEntity[]): CadSketch => ({ id: 'sketch', entities, constraints: [] });
const identity = { project: (p: { x: number; y: number }) => ({ ...p }) };

describe('screen-space sketch picking', () => {
  it.each([0.1, 1, 10])('uses the painted curve only for exact-distance ties at zoom %s', scale => {
    const options = {
      project: (p: { x: number; y: number }) => ({ x: p.x * scale, y: -p.y * scale }),
      includeMidpoints: false,
      preferredCurveId: 'z-handle',
    };
    const source = sketch(point('a', 0, 0), point('b', 1000, 0), line('a-parent', 'a', 'b'), point('c', 0, 0), point('d', 1000, 0), {
      ...line('z-handle', 'c', 'd'),
      construction: true,
    });
    expect(pickSketchSnap(source, { x: 300 * scale, y: 0 }, options)?.entityId).toBe('z-handle');
    const separated = {
      ...source,
      entities: source.entities.map(entity =>
        entity.type === 'point' && ['a', 'b'].includes(entity.id) ? { ...entity, y: 2 / scale } : entity
      ),
    };
    expect(pickSketchSnap(separated, { x: 300 * scale, y: -2 }, options)?.entityId).toBe('a-parent');
    expect(pickSketchSnap(separated, { x: 300 * scale, y: 10 }, options)).toBeNull();
  });

  it('honors the painted endpoint only for equal-distance overlapping aliases', () => {
    const aliases = sketch(point('a', 10, 20), point('b', 10, 20));
    expect(pickSketchPoint(aliases, { x: 10, y: 20 }, { ...identity, preferredPointId: 'b' })?.targetPointId).toBe('b');
    const separated = sketch(point('near', 10, 20), point('painted', 12, 20));
    expect(pickSketchPoint(separated, { x: 10, y: 20 }, { ...identity, preferredPointId: 'painted' })?.targetPointId).toBe('near');
    expect(pickSketchPoint(aliases, { x: 100, y: 100 }, { ...identity, preferredPointId: 'b' })).toBeNull();
  });
  it('chooses the nearest endpoint instead of the first point in source order and preserves its ID', () => {
    const source = sketch(
      point('far', 0, 0),
      point('near', 3, 0),
      point('end-a', 100, 100),
      point('end-b', 200, 200),
      line('line-a', 'far', 'end-a'),
      line('line-b', 'near', 'end-b')
    );
    const options = { project: (p: { x: number; y: number }) => ({ x: p.x * 2 + 100, y: 200 - p.y * 2 }) };
    expect(pickSketchSnap(source, { x: 108, y: 200 }, options)).toMatchObject({
      kind: 'endpoint',
      targetPointId: 'near',
      point: { x: 3, y: 0 },
      distancePx: 2,
    });
    expect(pickSketchSnap({ ...source, entities: [...source.entities].reverse() }, { x: 108, y: 200 }, options)?.targetPointId).toBe(
      'near'
    );
  });

  it.each([0.1, 1, 10])('keeps the point hit radius at eight pixels with zoom %s', scale => {
    const source = sketch(point('point', 20, 30));
    const options = { project: (p: { x: number; y: number }) => ({ x: p.x * scale, y: -p.y * scale }) };
    const screen = options.project({ x: 20, y: 30 });
    expect(pickSketchPoint(source, { x: screen.x + 7.9, y: screen.y }, options)?.targetPointId).toBe('point');
    expect(pickSketchPoint(source, { x: screen.x + 8.1, y: screen.y }, options)).toBeNull();
  });

  it('picks circular centers as point identities and resolves equal-distance ties deterministically', () => {
    const source = sketch(point('center', 50, 50), { id: 'circle', type: 'circle', centerId: 'center', radius: 30 });
    expect(pickSketchSnap(source, { x: 52, y: 51 }, identity)).toMatchObject({ kind: 'center', targetPointId: 'center' });
    const ties = sketch(point('b', 1, 0), point('a', -1, 0));
    expect(pickSketchPoint(ties, { x: 0, y: 0 }, identity)?.targetPointId).toBe('a');
    expect(pickSketchPoint({ ...ties, entities: [...ties.entities].reverse() }, { x: 0, y: 0 }, identity)?.targetPointId).toBe('a');
  });

  it('prioritizes endpoint hits over a nearby midpoint, then midpoint intent over a generic line hit', () => {
    const short = sketch(point('start', 0, 0), point('end', 12, 0), line('short', 'start', 'end'));
    expect(pickSketchSnap(short, { x: 5, y: 0 }, identity)).toMatchObject({ kind: 'endpoint', targetPointId: 'start' });
    const long = sketch(point('start', 0, 0), point('end', 100, 0), line('long', 'start', 'end'));
    expect(pickSketchSnap(long, { x: 52, y: 2 }, identity)).toMatchObject({
      kind: 'midpoint',
      point: { x: 50, y: 0 },
      intent: { type: 'midpoint', entityId: 'long' },
    });
    expect(pickSketchSnap(long, { x: 52, y: 2 }, { ...identity, includeMidpoints: false })).toMatchObject({
      kind: 'pointOnCurve',
      point: { x: 52, y: 0 },
    });
  });

  it('projects onto finite line segments and chooses the nearest curve within six pixels', () => {
    const source = sketch(
      point('left', 0, 0),
      point('right', 100, 0),
      line('horizontal', 'left', 'right'),
      point('bottom', 40, -100),
      point('top', 40, 100),
      line('vertical', 'bottom', 'top')
    );
    const nearest = pickSketchSnap(source, { x: 39, y: 14 }, identity)!;
    expect(nearest).toMatchObject({ kind: 'pointOnCurve', entityId: 'vertical', distancePx: 1 });
    expect(nearest.point.x).toBeCloseTo(40, 8);
    expect(nearest.point.y).toBeCloseTo(14, 8);
    const single = sketch(point('left', 0, 0), point('right', 100, 0), line('line', 'left', 'right'));
    expect(pickSketchSnap(single, { x: 30, y: 5.9 }, identity)).toMatchObject({ kind: 'pointOnCurve', parameter: 0.3, distancePx: 5.9 });
    expect(pickSketchSnap(single, { x: 30, y: 6.1 }, identity)).toBeNull();
    expect(pickSketchSnap(single, { x: -10, y: 0 }, identity)).toBeNull();
  });

  it('excludes dragged points and their incident curve features while retaining shared eligible endpoints', () => {
    const source = sketch(point('start', 0, 0), point('end', 100, 0), line('line', 'start', 'end'));
    expect(pickSketchSnap(source, { x: 50, y: 0 }, { ...identity, excludePointIds: ['start'] })).toBeNull();
    expect(pickSketchSnap(source, { x: 0, y: 0 }, { ...identity, excludeEntityIds: ['line'] })).toBeNull();
    const shared = { ...source, entities: [...source.entities, point('other', 0, 100), line('other-line', 'start', 'other')] };
    expect(pickSketchSnap(shared, { x: 0, y: 0 }, { ...identity, excludeEntityIds: ['line'] })?.targetPointId).toBe('start');
  });

  it('projects onto a circle after zoom and Y inversion and retains circular point-on-curve intent', () => {
    const source = sketch(point('center', 0, 0), { id: 'circle', type: 'circle', centerId: 'center', radius: 100 });
    const options = { project: (p: { x: number; y: number }) => ({ x: p.x * 2 + 100, y: 300 - p.y * 2 }) };
    const hit = pickSketchSnap(source, { x: 100, y: 96 }, options)!;
    expect(hit).toMatchObject({ kind: 'pointOnCurve', entityId: 'circle', intent: { type: 'pointOnCurve', entityId: 'circle' } });
    expect(hit.point.x).toBeCloseTo(0, 5);
    expect(hit.point.y).toBeCloseTo(100, 5);
    expect(hit.distancePx).toBeCloseTo(4, 5);
  });

  it('finds the closest projected ellipse point under a nonuniform affine screen transform', () => {
    const source = sketch(point('center', 0, 0), { id: 'circle', type: 'circle', centerId: 'center', radius: 100 });
    const hit = pickSketchSnap(source, { x: 150, y: -70 }, { project: p => ({ x: p.x * 2, y: -p.y }) })!;
    expect(hit.kind).toBe('pointOnCurve');
    expect(Math.hypot(hit.point.x, hit.point.y)).toBeCloseTo(100, 6);
    const angle = hit.parameter!;
    const dot = (150 - hit.screenPoint.x) * (-200 * Math.sin(angle)) + (-70 - hit.screenPoint.y) * (-100 * Math.cos(angle));
    expect(Math.abs(dot)).toBeLessThan(0.001);
    expect(hit.distancePx).toBeLessThan(6);
  });

  it('respects finite and wrapped arc sweeps instead of snapping onto the rest of the supporting circle', () => {
    const source = sketch(point('center', 0, 0), point('start', 100, 0), point('end', 0, 100), {
      id: 'arc',
      type: 'arc',
      centerId: 'center',
      startId: 'start',
      endId: 'end',
      radius: 100,
      startAngle: 0,
      endAngle: Math.PI / 2,
    });
    expect(pickSketchSnap(source, { x: -100, y: 0 }, identity)).toBeNull();
    expect(pickSketchSnap(source, { x: Math.SQRT1_2 * 100, y: Math.SQRT1_2 * 100 }, identity)).toMatchObject({
      kind: 'pointOnCurve',
      entityId: 'arc',
    });
    expect(pickSketchSnap(source, { x: 101, y: 1 }, identity)).toMatchObject({ kind: 'endpoint', targetPointId: 'start' });
    const wrapped = sketch(point('center', 0, 0), point('start', 0, -100), point('end', 0, 100), {
      id: 'arc',
      type: 'arc',
      centerId: 'center',
      startId: 'start',
      endId: 'end',
      radius: 100,
      startAngle: Math.PI * 1.5,
      endAngle: Math.PI / 2,
    });
    expect(pickSketchSnap(wrapped, { x: 100, y: 0 }, identity)).toMatchObject({ kind: 'pointOnCurve', entityId: 'arc' });
    expect(pickSketchSnap(wrapped, { x: -100, y: 0 }, identity)).toBeNull();
  });

  it('ignores invalid geometry and optional construction/curve features without mutating the source', () => {
    const source = sketch(point('bad', NaN, 0), { id: 'construction', type: 'point', x: 10, y: 10, construction: true });
    const copy = structuredClone(source);
    expect(pickSketchSnap(source, { x: 10, y: 10 }, { ...identity, includeConstruction: false })).toBeNull();
    expect(pickSketchSnap(source, { x: Infinity, y: 0 }, identity)).toBeNull();
    expect(source).toEqual(copy);
  });
});
