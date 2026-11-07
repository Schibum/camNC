import { addConstraint, addLine, addPoint, createCadPart, resolveDimensionPlacement, type CadSketch } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { idleDimensionWorkflow, transitionDimensionWorkflow, type DimensionWorkflow } from './dimensionWorkflow';

function fixture() {
  let sketch = addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 110, y2: 20 });
  const horizontal = sketch.entities.find(entity => entity.type === 'line')!;
  sketch = addLine(sketch, { x1: 10, y1: 20, x2: 60, y2: 70 });
  const diagonal = sketch.entities.filter(entity => entity.type === 'line')[1]!;
  sketch = addPoint(sketch, { x: 60, y: 45 });
  const point = sketch.entities.at(-1)!;
  return { sketch, horizontal, diagonal, point };
}
const pick = (sketch: CadSketch, state: DimensionWorkflow, entityId: string) =>
  transitionDimensionWorkflow(sketch, state, { type: 'pick', entityId, previewId: 'stable-preview' });

describe('pure dimension selection and placement workflow', () => {
  it('keeps a first-line candidate provisional so the next ordinary geometry click produces an angle', () => {
    const { sketch, horizontal, diagonal } = fixture(),
      before = structuredClone(sketch);
    const first = pick(sketch, idleDimensionWorkflow(), horizontal.id);
    expect(first.state.phase).toBe('placing');
    expect(first.effect).toBeUndefined();
    if (first.state.phase !== 'placing') throw Error();
    expect(first.state.preview).toMatchObject({ type: 'distance', sourceEntityId: horizontal.id, id: 'stable-preview' });
    const second = pick(sketch, first.state, diagonal.id);
    expect(second.state.phase).toBe('placing');
    expect(second.effect).toBeUndefined();
    if (second.state.phase !== 'placing') throw Error();
    expect(second.state.entityIds).toEqual([horizontal.id, diagonal.id]);
    expect(second.state.preview).toMatchObject({
      type: 'angle',
      value: 45,
      entityAId: horizontal.id,
      entityBId: diagonal.id,
      id: 'stable-preview',
    });
    const placed = transitionDimensionWorkflow(sketch, second.state, { type: 'place', position: { x: 65, y: 35 } });
    expect(placed.state.phase).toBe('idle');
    expect(placed.effect).toMatchObject({ type: 'create', constraint: { type: 'angle' } });
    if (placed.effect?.type !== 'create') throw Error();
    expect(placed.effect.constraint.labelPlacement).toBeDefined();
    expect(placed.effect.constraint.labelPosition).toBeUndefined();
    expect(resolveDimensionPlacement(sketch, placed.effect.constraint)).toMatchObject({ x: expect.closeTo(65), y: expect.closeTo(35) });
    expect(sketch).toEqual(before);
  });

  it.each(['point-first', 'line-first'] as const)('collects point-line references without Shift in %s order', order => {
    const { sketch, point, horizontal } = fixture();
    const ids = order === 'point-first' ? [point.id, horizontal.id] : [horizontal.id, point.id];
    const first = pick(sketch, idleDimensionWorkflow(), ids[0]!);
    const second = pick(sketch, first.state, ids[1]!);
    expect(second.state.phase).toBe('placing');
    if (second.state.phase !== 'placing') throw Error();
    expect(second.state.preview).toMatchObject({ type: 'pointLineDistance', pointId: point.id, entityId: horizontal.id, value: 25 });
    expect(second.effect).toBeUndefined();
  });

  it('rejects an unsupported multi-reference selection without falling back to a first-line length', () => {
    const { sketch, horizontal, diagonal, point } = fixture();
    const active = transitionDimensionWorkflow(sketch, idleDimensionWorkflow(), {
      type: 'begin',
      entityIds: [horizontal.id, diagonal.id, point.id],
      previewId: 'preview',
    });
    expect(active.state.phase).toBe('picking');
    const placed = transitionDimensionWorkflow(sketch, active.state, { type: 'place', position: { x: 70, y: 50 } });
    expect(placed.effect).toBeUndefined();
    expect(placed.state.phase).toBe('picking');
    expect('preview' in placed.state).toBe(false);
  });

  it('cancels the candidate before tool, part, and history transitions while retaining the chosen mode', () => {
    const { sketch, horizontal } = fixture();
    const mode = transitionDimensionWorkflow(sketch, idleDimensionWorkflow(), { type: 'mode', mode: 'distanceX' }).state;
    const active = pick(sketch, mode, horizontal.id).state;
    const cancelled = transitionDimensionWorkflow(sketch, active, { type: 'cancel' });
    expect(cancelled.state).toEqual({ phase: 'idle', mode: 'distanceX' });
    expect(cancelled.effect).toBeUndefined();
  });

  it('drops a candidate when one of its references disappears before placement', () => {
    const { sketch, horizontal } = fixture();
    const active = pick(sketch, idleDimensionWorkflow(), horizontal.id).state;
    const changed = { ...sketch, entities: sketch.entities.filter(entity => entity.id !== horizontal.id) };
    const placed = transitionDimensionWorkflow(changed, active, { type: 'place', position: { x: 70, y: 50 } });
    expect(placed.state.phase).toBe('picking');
    expect(placed.effect).toBeUndefined();
    expect('preview' in placed.state).toBe(false);
  });

  it('defers existing-dimension reuse until placement so a second reference can still change the measurement', () => {
    const { sketch: source, horizontal, point } = fixture();
    const sketch = addConstraint(source, {
      id: 'width',
      type: 'distanceX',
      pointAId: horizontal.startId,
      pointBId: horizontal.endId,
      sourceEntityId: horizontal.id,
      value: 100,
      label: 'Width',
    });
    const active = pick(sketch, idleDimensionWorkflow(), horizontal.id);
    expect(active.effect).toBeUndefined();
    if (active.state.phase !== 'placing') throw Error();
    expect(active.state.existingConstraintId).toBe('width');
    const pair = pick(sketch, active.state, point.id);
    if (pair.state.phase !== 'placing') throw Error();
    expect(pair.state.preview.type).toBe('pointLineDistance');
    expect(pair.state.existingConstraintId).toBeUndefined();
    const placed = transitionDimensionWorkflow(sketch, active.state, { type: 'place', position: { x: 70, y: 50 } });
    expect(placed.effect).toEqual({ type: 'edit-existing', constraintId: 'width' });
  });

  it('copies reference pick hints and reevaluates the angular wedge on hover and final placement', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 100, y2: 20 });
    sketch = addLine(sketch, { x1: 100, y1: 20, x2: 160, y2: 50 });
    const [first, second] = sketch.entities.filter(entity => entity.type === 'line');
    const hints = { [first!.id]: { x: 60, y: 20 }, [second!.id]: { x: 130, y: 35 } };
    const picked = transitionDimensionWorkflow(sketch, idleDimensionWorkflow(), {
      type: 'begin',
      entityIds: [first!.id, second!.id],
      previewId: 'angle-preview',
      pickHints: hints,
    }).state;
    if (picked.phase !== 'placing') throw Error();
    expect(picked.preview.value).toBeCloseTo(153.4349488, 6);
    hints[first!.id]!.x = 200;
    expect(picked.pickHints[first!.id]).toEqual({ x: 60, y: 20 });
    const hovered = transitionDimensionWorkflow(sketch, picked, { type: 'hover', position: { x: 130, y: 25 } });
    if (hovered.state.phase !== 'placing') throw Error();
    expect(hovered.effect).toBeUndefined();
    expect(hovered.state.preview).toMatchObject({ orientation: 1, reversedA: false, reversedB: false });
    expect(hovered.state.preview.value).toBeCloseTo(26.5650512, 6);
    const placed = transitionDimensionWorkflow(sketch, hovered.state, { type: 'place', position: { x: 80, y: 50 } });
    expect(placed.effect).toMatchObject({
      type: 'create',
      constraint: { orientation: -1, reversedA: true, reversedB: false },
    });
    if (placed.effect?.type !== 'create') throw Error();
    expect(placed.effect.constraint.labelPlacement).toBeDefined();
    expect(placed.effect.constraint.labelPosition).toBeUndefined();
    expect(resolveDimensionPlacement(sketch, placed.effect.constraint)).toMatchObject({ x: expect.closeTo(80), y: expect.closeTo(50) });
    expect(placed.effect.constraint.value).toBeCloseTo(153.4349488, 6);
  });
});
