import { constraintEntityIds, entityPointIds, originId } from './document';
import { sketchTargets, validateCadFeatures } from './featureModel';
import type {
  CadArcEntity,
  CadCircleEntity,
  CadDiagnostic,
  CadDocument,
  CadLineEntity,
  CadNurbsEntity,
  CadPart,
  CadPoint,
  CadPointEntity,
  EvaluatedCadLoop,
  EvaluatedCadPart,
} from './types';
import { curveEndpointIds, isNurbsCurve, tessellateCurve } from './curves';
import { curveContacts, isNumericalJoinedEndpointContact } from './curveContacts';
import { pointEquivalence } from './pointEquivalence';

import { CAD_GEOMETRY_TOLERANCE } from './tolerances';
import { dimensionValueError } from './dimensionValues';
import { isOwnedSplineHandle, splineHandleIssue } from './splineHandles';
export { CAD_GEOMETRY_TOLERANCE } from './tolerances';
/** Absolute chord error, mm; analytic sketch geometry is retained in the source. */
export const CAD_CHORD_TOLERANCE = 0.01;

export function validateCadDocument(document: CadDocument): CadDiagnostic[] {
  const diagnostics: CadDiagnostic[] = [];
  const ids = new Set<string>();
  const addId = (id: string, partId?: string) => {
    if (!id || ids.has(id))
      diagnostics.push({ code: 'duplicate-id', message: 'Every CAD object needs a unique ID.', severity: 'error', partId });
    ids.add(id);
  };
  addId(document.id);
  if ((document.version !== 1 && document.version !== 2) || !Number.isSafeInteger(document.revision) || document.revision < 0)
    diagnostics.push({ code: 'invalid-document', message: 'Unsupported or invalid CAD document.', severity: 'error' });
  if (!document.parts.length) diagnostics.push({ code: 'no-parts', message: 'Add a part before preparing a cut.', severity: 'error' });
  if ((document.version === 2) !== document.parts.some(part => part.features?.length))
    diagnostics.push({ code: 'invalid-document', message: 'Unsupported or invalid CAD document.', severity: 'error' });
  for (const owner of document.parts) {
    addId(owner.id, owner.id);
    diagnostics.push(...validateCadFeatures(owner));
    for (const feature of owner.features ?? []) addId(feature.id, owner.id);
  }
  for (const part of document.parts.flatMap(sketchTargets)) {
    addId(part.sketch.id, part.id);
    const error = (code: string, message: string, entityIds?: string[], constraintIds?: string[]) =>
      diagnostics.push({ code, message, severity: 'error', partId: part.id, entityIds, constraintIds });
    if (!Number.isFinite(part.thickness) || part.thickness <= 0) error('invalid-thickness', 'Part thickness must be greater than zero.');
    const entities = new Map(part.sketch.entities.map(e => [e.id, e]));
    const equivalent = pointEquivalence(part.sketch.constraints);
    const origin = entities.get(originId(part.sketch));
    if (!origin || origin.type !== 'point' || !origin.fixed || origin.x !== 0 || origin.y !== 0)
      error('invalid-origin', 'The sketch origin must stay fixed at 0, 0.');
    for (const e of part.sketch.entities) {
      addId(e.id, part.id);
      const ownershipIssue = splineHandleIssue(e, entities);
      if (ownershipIssue) error('invalid-spline-handle', ownershipIssue, [e.id]);
      if (entityPointIds(e).some(id => entities.get(id)?.type !== 'point'))
        error('missing-point', 'A curve references a missing sketch point.', [e.id]);
      if (e.type === 'point') {
        if (![e.x, e.y].every(Number.isFinite)) error('invalid-coordinate', 'Sketch coordinates must be finite numbers.', [e.id]);
      } else if (e.type === 'circle' || e.type === 'arc') {
        if (!Number.isFinite(e.radius) || e.radius <= CAD_GEOMETRY_TOLERANCE)
          error('invalid-radius', 'Circle and arc radii must be greater than zero.', [e.id]);
        if (e.type === 'arc' && (![e.startAngle, e.endAngle].every(Number.isFinite) || Math.abs(e.endAngle - e.startAngle) < 1e-9))
          error('invalid-arc', 'An arc needs distinct finite start and end angles.', [e.id]);
      }
      if (e.type === 'line') {
        const a = entities.get(e.startId),
          b = entities.get(e.endId);
        if (!isOwnedSplineHandle(e) && a?.type === 'point' && b?.type === 'point' && distance(a, b) < CAD_GEOMETRY_TOLERANCE)
          error('zero-length', 'Remove or redraw this zero-length line.', [e.id]);
      }
      if (isNurbsCurve(e)) {
        if (e.type === 'conic' && (!Number.isFinite(e.rho) || e.rho <= 0 || e.rho >= 1))
          error('invalid-conic', 'Conic rho must be between zero and one.', [e.id]);
        if (
          e.type === 'bezier' &&
          (e.controlPointIds.length < 2 ||
            e.controlPointIds.length > 16 ||
            e.startId !== e.controlPointIds[0] ||
            e.endId !== e.controlPointIds.at(-1))
        )
          error('invalid-bezier', 'A Bézier curve needs 2–16 ordered controls including its endpoints.', [e.id]);
        if (e.type === 'spline') {
          const count = e.controlPointIds.length + (e.closed ? 3 : 0);
          if (
            !Number.isInteger(e.degree) ||
            e.degree < 1 ||
            e.degree > 3 ||
            (e.closed && e.degree !== 3) ||
            count <= e.degree ||
            e.controlPointIds.length > 128 ||
            new Set(e.controlPointIds).size !== e.controlPointIds.length ||
            e.weights.length !== e.controlPointIds.length ||
            e.weights.some(w => !Number.isFinite(w) || w <= 0) ||
            e.knots.length !== count + e.degree + 1 ||
            e.knots.some((k, i) => !Number.isFinite(k) || (i > 0 && k < e.knots[i - 1]!)) ||
            !(e.knots[count]! > e.knots[e.degree]!) ||
            e.fitPointIds.length < (e.closed ? 3 : 2) ||
            e.fitPointIds.length > 64 ||
            e.fitPointIds.length !== e.fitParameters.length ||
            e.fitParameters.some((t, i) => !Number.isFinite(t) || t < 0 || t > 1 || (i > 0 && t <= e.fitParameters[i - 1]!)) ||
            e.startId !== e.fitPointIds[0] ||
            e.endId !== (e.closed ? e.fitPointIds[0] : e.fitPointIds.at(-1)) ||
            (!e.closed && (e.controlPointIds[0] !== e.startId || e.controlPointIds.at(-1) !== e.endId))
          )
            error('invalid-spline', 'The spline basis, fit points, and controls must form a valid editable curve.', [e.id]);
        }
        if (
          !entityPointIds(e).some(id => entities.get(id)?.type !== 'point') &&
          !diagnostics.some(d => d.entityIds?.includes(e.id) && d.severity === 'error')
        ) {
          try {
            const points = new Map(part.sketch.entities.filter((p): p is CadPointEntity => p.type === 'point').map(p => [p.id, p]));
            const path = tessellateCurve(e, points);
            if (
              path.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) ||
              path.every(p => distance(p, path[0]!) <= CAD_GEOMETRY_TOLERANCE)
            )
              error('degenerate-curve', 'A curve needs distinct finite geometry.', [e.id]);
          } catch {
            error('invalid-curve', 'The curve cannot be evaluated safely.', [e.id]);
          }
        }
      }
    }
    for (const c of part.sketch.constraints) {
      addId(c.id, part.id);
      if (c.type === 'offset' && (!Array.isArray(c.members) || !c.members.length || c.members.some(member => !member))) {
        error('invalid-reference', 'An offset needs source and copied geometry.', undefined, [c.id]);
        continue;
      }
      const dependencies = constraintEntityIds(c);
      if (dependencies.some(id => !entities.has(id))) {
        error('missing-reference', 'A constraint references deleted geometry.', undefined, [c.id]);
        continue;
      }
      // A line-derived dimension still measures its two points; its line is a deletion dependency.
      const refs = ('pointAId' in c ? [c.pointAId, c.pointBId] : dependencies).map(id => entities.get(id));
      if ('sourceEntityId' in c && c.sourceEntityId !== undefined) {
        const source = entities.get(c.sourceEntityId);
        const attached = (pointId: string) =>
          source?.type === 'line' &&
          (source.startId === pointId ||
            source.endId === pointId ||
            part.sketch.constraints.some(
              relation => relation.type === 'pointOnLine' && relation.pointId === pointId && relation.entityId === source.id
            ));
        if (source?.type !== 'line' || c.pointAId === c.pointBId || !attached(c.pointAId) || !attached(c.pointBId))
          error('invalid-reference', 'A line dimension must reference points attached to its source line.', [c.sourceEntityId], [c.id]);
      }
      if ('expression' in c && c.expression !== undefined && (!('value' in c) || typeof c.expression !== 'string'))
        error('invalid-dimension', 'A dimension expression must be text.', undefined, [c.id]);
      if ('driven' in c && c.driven !== undefined && (!('value' in c) || typeof c.driven !== 'boolean'))
        error('invalid-dimension', 'Only numeric dimensions may have a boolean driven flag.', undefined, [c.id]);
      if ('value' in c) {
        const message = dimensionValueError(c, c.value);
        if (message) error('invalid-dimension', message, undefined, [c.id]);
      }
      if (c.type === 'symmetricPoints') {
        if (
          entities.get(c.pointAId)?.type !== 'point' ||
          entities.get(c.pointBId)?.type !== 'point' ||
          entities.get(c.lineId)?.type !== 'line'
        )
          error('invalid-reference', 'Point symmetry needs two points and a mirror line.', undefined, [c.id]);
      }
      if (c.type === 'offset') {
        const sources = new Set(c.members.map(member => member.sourceId));
        const targets = new Set<string>();
        for (const member of c.members) {
          if (
            !['line', 'circle', 'arc'].includes(member.kind) ||
            entities.get(member.sourceId)?.type !== member.kind ||
            entities.get(member.targetId)?.type !== member.kind ||
            (member.side !== 1 && member.side !== -1) ||
            (member.kind !== 'circle' && typeof member.endpoints !== 'boolean') ||
            sources.has(member.targetId) ||
            targets.has(member.targetId)
          )
            error('invalid-reference', 'An offset needs distinct matching source and copied curves with a valid side.', undefined, [c.id]);
          targets.add(member.targetId);
        }
      }
      const pointTypes = [
        'coincident',
        'horizontalPoints',
        'verticalPoints',
        'distance',
        'distanceX',
        'distanceY',
        'positionX',
        'positionY',
      ];
      const lineTypes = ['horizontal', 'vertical', 'parallel', 'perpendicular', 'angle', 'lineLineDistance'];
      if (pointTypes.includes(c.type) && refs.some(e => e?.type !== 'point'))
        error('invalid-reference', 'This constraint requires sketch points.', undefined, [c.id]);
      if (lineTypes.includes(c.type) && refs.some(e => e?.type !== 'line'))
        error('invalid-reference', 'This constraint requires lines.', undefined, [c.id]);
      if (
        c.type === 'pointOnLine' ||
        c.type === 'pointOnCircle' ||
        c.type === 'pointOnCurve' ||
        c.type === 'midpoint' ||
        c.type === 'pointLineDistance' ||
        c.type === 'pointArcDistance'
      ) {
        if (entities.get(c.pointId)?.type !== 'point')
          error('invalid-reference', 'This constraint requires a sketch point.', undefined, [c.id]);
        const curve = entities.get(c.entityId);
        if ((c.type === 'pointOnLine' || c.type === 'midpoint' || c.type === 'pointLineDistance') && curve?.type !== 'line')
          error('invalid-reference', 'This point constraint requires a line.', undefined, [c.id]);
        if ((c.type === 'pointOnCircle' || c.type === 'pointArcDistance') && curve?.type !== 'circle' && curve?.type !== 'arc')
          error('invalid-reference', 'This point constraint requires a circle or arc.', undefined, [c.id]);
        if (
          c.type === 'pointOnCurve' &&
          (!curve || !isNurbsCurve(curve) || !Number.isFinite(c.parameter) || c.parameter < 0 || c.parameter > 1)
        )
          error(
            'invalid-reference',
            'This point constraint requires a spline, Bézier, or conic and a parameter between zero and one.',
            undefined,
            [c.id]
          );
      }
      if ((c.type === 'radius' || c.type === 'diameter') && refs[0]?.type !== 'circle' && refs[0]?.type !== 'arc')
        error('invalid-reference', 'This dimension requires a circle or arc.', undefined, [c.id]);
      if ((c.type === 'pointArcDistance' || c.type === 'lineCircleDistance') && c.side !== 'inside' && c.side !== 'outside')
        error('invalid-dimension', 'A circular distance needs its inside or outside branch.', undefined, [c.id]);
      if (c.type === 'lineCircleDistance' && (refs[0]?.type !== 'line' || (refs[1]?.type !== 'circle' && refs[1]?.type !== 'arc')))
        error('invalid-reference', 'This dimension requires a line and a circular curve.', undefined, [c.id]);
      if (
        (c.type === 'pointArcDistance' || c.type === 'lineCircleDistance') &&
        ((c.radiusSide !== undefined && c.radiusSide !== 'near' && c.radiusSide !== 'far') ||
          (c.radiusSide === 'far' && c.side === 'inside'))
      )
        error('invalid-dimension', 'A circular distance needs a valid witness side.', undefined, [c.id]);
      if (
        c.type === 'circleCircleDistance' &&
        (refs.some(e => e?.type !== 'circle' && e?.type !== 'arc') ||
          ![c.radiusASign, c.radiusBSign, c.direction].every(value => value === 1 || value === -1))
      )
        error('invalid-reference', 'A circular pair dimension needs two circular curves and valid witness directions.', undefined, [c.id]);
      if (
        c.type === 'angle' &&
        ((c.orientation !== undefined && c.orientation !== 1 && c.orientation !== -1) ||
          [c.reversedA, c.reversedB].some(value => value !== undefined && typeof value !== 'boolean'))
      )
        error('invalid-dimension', 'An angular dimension needs valid ray directions.', undefined, [c.id]);
      if (c.type === 'equal' && !(refs.every(e => e?.type === 'line') || refs.every(e => e?.type === 'circle' || e?.type === 'arc')))
        error('invalid-reference', 'Equal needs two lines or two circular curves.', undefined, [c.id]);
      if (c.type === 'tangent' && (refs.some(e => e?.type === 'point') || refs.every(e => e?.type === 'line')))
        error('invalid-reference', 'Tangent needs two curves, including at least one curved entity.', undefined, [c.id]);
      if (c.type === 'tangent' && refs.some(e => e && isNurbsCurve(e))) {
        const [a, b] = refs;
        if (!a || !b || !equivalent.match(curveEndpointIds(a), curveEndpointIds(b)))
          error('invalid-reference', 'Spline, Bézier, and conic tangency requires a shared endpoint.', undefined, [c.id]);
      }
    }
  }
  return diagnostics;
}

const distance = (a: CadPoint, b: CadPoint) => Math.hypot(b.x - a.x, b.y - a.y);
const cross = (a: CadPoint, b: CadPoint, c: CadPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function polygonArea(points: CadPoint[]): number {
  return (
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length]!;
      return sum + p.x * q.y - q.x * p.y;
    }, 0) / 2
  );
}

function segmentsMeet(a: CadPoint, b: CadPoint, c: CadPoint, d: CadPoint): boolean {
  const eps = CAD_GEOMETRY_TOLERANCE;
  if (
    Math.max(a.x, b.x) + eps < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) + eps < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) + eps < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) + eps < Math.min(a.y, b.y)
  )
    return false;
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const cd = Math.hypot(d.x - c.x, d.y - c.y);
  const e = eps * Math.max(1, ab, cd);
  const o1 = cross(a, b, c),
    o2 = cross(a, b, d),
    o3 = cross(c, d, a),
    o4 = cross(c, d, b);
  return !((o1 > e && o2 > e) || (o1 < -e && o2 < -e) || (o3 > e && o4 > e) || (o3 < -e && o4 < -e));
}

function selfIntersects(points: CadPoint[]): boolean {
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      if (segmentsMeet(points[i]!, points[(i + 1) % points.length]!, points[j]!, points[(j + 1) % points.length]!)) return true;
    }
  return false;
}

export function pointInPolygon(point: CadPoint, polygon: CadPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!,
      b = polygon[j]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function loopsMeet(a: CadPoint[], b: CadPoint[]): boolean {
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      if (segmentsMeet(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  return false;
}

const twoPi = Math.PI * 2;
function arcSweep(start: number, end: number): number {
  const sweep = (((end - start) % twoPi) + twoPi) % twoPi;
  return sweep < 1e-10 ? twoPi : sweep;
}
function circularSegments(radius: number, sweep: number): number {
  const step = 2 * Math.acos(Math.max(-1, 1 - CAD_CHORD_TOLERANCE / radius));
  return Math.max(4, Math.min(4096, Math.ceil(sweep / step)));
}

type Curve = CadLineEntity | CadCircleEntity | CadArcEntity | CadNurbsEntity;
function curveEndpoints(curve: Curve, points: Map<string, CadPointEntity>): CadPoint[] {
  return curveEndpointIds(curve).map(id => points.get(id)!);
}
export function tessellateArc(arc: CadArcEntity, center: CadPoint): CadPoint[] {
  const sweep = arcSweep(arc.startAngle, arc.endAngle);
  const count = circularSegments(arc.radius, sweep);
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = arc.startAngle + (sweep * i) / count;
    return { x: center.x + arc.radius * Math.cos(angle), y: center.y + arc.radius * Math.sin(angle) };
  });
}

/** Solve-independent profile evaluation. Invalid contours are never partially handed to CAM. */
export function evaluateCadPart(part: CadPart): { part?: EvaluatedCadPart; diagnostics: CadDiagnostic[] } {
  const diagnostics: CadDiagnostic[] = [];
  const error = (code: string, message: string, entityIds?: string[]) =>
    diagnostics.push({ code, message, severity: 'error', partId: part.id, entityIds });
  const points = new Map(part.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p]));
  const equivalent = pointEquivalence(part.sketch.constraints);
  const curves = part.sketch.entities.filter(e => e.type !== 'point' && !e.construction);
  const loops: EvaluatedCadLoop[] = [];
  const loopId = (ids: string[]) => `${part.id}:profile:${[...ids].sort().join(':')}`;
  const point = (id: string) => points.get(id);
  type Edge = { id: string; a: number; b: number; points: CadPoint[] };
  const nodes: CadPoint[] = [];
  const node = (p: CadPoint) => {
    const index = nodes.findIndex(n => distance(n, p) < CAD_GEOMETRY_TOLERANCE);
    if (index >= 0) return index;
    nodes.push(p);
    return nodes.length - 1;
  };
  const edges: Edge[] = [];
  for (const e of curves) {
    if (e.type === 'circle') {
      const center = point(e.centerId);
      if (!center) {
        error('missing-point', 'A circle is missing its center.', [e.id]);
        continue;
      }
      const count = 4 * Math.ceil(Math.max(24, circularSegments(e.radius, twoPi)) / 4);
      const polygon = Array.from({ length: count }, (_, i) => ({
        x: center.x + e.radius * Math.cos((i * twoPi) / count),
        y: center.y + e.radius * Math.sin((i * twoPi) / count),
      }));
      loops.push({ id: loopId([e.id]), entityIds: [e.id], points: polygon, kind: 'hole' });
    } else if (isNurbsCurve(e)) {
      try {
        const path = tessellateCurve(e, points, CAD_CHORD_TOLERANCE);
        if (e.type === 'spline' && e.closed) {
          if (distance(path[0]!, path.at(-1)!) > CAD_GEOMETRY_TOLERANCE) {
            error('invalid-curve', 'A closed spline must meet its start.', [e.id]);
            continue;
          }
          loops.push({ id: loopId([e.id]), entityIds: [e.id], points: path.slice(0, -1), kind: 'hole' });
        } else {
          const a = point(e.startId),
            b = point(e.endId);
          if (!a || !b || distance(path[0]!, a) > CAD_GEOMETRY_TOLERANCE || distance(path.at(-1)!, b) > CAD_GEOMETRY_TOLERANCE) {
            error('invalid-curve-endpoints', 'Solve the curve so its endpoints match the source points.', [e.id]);
            continue;
          }
          path[0] = a;
          path[path.length - 1] = b;
          edges.push({ id: e.id, a: node(a), b: node(b), points: path });
        }
      } catch {
        error('invalid-curve', 'This curve cannot be exported at the required accuracy.', [e.id]);
      }
    } else if (e.type === 'line' || e.type === 'arc') {
      const a = point(e.startId),
        b = point(e.endId);
      if (!a || !b) {
        error('missing-point', 'A curve is missing an endpoint.', [e.id]);
        continue;
      }
      if (distance(a, b) < CAD_GEOMETRY_TOLERANCE) {
        error('zero-length', 'A cut curve has coincident endpoints.', [e.id]);
        continue;
      }
      if (e.type === 'arc') {
        const center = point(e.centerId);
        if (!center) {
          error('missing-point', 'An arc is missing its center.', [e.id]);
          continue;
        }
        const path = tessellateArc(e, center);
        if (distance(path[0]!, a) > CAD_GEOMETRY_TOLERANCE || distance(path[path.length - 1]!, b) > CAD_GEOMETRY_TOLERANCE) {
          error('invalid-arc-endpoints', 'Solve the arc so its endpoints lie on the circular curve.', [e.id]);
          continue;
        }
        // Use the common solved endpoints exactly so tessellation cannot open a loop.
        path[0] = a;
        path[path.length - 1] = b;
        edges.push({ id: e.id, a: node(a), b: node(b), points: path });
      } else edges.push({ id: e.id, a: node(a), b: node(b), points: [a, b] });
    }
  }
  const adjacency = new Map<number, Edge[]>();
  for (const e of edges) for (const n of [e.a, e.b]) adjacency.set(n, [...(adjacency.get(n) ?? []), e]);
  for (const es of adjacency.values())
    if (es.length !== 2)
      error(
        es.length < 2 ? 'open-profile' : 'ambiguous-profile',
        es.length < 2 ? 'Close every cut contour before preparing CAM.' : 'Cut contours cannot branch or touch at a vertex.',
        es.map(e => e.id)
      );
  const analyticCurves = curves.filter((e): e is Curve => e.type !== 'point');
  if (!diagnostics.length)
    for (let i = 0; i < analyticCurves.length; i++)
      for (let j = i + 1; j < analyticCurves.length; j++) {
        const a = analyticCurves[i]!,
          b = analyticCurves[j]!;
        // Polygon topology below classifies line-only self-intersections.
        if (a.type === 'line' && b.type === 'line') continue;
        const aEnds = curveEndpoints(a, points),
          bEnds = curveEndpoints(b, points);
        let contacts: CadPoint[];
        let overlap = false;
        try {
          const result = curveContacts(a, b, points, CAD_GEOMETRY_TOLERANCE);
          contacts = result.points;
          overlap = result.overlap;
        } catch {
          error('curve-complexity', 'These curves need simpler geometry before safe cutting.', [a.id, b.id]);
          continue;
        }
        const illegal = contacts.some(
          p =>
            !(
              aEnds.some(end => distance(end, p) < CAD_GEOMETRY_TOLERANCE) && bEnds.some(end => distance(end, p) < CAD_GEOMETRY_TOLERANCE)
            ) && !isNumericalJoinedEndpointContact(a, b, p, points, equivalent, CAD_GEOMETRY_TOLERANCE)
        );
        if (illegal || overlap)
          error('intersecting-profiles', 'Cut curves cannot cross or touch except at their joined endpoints.', [a.id, b.id]);
      }
  if (diagnostics.length) return { diagnostics };
  const unused = new Set(edges.map(e => e.id));
  for (const seed of edges) {
    if (!unused.has(seed.id)) continue;
    const polygon: CadPoint[] = [];
    const ids: string[] = [];
    let edge = seed,
      currentNode = seed.a;
    while (unused.has(edge.id)) {
      unused.delete(edge.id);
      ids.push(edge.id);
      const forward = edge.a === currentNode;
      const path = forward ? edge.points : [...edge.points].reverse();
      polygon.push(...path.slice(0, -1));
      currentNode = forward ? edge.b : edge.a;
      if (currentNode === seed.a) break;
      const next = adjacency.get(currentNode)?.find(candidate => unused.has(candidate.id));
      if (!next) {
        error('open-profile', 'This contour is not closed.', ids);
        break;
      }
      edge = next;
    }
    loops.push({ id: loopId(ids), entityIds: ids, points: polygon, kind: 'hole' });
  }
  if (!loops.length) error('empty-sketch', 'Draw a closed profile to create this flat part.');
  for (const loop of loops) {
    if (loop.points.length < 3 || Math.abs(polygonArea(loop.points)) < CAD_GEOMETRY_TOLERANCE)
      error('degenerate-profile', 'A cut contour needs a nonzero enclosed area.', loop.entityIds);
    if (selfIntersects(loop.points)) error('self-intersection', 'A cut contour crosses or touches itself.', loop.entityIds);
  }
  for (let i = 0; i < loops.length; i++)
    for (let j = i + 1; j < loops.length; j++) {
      if (loopsMeet(loops[i]!.points, loops[j]!.points))
        error('intersecting-profiles', 'Cut contours cannot cross or touch.', [...loops[i]!.entityIds, ...loops[j]!.entityIds]);
    }
  const sorted = [...loops].sort((a, b) => Math.abs(polygonArea(b.points)) - Math.abs(polygonArea(a.points)));
  const outer = sorted[0];
  if (outer) {
    outer.kind = 'outer';
    for (const hole of sorted.slice(1)) {
      if (!pointInPolygon(hole.points[0]!, outer.points))
        error('disconnected-profile', 'Use a separate part for each disconnected outline.', hole.entityIds);
      for (const other of sorted.slice(1))
        if (other !== hole && pointInPolygon(hole.points[0]!, other.points))
          error('nested-island', 'Nested solid islands need a separate part.', hole.entityIds);
    }
  }
  if (diagnostics.length || !outer) return { diagnostics };
  for (const loop of sorted) {
    const shouldBePositive = loop.kind === 'outer';
    if (polygonArea(loop.points) > 0 !== shouldBePositive) loop.points.reverse();
  }
  return {
    part: {
      partId: part.id,
      name: part.name,
      thickness: part.thickness,
      outline: outer.points,
      holes: sorted.slice(1).map(loop => loop.points),
      loops: sorted,
    },
    diagnostics,
  };
}
