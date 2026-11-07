import { refreshDimensionMeasurement } from './dimensions';
import { migrateDimensionPlacements } from './dimensionPlacement';
import type {
  CadArcEntity,
  CadCircleEntity,
  CadConstraint,
  CadDocument,
  CadEntity,
  CadPart,
  CadPoint,
  CadPointEntity,
  CadSketch,
  CadSplineEntity,
  NewCadConstraint,
} from './types';
import { elevateBezierData, evaluateCurvePoint, fitSplineData, insertRationalKnot, rationalCurveData } from './curves';
import { rectangleCorners } from './rectangleCorners';
import { isOwnedSplineHandle, splineHandleEntities, splineHandleIssue, splineHandleOwner, withSplineHandleSegments } from './splineHandles';

export const CAD_DOCUMENT_VERSION = 1;
export const newCadId = (): string => crypto.randomUUID();
export const originId = (sketch: CadSketch): string => `${sketch.id}:origin`;

export function createCadDocument(name = 'Untitled design'): CadDocument {
  return { version: 1, id: newCadId(), name, revision: 0, parts: [] };
}

export function createCadPart(name = 'Part 1', thickness = 18): CadPart {
  const sketch: CadSketch = { id: newCadId(), entities: [], constraints: [] };
  sketch.entities.push({ id: originId(sketch), type: 'point', x: 0, y: 0, fixed: true, construction: true });
  return { id: newCadId(), name, thickness, sketch };
}

export function createPlateDocument(
  options: {
    name?: string;
    width?: number;
    height?: number;
    thickness?: number;
  } = {}
): CadDocument {
  const document = createCadDocument(options.name ?? 'Plate');
  const part = createCadPart('Plate', options.thickness ?? 18);
  part.sketch = addRectangle(part.sketch, {
    x: 0,
    y: 0,
    width: options.width ?? 120,
    height: options.height ?? 80,
    dimensioned: true,
  });
  const firstEdge = part.sketch.entities.find(entity => entity.type === 'line')!;
  part.sketch = addConstraint(part.sketch, {
    type: 'coincident',
    pointAId: firstEdge.startId,
    pointBId: originId(part.sketch),
  });
  document.parts.push(part);
  return document;
}

export function addConstraint(sketch: CadSketch, constraint: NewCadConstraint): CadSketch {
  return { ...sketch, constraints: [...sketch.constraints, { ...constraint, id: constraint.id ?? newCadId() } as CadConstraint] };
}

export function removeConstraint(sketch: CadSketch, id: string): CadSketch {
  return { ...sketch, constraints: sketch.constraints.filter(c => c.id !== id) };
}

/** Each edit is a detached JSON value suitable for undo history and persistence. */
export function updateDimension(document: CadDocument, id: string, value: number, expression?: string): CadDocument {
  const sourceExpression = expression?.trim() || undefined;
  const next = migrateDimensionPlacements(document);
  let changed = false;
  for (const part of next.parts) {
    for (const c of part.sketch.constraints) {
      if (c.id === id && 'value' in c && !c.driven && (c.value !== value || c.expression !== sourceExpression)) {
        c.value = value;
        if (sourceExpression === undefined) delete c.expression;
        else c.expression = sourceExpression;
        changed = true;
      }
    }
  }
  if (changed) next.revision++;
  return next;
}

/** Convert a numeric driver to a reference, or restore driving at its current measured value. */
export function setDimensionDriven(document: CadDocument, id: string, driven: boolean): CadDocument {
  const next = migrateDimensionPlacements(document);
  let changed = false;
  for (const part of next.parts) {
    part.sketch.constraints = part.sketch.constraints.map(constraint => {
      if (constraint.id !== id || !('value' in constraint) || !!constraint.driven === driven) return constraint;
      changed = true;
      const measured = refreshDimensionMeasurement(part.sketch, constraint);
      if (driven) {
        const reference = { ...measured, driven: true };
        delete reference.expression;
        return reference;
      }
      const restored = { ...measured };
      delete restored.driven;
      return restored;
    });
  }
  if (changed) next.revision++;
  return next;
}

export function updatePoint(document: CadDocument, id: string, point: CadPoint): CadDocument {
  const next = migrateDimensionPlacements(document);
  let changed = false;
  for (const part of next.parts) {
    const e = part.sketch.entities.find((e): e is CadPointEntity => e.id === id && e.type === 'point');
    if (e && !e.fixed && (e.x !== point.x || e.y !== point.y)) {
      e.x = point.x;
      e.y = point.y;
      changed = true;
    }
  }
  if (changed) next.revision++;
  return next;
}

export function entityPointIds(entity: CadEntity): string[] {
  switch (entity.type) {
    case 'point':
      return [];
    case 'line':
      return [entity.startId, entity.endId];
    case 'circle':
      return [entity.centerId];
    case 'arc':
      return [entity.centerId, entity.startId, entity.endId];
    case 'conic':
      return [entity.startId, entity.controlId, entity.endId];
    case 'bezier':
      return [...entity.controlPointIds];
    case 'spline':
      return [...new Set([entity.startId, entity.endId, ...entity.controlPointIds, ...entity.fitPointIds])];
  }
}

export function constraintEntityIds(constraint: CadConstraint): string[] {
  if (constraint.type === 'offset')
    return Array.isArray(constraint.members)
      ? [...new Set(constraint.members.flatMap(member => (member ? [member.sourceId, member.targetId] : [])))]
      : [];
  if (constraint.type === 'symmetricPoints') return [constraint.pointAId, constraint.pointBId, constraint.lineId];
  if ('sourceEntityId' in constraint && constraint.sourceEntityId !== undefined)
    return [constraint.pointAId, constraint.pointBId, constraint.sourceEntityId];
  if ('pointId' in constraint && 'entityId' in constraint) return [constraint.pointId, constraint.entityId];
  if ('entityId' in constraint) return [constraint.entityId];
  if ('entityAId' in constraint) return [constraint.entityAId, constraint.entityBId];
  if ('pointId' in constraint) return [constraint.pointId];
  return [constraint.pointAId, constraint.pointBId];
}

export function isSplineTangentHandle(sketch: CadSketch, entityId: string): boolean {
  return splineHandleOwner(sketch, entityId) !== undefined;
}

/** Deleting a point removes dependent curves; deleting a curve removes only unused points. */
export function removeEntity(sketch: CadSketch, id: string): CadSketch {
  if (id === originId(sketch)) return sketch;
  // Endpoint tangent handles belong to the fit spline definition. They remain
  // editable/dimensionable, but deleting a handle must never delete its curve.
  if (isSplineTangentHandle(sketch, id)) return sketch;
  const removed = new Set([id]);
  const dependents = new Map<string, string[]>();
  for (const entity of sketch.entities) {
    const refs = [...entityPointIds(entity), ...(isOwnedSplineHandle(entity) ? [entity.owner.splineId] : [])];
    for (const reference of refs) dependents.set(reference, [...(dependents.get(reference) ?? []), entity.id]);
  }
  const pending = [id];
  while (pending.length)
    for (const dependent of dependents.get(pending.pop()!) ?? []) {
      if (removed.has(dependent)) continue;
      removed.add(dependent);
      pending.push(dependent);
    }
  let entities = sketch.entities.filter(e => !removed.has(e.id));
  const used = new Set(entities.flatMap(entityPointIds));
  const removedPointIds = new Set(sketch.entities.filter(e => removed.has(e.id)).flatMap(entityPointIds));
  entities = entities.filter(e => {
    const remove = e.type === 'point' && !e.standalone && e.id !== originId(sketch) && removedPointIds.has(e.id) && !used.has(e.id);
    if (remove) removed.add(e.id);
    return !remove;
  });
  return { ...sketch, entities, constraints: sketch.constraints.filter(c => !constraintEntityIds(c).some(e => removed.has(e))) };
}

function pointAt(sketch: CadSketch, p: CadPoint, construction?: boolean): CadPointEntity {
  // Reuse shared endpoints, including the fixed origin, when drawing a chain.
  const existing = sketch.entities.find((e): e is CadPointEntity => e.type === 'point' && Math.hypot(e.x - p.x, e.y - p.y) < 1e-7);
  return existing ?? { id: newCadId(), type: 'point', ...p, construction };
}

/** Standalone reference geometry stays editable and can later be constrained onto curves. */
export function addPoint(
  sketch: CadSketch,
  options: CadPoint & { construction?: boolean; fixed?: boolean; standalone?: boolean }
): CadSketch {
  return { ...sketch, entities: [...sketch.entities, { id: newCadId(), type: 'point', standalone: true, ...options }] };
}

export function addConic(
  sketch: CadSketch,
  options: { start: CadPoint; end: CadPoint; control: CadPoint; rho?: number; construction?: boolean }
): CadSketch {
  const rho = options.rho ?? 0.5;
  if (!Number.isFinite(rho) || rho <= 0 || rho >= 1) throw new Error('Conic rho must be between zero and one.');
  const entities = [...sketch.entities];
  const refs = [options.start, options.end].map(p => {
    const point = pointAt({ ...sketch, entities }, p, options.construction);
    if (!entities.some(e => e.id === point.id)) entities.push(point);
    return point.id;
  });
  const control = { id: newCadId(), type: 'point' as const, ...options.control, standalone: false, construction: true };
  entities.push(control, {
    id: newCadId(),
    type: 'conic',
    startId: refs[0]!,
    endId: refs[1]!,
    controlId: control.id,
    rho,
    construction: options.construction,
  });
  return { ...sketch, entities };
}

export function setConicRho(sketch: CadSketch, entityId: string, rho: number): CadSketch {
  if (!Number.isFinite(rho) || rho <= 0 || rho >= 1) throw new Error('Conic rho must be between zero and one.');
  return { ...sketch, entities: sketch.entities.map(e => (e.id === entityId && e.type === 'conic' ? { ...e, rho } : e)) };
}

export function addBezier(sketch: CadSketch, options: { points: CadPoint[]; construction?: boolean }): CadSketch {
  if (options.points.length < 2 || options.points.length > 16 || options.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('A Bézier curve needs 2–16 finite control points (degree 1–15).');
  const entities = [...sketch.entities];
  const ids = options.points.map((p, i) => {
    const point =
      i === 0 || i === options.points.length - 1
        ? pointAt({ ...sketch, entities }, p, options.construction)
        : { id: newCadId(), type: 'point' as const, ...p, standalone: false, construction: true };
    if (!entities.some(e => e.id === point.id)) entities.push(point);
    return point.id;
  });
  entities.push({
    id: newCadId(),
    type: 'bezier',
    startId: ids[0]!,
    endId: ids.at(-1)!,
    controlPointIds: ids,
    construction: options.construction,
  });
  return { ...sketch, entities };
}

export function addSpline(sketch: CadSketch, options: { points: CadPoint[]; closed?: boolean; construction?: boolean }): CadSketch {
  const repeatedEnd =
    options.points.length > 3 &&
    Math.hypot(options.points[0]!.x - options.points.at(-1)!.x, options.points[0]!.y - options.points.at(-1)!.y) < 1e-7;
  const closed = options.closed ?? repeatedEnd,
    fitPoints = closed && repeatedEnd ? options.points.slice(0, -1) : options.points;
  const fit = fitSplineData(fitPoints, closed);
  const entities = [...sketch.entities];
  const fitPointIds = fitPoints.map(p => {
    const point = pointAt({ ...sketch, entities }, p, options.construction);
    if (!entities.some(e => e.id === point.id)) entities.push(point);
    return point.id;
  });
  const controlPointIds = fit.poles.map((p, i) => {
    if (!closed && (i === 0 || i === fit.poles.length - 1)) return i === 0 ? fitPointIds[0]! : fitPointIds.at(-1)!;
    const point = { id: newCadId(), type: 'point' as const, ...p, construction: true, standalone: false };
    entities.push(point);
    return point.id;
  });
  const spline: CadSplineEntity = {
    id: newCadId(),
    type: 'spline',
    startId: fitPointIds[0]!,
    endId: closed ? fitPointIds[0]! : fitPointIds.at(-1)!,
    controlPointIds,
    fitPointIds,
    fitParameters: fit.parameters,
    degree: fit.degree,
    knots: fit.knots,
    weights: fit.weights,
    closed,
    construction: options.construction,
  };
  entities.push(...splineHandleEntities(spline), spline);
  return { ...sketch, entities };
}

export function insertCurveControlPoint(sketch: CadSketch, entityId: string, parameter = 0.5): CadSketch {
  const curve = sketch.entities.find(e => e.id === entityId);
  if (curve?.type !== 'spline' && curve?.type !== 'bezier') throw new Error('Select a spline or Bézier curve to add a control point.');
  if (curve.type === 'spline' && curve.closed) throw new Error('Control insertion is currently available on open fit splines.');
  if (curve.type === 'spline' && curve.fitPointIds.length >= 64) throw new Error('A spline supports at most 64 fit points.');
  if (curve.controlPointIds.length >= (curve.type === 'bezier' ? 16 : 128))
    throw new Error('This curve has reached its control point limit.');
  const points = new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
  if (curve.type === 'spline' && curve.fitParameters.some(t => Math.abs(t - parameter) < 1e-7))
    throw new Error('That location already has a spline fit point.');
  const data = rationalCurveData(curve, points),
    refined = curve.type === 'bezier' ? elevateBezierData(data) : insertRationalKnot(data, parameter);
  const newId = newCadId(),
    ids = [...curve.controlPointIds];
  ids.splice(
    curve.type === 'bezier' ? ids.length - 1 : 'insertedIndex' in refined ? (refined.insertedIndex as number) : ids.length - 1,
    0,
    newId
  );
  if (curve.type === 'spline') {
    // The visible white points have semantic identities independent of where the
    // knot-refinement algorithm inserts a new internal pole.
    for (const [id, slot] of [
      [curve.controlPointIds[1]!, 1],
      [curve.controlPointIds.at(-2)!, ids.length - 2],
    ] as const) {
      const previous = ids.indexOf(id);
      [ids[previous], ids[slot]] = [ids[slot]!, ids[previous]!];
    }
  }
  const protectedHandles = new Set<string>();
  if (curve.type === 'spline')
    for (const id of [curve.controlPointIds[1]!, curve.controlPointIds.at(-2)!])
      if (
        sketch.constraints.some(
          c =>
            (!('value' in c) || !c.driven) &&
            constraintEntityIds(c).some(
              reference =>
                reference === id || sketch.entities.some(e => e.id === reference && e.type !== 'spline' && entityPointIds(e).includes(id))
            )
        )
      )
        protectedHandles.add(id);
  const replacements = new Map(ids.map((id, i) => [id, refined.poles[i]!]));
  const entities = sketch.entities.map(e =>
    e.type === 'point' && !e.fixed && !protectedHandles.has(e.id) && replacements.has(e.id) ? { ...e, ...replacements.get(e.id)! } : e
  );
  const inserted = refined.poles[ids.indexOf(newId)]!;
  entities.push({ id: newId, type: 'point', ...inserted, standalone: false, construction: true });
  const fitId = newCadId(),
    fit = evaluateCurvePoint(curve, points, parameter);
  const fitPointIds = curve.type === 'spline' ? [...curve.fitPointIds] : [],
    fitParameters = curve.type === 'spline' ? [...curve.fitParameters] : [];
  if (curve.type === 'spline') {
    const index = fitParameters.findIndex(t => t > parameter);
    fitPointIds.splice(index, 0, fitId);
    fitParameters.splice(index, 0, parameter);
    entities.push({ id: fitId, type: 'point', ...fit, standalone: false });
  }
  return {
    ...sketch,
    entities: entities.map(e =>
      e.id !== curve.id
        ? e
        : e.type === 'bezier'
          ? { ...e, controlPointIds: ids }
          : e.type === 'spline'
            ? { ...e, controlPointIds: ids, weights: refined.weights, knots: refined.knots, fitPointIds, fitParameters }
            : e
    ),
  };
}

/** Fit handles are always visible; construction controls are shown for a selected curve. */
export function visibleSketchPointIds(sketch: CadSketch, selectedEntityIds: readonly string[] = []): Set<string> {
  const hidden = new Set<string>(),
    visible = new Set<string>();
  for (const entity of sketch.entities) {
    if (entity.type === 'conic') visible.add(entity.controlId);
    if (entity.type === 'bezier') entity.controlPointIds.forEach(id => visible.add(id));
    if (entity.type === 'spline') {
      entity.controlPointIds.forEach(id => hidden.add(id));
      entity.fitPointIds.forEach(id => visible.add(id));
      if (!entity.closed) {
        visible.add(entity.controlPointIds[1]!);
        visible.add(entity.controlPointIds.at(-2)!);
      }
    }
    if (entity.type !== 'point' && entity.type !== 'spline' && selectedEntityIds.includes(entity.id))
      entityPointIds(entity).forEach(id => visible.add(id));
  }
  return new Set(
    sketch.entities
      .filter((e): e is CadPointEntity => e.type === 'point' && (!hidden.has(e.id) || visible.has(e.id) || !!e.standalone))
      .map(e => e.id)
  );
}

export function addLine(
  sketch: CadSketch,
  options: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    construction?: boolean;
  }
): CadSketch {
  const a = pointAt(sketch, { x: options.x1, y: options.y1 }, options.construction);
  const b = pointAt(sketch, { x: options.x2, y: options.y2 }, options.construction);
  const entities = [...sketch.entities];
  for (const p of [a, b]) if (!entities.some(e => e.id === p.id)) entities.push(p);
  entities.push({ id: newCadId(), type: 'line', startId: a.id, endId: b.id, construction: options.construction });
  return { ...sketch, entities };
}

export function addRectangle(
  sketch: CadSketch,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    construction?: boolean;
    /** Intentional numeric creation: constrain the size rather than only providing an initial shape. */
    dimensioned?: boolean;
    /** Explicitly constrain the lower-left location. Free drawing never adds these dimensions. */
    positioned?: boolean;
  }
): CadSketch {
  const { x, y, width: w, height: h, construction } = options;
  const corners: [CadPoint, CadPoint, CadPoint, CadPoint] = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const graph = rectangleCorners(corners, { createId: newCadId, construction });
  const entities = [...sketch.entities, ...graph.entities];
  const [bottom, right, top, left] = graph.edges;
  const constraints: CadConstraint[] = [
    ...sketch.constraints,
    ...graph.coincidences,
    { id: newCadId(), type: 'horizontal', entityId: bottom.id },
    { id: newCadId(), type: 'parallel', entityAId: bottom.id, entityBId: top.id },
    { id: newCadId(), type: 'parallel', entityAId: right.id, entityBId: left.id },
    { id: newCadId(), type: 'perpendicular', entityAId: bottom.id, entityBId: right.id },
  ];
  if (options.dimensioned)
    constraints.push(
      {
        id: newCadId(),
        type: 'distanceX',
        pointAId: bottom.startId,
        pointBId: bottom.endId,
        value: w,
        label: 'Width',
        sourceEntityId: bottom.id,
      },
      {
        id: newCadId(),
        type: 'distanceY',
        pointAId: right.startId,
        pointBId: right.endId,
        value: h,
        label: 'Height',
        sourceEntityId: right.id,
      }
    );
  if (options.positioned)
    constraints.push(
      { id: newCadId(), type: 'positionX', pointId: bottom.startId, value: x, label: 'X' },
      { id: newCadId(), type: 'positionY', pointId: bottom.startId, value: y, label: 'Y' }
    );
  return { ...sketch, entities, constraints };
}

/** A center rectangle keeps its clicked center through a persistent diagonal midpoint relation. */
export function addCenterRectangle(
  sketch: CadSketch,
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    construction?: boolean;
    /** Constrain width and height for intentional numeric creation. */
    dimensioned?: boolean;
    /** Add explicit center X/Y dimensions; omitted for free drawing. */
    positioned?: boolean;
  }
): CadSketch {
  const { x, y, width, height } = options;
  // A matching coordinate is not an external attachment. The caller's explicit snap relation owns that intent.
  const center: CadPointEntity = { id: newCadId(), type: 'point', x, y, construction: true, standalone: false };
  const centered = { ...sketch, entities: [...sketch.entities, center] };
  const rectangle = addRectangle(centered, {
    ...options,
    x: x - width / 2,
    y: y - height / 2,
    positioned: false,
  });
  const edges = rectangle.entities.slice(centered.entities.length).filter(e => e.type === 'line');
  const first = edges[0]!,
    opposite = edges[2]!;
  const diagonalId = newCadId();
  const entities: CadEntity[] = [
    ...rectangle.entities,
    { id: diagonalId, type: 'line', startId: first.startId, endId: opposite.startId, construction: true },
    { id: newCadId(), type: 'line', startId: first.endId, endId: opposite.endId, construction: true },
  ];
  const constraints: CadConstraint[] = [
    ...rectangle.constraints,
    { id: newCadId(), type: 'midpoint', pointId: center.id, entityId: diagonalId },
  ];
  if (options.positioned)
    constraints.push(
      { id: newCadId(), type: 'positionX', pointId: center.id, value: x, label: 'Center X' },
      { id: newCadId(), type: 'positionY', pointId: center.id, value: y, label: 'Center Y' }
    );
  return { ...sketch, entities, constraints };
}

export function addCircle(
  sketch: CadSketch,
  options: {
    x: number;
    y: number;
    radius: number;
    construction?: boolean;
    /** Constrain diameter for intentional numeric creation. */
    dimensioned?: boolean;
    /** Add explicit center X/Y dimensions; omitted for free drawing. */
    positioned?: boolean;
  }
): CadSketch {
  const center = pointAt(sketch, { x: options.x, y: options.y }, options.construction);
  const circle: CadCircleEntity = {
    id: newCadId(),
    type: 'circle',
    centerId: center.id,
    radius: options.radius,
    construction: options.construction,
  };
  const entities = sketch.entities.some(e => e.id === center.id) ? [...sketch.entities, circle] : [...sketch.entities, center, circle];
  const constraints: CadConstraint[] = [...sketch.constraints];
  if (options.dimensioned)
    constraints.push({ id: newCadId(), type: 'diameter', entityId: circle.id, value: 2 * options.radius, label: 'Diameter' });
  if (options.positioned && !center.fixed)
    constraints.push(
      { id: newCadId(), type: 'positionX', pointId: center.id, value: options.x, label: 'Center X' },
      { id: newCadId(), type: 'positionY', pointId: center.id, value: options.y, label: 'Center Y' }
    );
  return { ...sketch, entities, constraints };
}

export function addArc(
  sketch: CadSketch,
  options: {
    cx: number;
    cy: number;
    radius: number;
    startAngle: number;
    endAngle: number;
    construction?: boolean;
  }
): CadSketch {
  const { cx, cy, radius, startAngle, endAngle, construction } = options;
  const points = [
    pointAt(sketch, { x: cx, y: cy }, construction),
    pointAt(sketch, { x: cx + radius * Math.cos(startAngle), y: cy + radius * Math.sin(startAngle) }, construction),
    pointAt(sketch, { x: cx + radius * Math.cos(endAngle), y: cy + radius * Math.sin(endAngle) }, construction),
  ];
  const entities = [...sketch.entities];
  for (const p of points) if (!entities.some(e => e.id === p.id)) entities.push(p);
  const arc: CadArcEntity = {
    id: newCadId(),
    type: 'arc',
    centerId: points[0]!.id,
    startId: points[1]!.id,
    endId: points[2]!.id,
    radius,
    startAngle,
    endAngle,
    construction,
  };
  entities.push(arc);
  return { ...sketch, entities };
}

/** Reject invalid source shapes early when loading portable documents. Geometric errors stay editable. */
export function parseCadDocument(input: unknown): CadDocument {
  if (!input || typeof input !== 'object') throw new Error('Invalid CAD document');
  const d = input as CadDocument;
  if (
    d.version !== 1 ||
    typeof d.id !== 'string' ||
    typeof d.name !== 'string' ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 0 ||
    !Array.isArray(d.parts)
  )
    throw new Error('Invalid CAD document');
  const ids = new Set<string>([d.id]);
  const addId = (id: unknown) => {
    if (typeof id !== 'string' || !id || ids.has(id)) throw new Error('CAD IDs must be unique nonempty strings');
    ids.add(id);
  };
  const number = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('CAD numeric fields must be finite numbers');
  };
  const reference = (value: unknown) => {
    if (typeof value !== 'string' || !value) throw new Error('CAD references must be nonempty strings');
  };
  for (const p of d.parts) {
    if (!p || typeof p !== 'object' || !p.sketch || typeof p.sketch !== 'object') throw new Error('Invalid CAD part');
    addId(p.id);
    addId(p.sketch?.id);
    if (
      typeof p.name !== 'string' ||
      typeof p.thickness !== 'number' ||
      !Array.isArray(p.sketch.entities) ||
      !Array.isArray(p.sketch.constraints)
    )
      throw new Error('Invalid CAD part');
    number(p.thickness);
    for (const e of p.sketch.entities) {
      if (!e || typeof e !== 'object') throw new Error('Invalid CAD entity');
      addId(e.id);
      if (!['point', 'line', 'circle', 'arc', 'conic', 'bezier', 'spline'].includes(e.type)) throw new Error('Unknown CAD entity');
      if (e.construction !== undefined && typeof e.construction !== 'boolean') throw new Error('Invalid construction flag');
      if (e.type === 'point') {
        number(e.x);
        number(e.y);
        if (e.fixed !== undefined && typeof e.fixed !== 'boolean') throw new Error('Invalid fixed flag');
        if (e.standalone !== undefined && typeof e.standalone !== 'boolean') throw new Error('Invalid standalone point flag');
      } else {
        if (e.type === 'bezier' || e.type === 'spline') {
          if (!Array.isArray(e.controlPointIds)) throw new Error('Invalid curve controls');
        }
        if (e.type === 'spline') {
          if (![e.fitPointIds, e.fitParameters, e.knots, e.weights].every(Array.isArray)) throw new Error('Invalid spline data');
          e.fitPointIds.forEach(reference);
          e.fitParameters.forEach(number);
          e.knots.forEach(number);
          e.weights.forEach(number);
          number(e.degree);
          if (e.closed !== undefined && typeof e.closed !== 'boolean') throw new Error('Invalid closed spline flag');
        }
        if (e.type === 'conic') number(e.rho);
        entityPointIds(e).forEach(reference);
        if (e.type === 'circle' || e.type === 'arc') number(e.radius);
        if (e.type === 'arc') {
          number(e.startAngle);
          number(e.endAngle);
        }
      }
    }
    const entityMap = new Map(p.sketch.entities.map(e => [e.id, e]));
    for (const entity of p.sketch.entities) {
      const issue = splineHandleIssue(entity, entityMap);
      if (issue) throw new Error(issue);
    }
    for (const c of p.sketch.constraints) {
      if (!c || typeof c !== 'object') throw new Error('Invalid CAD constraint');
      addId(c.id);
      if (
        ![
          'horizontal',
          'vertical',
          'coincident',
          'symmetricPoints',
          'horizontalPoints',
          'verticalPoints',
          'pointOnLine',
          'pointOnCircle',
          'pointOnCurve',
          'midpoint',
          'distance',
          'distanceX',
          'distanceY',
          'pointLineDistance',
          'lineLineDistance',
          'pointArcDistance',
          'lineCircleDistance',
          'circleCircleDistance',
          'radius',
          'diameter',
          'positionX',
          'positionY',
          'parallel',
          'perpendicular',
          'equal',
          'tangent',
          'angle',
          'offset',
        ].includes(c.type)
      )
        throw new Error('Unknown CAD constraint');
      if (c.label !== undefined && typeof c.label !== 'string') throw new Error('Invalid constraint label');
      if (c.type === 'offset') {
        if (!Array.isArray(c.members) || c.members.length === 0) throw new Error('An offset needs copied geometry.');
        for (const member of c.members) {
          if (!member || !['line', 'circle', 'arc'].includes(member.kind) || (member.side !== 1 && member.side !== -1))
            throw new Error('Invalid offset member.');
          if ((member.kind === 'line' || member.kind === 'arc') && typeof member.endpoints !== 'boolean')
            throw new Error('Invalid offset endpoint relationship.');
          reference(member.sourceId);
          reference(member.targetId);
        }
      }
      if (c.labelPosition !== undefined) {
        if (!c.labelPosition || typeof c.labelPosition !== 'object') throw new Error('Invalid constraint label position');
        number(c.labelPosition.x);
        number(c.labelPosition.y);
      }
      if ('labelPlacement' in c && c.labelPlacement !== undefined) {
        if (!('value' in c) || !c.labelPlacement || typeof c.labelPlacement !== 'object')
          throw new Error('Invalid dimension label placement');
        const placement = c.labelPlacement;
        if (placement.kind === 'linear') {
          if (c.type === 'radius' || c.type === 'diameter' || c.type === 'angle') throw new Error('Invalid dimension label placement kind');
          number(placement.fraction);
          number(placement.normalOffset);
          if (placement.overshoot !== undefined) number(placement.overshoot);
        } else if (placement.kind === 'radial') {
          if (c.type !== 'radius' && c.type !== 'diameter') throw new Error('Invalid dimension label placement kind');
          number(placement.angle);
          number(placement.radiusRatio);
          if (placement.radiusRatio < 0) throw new Error('Invalid dimension label radius ratio');
          if (placement.radiusOffset !== undefined) {
            number(placement.radiusOffset);
            if (placement.radiusOffset < 0) throw new Error('Invalid dimension label radius offset');
          }
          if (placement.distance !== undefined) {
            number(placement.distance);
            if (placement.distance < 0) throw new Error('Invalid dimension label distance');
          }
        } else if (placement.kind === 'angle') {
          if (c.type !== 'angle') throw new Error('Invalid dimension label placement kind');
          number(placement.radius);
          number(placement.angleOffset);
          if (placement.radius < 0) throw new Error('Invalid dimension label radius');
          if (placement.frame !== undefined && placement.frame !== 'local') throw new Error('Invalid dimension label frame');
        } else if (placement.kind === 'fallback') {
          if (!placement.offset || typeof placement.offset !== 'object') throw new Error('Invalid dimension label fallback');
          number(placement.offset.x);
          number(placement.offset.y);
        } else throw new Error('Invalid dimension label placement kind');
      }
      if ('sourceEntityId' in c && c.sourceEntityId !== undefined) {
        if (c.type !== 'distance' && c.type !== 'distanceX' && c.type !== 'distanceY')
          throw new Error('Only point-pair dimensions can reference a source line');
        reference(c.sourceEntityId);
      }
      constraintEntityIds(c).forEach(reference);
      if ((c.type === 'pointArcDistance' || c.type === 'lineCircleDistance') && c.side !== 'inside' && c.side !== 'outside')
        throw new Error('Invalid circular distance side');
      if (
        (c.type === 'pointArcDistance' || c.type === 'lineCircleDistance') &&
        c.radiusSide !== undefined &&
        c.radiusSide !== 'near' &&
        c.radiusSide !== 'far'
      )
        throw new Error('Invalid circular witness side');
      if (c.type === 'circleCircleDistance' && ![c.radiusASign, c.radiusBSign, c.direction].every(value => value === 1 || value === -1))
        throw new Error('Invalid circular dimension direction');
      if ('expression' in c && c.expression !== undefined && (!('value' in c) || typeof c.expression !== 'string'))
        throw new Error('Invalid dimension expression');
      if ('driven' in c && c.driven !== undefined && (!('value' in c) || typeof c.driven !== 'boolean'))
        throw new Error('Invalid driven dimension flag');
      if (c.type === 'angle') {
        if (c.orientation !== undefined && c.orientation !== 1 && c.orientation !== -1)
          throw new Error('Invalid angular dimension orientation');
        if ([c.reversedA, c.reversedB].some(value => value !== undefined && typeof value !== 'boolean'))
          throw new Error('Invalid angular dimension ray');
      }
      if (c.type === 'pointOnCurve') {
        number(c.parameter);
        if (c.parameterFixed !== undefined && typeof c.parameterFixed !== 'boolean') throw new Error('Invalid curve parameter flag');
      }
      if (
        [
          'distance',
          'distanceX',
          'distanceY',
          'pointLineDistance',
          'lineLineDistance',
          'pointArcDistance',
          'lineCircleDistance',
          'circleCircleDistance',
          'radius',
          'diameter',
          'positionX',
          'positionY',
          'angle',
          'offset',
        ].includes(c.type)
      )
        number((c as { value: unknown }).value);
    }
  }
  const parsed = migrateDimensionPlacements(d);
  for (const part of parsed.parts) part.sketch = withSplineHandleSegments(part.sketch);
  return parsed;
}
