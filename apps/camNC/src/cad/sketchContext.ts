import { isSplineTangentHandle, originId, type CadPoint, type CadSketch } from '@wbcnc/cad';
import { pickSketchPoint, pickSketchSnap, type CadPickingOptions } from './picking';

export type SketchContextTarget = { kind: 'entity' | 'dimension'; id: string } | { kind: 'blank' };
export interface SketchContextSelection {
  entityIds: readonly string[];
  constraintIds: readonly string[];
}
export interface SketchContext extends SketchContextSelection {
  target: SketchContextTarget;
  /** Client coordinates, shared by pointer and keyboard menu invocation. */
  position: CadPoint;
}
export type SketchContextPress =
  | { phase: 'idle' }
  | { phase: 'pressed'; pointerId: number; start: CadPoint; target: SketchContextTarget; moved: boolean };
export type SketchContextPressEvent =
  | { type: 'press'; pointerId: number; position: CadPoint; target: SketchContextTarget }
  | { type: 'move' | 'release'; pointerId: number; position: CadPoint }
  | { type: 'cancel' };

/** Right-button click opens a menu; a captured drag pans without opening a menu on release. */
export function transitionSketchContextPress(
  state: SketchContextPress,
  event: SketchContextPressEvent
): {
  state: SketchContextPress;
  open?: { target: SketchContextTarget; position: CadPoint };
} {
  if (event.type === 'cancel') return { state: { phase: 'idle' } };
  if (event.type === 'press')
    return {
      state: { phase: 'pressed', pointerId: event.pointerId, target: { ...event.target }, start: { ...event.position }, moved: false },
    };
  if (state.phase !== 'pressed' || state.pointerId !== event.pointerId) return { state };
  const moved = state.moved || Math.hypot(event.position.x - state.start.x, event.position.y - state.start.y) >= 4;
  if (event.type === 'move') return { state: { ...state, moved } };
  return { state: { phase: 'idle' }, ...(!moved && { open: { target: { ...state.target }, position: { ...event.position } } }) };
}
export type SketchContextAction =
  | 'construction'
  | 'delete-entities'
  | 'clear'
  | 'fit'
  | 'fit-selection'
  | 'edit-dimension'
  | 'toggle-driven'
  | 'delete-dimensions';
export interface SketchContextItem {
  action: SketchContextAction;
  label: string;
  disabled?: boolean;
  checked?: boolean | 'indeterminate';
  shortcut?: string;
  separatorBefore?: boolean;
}

/** Visible annotation targets come from their DOM label; geometry uses the same nearest picking as drawing. */
export function pickSketchContextTarget(
  sketch: CadSketch,
  pointer: CadPoint,
  options: CadPickingOptions & { targetDimensionId?: string; targetEntityId?: string }
): SketchContextTarget {
  if (options.targetDimensionId)
    return sketch.constraints.some(c => c.id === options.targetDimensionId && 'value' in c)
      ? { kind: 'dimension', id: options.targetDimensionId }
      : { kind: 'blank' };
  const point = pickSketchPoint(sketch, pointer, {
    ...options,
    preferredPointId: options.targetEntityId ?? options.preferredPointId,
  });
  if (point?.targetPointId) return { kind: 'entity', id: point.targetPointId };
  const curve = pickSketchSnap(sketch, pointer, {
    ...options,
    includeMidpoints: false,
    pointRadiusPx: -1,
    preferredCurveId: options.targetEntityId ?? options.preferredCurveId,
  });
  return curve?.entityId ? { kind: 'entity', id: curve.entityId } : { kind: 'blank' };
}

/** Right-clicking a selected member preserves the group; a new target replaces the other selection. */
export function createSketchContext(
  sketch: CadSketch,
  target: SketchContextTarget,
  position: CadPoint,
  selection: SketchContextSelection
): SketchContext {
  const entityIds = [...new Set(selection.entityIds)].filter(id => sketch.entities.some(entity => entity.id === id));
  const constraintIds = [...new Set(selection.constraintIds)].filter(id => sketch.constraints.some(c => c.id === id));
  if (target.kind === 'entity' && sketch.entities.some(entity => entity.id === target.id))
    return {
      target: { ...target },
      position: { ...position },
      entityIds: entityIds.includes(target.id) ? entityIds : [target.id],
      constraintIds: [],
    };
  if (target.kind === 'dimension' && sketch.constraints.some(c => c.id === target.id && 'value' in c))
    return {
      target: { ...target },
      position: { ...position },
      entityIds: [],
      constraintIds: constraintIds.includes(target.id)
        ? constraintIds.filter(id => sketch.constraints.some(c => c.id === id && 'value' in c))
        : [target.id],
    };
  return { target: { kind: 'blank' }, position: { ...position }, entityIds, constraintIds };
}

/** Shift+F10 / ContextMenu can target the current selection without an inaccurate pointer position. */
export function selectedSketchContextTarget(sketch: CadSketch, selection: SketchContextSelection): SketchContextTarget {
  const dimension = selection.constraintIds.find(id => sketch.constraints.some(c => c.id === id && 'value' in c));
  if (dimension) return { kind: 'dimension', id: dimension };
  const entity = selection.entityIds.find(id => sketch.entities.some(entity => entity.id === id));
  return entity ? { kind: 'entity', id: entity } : { kind: 'blank' };
}

const editableEntities = (sketch: CadSketch, ids: readonly string[]) =>
  sketch.entities.filter(entity => ids.includes(entity.id) && entity.id !== originId(sketch) && !isSplineTangentHandle(sketch, entity.id));

/** Construction is one command for the selected group, including a consistent mixed-selection toggle. */
export function toggleContextConstruction(sketch: CadSketch, ids: readonly string[]): CadSketch {
  const targets = editableEntities(sketch, ids);
  if (!targets.length) return sketch;
  const construction = !targets.every(entity => entity.construction);
  const targetIds = new Set(targets.map(entity => entity.id));
  return { ...sketch, entities: sketch.entities.map(entity => (targetIds.has(entity.id) ? { ...entity, construction } : entity)) };
}

export function sketchContextItems(sketch: CadSketch, context: SketchContext, busy = false): SketchContextItem[] {
  if (context.target.kind === 'dimension') {
    const id = context.target.id;
    const dimension = sketch.constraints.find(c => c.id === id && 'value' in c);
    if (!dimension) return [];
    const driven = 'driven' in dimension && dimension.driven === true;
    return [
      { action: 'edit-dimension', label: 'Edit dimension', disabled: busy || driven, shortcut: 'Enter' },
      { action: 'toggle-driven', label: `Change to ${driven ? 'driving' : 'driven'} dimension`, disabled: busy },
      {
        action: 'delete-dimensions',
        label: context.constraintIds.length > 1 ? 'Delete dimensions' : 'Delete dimension',
        disabled: busy,
        shortcut: 'Delete',
      },
      { action: 'fit', label: 'Zoom to fit', separatorBefore: true, shortcut: 'F' },
    ];
  }
  const items: SketchContextItem[] = [];
  if (context.target.kind === 'entity') {
    const targets = editableEntities(sketch, context.entityIds);
    const allConstruction = targets.length > 0 && targets.every(entity => entity.construction);
    const someConstruction = targets.some(entity => entity.construction);
    items.push(
      {
        action: 'construction',
        label: 'Construction',
        checked: allConstruction ? true : someConstruction ? 'indeterminate' : false,
        disabled: busy || !targets.length,
        shortcut: 'Q',
      },
      {
        action: 'delete-entities',
        label: context.entityIds.length > 1 ? 'Delete sketch entities' : 'Delete sketch entity',
        disabled: busy || !targets.length,
        shortcut: 'Delete',
      }
    );
  }
  items.push(
    {
      action: 'clear',
      label: 'Clear selection',
      disabled: !context.entityIds.length && !context.constraintIds.length,
      separatorBefore: items.length > 0,
      shortcut: 'Space',
    },
    { action: 'fit', label: 'Zoom to fit', shortcut: 'F' }
  );
  if (context.entityIds.length) items.push({ action: 'fit-selection', label: 'Zoom to selection' });
  return items;
}
