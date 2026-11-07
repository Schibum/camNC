import { Algorithm, GcsWrapper, init_planegcs_module, SolveStatus, type ModuleStatic, type SketchPrimitive } from '@salusoft89/planegcs';
import { sketchTargets } from './featureModel';
import { evaluateCadDocument } from './features';
import { validateCadDocument, CAD_GEOMETRY_TOLERANCE } from './geometry';
import type {
  CadArcEntity,
  CadConstraint,
  CadDocument,
  CadEntity,
  CadLineEntity,
  CadNurbsEntity,
  CadPart,
  CadPointEntity,
  CadSolveResult,
} from './types';
import { curveEndpointIds, evaluateCurvePoint, evaluateCurveTangent, isNurbsCurve, rationalCurveData, splineNativePoleIds } from './curves';
import bundledWasmUrl from './wasmAsset';
import { fixedConstraintConflicts } from './fixedConstraints';
import { pointEquivalence, type CadPointEquivalence } from './pointEquivalence';
import { classifyNativeEntities } from './entityFreedom';
import { refreshDimensionMeasurement } from './dimensions';
import { migrateDimensionPlacements } from './dimensionPlacement';
import { isFatalSolverError } from './solverFailure';
import { invalidOffsetBranches, offsetNativePrimitives, offsetNativeSeed } from './offsetConstraint';
import { withSplineHandleSegments } from './splineHandles';

let modulePromise: Promise<ModuleStatic> | undefined;
const poisonedModules = new WeakSet<ModuleStatic>();
function destroyWrapper(wrapper: GcsWrapper): void {
  // After a native trap/abort, release the whole module instead of calling back into its heap.
  if (wrapper.module && poisonedModules.has(wrapper.module)) return;
  // The upstream wrapper keeps BSpline geometries alive for constraint reuse; release
  // our cache explicitly after their copied native constraints have been cleared.
  wrapper.gcs.clear_data();
  for (const curve of wrapper.bspline_gcs_cache.values()) curve.delete();
  wrapper.bspline_gcs_cache.clear();
  wrapper.destroy_gcs_module();
}

/** PlaneGCS normalizes symmetry's perpendicular equation by the initial point separation.
 * An on-axis mirror has zero separation. Condition registration only, then restore
 * the exact source/copy guess before solving; no coordinates or fixed flags persist. */
function pushConditionedPrimitive(wrapper: GcsWrapper, primitive: SketchPrimitive): void {
  if (primitive.type !== 'p2p_symmetric_ppl') {
    wrapper.push_primitive(primitive);
    return;
  }
  const ai = wrapper.p_param_index.get(primitive.p1_id),
    bi = wrapper.p_param_index.get(primitive.p2_id);
  const axis = wrapper.sketch_index.get_primitive(primitive.l_id);
  if (ai === undefined || bi === undefined || axis?.type !== 'line') throw new Error('Missing native symmetry geometry.');
  if (ai === bi) {
    wrapper.push_primitive({ id: primitive.id, type: 'point_on_line_pl', p_id: primitive.p1_id, l_id: primitive.l_id });
    return;
  }
  const ax = wrapper.gcs.get_p_param(ai),
    ay = wrapper.gcs.get_p_param(ai + 1);
  const bx = wrapper.gcs.get_p_param(bi),
    by = wrapper.gcs.get_p_param(bi + 1);
  if (Math.hypot(bx - ax, by - ay) > CAD_GEOMETRY_TOLERANCE) {
    wrapper.push_primitive(primitive);
    return;
  }
  const start = wrapper.p_param_index.get(axis.p1_id)!,
    end = wrapper.p_param_index.get(axis.p2_id)!;
  const dx = wrapper.gcs.get_p_param(end) - wrapper.gcs.get_p_param(start);
  const dy = wrapper.gcs.get_p_param(end + 1) - wrapper.gcs.get_p_param(start + 1),
    length = Math.hypot(dx, dy);
  if (!length) throw new Error('A symmetry axis needs distinct endpoints.');
  const fixedX = wrapper.gcs.get_is_fixed(bi),
    fixedY = wrapper.gcs.get_is_fixed(bi + 1);
  try {
    wrapper.gcs.set_p_param(bi, ax - dy / length, fixedX);
    wrapper.gcs.set_p_param(bi + 1, ay + dx / length, fixedY);
    wrapper.push_primitive(primitive);
  } finally {
    wrapper.gcs.set_p_param(bi, bx, fixedX);
    wrapper.gcs.set_p_param(bi + 1, by, fixedY);
  }
}

/** Optional explicit asset URL for hosts without Vite. WASM is bundled and runs locally. */
export async function initializeCadSolver(wasmUrl?: string): Promise<void> {
  if (!modulePromise) {
    const opening = (async () => {
      const isNode = typeof process !== 'undefined' && !!process.versions?.node;
      const url = wasmUrl ?? (isNode ? undefined : bundledWasmUrl);
      const module = await init_planegcs_module(url ? { locateFile: () => url } : undefined);
      // The pinned Emscripten runtime reads this mutable hook when it aborts, although
      // its package declaration exposes only the CAD constructors.
      (module as ModuleStatic & { onAbort?: (reason: unknown) => void }).onAbort = () => {
        poisonedModules.add(module);
        if (modulePromise === opening) modulePromise = undefined;
      };
      return module;
    })();
    modulePromise = opening;
    opening.catch(() => {
      if (modulePromise === opening) modulePromise = undefined;
    });
  }
  await modulePromise;
}

export interface CadSolveOptions {
  wasmUrl?: string;
  /** Low-priority edit intent: existing dimensions win over pointer movement. */
  drag?: CadDragTarget | CadDragTarget[];
  /** Low-priority circumference edit: a driving radius/diameter dimension still takes precedence. */
  radiusDrag?: { entityId: string; radius: number };
  /** Optional native rank analysis; hosts may defer this during pointer movement. */
  classifyEntities?: boolean;
  /** Optional analysis shares this measured budget with the primary native solve. Geometry solving is never truncated. */
  entityAnalysisBudgetMs?: number;
}
export interface CadDragTarget {
  pointId: string;
  x: number;
  y: number;
}

function nativeCurveData(e: CadNurbsEntity, points: Map<string, CadPointEntity>) {
  const data = rationalCurveData(e, points),
    lo = data.knots[data.degree]!,
    hi = data.knots[data.poles.length]!;
  const poleIds = e.type === 'conic' ? [e.startId, e.controlId, e.endId] : e.type === 'spline' ? splineNativePoleIds(e) : e.controlPointIds;
  const periodic = e.type === 'spline' && !!e.closed;
  const full = periodic ? data.knots.filter(k => k >= lo && k <= hi) : data.knots,
    knots = [...new Set(full)];
  const weights = e.type === 'spline' && e.closed ? poleIds.map(id => e.weights[e.controlPointIds.indexOf(id)]!) : data.weights;
  return { poleIds, weights, knots, mult: knots.map(k => full.filter(value => value === k).length), degree: data.degree, periodic };
}
function solverGeometry(e: CadEntity, points: Map<string, CadPointEntity>): SketchPrimitive {
  switch (e.type) {
    case 'point':
      return { id: e.id, type: 'point', x: e.x, y: e.y, fixed: e.fixed ?? false };
    case 'line':
      return { id: e.id, type: 'line', p1_id: e.startId, p2_id: e.endId };
    case 'circle':
      return { id: e.id, type: 'circle', c_id: e.centerId, radius: e.radius };
    case 'arc':
      return {
        id: e.id,
        type: 'arc',
        c_id: e.centerId,
        start_id: e.startId,
        end_id: e.endId,
        radius: e.radius,
        start_angle: e.startAngle,
        end_angle: e.endAngle,
      };
    case 'conic':
    case 'bezier':
    case 'spline': {
      const { poleIds, ...data } = nativeCurveData(e, points);
      return { id: e.id, type: 'bspline', pole_ids: poleIds, ...data };
    }
  }
}

function solverConstraint(
  c: CadConstraint,
  entities: Map<string, CadEntity>,
  coincident: CadPointEquivalence,
  constraints: readonly CadConstraint[],
  offsetSeed: ReadonlyMap<string, CadEntity>
): SketchPrimitive | SketchPrimitive[] {
  const id = c.id;
  switch (c.type) {
    case 'offset':
      return offsetNativePrimitives(c, offsetSeed, constraints);
    case 'symmetricPoints':
      return { id, type: 'p2p_symmetric_ppl', p1_id: c.pointAId, p2_id: c.pointBId, l_id: c.lineId };
    case 'horizontal':
      return { id, type: 'horizontal_l', l_id: c.entityId };
    case 'vertical':
      return { id, type: 'vertical_l', l_id: c.entityId };
    case 'horizontalPoints':
      return { id, type: 'horizontal_pp', p1_id: c.pointAId, p2_id: c.pointBId };
    case 'verticalPoints':
      return { id, type: 'vertical_pp', p1_id: c.pointAId, p2_id: c.pointBId };
    case 'coincident':
      return { id, type: 'p2p_coincident', p1_id: c.pointAId, p2_id: c.pointBId };
    case 'pointOnLine':
      return { id, type: 'point_on_line_pl', p_id: c.pointId, l_id: c.entityId };
    case 'pointOnCircle':
      return entities.get(c.entityId)?.type === 'arc'
        ? { id, type: 'point_on_arc', p_id: c.pointId, a_id: c.entityId }
        : { id, type: 'point_on_circle', p_id: c.pointId, c_id: c.entityId };
    case 'pointOnCurve': {
      const curve = entities.get(c.entityId) as CadNurbsEntity;
      const points = new Map([...entities].filter((entry): entry is [string, CadPointEntity] => entry[1].type === 'point'));
      const data = rationalCurveData(curve, points),
        lo = data.knots[data.degree]!,
        hi = data.knots[data.poles.length]!;
      return {
        id,
        type: 'point_on_bspline',
        p_id: c.pointId,
        b_id: c.entityId,
        pointparam: c.parameterFixed ? lo + c.parameter * (hi - lo) : `${c.id}:parameter`,
      };
    }
    case 'midpoint': {
      const line = entities.get(c.entityId)!;
      if (line.type !== 'line') throw new Error('Midpoint requires a line.');
      return { id, type: 'p2p_symmetric_ppp', p1_id: line.startId, p2_id: line.endId, p_id: c.pointId };
    }
    case 'pointArcDistance':
    case 'lineCircleDistance': {
      const circular = entities.get(c.type === 'pointArcDistance' ? c.entityId : c.entityBId) as
        | import('./types').CadCircleEntity
        | CadArcEntity;
      const distance = `${id}:center-distance`;
      return [
        c.type === 'pointArcDistance'
          ? { id, type: 'p2p_distance', p1_id: circular.centerId, p2_id: c.pointId, distance }
          : { id, type: 'p2l_distance', p_id: circular.centerId, l_id: c.entityAId, distance },
        c.radiusSide === 'far'
          ? {
              id: `${id}:radius-gap`,
              type: 'difference',
              param1: distance,
              param2: c.value,
              difference: { o_id: circular.id, prop: 'radius' },
            }
          : {
              id: `${id}:radius-gap`,
              type: 'difference',
              param1: { o_id: circular.id, prop: 'radius' },
              param2: distance,
              difference: c.side === 'outside' ? c.value : -c.value,
            },
      ];
    }
    case 'circleCircleDistance': {
      const a = entities.get(c.entityAId) as import('./types').CadCircleEntity | CadArcEntity;
      const b = entities.get(c.entityBId) as import('./types').CadCircleEntity | CadArcEntity;
      const distance = `${id}:center-distance`,
        intermediate = `${id}:radius-distance`;
      const ra = { o_id: a.id, prop: 'radius' as const },
        rb = { o_id: b.id, prop: 'radius' as const };
      return [
        { id, type: 'p2p_distance', p1_id: a.centerId, p2_id: b.centerId, distance },
        c.radiusASign === 1
          ? { id: `${id}:radius-a`, type: 'difference', param1: distance, param2: intermediate, difference: ra }
          : { id: `${id}:radius-a`, type: 'difference', param1: ra, param2: distance, difference: intermediate },
        c.radiusBSign === 1
          ? { id: `${id}:radius-b`, type: 'difference', param1: intermediate, param2: c.direction * c.value, difference: rb }
          : { id: `${id}:radius-b`, type: 'difference', param1: rb, param2: intermediate, difference: c.direction * c.value },
      ];
    }
    case 'pointLineDistance':
      return c.value === 0
        ? { id, type: 'point_on_line_pl', p_id: c.pointId, l_id: c.entityId }
        : { id, type: 'p2l_distance', p_id: c.pointId, l_id: c.entityId, distance: c.value };
    case 'lineLineDistance': {
      const second = entities.get(c.entityBId) as CadLineEntity;
      return [
        { id: `${id}:parallel`, type: 'parallel', l1_id: c.entityAId, l2_id: c.entityBId },
        c.value === 0
          ? { id, type: 'point_on_line_pl', p_id: second.startId, l_id: c.entityAId }
          : { id, type: 'p2l_distance', p_id: second.startId, l_id: c.entityAId, distance: c.value },
      ];
    }
    case 'distance':
      return { id, type: 'p2p_distance', p1_id: c.pointAId, p2_id: c.pointBId, distance: c.value };
    // PlaneGCS Difference is param2 - param1 = difference, verified against the published WASM.
    case 'distanceX':
    case 'distanceY':
      return {
        id,
        type: 'difference',
        param1: { o_id: c.pointAId, prop: c.type === 'distanceX' ? 'x' : 'y' },
        param2: { o_id: c.pointBId, prop: c.type === 'distanceX' ? 'x' : 'y' },
        difference: c.value,
      };
    case 'positionX':
      return { id, type: 'coordinate_x', p_id: c.pointId, x: c.value };
    case 'positionY':
      return { id, type: 'coordinate_y', p_id: c.pointId, y: c.value };
    case 'radius':
      return entities.get(c.entityId)?.type === 'arc'
        ? { id, type: 'arc_radius', a_id: c.entityId, radius: c.value }
        : { id, type: 'circle_radius', c_id: c.entityId, radius: c.value };
    case 'diameter':
      return entities.get(c.entityId)?.type === 'arc'
        ? { id, type: 'arc_diameter', a_id: c.entityId, diameter: c.value }
        : { id, type: 'circle_diameter', c_id: c.entityId, diameter: c.value };
    case 'parallel':
      return { id, type: 'parallel', l1_id: c.entityAId, l2_id: c.entityBId };
    case 'perpendicular':
      return { id, type: 'perpendicular_ll', l1_id: c.entityAId, l2_id: c.entityBId };
    case 'angle':
      return {
        id,
        type: 'l2l_angle_ll',
        l1_id: c.entityAId,
        l2_id: c.entityBId,
        angle:
          ((c.orientation === undefined ? c.value : c.orientation * c.value + (c.reversedA ? 180 : 0) - (c.reversedB ? 180 : 0)) *
            Math.PI) /
          180,
      };
    case 'equal': {
      const a = entities.get(c.entityAId)!,
        b = entities.get(c.entityBId)!;
      if (a.type === 'line' && b.type === 'line') return { id, type: 'equal_length', l1_id: a.id, l2_id: b.id };
      if (a.type === 'circle' && b.type === 'circle') return { id, type: 'equal_radius_cc', c1_id: a.id, c2_id: b.id };
      if (a.type === 'arc' && b.type === 'arc') return { id, type: 'equal_radius_aa', a1_id: a.id, a2_id: b.id };
      return { id, type: 'equal_radius_ca', c1_id: a.type === 'circle' ? a.id : b.id, a2_id: a.type === 'arc' ? a.id : b.id };
    }
    case 'tangent': {
      let a = entities.get(c.entityAId)!,
        b = entities.get(c.entityBId)!;
      if (isNurbsCurve(a) || isNurbsCurve(b)) {
        if (!isNurbsCurve(a)) [a, b] = [b, a];
        const shared = coincident.match(curveEndpointIds(a), curveEndpointIds(b))!;
        const points = new Map([...entities].filter((entry): entry is [string, CadPointEntity] => entry[1].type === 'point'));
        const parameter = (curve: CadEntity) => (coincident.equivalent(curveEndpointIds(curve)[0]!, shared[0]) ? 0 : 1);
        const ta = evaluateCurveTangent(a as Exclude<CadEntity, { type: 'point' }>, points, parameter(a));
        const tb = evaluateCurveTangent(b as Exclude<CadEntity, { type: 'point' }>, points, parameter(b));
        const angle = ta.x * tb.x + ta.y * tb.y >= 0 ? 0 : Math.PI;
        // At clamped endpoints the native BSpline normal uses its adjacent poles directly.
        return { id, type: 'angle_via_point', crv1_id: a.id, crv2_id: b.id, p_id: coincident.canonical(shared[0]), angle };
      }
      if ((a.type === 'line' || a.type === 'arc') && (b.type === 'line' || b.type === 'arc')) {
        const curveA = a,
          curveB = b;
        const group = coincident.canonical;
        const sharedId = [curveA.startId, curveA.endId].find(pointId =>
          [curveB.startId, curveB.endId].some(otherId => group(pointId) === group(otherId))
        );
        if (sharedId) {
          const point = entities.get(sharedId) as CadPointEntity;
          const normal = (curve: CadLineEntity | CadArcEntity): [number, number] => {
            if (curve.type === 'line') {
              const start = entities.get(curve.startId) as CadPointEntity;
              const end = entities.get(curve.endId) as CadPointEntity;
              return [start.y - end.y, end.x - start.x];
            }
            const center = entities.get(curve.centerId) as CadPointEntity;
            return [center.x - point.x, center.y - point.y];
          };
          const [ax, ay] = normal(curveA),
            [bx, by] = normal(curveB);
          // The distance-to-circle tangent equation loses first-order rank at a shared endpoint.
          // A native angle between curve normals retains the joined tangent's independent equation.
          return {
            id,
            type: 'angle_via_point',
            crv1_id: curveA.id,
            crv2_id: curveB.id,
            p_id: sharedId,
            angle: ax * bx + ay * by >= 0 ? 0 : Math.PI,
          };
        }
      }
      if (b.type === 'line' || (a.type === 'arc' && b.type === 'circle')) [a, b] = [b, a];
      if (a.type === 'line' && b.type === 'circle') return { id, type: 'tangent_lc', l_id: a.id, c_id: b.id };
      if (a.type === 'line' && b.type === 'arc') return { id, type: 'tangent_la', l_id: a.id, a_id: b.id };
      if (a.type === 'circle' && b.type === 'circle') return { id, type: 'tangent_cc', c1_id: a.id, c2_id: b.id };
      if (a.type === 'arc' && b.type === 'arc') return { id, type: 'tangent_aa', a1_id: a.id, a2_id: b.id };
      return { id, type: 'tangent_ca', c_id: a.id, a_id: b.id };
    }
  }
}

function applySolvedGeometry(part: CadPart, wrapper: GcsWrapper): void {
  wrapper.apply_solution();
  for (const entity of part.sketch.entities) {
    const solved = wrapper.sketch_index.get_primitive(entity.id);
    if (entity.type === 'point' && solved?.type === 'point') {
      entity.x = solved.x;
      entity.y = solved.y;
    } else if ((entity.type === 'circle' || entity.type === 'arc') && (solved?.type === 'circle' || solved?.type === 'arc')) {
      entity.radius = solved.radius;
      if (entity.type === 'arc' && solved.type === 'arc') {
        entity.startAngle = solved.start_angle;
        entity.endAngle = solved.end_angle;
      }
    }
  }
  const points = new Map(part.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
  for (const constraint of part.sketch.constraints)
    if (constraint.type === 'pointOnCurve' && !constraint.parameterFixed) {
      const curve = part.sketch.entities.find(e => e.id === constraint.entityId) as CadNurbsEntity;
      const data = rationalCurveData(curve, points),
        lo = data.knots[data.degree]!,
        hi = data.knots[data.poles.length]!;
      const solved = wrapper.get_sketch_param_value(`${constraint.id}:parameter`);
      if (solved === undefined) throw new Error('The curve contact parameter was not solved.');
      constraint.parameter = (solved - lo) / (hi - lo);
    }
}

/** Never publish native success unless its evaluated curve equations match retained source. */
function solvedCurveEquationsHold(part: CadPart): boolean {
  const entities = new Map(part.sketch.entities.map(e => [e.id, e]));
  const points = new Map(part.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
  const matches = (curve: CadNurbsEntity, id: string, t: number) => {
    const actual = points.get(id)!,
      expected = evaluateCurvePoint(curve, points, t);
    return Math.hypot(actual.x - expected.x, actual.y - expected.y) <= CAD_GEOMETRY_TOLERANCE;
  };
  for (const curve of part.sketch.entities)
    if (curve.type === 'spline' && !curve.fitPointIds.every((id, i) => matches(curve, id, curve.fitParameters[i]!))) return false;
  for (const c of part.sketch.constraints)
    if (c.type === 'pointOnCurve' && !matches(entities.get(c.entityId) as CadNurbsEntity, c.pointId, c.parameter)) return false;
  return true;
}

/** Solve a detached revision. Callers retain their accepted model while an invalid draft is edited. */
export async function solveCadDocument(document: CadDocument, options: CadSolveOptions = {}): Promise<CadSolveResult> {
  const next = migrateDimensionPlacements(document);
  for (const part of next.parts) {
    part.sketch = withSplineHandleSegments(part.sketch);
    for (const feature of part.features ?? []) if (feature.type === 'sketch') feature.sketch = withSplineHandleSegments(feature.sketch);
  }
  const diagnostics = validateCadDocument(next);
  const sketches: CadSolveResult['sketches'] = [];
  if (diagnostics.some(d => d.severity === 'error')) return { document: next, status: 'invalid', diagnostics, parts: [], sketches };
  const targets = options.drag ? (Array.isArray(options.drag) ? options.drag : [options.drag]) : [];
  const dragTargets = [...new Map(targets.map(target => [target.pointId, target])).values()];
  if (dragTargets.some(target => ![target.x, target.y].every(Number.isFinite)))
    return {
      document: next,
      status: 'invalid',
      diagnostics: [{ code: 'invalid-drag', message: 'Drag coordinates must be finite.', severity: 'error' }],
      parts: [],
      sketches,
    };
  if (options.radiusDrag && (!Number.isFinite(options.radiusDrag.radius) || options.radiusDrag.radius <= CAD_GEOMETRY_TOLERANCE)) {
    return {
      document: next,
      status: 'invalid',
      diagnostics: [{ code: 'invalid-drag', message: 'A radius drag needs a finite radius greater than zero.', severity: 'error' }],
      parts: [],
      sketches,
    };
  }
  let nativeModule: ModuleStatic | undefined;
  let nativePromise: Promise<ModuleStatic> | undefined;
  try {
    await initializeCadSolver(options.wasmUrl);
    nativePromise = modulePromise!;
    let module = await nativePromise;
    nativeModule = module;
    // Solving replaces each sketch's contents in place, so the face sketches update through their targets.
    for (const part of next.parts.flatMap(sketchTargets)) {
      const fixedConflicts = fixedConstraintConflicts(part);
      if (fixedConflicts.length) {
        diagnostics.push(...fixedConflicts);
        sketches.push({ partId: part.id, dof: -1, status: 'conflict' });
        continue;
      }
      if (poisonedModules.has(module)) {
        await initializeCadSolver(options.wasmUrl);
        nativePromise = modulePromise!;
        module = await nativePromise;
        nativeModule = module;
      }
      let wrapper = new GcsWrapper(new module.GcsSystem(), module);
      try {
        const entities = new Map(part.sketch.entities.map(e => [e.id, e]));
        const fixedArcs: CadArcEntity[] = [];
        for (const entity of part.sketch.entities) {
          if (entity.type !== 'arc') continue;
          const points = [entity.centerId, entity.startId, entity.endId].map(id => entities.get(id) as CadPointEntity);
          if (!points.every(point => point.fixed)) continue;
          const [center, start, end] = points as [CadPointEntity, CadPointEntity, CadPointEntity];
          const radius = Math.hypot(start.x - center.x, start.y - center.y);
          const endRadius = Math.hypot(end.x - center.x, end.y - center.y);
          if (radius <= CAD_GEOMETRY_TOLERANCE || Math.abs(radius - endRadius) > CAD_GEOMETRY_TOLERANCE) {
            diagnostics.push({
              code: 'constraint-conflict',
              message: 'The fixed arc endpoints must lie on the same circle around its fixed center.',
              severity: 'error',
              partId: part.id,
              entityIds: [entity.id, ...points.map(point => point.id)],
            });
            continue;
          }
          const near = (angle: number, previous: number) => angle + 2 * Math.PI * Math.round((previous - angle) / (2 * Math.PI));
          entity.radius = radius;
          entity.startAngle = near(Math.atan2(start.y - center.y, start.x - center.x), entity.startAngle);
          entity.endAngle = near(Math.atan2(end.y - center.y, end.x - center.x), entity.endAngle);
          fixedArcs.push(entity);
        }
        if (diagnostics.some(d => d.partId === part.id && d.severity === 'error')) {
          sketches.push({ partId: part.id, dof: -1, status: 'conflict' });
          continue;
        }
        // Points must precede curves; document order has no semantic significance.
        const ordered = [...part.sketch.entities].sort((a, b) => Number(a.type !== 'point') - Number(b.type !== 'point'));
        const points = new Map(ordered.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
        const offsetSeed = offsetNativeSeed(part.sketch);
        const geometry: SketchPrimitive[] = ordered.map(e => solverGeometry(offsetSeed.get(e.id) ?? e, points));
        const primitives: SketchPrimitive[] = [];
        const draggedIds = new Set(dragTargets.map(target => target.pointId));
        const retainedSplineHandles = new Set<string>();
        for (const e of ordered)
          if (e.type === 'spline' && [...e.fitPointIds, ...e.controlPointIds].some(id => draggedIds.has(id))) {
            for (const id of [...e.fitPointIds, ...(e.closed ? [] : [e.controlPointIds[1]!, e.controlPointIds.at(-2)!])])
              if (!draggedIds.has(id)) retainedSplineHandles.add(id);
          }
        for (const id of retainedSplineHandles) {
          const p = points.get(id)!;
          if (!p.fixed)
            primitives.push(
              { id: `${id}:retain-x`, type: 'coordinate_x', p_id: id, x: p.x, temporary: true },
              { id: `${id}:retain-y`, type: 'coordinate_y', p_id: id, y: p.y, temporary: true }
            );
        }
        for (const e of ordered)
          if (e.type === 'spline') {
            const data = rationalCurveData(e, points),
              lo = data.knots[data.degree]!,
              hi = data.knots[data.poles.length]!;
            e.fitPointIds.forEach((pointId, i) => {
              if (!e.closed && (i === 0 || i === e.fitPointIds.length - 1)) return;
              primitives.push({
                id: `${e.id}:fit:${i}`,
                type: 'point_on_bspline',
                p_id: pointId,
                b_id: e.id,
                pointparam: lo + e.fitParameters[i]! * (hi - lo),
              });
            });
          }
        for (const e of ordered)
          if (e.type === 'arc') {
            // With all three points fixed, four arc rules overconstrain three native arc parameters.
            // Keep one native radius equation so contradictory user dimensions remain detectable.
            primitives.push(
              fixedArcs.includes(e)
                ? { id: `${e.id}:fixed-radius`, type: 'arc_radius', a_id: e.id, radius: e.radius }
                : { id: `${e.id}:arc-rules`, type: 'arc_rules', a_id: e.id }
            );
          }
        const coincident = pointEquivalence(part.sketch.constraints);
        primitives.push(
          ...part.sketch.constraints.flatMap(c =>
            'value' in c && c.driven ? [] : solverConstraint(c, entities, coincident, part.sketch.constraints, offsetSeed)
          )
        );
        for (const drag of dragTargets)
          if (entities.get(drag.pointId)?.type === 'point')
            primitives.push(
              { id: `${drag.pointId}:drag-x`, type: 'coordinate_x', p_id: drag.pointId, x: drag.x, temporary: true },
              { id: `${drag.pointId}:drag-y`, type: 'coordinate_y', p_id: drag.pointId, y: drag.y, temporary: true }
            );
        const radiusDrag = options.radiusDrag;
        if (radiusDrag) {
          const curve = entities.get(radiusDrag.entityId);
          if (curve?.type === 'circle')
            primitives.push({
              id: `${curve.id}:drag-radius`,
              type: 'circle_radius',
              c_id: curve.id,
              radius: radiusDrag.radius,
              temporary: true,
            });
          else if (curve?.type === 'arc')
            primitives.push({
              id: `${curve.id}:drag-radius`,
              type: 'arc_radius',
              a_id: curve.id,
              radius: radiusDrag.radius,
              temporary: true,
            });
        }
        const populate = (target: GcsWrapper) => {
          target.push_primitives_and_params(structuredClone(geometry));
          for (const entity of ordered)
            if (isNurbsCurve(entity)) {
              const data = nativeCurveData(entity, points),
                ids = data.poleIds;
              const addr = (id: string) => {
                const i = target.p_param_index.get(id);
                if (i === undefined) throw new Error('Missing native curve point.');
                return i;
              };
              const vector = (values: number[]) => {
                const v = new module.IntVector();
                values.forEach(value => v.push_back(value));
                return v;
              };
              const knots = data.knots;
              const poles = vector(ids.flatMap(id => [addr(id), addr(id) + 1]));
              const weights = vector(data.weights.map(w => target.gcs.push_p_param(w, true)));
              const knotValues = vector(knots.map(k => target.gcs.push_p_param(k, true)));
              const multiplicities = vector(data.mult);
              // Native endpoint normals recognize the cached endpoint parameter address. Logical aliases
              // share only those cache references; source point/pole IDs and their equations stay separate.
              try {
                target.bspline_gcs_cache.set(
                  entity.id,
                  target.gcs.make_bspline(
                    addr(coincident.canonical(entity.startId)),
                    addr(coincident.canonical(entity.startId)) + 1,
                    addr(coincident.canonical(entity.endId)),
                    addr(coincident.canonical(entity.endId)) + 1,
                    poles,
                    weights,
                    knotValues,
                    multiplicities,
                    data.degree,
                    data.periodic
                  )
                );
              } finally {
                poles.delete();
                weights.delete();
                knotValues.delete();
                multiplicities.delete();
              }
            }
          for (const c of part.sketch.constraints)
            if (c.type === 'pointOnCurve' && !c.parameterFixed) {
              const data = rationalCurveData(entities.get(c.entityId) as CadNurbsEntity, points),
                lo = data.knots[data.degree]!,
                hi = data.knots[data.poles.length]!;
              target.push_sketch_param(`${c.id}:parameter`, lo + c.parameter * (hi - lo), false);
            }
          for (const c of part.sketch.constraints) {
            if ('value' in c && c.driven) continue;
            if (c.type === 'offset') {
              target.push_sketch_param(`${c.id}:offset-magnitude`, Math.abs(c.value));
              target.push_sketch_param(`${c.id}:offset-value`, c.value);
              continue;
            }
            if (c.type === 'circleCircleDistance') {
              const a = entities.get(c.entityAId) as import('./types').CadCircleEntity | CadArcEntity,
                b = entities.get(c.entityBId) as import('./types').CadCircleEntity | CadArcEntity;
              const ca = points.get(a.centerId)!,
                cb = points.get(b.centerId)!;
              const distance = Math.hypot(cb.x - ca.x, cb.y - ca.y);
              target.push_sketch_param(`${c.id}:center-distance`, distance, false);
              target.push_sketch_param(`${c.id}:radius-distance`, distance + c.radiusASign * a.radius, false);
              continue;
            }
            if (c.type !== 'pointArcDistance' && c.type !== 'lineCircleDistance') continue;
            const circular = entities.get(c.type === 'pointArcDistance' ? c.entityId : c.entityBId) as
              | import('./types').CadCircleEntity
              | CadArcEntity;
            const center = points.get(circular.centerId)!;
            let distance: number;
            if (c.type === 'pointArcDistance') {
              const point = points.get(c.pointId)!;
              distance = Math.hypot(point.x - center.x, point.y - center.y);
            } else {
              const line = entities.get(c.entityAId) as CadLineEntity;
              const a = points.get(line.startId)!,
                b = points.get(line.endId)!;
              distance = Math.abs((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
            }
            target.push_sketch_param(`${c.id}:center-distance`, distance, false);
          }
          for (const primitive of structuredClone(primitives)) pushConditionedPrimitive(target, primitive);
          for (const arc of fixedArcs) {
            // PlaneGCS 1.3.0 exposes arc parameters in start-angle, end-angle, radius order.
            const index = target.p_param_index.get(arc.id);
            if (index === undefined) throw new Error('The fixed arc was not registered with the solver.');
            target.gcs.set_p_param(index, arc.startAngle, true);
            target.gcs.set_p_param(index + 1, arc.endAngle, true);
          }
        };
        populate(wrapper);
        let solveStatus: SolveStatus = SolveStatus.Failed;
        let conflicts: string[] = [],
          redundant: string[] = [];
        let candidate: CadPart | undefined;
        let invalidOffsets: string[] = [];
        let nativeSolveMs = 0;
        for (const algorithm of [Algorithm.DogLeg, Algorithm.LevenbergMarquardt, Algorithm.BFGS]) {
          if (algorithm !== Algorithm.DogLeg) {
            const fresh = new GcsWrapper(new module.GcsSystem(), module);
            try {
              populate(fresh);
            } catch (error) {
              destroyWrapper(fresh);
              throw error;
            }
            destroyWrapper(wrapper);
            wrapper = fresh;
          }
          candidate = undefined;
          const solveStarted = performance.now();
          solveStatus = wrapper.solve(algorithm);
          nativeSolveMs += performance.now() - solveStarted;
          const sourceConstraintId = (id: string) => {
            const offset = part.sketch.constraints.find(c => c.type === 'offset' && id.startsWith(`${c.id}:offset:`));
            if (offset) return offset.id;
            const suffix = [':parallel', ':radius-gap', ':radius-a', ':radius-b'].find(suffix => id.endsWith(suffix));
            const parent =
              suffix &&
              part.sketch.constraints.find(
                c =>
                  c.id === id.slice(0, -suffix.length) &&
                  ['lineLineDistance', 'pointArcDistance', 'lineCircleDistance', 'circleCircleDistance'].includes(c.type)
              );
            return parent ? parent.id : id;
          };
          conflicts = [...new Set(wrapper.get_gcs_conflicting_constraints().map(sourceConstraintId))];
          redundant = [...new Set(wrapper.get_gcs_redundant_constraints().map(sourceConstraintId))];
          // A real driving conflict is never hidden by an algorithm retry.
          if (conflicts.length) break;
          if (solveStatus !== SolveStatus.Success) continue;
          const solvedPart = structuredClone(part);
          applySolvedGeometry(solvedPart, wrapper);
          invalidOffsets = invalidOffsetBranches(solvedPart.sketch);
          if (invalidOffsets.length) continue;
          // DogLeg can report success at a degenerate zero-radius branch of an underconstrained
          // arc network. Retry the untouched source with another native algorithm before publishing it.
          // Open profiles are intentionally excluded: they remain normal editable sketch geometry.
          if (
            solvedCurveEquationsHold(solvedPart) &&
            !validateCadDocument({ ...next, version: solvedPart.features?.length ? 2 : 1, parts: [solvedPart] }).some(
              diagnostic => diagnostic.severity === 'error'
            )
          ) {
            candidate = solvedPart;
            break;
          }
        }
        const status = conflicts.length ? 'conflict' : candidate ? 'solved' : 'invalid';
        sketches.push({ partId: part.id, dof: wrapper.gcs.dof(), status });
        if (status !== 'solved') {
          diagnostics.push({
            code: conflicts.length ? 'constraint-conflict' : invalidOffsets.length ? 'invalid-offset' : 'solver-failed',
            message: conflicts.length
              ? 'These dimensions or constraints conflict. Edit or remove one to continue.'
              : invalidOffsets.length
                ? 'That offset would reverse or consume a copied edge. Choose a smaller distance.'
                : 'The sketch solver could not find a valid solution. Undo the last edit or adjust the geometry.',
            severity: 'error',
            partId: part.id,
            constraintIds:
              invalidOffsets.length && !conflicts.length
                ? invalidOffsets
                : conflicts.filter(id => part.sketch.constraints.some(c => c.id === id)),
            entityIds: conflicts.flatMap(id => {
              const suffix = [':arc-rules', ':fixed-radius'].find(suffix => id.endsWith(suffix));
              return suffix ? [id.slice(0, -suffix.length)] : [];
            }),
          });
          continue;
        }
        part.sketch.entities = candidate!.sketch.entities;
        part.sketch.constraints = candidate!.sketch.constraints;
        part.sketch.constraints = part.sketch.constraints.map(c =>
          'value' in c && c.driven ? refreshDimensionMeasurement(part.sketch, c) : c
        );
        if (redundant.length)
          diagnostics.push({
            code: 'redundant-constraint',
            message: 'Some constraints repeat relationships that are already defined.',
            severity: 'warning',
            partId: part.id,
            constraintIds: redundant,
          });
        if (wrapper.gcs.dof() > 0)
          diagnostics.push({
            code: 'underconstrained',
            message: `${wrapper.gcs.dof()} degrees of freedom remain. Add dimensions to keep this shape predictable.`,
            severity: 'warning',
            partId: part.id,
          });
        let classificationReset = false;
        if (options.classifyEntities) {
          const sketchStatus = sketches.at(-1)!;
          const analysisStarted = performance.now();
          try {
            const analysis = classifyNativeEntities(part.sketch, wrapper, {
              budgetMs: options.entityAnalysisBudgetMs,
              spentMs: nativeSolveMs,
              isAborted: () => poisonedModules.has(module),
            });
            sketchStatus.entityStatus = analysis.status;
            sketchStatus.entityAnalysis = {
              elapsedMs: analysis.elapsedMs,
              probes: analysis.probes,
              complete: analysis.complete,
              ...(analysis.limitedBy && { limitedBy: analysis.limitedBy }),
            };
          } catch (error) {
            classificationReset = isFatalSolverError(error) || poisonedModules.has(module);
            if (classificationReset) {
              // Geometry and global DOF were already validated before this optional query.
              // Discard only the aborted analysis engine; later parts use a fresh module.
              poisonedModules.add(module);
              if (modulePromise === nativePromise) modulePromise = undefined;
            }
            sketchStatus.entityStatus = Object.fromEntries(part.sketch.entities.map(entity => [entity.id, 'unknown']));
            sketchStatus.entityAnalysis = {
              elapsedMs: performance.now() - analysisStarted,
              probes: -1,
              complete: false,
              limitedBy: classificationReset ? 'engine-reset' : 'failure',
            };
          }
          if (sketchStatus.entityAnalysis?.complete === false) {
            diagnostics.push({
              code: 'entity-analysis-limited',
              severity: 'warning',
              partId: part.id,
              message: classificationReset
                ? 'The sketch is solved. Constraint color analysis stopped and its engine was reset.'
                : sketchStatus.entityAnalysis.limitedBy === 'budget'
                  ? 'The sketch is solved; some constraint colors are unavailable because analysis reached its time budget.'
                  : 'The sketch is solved; some entity constraint colors could not be determined.',
            });
          }
        }
        if (!classificationReset && poisonedModules.has(module)) throw new WebAssembly.RuntimeError('The native sketch solver aborted.');
      } catch (error) {
        if (isFatalSolverError(error) || poisonedModules.has(module)) {
          poisonedModules.add(module);
          if (modulePromise === nativePromise) modulePromise = undefined;
        }
        throw error;
      } finally {
        destroyWrapper(wrapper);
      }
    }
  } catch (error) {
    if (isFatalSolverError(error) || (nativeModule && poisonedModules.has(nativeModule))) {
      if (nativeModule) poisonedModules.add(nativeModule);
      if (modulePromise === nativePromise) modulePromise = undefined;
      return {
        document: structuredClone(document),
        status: 'invalid',
        parts: [],
        diagnostics: [
          {
            code: 'solver-restarted',
            severity: 'error',
            message: 'The sketch solver stopped and its engine was reset. Your sketch is unchanged; try the edit again.',
          },
        ],
        sketches: document.parts.map(part => ({ partId: part.id, dof: -1, status: 'invalid' })),
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    diagnostics.push({ code: 'solver-error', message: `Could not solve this sketch: ${detail}`, severity: 'error' });
  }
  if (diagnostics.some(d => d.severity === 'error')) {
    return {
      document: next,
      status: sketches.some(s => s.status === 'conflict') ? 'conflict' : 'invalid',
      diagnostics,
      parts: [],
      sketches,
    };
  }
  const evaluated = evaluateCadDocument(next);
  diagnostics.push(...evaluated.diagnostics);
  return {
    document: next,
    status: diagnostics.some(d => d.severity === 'error') ? 'invalid' : 'solved',
    diagnostics,
    parts: evaluated.parts,
    sketches,
  };
}
