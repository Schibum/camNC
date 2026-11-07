import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addConstraint,
  addLine,
  addPoint,
  createCadDocument,
  createCadPart,
  parseCadDocument,
  updateDimension,
} from './document';
import {
  captureDimensionPlacement,
  migrateDimensionPlacements,
  resolveDimensionPlacement,
  withDimensionPlacement,
} from './dimensionPlacement';
import { solveCadDocument } from './solver';
import type { CadDimension, CadDocument, CadPoint, CadSketch } from './types';

const closePoint = (actual: CadPoint | null, expected: CadPoint) => {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected.x, 8);
  expect(actual!.y).toBeCloseTo(expected.y, 8);
};
const translate = (sketch: CadSketch, delta: CadPoint): CadSketch => ({
  ...sketch,
  entities: sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, x: entity.x + delta.x, y: entity.y + delta.y } : entity)),
});
const documentOf = (sketch: CadSketch): CadDocument => ({ ...createCadDocument(), parts: [{ ...createCadPart(), sketch }] });

function linearFixture() {
  let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 40, x2: 120, y2: 40 });
  const first = sketch.entities.find(entity => entity.type === 'line')!;
  sketch = addLine(sketch, { x1: 30, y1: 80, x2: 110, y2: 80 });
  const second = sketch.entities.filter(entity => entity.type === 'line')[1]!;
  sketch = addPoint(sketch, { x: 70, y: 65 });
  const point = sketch.entities.at(-1)!;
  sketch = addCircle(sketch, { x: 180, y: 90, radius: 10 });
  const circle = sketch.entities.at(-1)!;
  sketch = addCircle(sketch, { x: 230, y: 90, radius: 15 });
  const otherCircle = sketch.entities.at(-1)!;
  const dimensions: CadDimension[] = [
    { id: 'length', type: 'distance', pointAId: first.startId, pointBId: first.endId, value: 100 },
    { id: 'horizontal', type: 'distanceX', pointAId: first.endId, pointBId: second.endId, value: -10 },
    { id: 'vertical', type: 'distanceY', pointAId: first.endId, pointBId: second.endId, value: 40 },
    { id: 'position-x', type: 'positionX', pointId: point.id, value: 70 },
    { id: 'position-y', type: 'positionY', pointId: point.id, value: 65 },
    { id: 'point-line', type: 'pointLineDistance', pointId: point.id, entityId: first.id, value: 25 },
    { id: 'lines', type: 'lineLineDistance', entityAId: first.id, entityBId: second.id, value: 40 },
    {
      id: 'point-circle',
      type: 'pointArcDistance',
      pointId: point.id,
      entityId: circle.id,
      value: Math.hypot(110, 25) - 10,
      side: 'outside',
    },
    { id: 'line-circle', type: 'lineCircleDistance', entityAId: first.id, entityBId: circle.id, value: 40, side: 'outside' },
    {
      id: 'circles',
      type: 'circleCircleDistance',
      entityAId: circle.id,
      entityBId: otherCircle.id,
      value: 25,
      radiusASign: -1,
      radiusBSign: -1,
      direction: 1,
    },
    {
      id: 'offset',
      type: 'offset',
      value: 40,
      members: [{ kind: 'line', sourceId: first.id, targetId: second.id, side: 1, endpoints: false }],
    },
  ];
  return { sketch, first, second, circle, point, dimensions };
}

function angleFixture(parallel = false) {
  let sketch = addLine(createCadPart().sketch, { x1: 40, y1: 40, x2: 140, y2: 40 });
  sketch = addLine(sketch, parallel ? { x1: 40, y1: 60, x2: 140, y2: 60 } : { x1: 40, y1: 40, x2: 90, y2: 40 + 50 * Math.sqrt(3) });
  const [first, second] = sketch.entities.filter(entity => entity.type === 'line');
  const dimension: CadDimension = {
    id: 'angle',
    type: 'angle',
    entityAId: first!.id,
    entityBId: second!.id,
    value: parallel ? 0 : 60,
    orientation: 1,
  };
  return { sketch, first: first!, second: second!, dimension };
}

describe('geometric dimension placement frames', () => {
  it('round-trips every linear witness category, including signed axes and labels beyond the witness span', () => {
    const { sketch, dimensions } = linearFixture();
    for (const dimension of dimensions)
      for (const position of [
        { x: -80, y: -40 },
        { x: 165, y: 130 },
      ]) {
        const placed = withDimensionPlacement(sketch, dimension, position);
        expect(placed).not.toHaveProperty('labelPosition');
        expect(placed.labelPlacement?.kind).toBe('linear');
        closePoint(resolveDimensionPlacement(sketch, placed), position);
      }
  });

  it('translates every two-reference linear annotation with its geometry without mutating either source', () => {
    const { sketch, dimensions } = linearFixture();
    const position = { x: 165, y: 130 },
      delta = { x: 20, y: -35 },
      before = structuredClone(sketch);
    for (const dimension of dimensions.filter(dimension => dimension.type !== 'positionX' && dimension.type !== 'positionY')) {
      const placed = withDimensionPlacement(sketch, dimension, position),
        stored = structuredClone(placed);
      closePoint(resolveDimensionPlacement(translate(sketch, delta), placed), { x: 185, y: 95 });
      expect(placed).toEqual(stored);
    }
    expect(sketch).toEqual(before);
  });

  it('retains along-span fraction and perpendicular millimetres when a line is resized or rotated', () => {
    const { sketch, first, dimensions } = linearFixture();
    const placed = withDimensionPlacement(sketch, dimensions[0]!, { x: 45, y: 70 });
    expect(placed.labelPlacement).toEqual({ kind: 'linear', fraction: 0.25, normalOffset: 30 });
    const changed = (x: number, y: number): CadSketch => ({
      ...sketch,
      entities: sketch.entities.map(entity => (entity.id === first.endId ? { ...entity, x, y } : entity)),
    });
    closePoint(resolveDimensionPlacement(changed(220, 40), placed), { x: 70, y: 70 });
    closePoint(resolveDimensionPlacement(changed(20, 140), placed), { x: -10, y: 65 });
  });

  it.each(['radius', 'diameter'] as const)(
    'retains circular bearing and radius ratio for a %s through translation and radius changes',
    type => {
      const { sketch, circle } = linearFixture();
      const dimension: CadDimension = { id: type, type, entityId: circle.id, value: type === 'radius' ? 10 : 20 };
      const placed = withDimensionPlacement(sketch, dimension, { x: 210, y: 110 });
      expect(placed.labelPlacement).toMatchObject({ kind: 'radial', angle: Math.atan2(20, 30), radiusRatio: Math.hypot(30, 20) / 10 });
      const moved = translate(sketch, { x: -20, y: 35 });
      closePoint(resolveDimensionPlacement(moved, placed), { x: 190, y: 145 });
      const resized = { ...moved, entities: moved.entities.map(entity => (entity.id === circle.id ? { ...entity, radius: 20 } : entity)) };
      closePoint(resolveDimensionPlacement(resized, placed), { x: 220, y: 165 });
    }
  );

  it('keeps angular radius and phase relative to its first oriented ray, including placement outside the wedge', () => {
    const { sketch, dimension } = angleFixture();
    for (const position of [
      { x: 105, y: 65 },
      { x: -10, y: 10 },
    ]) {
      const placed = withDimensionPlacement(sketch, dimension, position);
      closePoint(resolveDimensionPlacement(sketch, placed), position);
      closePoint(resolveDimensionPlacement(sketch, { ...placed, value: 90 }), position);
      closePoint(resolveDimensionPlacement(translate(sketch, { x: 30, y: -20 }), placed), { x: position.x + 30, y: position.y - 20 });
      const rotated = {
        ...sketch,
        entities: sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, x: 80 - entity.y, y: entity.x } : entity)),
      };
      closePoint(resolveDimensionPlacement(rotated, placed), { x: 80 - position.y, y: position.x });
    }
    const reversed = { ...dimension, reversedA: true, reversedB: true };
    closePoint(resolveDimensionPlacement(sketch, withDimensionPlacement(sketch, reversed, { x: 105, y: 65 })), { x: 105, y: 65 });
  });

  it('retains a finite fallback in the same reference-centroid frame when parallel lines become intersecting', () => {
    const { sketch, second, dimension } = angleFixture(true);
    const placed = { ...dimension, labelPlacement: { kind: 'fallback' as const, offset: { x: 15, y: 45 } } };
    expect(placed.labelPlacement?.kind).toBe('fallback');
    closePoint(resolveDimensionPlacement(translate(sketch, { x: 20, y: -10 }), placed), { x: 125, y: 85 });
    const changed = {
      ...sketch,
      entities: sketch.entities.map(entity => (entity.id === second.endId ? { ...entity, y: 100 } : entity)),
    };
    closePoint(resolveDimensionPlacement(changed, placed), { x: 105, y: 105 });
  });

  it('keeps zero-gap fallback placement finite as its witnesses separate', () => {
    const { sketch, first, point } = linearFixture();
    const zero = { ...sketch, entities: sketch.entities.map(entity => (entity.id === point.id ? { ...entity, y: 40 } : entity)) };
    const dimension: CadDimension = { id: 'zero', type: 'pointLineDistance', entityId: first.id, pointId: point.id, value: 0 };
    const placed = withDimensionPlacement(zero, dimension, { x: 150, y: 60 });
    expect(placed.labelPlacement).toEqual({ kind: 'fallback', offset: { x: 80, y: 20 } });
    closePoint(resolveDimensionPlacement(sketch, placed), { x: 150, y: 72.5 });
  });

  it('keeps invalid referenced annotations editable with one finite absolute authority until repaired', () => {
    const { sketch, dimensions } = linearFixture();
    const placed = withDimensionPlacement(sketch, { ...dimensions[0]!, pointBId: 'missing' } as CadDimension, { x: 80, y: 90 });
    expect(placed.labelPosition).toEqual({ x: 80, y: 90 });
    expect(placed).not.toHaveProperty('labelPlacement');
    closePoint(resolveDimensionPlacement(sketch, placed), { x: 80, y: 90 });
    expect(captureDimensionPlacement(sketch, dimensions[0]!, { x: Infinity, y: 90 })).toBeNull();
    expect(() => withDimensionPlacement(sketch, dimensions[0]!, { x: Infinity, y: 90 })).toThrow('must be finite');
  });

  it('gives canonical relative placement precedence over a stale absolute and leaves unplaced defaults to the renderer', () => {
    const { sketch, dimensions } = linearFixture();
    expect(resolveDimensionPlacement(sketch, dimensions[0]!)).toBeNull();
    const placed = { ...withDimensionPlacement(sketch, dimensions[0]!, { x: 45, y: 70 }), labelPosition: { x: -999, y: -999 } };
    const source = documentOf({ ...sketch, constraints: [placed] });
    const migrated = migrateDimensionPlacements(source);
    const constraint = migrated.parts[0]!.sketch.constraints[0] as CadDimension;
    expect(constraint).not.toHaveProperty('labelPosition');
    closePoint(resolveDimensionPlacement(sketch, constraint), { x: 45, y: 70 });
    expect(source.parts[0]!.sketch.constraints[0]).toHaveProperty('labelPosition');
    expect(migrateDimensionPlacements(migrated)).toEqual(migrated);
  });

  it('leaves finite legacy coordinates intact if converting them would overflow a derived placement parameter', () => {
    let sketch = addCircle(createCadPart().sketch, { x: -1e308, y: -1e308, radius: 10 });
    const circle = sketch.entities.find(entity => entity.type === 'circle')!;
    sketch = addConstraint(sketch, { type: 'diameter', entityId: circle.id, value: 20, labelPosition: { x: 1e308, y: 1e308 } });
    const document = documentOf(sketch),
      migrated = migrateDimensionPlacements(document),
      constraint = migrated.parts[0]!.sketch.constraints[0] as CadDimension;
    expect(constraint).not.toHaveProperty('labelPlacement');
    expect(constraint.labelPosition).toEqual({ x: 1e308, y: 1e308 });
    expect(parseCadDocument(document)).toEqual(migrated);
  });
});

describe('portable relative placement validation', () => {
  it.each([
    { kind: 'unknown' },
    { kind: 'linear', fraction: Infinity, normalOffset: 0 },
    { kind: 'linear', fraction: 0.5, normalOffset: NaN },
    { kind: 'linear', fraction: 1, normalOffset: 0, overshoot: Infinity },
    { kind: 'fallback', offset: { x: 0, y: Infinity } },
    { kind: 'fallback' },
    { kind: 'radial', angle: 0, radiusRatio: 1 },
    { kind: 'angle', radius: 20, angleOffset: 0 },
  ])('rejects malformed or incompatible linear annotation metadata %j', labelPlacement => {
    const { sketch, dimensions } = linearFixture();
    const source = documentOf({ ...sketch, constraints: [{ ...dimensions[0]!, labelPlacement } as CadDimension] });
    expect(() => parseCadDocument(source)).toThrow();
  });

  it.each([
    { kind: 'radial', angle: 0, radiusRatio: -1 },
    { kind: 'radial', angle: NaN, radiusRatio: 1 },
    { kind: 'radial', angle: 0, radiusRatio: 0, distance: -1 },
    { kind: 'radial', angle: 0, radiusRatio: 0, distance: Infinity },
    { kind: 'radial', angle: 0, radiusRatio: 4, radiusOffset: -1 },
    { kind: 'radial', angle: 0, radiusRatio: 4, radiusOffset: Infinity },
  ])('rejects invalid radial annotation metadata %j', labelPlacement => {
    const { sketch, circle } = linearFixture();
    const source = documentOf({
      ...sketch,
      constraints: [{ id: 'radial', type: 'radius', entityId: circle.id, value: 10, labelPlacement } as CadDimension],
    });
    expect(() => parseCadDocument(source)).toThrow();
  });

  it('rejects a negative angular radius and relative metadata on a geometric constraint', () => {
    const { sketch, dimension, first } = angleFixture();
    const source = documentOf({
      ...sketch,
      constraints: [{ ...dimension, labelPlacement: { kind: 'angle', radius: -1, angleOffset: 0 } }],
    });
    expect(() => parseCadDocument(source)).toThrow('Invalid dimension label radius');
    const invalidFrame = documentOf({
      ...sketch,
      constraints: [
        {
          ...dimension,
          labelPlacement: { kind: 'angle', radius: 20, angleOffset: 0, frame: 'other' } as unknown as NonNullable<
            CadDimension['labelPlacement']
          >,
        },
      ],
    });
    expect(() => parseCadDocument(invalidFrame)).toThrow('Invalid dimension label frame');
    const geometric = documentOf({ ...sketch, constraints: [{ id: 'horizontal', type: 'horizontal', entityId: first.id }] });
    Object.assign(geometric.parts[0]!.sketch.constraints[0]!, { labelPlacement: { kind: 'fallback', offset: { x: 0, y: 0 } } });
    expect(() => parseCadDocument(geometric)).toThrow('Invalid dimension label placement');
  });
});

describe('relative annotations through native value edits and portable snapshots', () => {
  it('resolves a legacy quarter-span label against the solved edited line rather than its previous world position', async () => {
    const { sketch, first, dimensions } = linearFixture();
    const source = documentOf({
      ...sketch,
      entities: sketch.entities.map(entity => (entity.id === first.startId ? { ...entity, fixed: true } : entity)),
      constraints: [
        { id: 'horizontal', type: 'horizontal', entityId: first.id },
        { ...dimensions[0]!, labelPosition: { x: 45, y: 70 } },
      ],
    });
    const solved = await solveCadDocument(updateDimension(source, 'length', 200));
    expect(solved.sketches[0]!.status).toBe('solved');
    const edited = solved.document.parts[0]!.sketch;
    closePoint(resolveDimensionPlacement(edited, edited.constraints.find(c => c.id === 'length') as CadDimension), { x: 70, y: 70 });
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  });

  it('retains radial ratio through a native diameter edit without adding any geometry freedom', async () => {
    let sketch = addCircle(createCadPart().sketch, { x: 100, y: 70, radius: 15 });
    const circle = sketch.entities.find(entity => entity.type === 'circle')!;
    sketch = {
      ...sketch,
      entities: sketch.entities.map(entity => (entity.id === circle.centerId ? { ...entity, fixed: true } : entity)),
    };
    sketch = addConstraint(sketch, { id: 'diameter', type: 'diameter', entityId: circle.id, value: 30, labelPosition: { x: 145, y: 100 } });
    const solved = await solveCadDocument(updateDimension(documentOf(sketch), 'diameter', 60));
    expect(solved.sketches[0]).toMatchObject({ status: 'solved', dof: 0 });
    const edited = solved.document.parts[0]!.sketch;
    closePoint(resolveDimensionPlacement(edited, edited.constraints[0] as CadDimension), { x: 190, y: 130 });
  });

  it('keeps angular radius and oriented-ray phase through a native angle value edit', async () => {
    const { sketch, first, second, dimension } = angleFixture();
    const constrained: CadSketch = {
      ...sketch,
      entities: sketch.entities.map(entity => (entity.id === first.startId ? { ...entity, fixed: true } : entity)),
      constraints: [
        { id: 'horizontal', type: 'horizontal', entityId: first.id },
        { id: 'first-length', type: 'distance', pointAId: first.startId, pointBId: first.endId, value: 100 },
        { id: 'second-length', type: 'distance', pointAId: second.startId, pointBId: second.endId, value: 100 },
        { ...dimension, labelPosition: { x: 105, y: 65 } },
      ],
    };
    const solved = await solveCadDocument(updateDimension(documentOf(constrained), dimension.id, 90));
    expect(solved.sketches[0]).toMatchObject({ status: 'solved', dof: 0 });
    const edited = solved.document.parts[0]!.sketch;
    expect(edited.entities.find(entity => entity.id === second.endId)).toMatchObject({
      x: expect.closeTo(40, 6),
      y: expect.closeTo(140, 6),
    });
    closePoint(resolveDimensionPlacement(edited, edited.constraints.find(c => c.id === dimension.id) as CadDimension), { x: 105, y: 65 });
    expect(parseCadDocument(JSON.parse(JSON.stringify(solved.document)))).toEqual(solved.document);
  });
});
