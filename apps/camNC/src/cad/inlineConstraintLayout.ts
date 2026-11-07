import {
  constraintEntityIds,
  originId,
  pointEquivalence,
  removeConstraint,
  curveEndpointIds,
  evaluateCurvePoint,
  isNurbsCurve,
  tessellateCurve,
  type CadConstraint,
  type CadDimension,
  type CadEntity,
  type CadPoint,
  type CadSketch,
} from '@wbcnc/cad';

export type InlineConstraintKind = Exclude<CadConstraint['type'], CadDimension['type']> | 'fix';
export interface InlineConstraintGlyph {
  id: string;
  key: string;
  kind: InlineConstraintKind;
  label: string;
  /** Source anchor and displaced glyph position, in model XY. */
  anchor: CadPoint;
  position: CadPoint;
  entityIds: string[];
}

export const INLINE_CONSTRAINT_SIZE = 20;
const gap = 3;
const tau = Math.PI * 2;
const finite = (p: CadPoint) => Number.isFinite(p.x) && Number.isFinite(p.y);
const wrap = (a: number) => ((a % tau) + tau) % tau;
const midpoint = (a: CadPoint, b: CadPoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const labels: Record<InlineConstraintKind, string> = {
  horizontal: 'Horizontal',
  horizontalPoints: 'Horizontal',
  vertical: 'Vertical',
  verticalPoints: 'Vertical',
  coincident: 'Coincident',
  pointOnLine: 'Point on line',
  pointOnCircle: 'Point on circle',
  pointOnCurve: 'Point on curve',
  midpoint: 'Midpoint',
  tangent: 'Tangent',
  equal: 'Equal',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  symmetricPoints: 'Symmetric',
  fix: 'Fixed point',
};

export const fixedConstraintId = (pointId: string) => `fix:${pointId}`;

/** Logical source references, shared by inline hover, selection, and the existing dimension controls. */
export function associatedEntityIds(sketch: CadSketch, constraintId: string): string[] {
  const constraint = sketch.constraints.find(c => c.id === constraintId);
  if (constraint) return [...new Set(constraintEntityIds(constraint))];
  if (!constraintId.startsWith('fix:')) return [];
  const pointId = constraintId.slice(4);
  return sketch.entities.some(e => e.type === 'point' && e.id === pointId && e.fixed) ? [pointId] : [];
}

/** Delete works on actual constraints and synthetic fixed-point glyphs, without deleting their geometry. */
export function removeInlineConstraint(sketch: CadSketch, constraintId: string): CadSketch {
  if (sketch.constraints.some(c => c.id === constraintId)) return removeConstraint(sketch, constraintId);
  const pointId = constraintId.startsWith('fix:') ? constraintId.slice(4) : null;
  if (!pointId || pointId === originId(sketch) || !sketch.entities.some(e => e.type === 'point' && e.id === pointId && e.fixed))
    return sketch;
  return { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' && e.id === pointId ? { ...e, fixed: false } : e)) };
}

/** Deterministic layout in screen pixels; source IDs and geometry do not change when markers move. */
export function layoutInlineConstraints(sketch: CadSketch, scale: number): InlineConstraintGlyph[] {
  const zoom = Number.isFinite(scale) && Math.abs(scale) > 1e-6 ? Math.abs(scale) : 1;
  const points = new Map(sketch.entities.flatMap(e => (e.type === 'point' && finite(e) ? [[e.id, e] as const] : [])));
  const entities = new Map(sketch.entities.map(e => [e.id, e]));
  const equivalent = pointEquivalence(sketch.constraints);
  const screen = (p: CadPoint) => ({ x: p.x * zoom, y: -p.y * zoom });
  const curveAnchor = (e: CadEntity): CadPoint | null => {
    if (e.type === 'point') return finite(e) ? { x: e.x, y: e.y } : null;
    if (e.type === 'line') {
      const a = points.get(e.startId),
        b = points.get(e.endId);
      return a && b ? midpoint(a, b) : null;
    }
    if (isNurbsCurve(e)) {
      try {
        return evaluateCurvePoint(e, points, 0.5);
      } catch {
        return null;
      }
    }
    const center = points.get(e.centerId);
    if (!center || !Number.isFinite(e.radius)) return null;
    const angle = e.type === 'arc' ? e.startAngle + (wrap(e.endAngle - e.startAngle) || tau) / 2 : Math.PI / 4;
    return { x: center.x + e.radius * Math.cos(angle), y: center.y + e.radius * Math.sin(angle) };
  };
  const normal = (e: CadEntity | undefined, at: CadPoint) => {
    if (e?.type === 'line') {
      const a = points.get(e.startId),
        b = points.get(e.endId);
      if (a && b) {
        const dx = b.x - a.x,
          dy = -(b.y - a.y),
          length = Math.hypot(dx, dy);
        if (length > 1e-9) {
          let x = dy / length,
            y = -dx / length;
          if (y > 1e-9 || (Math.abs(y) <= 1e-9 && x > 0)) {
            x = -x;
            y = -y;
          }
          return { x, y };
        }
      }
    } else if (e?.type === 'circle' || e?.type === 'arc') {
      const center = points.get(e.centerId);
      if (center) {
        const length = distance(at, center);
        if (length > 1e-9) return { x: (at.x - center.x) / length, y: -(at.y - center.y) / length };
      }
    }
    return { x: 1, y: -1 };
  };
  const endpointIds = curveEndpointIds;
  const joinedAnchor = (refs: CadEntity[]) => {
    if (refs.length !== 2) return null;
    const joint = equivalent.match(endpointIds(refs[0]), endpointIds(refs[1]));
    return joint ? (points.get(joint[0]) ?? null) : null;
  };
  const tangentAnchor = (refs: CadEntity[]) => {
    const joined = joinedAnchor(refs);
    if (joined) return joined;
    const line = refs.find(e => e.type === 'line');
    const circular = refs.find(e => e.type === 'circle' || e.type === 'arc');
    if (line?.type === 'line' && circular && 'centerId' in circular) {
      const a = points.get(line.startId),
        b = points.get(line.endId),
        center = points.get(circular.centerId);
      if (a && b && center) {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          length2 = dx * dx + dy * dy;
        const t = length2 > 1e-12 ? Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / length2)) : 0;
        return { x: a.x + t * dx, y: a.y + t * dy };
      }
    }
    return null;
  };
  type Pending = Omit<InlineConstraintGlyph, 'position'> & { offset: CadPoint };
  const pending: Pending[] = [];
  for (const constraint of sketch.constraints) {
    if ('value' in constraint) continue;
    const kind = constraint.type;
    const ids = associatedEntityIds(sketch, constraint.id);
    const refs = ids.flatMap(id => (entities.has(id) ? [entities.get(id)!] : []));
    const add = (anchor: CadPoint | null, owner?: CadEntity) => {
      if (anchor && finite(anchor))
        pending.push({
          id: constraint.id,
          key: `${constraint.id}:${owner?.id ?? 'relation'}`,
          kind,
          label: labels[kind],
          anchor: { x: anchor.x, y: anchor.y },
          offset: normal(owner, anchor),
          entityIds: ids,
        });
    };
    // Equal and parallel relations mark both members, with a shared logical selection ID.
    if ((kind === 'parallel' || kind === 'equal') && refs.length === 2) {
      refs.forEach(e => add(curveAnchor(e), e));
    } else if ('pointId' in constraint) {
      add(points.get(constraint.pointId) ?? null, entities.get(constraint.entityId));
    } else if ('pointAId' in constraint) {
      const a = points.get(constraint.pointAId),
        b = points.get(constraint.pointBId);
      add(a && b ? midpoint(a, b) : (a ?? b ?? null));
    } else if ('entityId' in constraint) {
      const owner = entities.get(constraint.entityId);
      add(owner ? curveAnchor(owner) : null, owner);
    } else {
      const shared = kind === 'tangent' ? tangentAnchor(refs) : joinedAnchor(refs);
      const anchors = refs.flatMap(e => {
        const p = curveAnchor(e);
        return p ? [p] : [];
      });
      add(shared ?? (anchors.length === 2 ? midpoint(anchors[0], anchors[1]) : (anchors[0] ?? null)));
    }
  }
  for (const point of points.values())
    if (point.fixed && point.id !== originId(sketch))
      pending.push({
        id: fixedConstraintId(point.id),
        key: fixedConstraintId(point.id),
        kind: 'fix',
        label: labels.fix,
        anchor: { x: point.x, y: point.y },
        offset: { x: -1, y: 1 },
        entityIds: [point.id],
      });
  // UUIDs identify glyphs but must not choose which relation claims a collision
  // slot. Stable sort retains source order only for visually identical markers.
  pending.sort(
    (a, b) =>
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
      a.anchor.x - b.anchor.x ||
      a.anchor.y - b.anchor.y ||
      a.offset.x - b.offset.x ||
      a.offset.y - b.offset.y
  );

  const half = INLINE_CONSTRAINT_SIZE / 2;
  const pointScreens = [...points.values()].map(screen);
  const obstacles = sketch.entities.filter(e => e.type !== 'point');
  const lineDistance = (p: CadPoint, a: CadPoint, b: CadPoint) => {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length2 = dx * dx + dy * dy;
    const t = length2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const hitsGeometry = (position: CadPoint) => {
    if (
      pointScreens.some(p => Math.hypot(Math.max(0, Math.abs(p.x - position.x) - half), Math.max(0, Math.abs(p.y - position.y) - half)) < 9)
    )
      return true;
    for (const e of obstacles) {
      let d = Infinity;
      if (e.type === 'line') {
        const a = points.get(e.startId),
          b = points.get(e.endId);
        if (a && b) d = lineDistance(position, screen(a), screen(b));
      } else if (e.type === 'circle' || e.type === 'arc') {
        const c = points.get(e.centerId);
        if (!c || !Number.isFinite(e.radius)) continue;
        const center = screen(c),
          radius = e.radius * zoom;
        const angle = Math.atan2(-(position.y - center.y), position.x - center.x);
        const onSweep = e.type === 'circle' || wrap(angle - e.startAngle) <= (wrap(e.endAngle - e.startAngle) || tau);
        if (onSweep) d = Math.abs(distance(position, center) - radius);
        else {
          const a = e.type === 'arc' && points.get(e.startId),
            b = e.type === 'arc' && points.get(e.endId);
          if (a && b) d = Math.min(distance(position, screen(a)), distance(position, screen(b)));
        }
      } else if (isNurbsCurve(e)) {
        try {
          const path = tessellateCurve(e, points, 0.5 / zoom).map(screen);
          d = Math.min(...path.slice(1).map((p, i) => lineDistance(position, path[i]!, p)));
        } catch {
          /* Invalid draft. */
        }
      }
      if (d < Math.SQRT2 * half + 6) return true;
    }
    return false;
  };
  const placed: CadPoint[] = [];
  return pending.map(glyph => {
    const anchor = screen(glyph.anchor),
      base = { x: anchor.x + glyph.offset.x * 24, y: anchor.y + glyph.offset.y * 24 };
    let position = base,
      found = false;
    const accepts = (p: CadPoint) =>
      !hitsGeometry(p) &&
      placed.every(q => Math.abs(p.x - q.x) >= INLINE_CONSTRAINT_SIZE + gap || Math.abs(p.y - q.y) >= INLINE_CONSTRAINT_SIZE + gap);
    for (let ring = 0; ring <= Math.max(12, pending.length); ring++) {
      for (let dy = -ring; dy <= ring && !found; dy++)
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const candidate = { x: base.x + dx * (INLINE_CONSTRAINT_SIZE + gap), y: base.y + dy * (INLINE_CONSTRAINT_SIZE + gap) };
          if (accepts(candidate)) {
            position = candidate;
            found = true;
            break;
          }
        }
      if (found) break;
    }
    placed.push(position);
    const { offset: _offset, ...source } = glyph;
    void _offset;
    return { ...source, position: { x: position.x / zoom, y: -position.y / zoom } };
  });
}
