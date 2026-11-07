import type { CadSketch } from '@wbcnc/cad';

export type ModificationTool = 'offset' | 'mirror' | 'extend';
export type ModificationWorkflow =
  | { phase: 'idle' }
  | { phase: 'offset'; entityIds: string[]; text: string; editing: boolean; selectAll: boolean }
  | { phase: 'mirror'; entityIds: string[]; picking: 'entities' | 'axis' }
  | { phase: 'extend'; entityId?: string; end?: 'start' | 'end' };
export const idleModificationWorkflow = (): ModificationWorkflow => ({ phase: 'idle' });

export function modificationSourceIds(sketch: CadSketch, ids: readonly string[], tool: ModificationTool): string[] {
  const allowed =
    tool === 'offset'
      ? ['line', 'circle', 'arc']
      : tool === 'extend'
        ? ['line', 'arc']
        : ['point', 'line', 'circle', 'arc', 'conic', 'spline', 'bezier'];
  return [...new Set(ids)].filter(id => sketch.entities.some(entity => entity.id === id && allowed.includes(entity.type)));
}

export function beginModification(sketch: CadSketch, tool: ModificationTool, selected: readonly string[]): ModificationWorkflow {
  const entityIds = modificationSourceIds(sketch, selected, tool);
  return tool === 'offset'
    ? { phase: 'offset', entityIds, text: '5', editing: false, selectAll: true }
    : tool === 'mirror'
      ? { phase: 'mirror', entityIds, picking: entityIds.length ? 'axis' : 'entities' }
      : { phase: 'extend' };
}

export type ModificationEvent =
  | { type: 'sources'; entityIds: string[] }
  | { type: 'text'; text: string }
  | { type: 'edit' }
  | { type: 'mirrorPicking'; picking: 'entities' | 'axis' }
  | { type: 'extendPick'; entityId: string; end: 'start' | 'end' }
  | { type: 'complete' | 'cancel' };

/** Tool phases only; pure geometry commands and the caller own commits and one-step Undo. */
export function transitionModification(state: ModificationWorkflow, event: ModificationEvent): ModificationWorkflow {
  if (event.type === 'cancel') return idleModificationWorkflow();
  if (event.type === 'complete')
    return state.phase === 'offset'
      ? { ...state, entityIds: [], editing: false }
      : state.phase === 'mirror'
        ? { ...state, entityIds: [], picking: 'entities' }
        : state.phase === 'extend'
          ? { phase: 'extend' }
          : state;
  if (event.type === 'sources' && (state.phase === 'offset' || state.phase === 'mirror'))
    return { ...state, entityIds: [...event.entityIds] };
  if (state.phase === 'offset' && event.type === 'text') return { ...state, text: event.text, editing: true, selectAll: false };
  if (state.phase === 'offset' && event.type === 'edit') return { ...state, editing: true, selectAll: true };
  if (state.phase === 'mirror' && event.type === 'mirrorPicking') return { ...state, picking: event.picking };
  if (state.phase === 'extend' && event.type === 'extendPick') return { phase: 'extend', entityId: event.entityId, end: event.end };
  return state;
}
