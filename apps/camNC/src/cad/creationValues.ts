import {
  dimensionForSelection,
  dimensionWitnessPoints,
  type CadDimensionMode,
  type CadPoint,
  type CadSketch,
  type NewCadDimension,
} from '@wbcnc/cad';
import type { SketchTool } from './sketchTools';

export interface CreationValueStep {
  entityId: string;
  mode: CadDimensionMode;
  label: string;
}
export interface CreationValues {
  partId: string;
  steps: CreationValueStep[];
  index: number;
  editing: boolean;
  text: string;
  selectAll: boolean;
  pointer?: CadPoint;
}

/** Completed geometry offers values without stealing focus from the next sketch shortcut. */
export function beginCreationValues(
  tool: SketchTool,
  partId: string,
  sketch: CadSketch,
  createdIds: string[],
  pointer?: CadPoint
): CreationValues | null {
  const created = new Set(createdIds);
  const entities = sketch.entities.filter(entity => created.has(entity.id));
  const steps: CreationValueStep[] = [];
  if (tool === 'line') {
    const line = entities.find(entity => entity.type === 'line');
    if (line) steps.push({ entityId: line.id, mode: 'distance', label: 'Line length' });
  } else if (tool === 'circle') {
    const circle = entities.find(entity => entity.type === 'circle');
    if (circle) steps.push({ entityId: circle.id, mode: 'auto', label: 'Circle diameter' });
  } else if (tool === 'rectangle' || tool === 'centerRectangle') {
    const points = new Map(sketch.entities.flatMap(entity => (entity.type === 'point' ? [[entity.id, entity] as const] : [])));
    const lines = entities.filter(entity => entity.type === 'line');
    const horizontal = lines
      .filter(line => {
        const a = points.get(line.startId),
          b = points.get(line.endId);
        return a && b && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.x - b.x) > 1e-6;
      })
      .sort((a, b) => points.get(b.startId)!.y - points.get(a.startId)!.y)[0];
    const vertical = lines
      .filter(line => {
        const a = points.get(line.startId),
          b = points.get(line.endId);
        return a && b && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) > 1e-6;
      })
      .sort((a, b) => points.get(a.startId)!.x - points.get(b.startId)!.x)[0];
    if (horizontal) steps.push({ entityId: horizontal.id, mode: 'distanceX', label: 'Rectangle width' });
    if (vertical) steps.push({ entityId: vertical.id, mode: 'distanceY', label: 'Rectangle height' });
  }
  return steps.length ? { partId, steps, index: 0, editing: false, text: '', selectAll: false, pointer } : null;
}

export function creationValueAt(
  state: CreationValues,
  sketch: CadSketch,
  index = state.index
): { constraint: NewCadDimension; existingConstraintId?: string } | null {
  const step = state.steps[index];
  if (!step || !sketch.entities.some(entity => entity.id === step.entityId)) return null;
  const result = dimensionForSelection(sketch, [step.entityId], { mode: step.mode });
  if (!('constraint' in result)) return null;
  const c = result.constraint;
  // Creation asks for positive width/height, independently of the boundary line's traversal direction.
  if ((c.type === 'distanceX' || c.type === 'distanceY') && c.value < 0 && !result.existingConstraintId)
    return { ...result, constraint: { ...c, pointAId: c.pointBId, pointBId: c.pointAId, value: -c.value } };
  return result;
}

export function advanceCreationValue(state: CreationValues): CreationValues | null {
  return state.index + 1 < state.steps.length ? { ...state, index: state.index + 1, editing: false, text: '', selectAll: false } : null;
}

export function creationValueAnchor(state: CreationValues, sketch: CadSketch, index: number, pixelScale: number): CadPoint | null {
  const value = creationValueAt(state, sketch, index),
    step = state.steps[index],
    offset = 20 / Math.max(pixelScale, 1e-9);
  if (!value || !step) return null;
  const pair = dimensionWitnessPoints(sketch, value.constraint);
  if (pair) {
    const [a, b] = pair,
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (step.mode === 'distanceX') return { x: mid.x, y: Math.max(a.y, b.y) + offset };
    if (step.mode === 'distanceY') return { x: Math.min(a.x, b.x) - offset, y: mid.y };
    const length = Math.hypot(b.x - a.x, b.y - a.y),
      sign = b.x - a.x < 0 || (b.x === a.x && b.y > a.y) ? -1 : 1;
    return { x: mid.x - (sign * (b.y - a.y) * offset) / length, y: mid.y + (sign * (b.x - a.x) * offset) / length };
  }
  const entity = sketch.entities.find(entity => entity.id === step.entityId);
  if (entity?.type !== 'circle') return null;
  const center = sketch.entities.find(entityPoint => entityPoint.id === entity.centerId);
  if (center?.type !== 'point') return null;
  const angle = state.pointer ? Math.atan2(center.y - state.pointer.y, center.x - state.pointer.x) : Math.PI;
  return { x: center.x + Math.cos(angle) * (entity.radius + offset), y: center.y + Math.sin(angle) * (entity.radius + offset) };
}
