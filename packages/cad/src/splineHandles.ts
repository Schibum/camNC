import type { CadEntity, CadLineEntity, CadSketch, CadSplineEntity, CadSplineHandleOwner } from './types';

export type CadSplineHandleLine = CadLineEntity & { owner: CadSplineHandleOwner };
export const splineHandleId = (splineId: string, end: CadSplineHandleOwner['end']): string => `${splineId}:handle:${end}`;
export const isOwnedSplineHandle = (entity: CadEntity): entity is CadSplineHandleLine =>
  entity.type === 'line' && entity.owner?.type === 'splineHandle';

/** No new points or equations: the ordinary line references the native spline endpoint and adjacent pole. */
export function splineHandleEntities(spline: CadSplineEntity): CadSplineHandleLine[] {
  if (spline.closed) return [];
  return (['start', 'end'] as const).map(end => ({
    id: splineHandleId(spline.id, end),
    type: 'line',
    construction: true,
    startId: end === 'start' ? spline.startId : spline.endId,
    endId: end === 'start' ? spline.controlPointIds[1]! : spline.controlPointIds.at(-2)!,
    owner: { type: 'splineHandle', splineId: spline.id, end },
  }));
}

/** Deterministic hydration for already editable source; repeated load/solve adds nothing. */
export function withSplineHandleSegments(sketch: CadSketch): CadSketch {
  const existing = new Set(sketch.entities.map(e => e.id)),
    entities: CadEntity[] = [];
  let changed = false;
  for (const entity of sketch.entities) {
    if (entity.type === 'spline' && !entity.closed && Array.isArray(entity.controlPointIds) && entity.controlPointIds.length >= 4) {
      for (const handle of splineHandleEntities(entity))
        if (!existing.has(handle.id)) {
          entities.push(handle);
          existing.add(handle.id);
          changed = true;
        }
    }
    entities.push(entity);
  }
  return changed ? { ...sketch, entities } : sketch;
}

/** Points and segments remain distinct selectable surfaces with the same protected parent ownership. */
export function splineHandleOwner(sketch: CadSketch, entityId: string): CadSplineHandleOwner | undefined {
  const entity = sketch.entities.find(e => e.id === entityId);
  if (entity && isOwnedSplineHandle(entity)) return entity.owner;
  for (const spline of sketch.entities) {
    if (spline.type !== 'spline' || spline.closed) continue;
    if (spline.controlPointIds[1] === entityId) return { type: 'splineHandle', splineId: spline.id, end: 'start' };
    if (spline.controlPointIds.at(-2) === entityId) return { type: 'splineHandle', splineId: spline.id, end: 'end' };
  }
  return undefined;
}

/** Validate source ownership instead of treating helper metadata as an unconstrained annotation. */
export function splineHandleIssue(entity: CadEntity, entities: ReadonlyMap<string, CadEntity>): string | null {
  const owner = (entity as { owner?: unknown }).owner;
  if (owner === undefined) return null;
  if (entity.type !== 'line' || !owner || typeof owner !== 'object') return 'Only spline tangent segments may have an owner.';
  const value = owner as Partial<CadSplineHandleOwner>;
  if (value.type !== 'splineHandle' || typeof value.splineId !== 'string' || !['start', 'end'].includes(value.end ?? ''))
    return 'A spline tangent segment needs a valid parent and endpoint.';
  const parent = entities.get(value.splineId);
  if (parent?.type !== 'spline' || parent.closed || !Array.isArray(parent.controlPointIds) || parent.controlPointIds.length < 4)
    return 'A tangent segment must belong to an open fit spline.';
  const expected = splineHandleEntities(parent).find(line => line.owner.end === value.end)!;
  if (entity.id !== expected.id || entity.startId !== expected.startId || entity.endId !== expected.endId || entity.construction !== true)
    return 'A tangent segment must retain its parent endpoint, adjacent pole and construction identity.';
  return null;
}

/** Shared keyboard/context command: structural spline helpers and the origin cannot become cut geometry. */
export function setSketchConstruction(sketch: CadSketch, ids: readonly string[], construction: boolean): CadSketch {
  const selected = new Set(ids.filter(id => id !== `${sketch.id}:origin` && !splineHandleOwner(sketch, id)));
  if (!sketch.entities.some(e => selected.has(e.id) && !!e.construction !== construction)) return sketch;
  return { ...sketch, entities: sketch.entities.map(e => (selected.has(e.id) ? { ...e, construction } : e)) };
}
