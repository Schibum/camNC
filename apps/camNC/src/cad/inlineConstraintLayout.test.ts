import { originId, type CadConstraint, type CadEntity, type CadSketch } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import {
  associatedEntityIds,
  fixedConstraintId,
  INLINE_CONSTRAINT_SIZE,
  layoutInlineConstraints,
  removeInlineConstraint,
} from './inlineConstraintLayout';

const point = (id: string, x: number, y: number, fixed = false): CadEntity => ({ id, type: 'point', x, y, fixed });
const line = (id: string, startId: string, endId: string): CadEntity => ({ id, type: 'line', startId, endId });
const source = (constraints: CadConstraint[] = []): CadSketch => ({
  id: 'sketch',
  entities: [point('a', 0, 0), point('b', 100, 0), point('c', 0, 60), point('d', 100, 60), line('ab', 'a', 'b'), line('cd', 'c', 'd')],
  constraints,
});

describe('inline constraint layout and references', () => {
  it.each([0.5, 1, 8])('keeps each semantic glyph in the same slot when all source IDs change at zoom %s', scale => {
    const sketch = source([
      { id: 'a-horizontal', type: 'horizontal', entityId: 'ab' },
      { id: 'b-parallel', type: 'parallel', entityAId: 'ab', entityBId: 'cd' },
      { id: 'c-equal', type: 'equal', entityAId: 'ab', entityBId: 'cd' },
      { id: 'd-perpendicular', type: 'perpendicular', entityAId: 'ab', entityBId: 'cd' },
    ]);
    sketch.entities.push(point('fixed', 50, 0, true));
    const ids = [...sketch.entities, ...sketch.constraints].map(entity => entity.id),
      renamed = new Map(ids.map((id, index) => [id, `random-${String(ids.length - index).padStart(3, '0')}`])),
      original = new Map([...renamed].map(([id, replacement]) => [replacement, id]));
    const equivalent = JSON.parse(
      JSON.stringify(sketch, (_key, value: unknown) => (typeof value === 'string' ? (renamed.get(value) ?? value) : value))
    ) as CadSketch;
    const positions = (value: CadSketch, restore = new Map<string, string>()) =>
      layoutInlineConstraints(value, scale)
        .map(glyph => ({
          id:
            glyph.kind === 'fix'
              ? fixedConstraintId(restore.get(glyph.entityIds[0]!) ?? glyph.entityIds[0]!)
              : (restore.get(glyph.id) ?? glyph.id),
          kind: glyph.kind,
          anchor: glyph.anchor,
          position: glyph.position,
          entityIds: glyph.entityIds.map(id => restore.get(id) ?? id),
        }))
        .sort((a, b) => a.id.localeCompare(b.id) || a.anchor.y - b.anchor.y);
    expect(positions(equivalent, original)).toEqual(positions(sketch));
  });

  it('anchors a tangent glyph at the logical joined endpoint across transitive point aliases', () => {
    const sketch = source([
      { id: 'join-a', type: 'coincident', pointAId: 'b', pointBId: 'bridge' },
      { id: 'join-b', type: 'coincident', pointAId: 'bridge', pointBId: 'curve-start' },
      { id: 'tangent', type: 'tangent', entityAId: 'ab', entityBId: 'curve' },
    ]);
    sketch.entities.push(point('bridge', 100, 0), point('curve-start', 100, 0), point('control', 140, 0), point('end', 160, 50), {
      id: 'curve',
      type: 'bezier',
      startId: 'curve-start',
      endId: 'end',
      controlPointIds: ['curve-start', 'control', 'end'],
    });
    expect(layoutInlineConstraints(sketch, 1).find(glyph => glyph.id === 'tangent')!.anchor).toEqual({ x: 100, y: 0 });
  });
  it('shows geometric relations and fixed points while leaving numeric dimensions to their editor', () => {
    const sketch = source([
      { id: 'horizontal', type: 'horizontal', entityId: 'ab' },
      { id: 'height', type: 'distanceY', pointAId: 'a', pointBId: 'c', value: 60 },
    ]);
    sketch.entities.push(point(originId(sketch), 0, 0, true), point('fixed', 200, 100, true));
    expect(layoutInlineConstraints(sketch, 1).map(g => g.id)).toEqual([fixedConstraintId('fixed'), 'horizontal']);
    expect(associatedEntityIds(sketch, 'height')).toEqual(['a', 'c']);
    expect(associatedEntityIds(sketch, fixedConstraintId('fixed'))).toEqual(['fixed']);
    expect(associatedEntityIds(sketch, 'missing')).toEqual([]);
  });

  it('marks both equal/parallel members with one logical selection ID and both geometry references', () => {
    const sketch = source([{ id: 'parallel', type: 'parallel', entityAId: 'ab', entityBId: 'cd' }]);
    const glyphs = layoutInlineConstraints(sketch, 1);
    expect(glyphs).toHaveLength(2);
    expect(glyphs.map(g => g.id)).toEqual(['parallel', 'parallel']);
    expect(glyphs.map(g => g.key)).toEqual(['parallel:ab', 'parallel:cd']);
    expect(glyphs.map(g => g.anchor)).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: 60 },
    ]);
    expect(glyphs.every(g => g.entityIds.join(',') === 'ab,cd')).toBe(true);
  });

  it.each([0.1, 1, 10])('keeps a solitary marker offset in screen pixels at zoom %s', scale => {
    const sketch = source([{ id: 'h', type: 'horizontal', entityId: 'ab' }]);
    sketch.entities = sketch.entities.filter(e => ['a', 'b', 'ab'].includes(e.id));
    const glyph = layoutInlineConstraints(sketch, scale)[0];
    expect((glyph.position.x - glyph.anchor.x) * scale).toBeCloseTo(0);
    expect((glyph.position.y - glyph.anchor.y) * scale).toBeCloseTo(24);
  });

  it('packs dense relations without overlapping each other or source point hit targets, deterministically', () => {
    const sketch = source(
      Array.from({ length: 18 }, (_, i) => ({ id: `h${String(i).padStart(2, '0')}`, type: 'horizontal', entityId: 'ab' }))
    );
    const before = structuredClone(sketch);
    const glyphs = layoutInlineConstraints(sketch, 1);
    for (const [i, a] of glyphs.entries())
      for (const b of glyphs.slice(i + 1)) {
        expect(
          Math.abs(a.position.x - b.position.x) >= INLINE_CONSTRAINT_SIZE + 3 ||
            Math.abs(a.position.y - b.position.y) >= INLINE_CONSTRAINT_SIZE + 3
        ).toBe(true);
      }
    for (const g of glyphs)
      for (const p of sketch.entities)
        if (p.type === 'point') {
          expect(
            Math.hypot(Math.max(0, Math.abs(p.x - g.position.x) - 10), Math.max(0, Math.abs(p.y - g.position.y) - 10))
          ).toBeGreaterThanOrEqual(9);
        }
    const reversed = { ...sketch, entities: [...sketch.entities].reverse(), constraints: [...sketch.constraints].reverse() };
    // These eighteen redundant constraints have indistinguishable geometry and
    // glyphs. Their source IDs must not determine the visible packing order.
    const appearance = (value: ReturnType<typeof layoutInlineConstraints>) =>
      value.map(({ kind, anchor, position, entityIds }) => ({ kind, anchor, position, entityIds }));
    expect(appearance(layoutInlineConstraints(reversed, 1))).toEqual(appearance(glyphs));
    expect(layoutInlineConstraints(sketch, 1)).toEqual(glyphs);
    expect(sketch).toEqual(before);
  });

  it('anchors arc relations on the finite CCW sweep, including a wrapped arc', () => {
    const sketch = source([{ id: 'arc-equal', type: 'equal', entityAId: 'arc', entityBId: 'ab' }]);
    sketch.entities.push(point('center', 300, 200), point('start', 300, 150), point('end', 300, 250), {
      id: 'arc',
      type: 'arc',
      centerId: 'center',
      startId: 'start',
      endId: 'end',
      radius: 50,
      startAngle: Math.PI * 1.5,
      endAngle: Math.PI / 2,
    });
    expect(layoutInlineConstraints(sketch, 1).find(g => g.key === 'arc-equal:arc')?.anchor).toEqual({ x: 350, y: 200 });
  });

  it('places point-on-curve/midpoint at the constrained point and tangency at a shared endpoint', () => {
    const sketch = source([
      { id: 'on', type: 'pointOnLine', pointId: 'p', entityId: 'ab' },
      { id: 'mid', type: 'midpoint', pointId: 'p', entityId: 'ab' },
      { id: 'tangent', type: 'tangent', entityAId: 'ab', entityBId: 'arc' },
    ]);
    sketch.entities.push(point('p', 50, 0), point('center', 100, 30), point('end', 130, 30), {
      id: 'arc',
      type: 'arc',
      centerId: 'center',
      startId: 'b',
      endId: 'end',
      radius: 30,
      startAngle: -Math.PI / 2,
      endAngle: 0,
    });
    const glyphs = layoutInlineConstraints(sketch, 1);
    expect(glyphs.find(g => g.id === 'on')?.anchor).toEqual({ x: 50, y: 0 });
    expect(glyphs.find(g => g.id === 'mid')?.anchor).toEqual({ x: 50, y: 0 });
    expect(glyphs.find(g => g.id === 'tangent')?.anchor).toEqual({ x: 100, y: 0 });
    expect(associatedEntityIds(sketch, 'on')).toEqual(['p', 'ab']);
  });

  it('safely skips missing and nonfinite source references and tolerates an uninitialized zoom', () => {
    const sketch = source([
      { id: 'bad', type: 'horizontal', entityId: 'missing' },
      { id: 'good', type: 'horizontal', entityId: 'ab' },
    ]);
    sketch.entities.push(point('nonfinite', NaN, 0, true));
    expect(layoutInlineConstraints(sketch, NaN).map(g => g.id)).toEqual(['good']);
  });

  it('deletes the relation while retaining all geometry and can unfix a point without deleting it', () => {
    const sketch = source([{ id: 'h', type: 'horizontal', entityId: 'ab' }]);
    sketch.entities.push(point('fixed', 20, 30, true), point(originId(sketch), 0, 0, true));
    const before = structuredClone(sketch);
    const removed = removeInlineConstraint(sketch, 'h');
    expect(removed.constraints).toEqual([]);
    expect(removed.entities).toEqual(sketch.entities);
    const unfixed = removeInlineConstraint(sketch, fixedConstraintId('fixed'));
    expect(unfixed.entities.find(e => e.id === 'fixed')).toMatchObject({ type: 'point', fixed: false, x: 20, y: 30 });
    expect(unfixed.constraints).toEqual(sketch.constraints);
    expect(removeInlineConstraint(sketch, fixedConstraintId(originId(sketch)))).toBe(sketch);
    expect(removeInlineConstraint(sketch, 'missing')).toBe(sketch);
    expect(sketch).toEqual(before);
  });
});
