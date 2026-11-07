import { describe, expect, it } from 'vitest';
import { idleDrawingGesture, transitionDrawingGesture } from './drawingGesture';

const press = (tool = 'line', canStart = true) =>
  transitionDrawingGesture(idleDrawingGesture(), {
    type: 'press',
    tool,
    canStart,
    pointerId: 7,
    position: { x: 100, y: 200 },
  }).state;

describe('pure primitive drawing gesture', () => {
  it.each(['line', 'rectangle', 'centerRectangle', 'circle'])('completes a %s drag on release exactly once', tool => {
    const start = press(tool);
    const moved = transitionDrawingGesture(start, { type: 'move', pointerId: 7, position: { x: 140, y: 230 } });
    expect(moved.effect).toBeUndefined();
    const released = transitionDrawingGesture(moved.state, { type: 'release', pointerId: 7, position: { x: 140, y: 230 } });
    expect(released).toEqual({ state: { phase: 'idle' }, effect: 'complete' });
    expect(transitionDrawingGesture(released.state, { type: 'cancel' })).toEqual({ state: { phase: 'idle' } });
    expect(
      transitionDrawingGesture(released.state, { type: 'release', pointerId: 7, position: { x: 160, y: 240 } }).effect
    ).toBeUndefined();
  });

  it('keeps click-click creation alive for a click or small screen-space jitter', () => {
    for (const position of [
      { x: 100, y: 200 },
      { x: 102, y: 202 },
    ]) {
      const released = transitionDrawingGesture(press(), { type: 'release', pointerId: 7, position });
      expect(released).toEqual({ state: { phase: 'idle' } });
    }
    expect(transitionDrawingGesture(press(), { type: 'release', pointerId: 7, position: { x: 104, y: 200 } }).effect).toBe('complete');
  });

  it('uses the release coordinates even when the browser did not deliver an intermediate move', () => {
    expect(transitionDrawingGesture(press(), { type: 'release', pointerId: 7, position: { x: 150, y: 250 } }).effect).toBe('complete');
  });

  it('retains drag intent after the pointer returns close to its start', () => {
    const moved = transitionDrawingGesture(press(), { type: 'move', pointerId: 7, position: { x: 120, y: 220 } });
    expect(transitionDrawingGesture(moved.state, { type: 'release', pointerId: 7, position: { x: 101, y: 201 } }).effect).toBe('complete');
  });

  it('ignores other pointer IDs and unsupported tools or an existing drawing chain', () => {
    const initial = press();
    expect(transitionDrawingGesture(initial, { type: 'release', pointerId: 8, position: { x: 150, y: 250 } }).state).toBe(initial);
    for (const tool of ['arc', 'conic', 'point', 'spline', 'select']) expect(press(tool)).toEqual({ phase: 'idle' });
    expect(press('line', false)).toEqual({ phase: 'idle' });
  });

  it('cancels a pending press without completing or carrying the gesture into the next command', () => {
    const cancelled = transitionDrawingGesture(press(), { type: 'cancel' });
    expect(cancelled).toEqual({ state: { phase: 'idle' }, effect: 'cancel' });
    expect(
      transitionDrawingGesture(cancelled.state, { type: 'release', pointerId: 7, position: { x: 150, y: 250 } }).effect
    ).toBeUndefined();
  });
});
