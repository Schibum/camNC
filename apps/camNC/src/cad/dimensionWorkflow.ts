import {
  dimensionForSelection,
  withDimensionPlacement,
  type CadDimension,
  type CadDimensionMode,
  type CadPoint,
  type CadSketch,
} from '@wbcnc/cad';

interface PickingDimension {
  mode: CadDimensionMode;
  previewId: string;
  entityIds: readonly string[];
  pickHints: Readonly<Record<string, CadPoint>>;
}

/** A valid first-curve candidate can still collect a second reference before a blank placement click. */
export type DimensionWorkflow =
  | { phase: 'idle'; mode: CadDimensionMode }
  | (PickingDimension & { phase: 'picking'; message: string })
  | (PickingDimension & { phase: 'placing'; preview: CadDimension; existingConstraintId?: string });

export type DimensionWorkflowEvent =
  | { type: 'begin'; entityIds: readonly string[]; previewId: string; pickHints?: Readonly<Record<string, CadPoint>> }
  | { type: 'pick'; entityId: string; previewId: string; additive?: boolean; position?: CadPoint }
  | { type: 'mode'; mode: CadDimensionMode }
  | { type: 'place'; position: CadPoint }
  | { type: 'hover'; position: CadPoint }
  | { type: 'refresh' }
  | { type: 'cancel' };

export interface DimensionWorkflowTransition {
  state: DimensionWorkflow;
  message?: string;
  effect?: { type: 'create'; constraint: CadDimension } | { type: 'edit-existing'; constraintId: string };
}

export const idleDimensionWorkflow = (mode: CadDimensionMode = 'auto'): DimensionWorkflow => ({ phase: 'idle', mode });

function candidate(sketch: CadSketch, picking: PickingDimension, placement?: CadPoint): DimensionWorkflowTransition {
  const pickHints = Object.fromEntries(
    picking.entityIds.flatMap(id => (picking.pickHints[id] ? [[id, { ...picking.pickHints[id]! }]] : []))
  );
  const result = dimensionForSelection(sketch, picking.entityIds, { mode: picking.mode, placement, picks: pickHints });
  const selection = { mode: picking.mode, previewId: picking.previewId, entityIds: [...picking.entityIds], pickHints };
  if ('message' in result) return { state: { ...selection, phase: 'picking', message: result.message }, message: result.message };
  const preview: CadDimension = { ...result.constraint, id: result.existingConstraintId ?? picking.previewId };
  return {
    state: { ...selection, phase: 'placing', preview, existingConstraintId: result.existingConstraintId },
    message: 'Select another reference, or click empty space to place the dimension.',
  };
}

/** Pure command transitions: geometry clicks refine selection; only a blank click emits a placement effect. */
export function transitionDimensionWorkflow(
  sketch: CadSketch,
  state: DimensionWorkflow,
  event: DimensionWorkflowEvent
): DimensionWorkflowTransition {
  if (event.type === 'cancel') return { state: idleDimensionWorkflow(state.mode) };
  if (event.type === 'begin')
    return candidate(sketch, {
      mode: state.mode,
      previewId: event.previewId,
      entityIds: [...new Set(event.entityIds)],
      pickHints: event.pickHints ?? {},
    });
  if (event.type === 'mode')
    return state.phase === 'idle' ? { state: idleDimensionWorkflow(event.mode) } : candidate(sketch, { ...state, mode: event.mode });
  if (event.type === 'pick') {
    const ids = state.phase === 'idle' ? [] : [...state.entityIds];
    const entityIds = event.additive
      ? ids.includes(event.entityId)
        ? ids.filter(id => id !== event.entityId)
        : [...ids, event.entityId]
      : ids.length === 1
        ? ids.includes(event.entityId)
          ? ids
          : [...ids, event.entityId]
        : [event.entityId];
    const previousHints = state.phase === 'idle' ? {} : state.pickHints;
    const hints = { ...previousHints, ...(event.position && { [event.entityId]: { ...event.position } }) };
    return candidate(sketch, {
      mode: state.mode,
      previewId: state.phase === 'idle' ? event.previewId : state.previewId,
      entityIds,
      pickHints: Object.fromEntries(entityIds.flatMap(id => (hints[id] ? [[id, hints[id]!]] : []))),
    });
  }
  if (state.phase === 'idle') return { state };
  if (event.type === 'refresh') return candidate(sketch, state);
  if (event.type === 'hover') return state.phase === 'placing' ? candidate(sketch, state, event.position) : { state };
  const resolved = candidate(sketch, state, event.position);
  if (resolved.state.phase !== 'placing') return resolved;
  if (resolved.state.existingConstraintId)
    return {
      state: idleDimensionWorkflow(state.mode),
      effect: { type: 'edit-existing', constraintId: resolved.state.existingConstraintId },
    };
  return {
    state: idleDimensionWorkflow(state.mode),
    effect: { type: 'create', constraint: withDimensionPlacement(sketch, resolved.state.preview, event.position) },
  };
}
