import type { CadPoint } from '@wbcnc/cad';

export type DragDrawingTool = 'line' | 'rectangle' | 'centerRectangle' | 'circle';
export type DrawingGesture =
  | { phase: 'idle' }
  | { phase: 'pressed'; tool: DragDrawingTool; pointerId: number; start: CadPoint; moved: boolean };
export type DrawingGestureEvent =
  | { type: 'press'; tool: string; pointerId: number; position: CadPoint; canStart: boolean }
  | { type: 'move' | 'release'; pointerId: number; position: CadPoint }
  | { type: 'cancel' };
export interface DrawingGestureTransition {
  state: DrawingGesture;
  effect?: 'complete' | 'cancel';
}
export const idleDrawingGesture = (): DrawingGesture => ({ phase: 'idle' });

/** A click starts click-click drawing; a primary press dragged 4 CSS pixels completes on release. */
export function transitionDrawingGesture(state: DrawingGesture, event: DrawingGestureEvent): DrawingGestureTransition {
  if (event.type === 'cancel') return { state: idleDrawingGesture(), ...(state.phase === 'pressed' && { effect: 'cancel' }) };
  if (event.type === 'press') {
    if (state.phase !== 'idle' || !event.canStart || !['line', 'rectangle', 'centerRectangle', 'circle'].includes(event.tool))
      return { state };
    return {
      state: {
        phase: 'pressed',
        tool: event.tool as DragDrawingTool,
        pointerId: event.pointerId,
        start: { ...event.position },
        moved: false,
      },
    };
  }
  if (state.phase !== 'pressed' || state.pointerId !== event.pointerId) return { state };
  const moved = state.moved || Math.hypot(event.position.x - state.start.x, event.position.y - state.start.y) >= 4;
  return event.type === 'move' ? { state: { ...state, moved } } : { state: idleDrawingGesture(), ...(moved && { effect: 'complete' }) };
}
