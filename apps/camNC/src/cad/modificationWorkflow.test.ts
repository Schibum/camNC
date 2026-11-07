import { addLine, addRectangle, createCadPart } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { beginModification, transitionModification } from './modificationWorkflow';

describe('modification gesture phases', () => {
  it('previews only selected curves and never silently expands one edge to a loop', () => {
    const sketch = addRectangle(createCadPart().sketch, { x: 20, y: 20, width: 100, height: 60 });
    const line = sketch.entities.find(e => e.type === 'line')!;
    const state = beginModification(sketch, 'offset', [line.id, line.id, 'missing']);
    expect(state).toMatchObject({ phase: 'offset', entityIds: [line.id], text: '5', editing: false });
    expect(transitionModification(state, { type: 'text', text: '-10' })).toMatchObject({ text: '-10', editing: true, selectAll: false });
    expect(transitionModification(state, { type: 'edit' })).toMatchObject({ editing: true, selectAll: true });
  });
  it('keeps mirror source selection separate from choosing an axis and rearms after completion', () => {
    const sketch = addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 40, y2: 20 });
    const line = sketch.entities.find(e => e.type === 'line')!;
    const selected = beginModification(sketch, 'mirror', [line.id]);
    expect(selected).toMatchObject({ picking: 'axis', entityIds: [line.id] });
    expect(transitionModification(selected, { type: 'complete' })).toMatchObject({ phase: 'mirror', picking: 'entities', entityIds: [] });
    expect(beginModification(sketch, 'mirror', [])).toMatchObject({ picking: 'entities' });
  });
  it('locks an extend endpoint until completion or cancellation, independent of later pointer position', () => {
    const state = transitionModification({ phase: 'extend' }, { type: 'extendPick', entityId: 'line', end: 'start' });
    expect(state).toEqual({ phase: 'extend', entityId: 'line', end: 'start' });
    expect(transitionModification(state, { type: 'complete' })).toEqual({ phase: 'extend' });
    expect(transitionModification(state, { type: 'cancel' })).toEqual({ phase: 'idle' });
  });
});
