import { addCircle, addConstraint, addLine, addPoint, addSpline, createCadPart, originId } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import {
  createSketchContext,
  pickSketchContextTarget,
  selectedSketchContextTarget,
  sketchContextItems,
  toggleContextConstruction,
  transitionSketchContextPress,
} from './sketchContext';

const project = (point: { x: number; y: number }) => ({ x: point.x * 2, y: -point.y * 2 });
function fixture() {
  let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 100, y2: 20 });
  const line = sketch.entities.at(-1)!;
  sketch = addCircle(sketch, { x: 140, y: 60, radius: 15 });
  const circle = sketch.entities.at(-1)!;
  sketch = addPoint(sketch, { x: 23, y: 20 });
  const point = sketch.entities.at(-1)!;
  sketch = addConstraint(sketch, { type: 'diameter', entityId: circle.id, value: 30, labelPosition: { x: 20, y: 20 } });
  const dimension = sketch.constraints.at(-1)!;
  return { sketch, line, circle, point, dimension };
}
const empty = { entityIds: [], constraintIds: [] };

describe('pure sketch context targeting and selection', () => {
  it.each([0.1, 1, 10])('honors the painted point only for exact-distance alias ties at zoom %s', scale => {
    const sketch = createCadPart().sketch;
    sketch.entities.push({ id: 'a-alias', type: 'point', x: 20, y: 20 }, { id: 'z-painted', type: 'point', x: 20, y: 20 });
    sketch.constraints.push({ id: 'join', type: 'coincident', pointAId: 'a-alias', pointBId: 'z-painted' });
    const project = (point: { x: number; y: number }) => ({ x: point.x * scale, y: -point.y * scale }),
      pointer = project({ x: 20, y: 20 });
    expect(pickSketchContextTarget(sketch, pointer, { project, targetEntityId: 'z-painted' })).toEqual({ kind: 'entity', id: 'z-painted' });
    const separated = {
      ...sketch,
      constraints: [],
      entities: sketch.entities.map(entity =>
        entity.id === 'z-painted' && entity.type === 'point' ? { ...entity, x: 20 + 2 / scale } : entity
      ),
    };
    expect(pickSketchContextTarget(separated, pointer, { project, targetEntityId: 'z-painted' })).toEqual({
      kind: 'entity',
      id: 'a-alias',
    });
  });

  it('uses measured curve distances before the painted target and retains exact overlap ties', () => {
    const { sketch: initial, line } = fixture();
    const sketch = addLine(initial, { x1: 20, y1: 22, x2: 100, y2: 22 }),
      closer = sketch.entities.at(-1)!;
    expect(pickSketchContextTarget(sketch, project({ x: 60, y: 22 }), { project, targetEntityId: line.id })).toEqual({
      kind: 'entity',
      id: closer.id,
    });
    const overlapping = addLine(initial, { x1: 20, y1: 20, x2: 100, y2: 20 }),
      painted = overlapping.entities.at(-1)!;
    expect(pickSketchContextTarget(overlapping, project({ x: 60, y: 20 }), { project, targetEntityId: painted.id })).toEqual({
      kind: 'entity',
      id: painted.id,
    });
    expect(pickSketchContextTarget(sketch, project({ x: 60, y: 30 }), { project, targetEntityId: line.id })).toEqual({ kind: 'blank' });
  });

  it('opens on an unmoved right release and keeps captured pan drags separate, including a return to their start', () => {
    const target = { kind: 'entity', id: 'line' } as const;
    const pressed = transitionSketchContextPress(
      { phase: 'idle' },
      { type: 'press', pointerId: 2, position: { x: 100, y: 100 }, target }
    ).state;
    expect(transitionSketchContextPress(pressed, { type: 'release', pointerId: 2, position: { x: 102, y: 102 } }).open).toEqual({
      target,
      position: { x: 102, y: 102 },
    });
    const moved = transitionSketchContextPress(pressed, { type: 'move', pointerId: 2, position: { x: 110, y: 110 } }).state;
    expect(transitionSketchContextPress(moved, { type: 'release', pointerId: 2, position: { x: 100, y: 100 } }).open).toBeUndefined();
    expect(transitionSketchContextPress(pressed, { type: 'release', pointerId: 2, position: { x: 110, y: 110 } }).open).toBeUndefined();
    expect(transitionSketchContextPress(pressed, { type: 'release', pointerId: 3, position: { x: 100, y: 100 } }).state).toBe(pressed);
    const cancelled = transitionSketchContextPress(pressed, { type: 'cancel' }).state;
    expect(transitionSketchContextPress(cancelled, { type: 'release', pointerId: 2, position: { x: 100, y: 100 } }).open).toBeUndefined();
  });
  it('picks the nearest point before a directly targeted curve and honors explicit dimension labels', () => {
    const { sketch, line, point, dimension } = fixture();
    expect(pickSketchContextTarget(sketch, project({ x: 22.5, y: 20 }), { project, targetEntityId: line.id })).toEqual({
      kind: 'entity',
      id: point.id,
    });
    expect(pickSketchContextTarget(sketch, project({ x: 20, y: 20 }), { project, targetDimensionId: dimension.id })).toEqual({
      kind: 'dimension',
      id: dimension.id,
    });
  });

  it('uses the shared CSS-pixel curve tolerance and reports blank space without inventing a target', () => {
    const { sketch, line } = fixture();
    expect(pickSketchContextTarget(sketch, project({ x: 60, y: 22.5 }), { project })).toEqual({ kind: 'entity', id: line.id });
    expect(pickSketchContextTarget(sketch, project({ x: 60, y: 24 }), { project })).toEqual({ kind: 'blank' });
    expect(pickSketchContextTarget(sketch, { x: 700, y: 700 }, { project })).toEqual({ kind: 'blank' });
    expect(pickSketchContextTarget(sketch, project({ x: 20, y: 20 }), { project, targetDimensionId: 'deleted' })).toEqual({
      kind: 'blank',
    });
  });

  it('preserves a selected entity group, replaces it for an unselected point, and drops stale IDs', () => {
    const { sketch, line, circle, point, dimension } = fixture();
    const selection = { entityIds: [line.id, circle.id, 'deleted'], constraintIds: [dimension.id] };
    const position = { x: 250, y: 100 };
    const group = createSketchContext(sketch, { kind: 'entity', id: circle.id }, position, selection);
    expect(group.entityIds).toEqual([line.id, circle.id]);
    expect(group.constraintIds).toEqual([]);
    position.x = 400;
    expect(group.position.x).toBe(250);
    expect(createSketchContext(sketch, { kind: 'entity', id: point.id }, position, selection).entityIds).toEqual([point.id]);
    expect(selection.entityIds).toHaveLength(3);
  });

  it('switches to dimension selection while preserving a selected numeric group and permits keyboard invocation', () => {
    const { sketch: initial, line, dimension } = fixture();
    const sketch = addConstraint(initial, {
      type: 'distance',
      pointAId: initial.entities.find(e => e.type === 'line')!.startId,
      pointBId: initial.entities.find(e => e.type === 'line')!.endId,
      value: 80,
    });
    const otherDimension = sketch.constraints.at(-1)!;
    const selection = { entityIds: [line.id], constraintIds: [dimension.id, otherDimension.id] };
    const context = createSketchContext(sketch, { kind: 'dimension', id: dimension.id }, { x: 10, y: 20 }, selection);
    expect(context.entityIds).toEqual([]);
    expect(context.constraintIds).toEqual([dimension.id, otherDimension.id]);
    expect(selectedSketchContextTarget(sketch, selection)).toEqual({ kind: 'dimension', id: dimension.id });
    expect(selectedSketchContextTarget(sketch, { ...empty, entityIds: [line.id] })).toEqual({ kind: 'entity', id: line.id });
    expect(selectedSketchContextTarget(sketch, empty)).toEqual({ kind: 'blank' });
  });

  it('keeps blank menus safe and treats stale targets as blank instead of deleting another entity', () => {
    const { sketch, line } = fixture();
    const context = createSketchContext(sketch, { kind: 'entity', id: 'removed' }, { x: 50, y: 70 }, { ...empty, entityIds: [line.id] });
    expect(context.target).toEqual({ kind: 'blank' });
    expect(sketchContextItems(sketch, context).map(item => item.action)).toEqual(['clear', 'fit', 'fit-selection']);
    const blank = createSketchContext(sketch, { kind: 'blank' }, { x: 10, y: 20 }, empty);
    expect(sketchContextItems(sketch, blank).find(item => item.action === 'clear')!.disabled).toBe(true);
  });
});

describe('context menu commands', () => {
  it('applies mixed construction selections consistently as one immutable graph edit', () => {
    const { sketch: initial, line, circle } = fixture();
    const sketch = {
      ...initial,
      entities: initial.entities.map(entity => (entity.id === circle.id ? { ...entity, construction: true } : entity)),
    };
    const before = structuredClone(sketch),
      ids = [line.id, circle.id];
    const context = createSketchContext(sketch, { kind: 'entity', id: line.id }, { x: 0, y: 0 }, { ...empty, entityIds: ids });
    expect(sketchContextItems(sketch, context)[0]!.checked).toBe('indeterminate');
    const changed = toggleContextConstruction(sketch, ids);
    expect(changed.entities.filter(entity => ids.includes(entity.id)).every(entity => entity.construction)).toBe(true);
    expect(changed.constraints).toBe(sketch.constraints);
    expect(
      toggleContextConstruction(changed, ids)
        .entities.filter(entity => ids.includes(entity.id))
        .every(entity => entity.construction === false)
    ).toBe(true);
    expect(sketch).toEqual(before);
  });

  it('protects the permanent origin and implicit spline tangent handles from context deletion or construction changes', () => {
    const { sketch: initial } = fixture();
    const sketch = addSpline(initial, {
      points: [
        { x: 10, y: 80 },
        { x: 60, y: 120 },
        { x: 110, y: 90 },
      ],
    });
    const spline = sketch.entities.at(-1)!;
    if (spline.type !== 'spline') throw Error();
    const handleId = spline.controlPointIds[1]!;
    for (const id of [originId(sketch), handleId]) {
      const context = createSketchContext(sketch, { kind: 'entity', id }, { x: 0, y: 0 }, empty);
      expect(
        sketchContextItems(sketch, context)
          .filter(item => ['construction', 'delete-entities'].includes(item.action))
          .every(item => item.disabled)
      ).toBe(true);
      expect(toggleContextConstruction(sketch, [id])).toBe(sketch);
    }
  });

  it('offers real driving/reference commands, disables editing references, and keeps view commands usable while busy', () => {
    const { sketch, dimension } = fixture();
    const context = createSketchContext(sketch, { kind: 'dimension', id: dimension.id }, { x: 0, y: 0 }, empty);
    expect(sketchContextItems(sketch, context).find(item => item.action === 'toggle-driven')!.label).toBe('Change to driven dimension');
    const driven = { ...sketch, constraints: sketch.constraints.map(c => (c.id === dimension.id ? { ...c, driven: true } : c)) };
    const items = sketchContextItems(driven, context);
    expect(items.find(item => item.action === 'edit-dimension')!.disabled).toBe(true);
    expect(items.find(item => item.action === 'toggle-driven')!.label).toBe('Change to driving dimension');
    const busy = sketchContextItems(sketch, context, true);
    expect(busy.filter(item => item.action !== 'fit').every(item => item.disabled)).toBe(true);
    expect(busy.find(item => item.action === 'fit')!.disabled).not.toBe(true);
  });
});
