import { describe, expect, it } from 'vitest';
import { addCircle, addConstraint, addLine, createCadDocument, createCadPart } from './document';
import {
  dimensionAnnotationAngleWitness,
  migrateDimensionPlacements,
  resolveDimensionPlacement,
  withDimensionPlacement,
} from './dimensionPlacement';
import type { CadDimension, CadPoint, CadSketch } from './types';

const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const finitePoint = (point: CadPoint | null): CadPoint => {
  expect(point).not.toBeNull();
  expect(Number.isFinite(point!.x) && Number.isFinite(point!.y)).toBe(true);
  return point!;
};
function angleFixture(shared = false) {
  let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
  sketch = addLine(sketch, { x1: 0, y1: shared ? 0 : 10, x2: 100, y2: shared ? 50 : 60 });
  const [first, second] = sketch.entities.filter(entity => entity.type === 'line');
  const dimension: Extract<CadDimension, { type: 'angle' }> = {
    id: 'angle',
    type: 'angle',
    entityAId: first!.id,
    entityBId: second!.id,
    value: (Math.atan2(50, 100) * 180) / Math.PI,
    orientation: 1,
  };
  const at = (dy: number): CadSketch => ({
    ...sketch,
    entities: sketch.entities.map(entity => (entity.id === second!.endId ? { ...entity, y: (shared ? 0 : 10) + dy } : entity)),
  });
  return { sketch, dimension, at };
}
function radialFixture(radius: number) {
  const sketch = addCircle(createCadPart().sketch, { x: 0, y: 0, radius });
  const circle = sketch.entities.find(entity => entity.type === 'circle')!;
  const dimension: CadDimension = { id: 'diameter', type: 'diameter', entityId: circle.id, value: radius * 2 };
  const at = (radius: number): CadSketch => ({
    ...sketch,
    entities: sketch.entities.map(entity => (entity.id === circle.id ? { ...entity, radius } : entity)),
  });
  return { sketch, dimension, at };
}

describe('continuous dimension placement through geometric degeneracies', () => {
  it('interprets an unflagged legacy small-radius angle in its previous bounded display frame before upgrading it', () => {
    const { dimension, at } = angleFixture();
    const sketch = at(0.001),
      source = createCadDocument();
    source.parts.push({
      ...createCadPart(),
      sketch: addConstraint(sketch, {
        ...dimension,
        value: (Math.atan2(0.001, 100) * 180) / Math.PI,
        labelPlacement: { kind: 'angle', radius: 70, angleOffset: 0 },
      }),
    });
    const stored = source.parts[0]!.sketch.constraints[0] as CadDimension;
    expect(distance(finitePoint(resolveDimensionPlacement(sketch, stored)), { x: 120, y: 5.00025 })).toBeLessThan(1e-7);
    const migrated = migrateDimensionPlacements(source).parts[0]!.sketch,
      upgraded = migrated.constraints[0] as CadDimension;
    expect(upgraded.labelPlacement).toMatchObject({ kind: 'angle', frame: 'local' });
    expect(distance(finitePoint(resolveDimensionPlacement(migrated, upgraded)), { x: 120, y: 5.00025 })).toBeLessThan(1e-7);
  });

  it('sweeps a stored angle through the former parallel boundary without label or arc-centre jumps', () => {
    const { sketch, dimension, at } = angleFixture();
    const placed = withDimensionPlacement(sketch, dimension, { x: 50, y: 20 });
    let previous: CadPoint | null = null,
      previousCenter: CadPoint | null = null;
    for (let index = 0; index <= 1000; index++) {
      const dy = 0.09 + index * 0.00002,
        current = at(dy),
        value = { ...placed, value: (Math.atan2(dy, 100) * 180) / Math.PI },
        label = finitePoint(resolveDimensionPlacement(current, value)),
        witness = dimensionAnnotationAngleWitness(current, value)!;
      expect(witness).not.toBeNull();
      const center = finitePoint(witness.center);
      expect(Math.hypot(label.x, label.y)).toBeLessThan(400);
      expect(Math.hypot(center.x, center.y)).toBeLessThan(400);
      if (previous) expect(distance(label, previous)).toBeLessThan(0.01);
      if (previousCenter) expect(distance(center, previousCenter)).toBeLessThan(0.01);
      previous = label;
      previousCenter = center;
    }
  });

  it.each([0, 0.11, 0.5, 1])('does not capture a huge polar radius at dy %s before opening the angle', dy => {
    const { dimension, at } = angleFixture();
    const placed = withDimensionPlacement(at(dy), { ...dimension, value: (Math.atan2(dy, 100) * 180) / Math.PI }, { x: 50, y: 20 });
    expect(distance(finitePoint(resolveDimensionPlacement(at(dy), placed)), { x: 50, y: 20 })).toBeLessThan(1e-7);
    const opened = finitePoint(resolveDimensionPlacement(at(50), { ...placed, value: dimension.value }));
    expect(Math.hypot(opened.x, opened.y)).toBeLessThan(400);
  });

  it('keeps a full positive-to-negative angle sweep bounded with small label and arc-endpoint steps', () => {
    const { sketch, dimension, at } = angleFixture(),
      placed = withDimensionPlacement(sketch, dimension, { x: 50, y: 20 });
    let previous: CadPoint[] | null = null;
    for (let index = 0; index <= 10_000; index++) {
      const dy = 50 - index * 0.01,
        current = at(dy),
        value = { ...placed, value: (Math.atan2(dy, 100) * 180) / Math.PI },
        label = finitePoint(resolveDimensionPlacement(current, value)),
        witness = dimensionAnnotationAngleWitness(current, value)!;
      expect(witness).not.toBeNull();
      const radius = distance(label, witness.center),
        samples = [
          label,
          witness.center,
          {
            x: witness.center.x + Math.cos(witness.startAngle) * radius,
            y: witness.center.y + Math.sin(witness.startAngle) * radius,
          },
          {
            x: witness.center.x + Math.cos(witness.startAngle + witness.sweep) * radius,
            y: witness.center.y + Math.sin(witness.startAngle + witness.sweep) * radius,
          },
        ];
      samples.forEach((point, sample) => {
        expect(Math.hypot(point.x, point.y)).toBeLessThan(400);
        if (previous) expect(distance(point, previous[sample]!), `dy=${dy}, sample=${sample}`).toBeLessThan(1);
      });
      previous = samples;
    }
  });

  it.each([25, 75])('converges unjoined collinear references to one finite centre when the nearby intersection approaches x=%s', vertex => {
    const { sketch, dimension, at } = angleFixture();
    const second = sketch.entities.filter(entity => entity.type === 'line')[1]!;
    const approach = (slope: number): CadSketch => ({
      ...at(slope * (100 - vertex)),
      entities: sketch.entities.map(entity =>
        entity.id === second.startId
          ? { ...entity, y: -slope * vertex }
          : entity.id === second.endId
            ? { ...entity, y: slope * (100 - vertex) }
            : entity
      ),
    });
    const placed = withDimensionPlacement(approach(1), dimension, { x: 50, y: 20 });
    let previous: CadPoint | null = null;
    for (const slope of [-1e-8, -1e-10, 0, 1e-10, 1e-8]) {
      const current = approach(slope),
        value = { ...placed, value: (Math.atan(slope) * 180) / Math.PI },
        label = finitePoint(resolveDimensionPlacement(current, value)),
        center = dimensionAnnotationAngleWitness(current, value)!.center;
      expect(distance(center, { x: 50, y: (slope * (100 - 2 * vertex)) / 4 })).toBeLessThan(1e-6);
      if (previous) expect(distance(label, previous)).toBeLessThan(1e-5);
      previous = label;
    }
  });

  it('retains a coincident endpoint relation as the angle joint across zero even when point IDs differ', () => {
    const { sketch, dimension } = angleFixture();
    const [first, second] = sketch.entities.filter(entity => entity.type === 'line');
    const related = addConstraint(sketch, { type: 'coincident', pointAId: first!.startId, pointBId: second!.startId });
    const at = (dy: number): CadSketch => ({
      ...related,
      entities: related.entities.map(entity =>
        entity.id === second!.startId ? { ...entity, y: 0 } : entity.id === second!.endId ? { ...entity, y: dy } : entity
      ),
    });
    const placed = withDimensionPlacement(at(50), dimension, { x: 50, y: 20 });
    for (const dy of [-1e-8, 0, 1e-8]) {
      const value = { ...placed, value: (Math.atan2(dy, 100) * 180) / Math.PI };
      expect(distance(dimensionAnnotationAngleWitness(at(dy), value)!.center, { x: 0, y: 0 })).toBeLessThan(1e-8);
      expect(distance(finitePoint(resolveDimensionPlacement(at(dy), value)), { x: 50, y: 20 })).toBeLessThan(1e-8);
    }
  });

  it.each([false, true])('keeps labels and graphics continuous across exact parallel, shared joint: %s', shared => {
    const { sketch, dimension, at } = angleFixture(shared);
    const placed = withDimensionPlacement(sketch, dimension, { x: 50, y: 20 });
    let previous: CadPoint | null = null;
    for (const dy of [-1e-8, 0, 1e-8]) {
      const current = at(dy),
        value = { ...placed, value: (Math.atan2(dy, 100) * 180) / Math.PI },
        label = finitePoint(resolveDimensionPlacement(current, value)),
        witness = dimensionAnnotationAngleWitness(current, value)!;
      expect(witness).not.toBeNull();
      if (shared) expect(distance(witness.center, { x: 0, y: 0 })).toBeLessThan(1e-7);
      else expect(distance(witness.center, { x: 50, y: 5 + dy / 4 })).toBeLessThan(1e-5);
      if (previous) expect(distance(label, previous)).toBeLessThan(1e-5);
      previous = label;
    }
  });

  it('keeps nearby radial captures adjacent after a large resize instead of switching placement modes', () => {
    const { sketch, dimension, at } = radialFixture(5);
    let previous: CadPoint | null = null;
    for (let index = 0; index <= 200; index++) {
      const initial = { x: 39 + index * 0.01, y: 0 },
        placed = withDimensionPlacement(sketch, dimension, initial),
        label = finitePoint(resolveDimensionPlacement(at(100), placed));
      expect(distance(finitePoint(resolveDimensionPlacement(sketch, placed)), initial)).toBeLessThan(1e-7);
      expect(label.x).toBeLessThanOrEqual(4 * 100 + initial.x);
      if (previous) expect(distance(label, previous)).toBeLessThan(0.02);
      previous = label;
    }
  });

  it('sweeps capture radii across the former tiny-radius cutoff without large resize discontinuities', () => {
    let previous: CadPoint | null = null;
    for (let index = 0; index <= 200; index++) {
      const radius = 0.009 + index * 0.00001,
        { sketch, dimension, at } = radialFixture(radius),
        placed = withDimensionPlacement(sketch, dimension, { x: 0.05, y: 0 }),
        label = finitePoint(resolveDimensionPlacement(at(10), placed));
      expect(label.x).toBeLessThanOrEqual(40.05);
      if (previous) expect(distance(label, previous)).toBeLessThan(0.001);
      previous = label;
    }
  });

  it('does not freeze a valid stored radial ratio while the supporting radius is temporarily tiny', () => {
    const { sketch, dimension, at } = radialFixture(0.005);
    const source = createCadDocument();
    source.parts.push({
      ...createCadPart(),
      sketch: addConstraint(sketch, { ...dimension, labelPlacement: { kind: 'radial', angle: 0, radiusRatio: 3 } }),
    });
    const migrated = migrateDimensionPlacements(source).parts[0]!.sketch;
    const stored = migrated.constraints[0] as CadDimension;
    expect(finitePoint(resolveDimensionPlacement(at(5), stored)).x).toBeCloseTo(15, 8);
  });

  it('retains a stored gain while its radius goes to zero and back without mutation during normalization', () => {
    const { sketch, dimension, at } = radialFixture(5),
      placed = withDimensionPlacement(sketch, dimension, { x: 15, y: 0 });
    for (const radius of [5, 0.0101, 0.01, 0.0099, 0.005, 0.000001, 0, 0.000001, 5]) {
      const source = createCadDocument();
      source.parts.push({ ...createCadPart(), sketch: addConstraint(at(radius), placed) });
      const migrated = migrateDimensionPlacements(source).parts[0]!.sketch,
        current = migrated.constraints[0] as CadDimension;
      expect(current.labelPlacement).toEqual(placed.labelPlacement);
      expect(finitePoint(resolveDimensionPlacement(migrated, current)).x).toBeCloseTo(radius * 3, 8);
      expect(finitePoint(resolveDimensionPlacement(at(5), current)).x).toBeCloseTo(15, 8);
    }
  });

  it('has the same capture limit at zero radius as at tiny positive radii', () => {
    let previous: CadPoint | null = null;
    for (const radius of [0, 1e-12, 1e-8, 1e-6, 1e-4]) {
      const { sketch, dimension, at } = radialFixture(radius),
        placed = withDimensionPlacement(sketch, dimension, { x: 0.05, y: 0 }),
        initial = finitePoint(resolveDimensionPlacement(sketch, placed)),
        grown = finitePoint(resolveDimensionPlacement(at(10), placed));
      expect(distance(initial, { x: 0.05, y: 0 })).toBeLessThan(1e-8);
      if (previous) expect(distance(grown, previous)).toBeLessThan(0.001);
      previous = grown;
    }
  });
});
