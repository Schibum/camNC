import { entityPointIds, newCadId } from './document';
import { pointEquivalence } from './pointEquivalence';
import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import { splineHandleOwner } from './splineHandles';
import type { CadEntity, CadPoint, CadPointEntity, CadSketch } from './types';

export interface CadMirrorOptions {
  entityIds: readonly string[];
  axisId: string;
}
export type CadMirrorResult =
  | { ok: true; sketch: CadSketch; sourceIds: string[]; entityIds: string[]; createdEntityIds: string[]; constraintIds: string[] }
  | { ok: false; message: string };

/** Linked mirror geometry, with native symmetry over real source points and equal circular radii. */
export function mirrorSketchEntities(sketch: CadSketch, { entityIds, axisId }: CadMirrorOptions): CadMirrorResult {
  const entities = new Map(sketch.entities.map(entity => [entity.id, entity]));
  const axis = entities.get(axisId);
  if (axis?.type !== 'line') return { ok: false, message: 'Choose a straight mirror line.' };
  const a = entities.get(axis.startId),
    b = entities.get(axis.endId);
  if (a?.type !== 'point' || b?.type !== 'point') return { ok: false, message: 'Repair the mirror line endpoints first.' };
  const dx = b.x - a.x,
    dy = b.y - a.y,
    squared = dx * dx + dy * dy;
  if (!Number.isFinite(squared) || squared <= CAD_GEOMETRY_TOLERANCE ** 2)
    return { ok: false, message: 'The mirror line needs distinct finite endpoints.' };
  const sourceIds = [...new Set(entityIds)];
  if (!sourceIds.length || sourceIds.includes(axisId)) return { ok: false, message: 'Select geometry separate from its mirror line.' };
  const sources = sourceIds.map(id => entities.get(id));
  if (sourceIds.some(id => splineHandleOwner(sketch, id)))
    return { ok: false, message: 'Spline tangent handles belong to their curve and cannot be mirrored separately.' };
  if (sources.some(entity => !entity || !['point', 'line', 'circle', 'arc'].includes(entity.type)))
    return {
      ok: false,
      message: 'Linked Mirror currently supports points, lines, circles and arcs. Spline, Bezier and conic mirrors are not supported yet.',
    };
  const equivalent = pointEquivalence(sketch.constraints);
  const reflect = (point: CadPoint): CadPoint => {
    const x = point.x - a.x,
      y = point.y - a.y,
      t = (x * dx + y * dy) / squared;
    return { x: a.x + 2 * t * dx - x, y: a.y + 2 * t * dy - y };
  };
  const next = structuredClone(sketch);
  const pointCopies = new Map<string, string>();
  const entityCopies = new Map<string, string>();
  const createdEntityIds: string[] = [],
    constraintIds: string[] = [];
  const copyPoint = (id: string): string => {
    const sourceId = equivalent.canonical(id);
    const previous = pointCopies.get(sourceId);
    if (previous) return previous;
    const source = entities.get(sourceId);
    if (source?.type !== 'point' || ![source.x, source.y].every(Number.isFinite))
      throw Error('A selected curve has a missing or invalid point.');
    const mirrored = reflect(source);
    if (![mirrored.x, mirrored.y].every(Number.isFinite)) throw Error('The mirror is outside the supported geometry range.');
    const copy: CadPointEntity = {
      id: newCadId(),
      type: 'point',
      ...mirrored,
      construction: source.construction,
      standalone: equivalent.members(sourceId).some(member => (entities.get(member) as CadPointEntity | undefined)?.standalone),
    };
    pointCopies.set(sourceId, copy.id);
    next.entities.push(copy);
    createdEntityIds.push(copy.id);
    const constraintId = newCadId();
    next.constraints.push({ id: constraintId, type: 'symmetricPoints', pointAId: sourceId, pointBId: copy.id, lineId: axisId });
    constraintIds.push(constraintId);
    return copy.id;
  };
  try {
    for (const source of sources as CadEntity[]) {
      if (source.type === 'point') {
        entityCopies.set(source.id, copyPoint(source.id));
        continue;
      }
      entityPointIds(source).forEach(copyPoint);
      const id = newCadId();
      let copy: CadEntity;
      if (source.type === 'line') copy = { ...source, id, startId: copyPoint(source.startId), endId: copyPoint(source.endId) };
      else if (source.type === 'circle') {
        if (!Number.isFinite(source.radius) || source.radius <= CAD_GEOMETRY_TOLERANCE)
          throw Error('Repair the selected circle before mirroring it.');
        copy = { ...source, id, centerId: copyPoint(source.centerId) };
        const constraintId = newCadId();
        next.constraints.push({ id: constraintId, type: 'equal', entityAId: source.id, entityBId: id });
        constraintIds.push(constraintId);
      } else if (source.type === 'arc') {
        const centerId = copyPoint(source.centerId),
          startId = copyPoint(source.endId),
          endId = copyPoint(source.startId);
        const center = next.entities.find(entity => entity.id === centerId) as CadPointEntity;
        const start = next.entities.find(entity => entity.id === startId) as CadPointEntity;
        const tau = 2 * Math.PI,
          sweep = (((source.endAngle - source.startAngle) % tau) + tau) % tau;
        if (!Number.isFinite(source.radius) || source.radius <= CAD_GEOMETRY_TOLERANCE || sweep * source.radius <= CAD_GEOMETRY_TOLERANCE)
          throw Error('Repair the selected arc before mirroring it.');
        const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
        copy = { ...source, id, centerId, startId, endId, startAngle, endAngle: startAngle + sweep };
      } else throw Error('This curve cannot be mirrored.');
      next.entities.push(copy);
      createdEntityIds.push(id);
      entityCopies.set(source.id, id);
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The selected geometry could not be mirrored.' };
  }
  return {
    ok: true,
    sketch: next,
    sourceIds,
    entityIds: [...new Set(sourceIds.map(id => entityCopies.get(id)!))],
    createdEntityIds,
    constraintIds,
  };
}
