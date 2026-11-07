import type { CadPoint, CadSketch, NewCadConstraint } from '@wbcnc/cad';
import { pickSketchSnap, sketchPointReferences, type CadPickingOptions, type CadSnapResult } from './picking';

export interface CadAxisAlignment {
  type: 'horizontalPoints' | 'verticalPoints';
  sourcePointId: string;
  sourcePoint: CadPoint;
  /** Additional correction from the raw/locked base point, measured in CSS pixels. */
  distancePx: number;
}
export interface CadInferenceGuide {
  axis: 'horizontal' | 'vertical';
  sourcePointId: string;
  from: CadPoint;
  to: CadPoint;
}
export interface CadDrawingInference {
  point: CadPoint;
  snap: CadSnapResult | null;
  alignments: CadAxisAlignment[];
  guides: CadInferenceGuide[];
}
export interface CadDrawingInferenceOptions extends CadPickingOptions {
  enabled?: boolean;
  /** Per-axis correction tolerance. Two independently eligible axes may both engage. */
  alignmentRadiusPx?: number;
  /** Coordinates already fixed by pending-line orientation or tangency must never move. */
  lockedAxes?: { x?: number; y?: number };
  /** Optional already-computed contact. Explicit null skips a second geometry-picking pass. */
  directSnap?: CadSnapResult | null;
  /** Recently hovered references, ordered most recent FIRST. Only candidates inside tolerance qualify. */
  preferredPointIds?: readonly string[];
}

const finite = (point: CadPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const coordinateTolerance = 1e-7;

/** Hover and click share this pure result; no grid rounding or source edits happen during inference. */
export function inferDrawingPoint(sketch: CadSketch, rawWorld: CadPoint, options: CadDrawingInferenceOptions): CadDrawingInference {
  const empty = (point: CadPoint): CadDrawingInference => ({ point: { x: point.x, y: point.y }, snap: null, alignments: [], guides: [] });
  if (options.enabled === false || !finite(rawWorld)) return empty(rawWorld);
  const pointerScreen = options.project(rawWorld);
  if (!finite(pointerScreen)) return empty(rawWorld);
  const snap = options.directSnap === undefined ? pickSketchSnap(sketch, pointerScreen, options) : options.directSnap;
  // A local point/midpoint/curve contact is stronger than a remote axis alignment.
  // In particular, alignment must not move a selected curve contact off its curve.
  if (snap && finite(snap.point)) return { ...empty(snap.point), snap };
  const locked = {
    x: Number.isFinite(options.lockedAxes?.x) ? options.lockedAxes!.x : undefined,
    y: Number.isFinite(options.lockedAxes?.y) ? options.lockedAxes!.y : undefined,
  };
  const base = { x: locked.x ?? rawWorld.x, y: locked.y ?? rawWorld.y };
  const baseScreen = options.project(base);
  if (!finite(baseScreen)) return empty(rawWorld);
  const radius = Number.isFinite(options.alignmentRadiusPx) ? Math.max(0, options.alignmentRadiusPx!) : 8;
  const preferences = new Map<string, number>();
  options.preferredPointIds?.forEach((id, index) => {
    if (!preferences.has(id)) preferences.set(id, index);
  });
  const references = sketchPointReferences(sketch, options);
  const alignments: CadAxisAlignment[] = [];
  const point = { ...base };
  for (const axis of ['y', 'x'] as const) {
    const candidates = references.flatMap(reference => {
      if (locked[axis] !== undefined && Math.abs(reference.point[axis] - locked[axis]!) > coordinateTolerance) return [];
      const candidate = { ...base, [axis]: locked[axis] ?? reference.point[axis] };
      const screen = options.project(candidate);
      if (!finite(screen)) return [];
      const distancePx = distance(baseScreen, screen);
      if (distancePx > radius) return [];
      return [
        {
          reference,
          distancePx,
          proximity: distance(pointerScreen, reference.screenPoint),
          preferred: preferences.get(reference.targetPointId) ?? Number.POSITIVE_INFINITY,
        },
      ];
    });
    candidates.sort((a, b) => {
      if (a.preferred !== b.preferred) return a.preferred < b.preferred ? -1 : 1;
      if (Math.abs(a.distancePx - b.distancePx) > 1e-9) return a.distancePx - b.distancePx;
      if (Math.abs(a.proximity - b.proximity) > 1e-9) return a.proximity - b.proximity;
      return a.reference.targetPointId.localeCompare(b.reference.targetPointId);
    });
    const selected = candidates[0];
    if (!selected) continue;
    point[axis] = locked[axis] ?? selected.reference.point[axis];
    alignments.push({
      type: axis === 'y' ? 'horizontalPoints' : 'verticalPoints',
      sourcePointId: selected.reference.targetPointId,
      sourcePoint: { ...selected.reference.point },
      distancePx: selected.distancePx,
    });
  }
  return {
    point,
    snap: null,
    alignments,
    guides: alignments.map(alignment => ({
      axis: alignment.type === 'horizontalPoints' ? 'horizontal' : 'vertical',
      sourcePointId: alignment.sourcePointId,
      from: { ...alignment.sourcePoint },
      to: { ...point },
    })),
  };
}

/** Bind the preview's explicit source identities to the actual newly-created point identity. */
export function inferredPointConstraints(inference: CadDrawingInference, pointBId: string, sketch?: CadSketch): NewCadConstraint[] {
  if (!pointBId) return [];
  const proposals: NewCadConstraint[] = [];
  for (const alignment of inference.alignments) {
    const pointAId = alignment.sourcePointId;
    if (pointAId === pointBId) continue;
    if (sketch && ![pointAId, pointBId].every(id => sketch.entities.some(e => e.id === id && e.type === 'point'))) continue;
    const samePair = (a: string, b: string) => (a === pointAId && b === pointBId) || (a === pointBId && b === pointAId);
    const existing = [...(sketch?.constraints ?? []), ...proposals];
    if (existing.some(c => 'pointAId' in c && samePair(c.pointAId, c.pointBId) && (c.type === alignment.type || c.type === 'coincident')))
      continue;
    if (
      sketch?.constraints.some(c => {
        if (c.type !== (alignment.type === 'horizontalPoints' ? 'horizontal' : 'vertical')) return false;
        const line = sketch.entities.find(e => e.id === c.entityId);
        return line?.type === 'line' && samePair(line.startId, line.endId);
      })
    )
      continue;
    proposals.push({ type: alignment.type, pointAId, pointBId });
  }
  return proposals;
}
