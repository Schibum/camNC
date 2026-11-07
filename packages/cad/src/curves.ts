import type { CadEntity, CadNurbsEntity, CadPoint, CadSplineEntity } from './types';

export interface RationalCurveData {
  poles: CadPoint[];
  weights: number[];
  knots: number[];
  degree: number;
}
type Homogeneous = [number, number, number];
const tau = 2 * Math.PI;
const wrap = (angle: number) => ((angle % tau) + tau) % tau;
export const isNurbsCurve = (entity: CadEntity): entity is CadNurbsEntity => ['conic', 'bezier', 'spline'].includes(entity.type);
export function curveEndpointIds(entity: CadEntity): string[] {
  return entity.type === 'point' || entity.type === 'circle' || (entity.type === 'spline' && entity.closed)
    ? []
    : [entity.startId, entity.endId];
}

export function rationalCurveData(entity: CadNurbsEntity, points: ReadonlyMap<string, CadPoint>): RationalCurveData {
  const point = (id: string) => {
    const p = points.get(id);
    if (!p) throw new Error('Curve references a missing point.');
    return p;
  };
  if (entity.type === 'conic')
    return {
      poles: [point(entity.startId), point(entity.controlId), point(entity.endId)],
      weights: [1, entity.rho / (1 - entity.rho), 1],
      knots: [0, 0, 0, 1, 1, 1],
      degree: 2,
    };
  if (entity.type === 'bezier') {
    const n = entity.controlPointIds.length;
    return {
      poles: entity.controlPointIds.map(point),
      weights: Array(n).fill(1),
      knots: [...Array(n).fill(0), ...Array(n).fill(1)],
      degree: n - 1,
    };
  }
  const ids = entity.closed
    ? [entity.controlPointIds.at(-1)!, ...entity.controlPointIds, entity.controlPointIds[0]!, entity.controlPointIds[1]!]
    : entity.controlPointIds;
  const weights = entity.closed ? [entity.weights.at(-1)!, ...entity.weights, entity.weights[0]!, entity.weights[1]!] : entity.weights;
  return { poles: ids.map(point), weights, knots: entity.knots, degree: entity.degree };
}

function spanAt(knots: number[], degree: number, count: number, u: number): number {
  if (u >= knots[count]!) return count - 1;
  let lo = degree,
    hi = count;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (u < knots[mid]!) hi = mid;
    else lo = mid;
  }
  return lo;
}
function deBoor(poles: Homogeneous[], knots: number[], degree: number, u: number): Homogeneous {
  const k = spanAt(knots, degree, poles.length, u);
  const d = Array.from({ length: degree + 1 }, (_, j) => [...poles[k - degree + j]!] as Homogeneous);
  for (let r = 1; r <= degree; r++)
    for (let j = degree; j >= r; j--) {
      const i = k - degree + j,
        denominator = knots[i + degree - r + 1]! - knots[i]!;
      const alpha = denominator ? (u - knots[i]!) / denominator : 0;
      for (let component = 0; component < 3; component++)
        d[j]![component] = (1 - alpha) * d[j - 1]![component]! + alpha * d[j]![component]!;
    }
  return d[degree]!;
}
const homogeneous = (data: RationalCurveData): Homogeneous[] =>
  data.poles.map((p, i) => [p.x * data.weights[i]!, p.y * data.weights[i]!, data.weights[i]!]);
export function evaluateRationalCurve(data: RationalCurveData, t: number): CadPoint {
  const a = data.knots[data.degree]!,
    b = data.knots[data.poles.length]!;
  const h = deBoor(homogeneous(data), data.knots, data.degree, a + Math.max(0, Math.min(1, t)) * (b - a));
  return { x: h[0] / h[2], y: h[1] / h[2] };
}
export function rationalCurveTangent(data: RationalCurveData, t: number): CadPoint {
  const poles = homogeneous(data),
    degree = data.degree;
  const a = data.knots[degree]!,
    b = data.knots[data.poles.length]!,
    u = a + Math.max(0, Math.min(1, t)) * (b - a);
  const h = deBoor(poles, data.knots, degree, u);
  const derivative = poles.slice(0, -1).map((p, i): Homogeneous => {
    const scale = degree / (data.knots[i + degree + 1]! - data.knots[i + 1]!);
    return p.map((component, j) => (poles[i + 1]![j]! - component) * scale) as Homogeneous;
  });
  const d = deBoor(derivative, data.knots.slice(1, -1), degree - 1, u);
  return { x: ((d[0] * h[2] - h[0] * d[2]) / (h[2] * h[2])) * (b - a), y: ((d[1] * h[2] - h[1] * d[2]) / (h[2] * h[2])) * (b - a) };
}

export function evaluateCurvePoint(
  entity: Exclude<CadEntity, { type: 'point' }>,
  points: ReadonlyMap<string, CadPoint>,
  t: number
): CadPoint {
  if (isNurbsCurve(entity)) return evaluateRationalCurve(rationalCurveData(entity, points), t);
  if (entity.type === 'line') {
    const a = points.get(entity.startId)!,
      b = points.get(entity.endId)!;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  const center = points.get(entity.centerId)!,
    start = entity.type === 'arc' ? entity.startAngle : 0;
  const sweep = entity.type === 'arc' ? wrap(entity.endAngle - start) || tau : tau,
    angle = start + sweep * t;
  return { x: center.x + entity.radius * Math.cos(angle), y: center.y + entity.radius * Math.sin(angle) };
}
export function evaluateCurveTangent(
  entity: Exclude<CadEntity, { type: 'point' }>,
  points: ReadonlyMap<string, CadPoint>,
  t: number
): CadPoint {
  if (isNurbsCurve(entity)) return rationalCurveTangent(rationalCurveData(entity, points), t);
  if (entity.type === 'line') {
    const a = points.get(entity.startId)!,
      b = points.get(entity.endId)!;
    return { x: b.x - a.x, y: b.y - a.y };
  }
  const start = entity.type === 'arc' ? entity.startAngle : 0,
    sweep = entity.type === 'arc' ? wrap(entity.endAngle - start) || tau : tau;
  const angle = start + sweep * t;
  return { x: -entity.radius * Math.sin(angle) * sweep, y: entity.radius * Math.cos(angle) * sweep };
}

/** Normalized finite-curve parameter for source-linked annotations and screen-space snapping. */
export function closestCurvePoint(
  entity: Exclude<CadEntity, { type: 'point' }>,
  points: ReadonlyMap<string, CadPoint>,
  target: CadPoint,
  project?: (p: CadPoint) => CadPoint
): { parameter: number; point: CadPoint; distance: number } {
  const projectPoint = project ?? ((p: CadPoint) => p);
  const at = (parameter: number) => {
    const point = evaluateCurvePoint(entity, points, parameter),
      q = projectPoint(point);
    return { parameter, point, distance: Math.hypot(q.x - target.x, q.y - target.y) };
  };
  // Screen projections are affine. Lines remain segments under every affine transform.
  if (entity.type === 'line') {
    const a = projectPoint(points.get(entity.startId)!),
      b = projectPoint(points.get(entity.endId)!);
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length2 = dx * dx + dy * dy;
    return at(length2 ? Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / length2)) : 0);
  }
  if (entity.type === 'circle' || entity.type === 'arc') {
    const center = points.get(entity.centerId)!,
      c = projectPoint(center);
    const x = projectPoint({ x: center.x + entity.radius, y: center.y }),
      y = projectPoint({ x: center.x, y: center.y + entity.radius });
    const ux = x.x - c.x,
      uy = x.y - c.y,
      vx = y.x - c.x,
      vy = y.y - c.y;
    const xx = ux * ux + uy * uy,
      yy = vx * vx + vy * vy;
    // Uniform scale, rotation, and reflection preserve circle closest points. Elliptic projections use the generic search.
    if (
      !project ||
      (Math.abs(xx - yy) <= 128 * Number.EPSILON * Math.max(xx, yy) &&
        Math.abs(ux * vx + uy * vy) <= 128 * Number.EPSILON * Math.max(xx, yy))
    ) {
      const angle = Math.atan2((target.x - c.x) * vx + (target.y - c.y) * vy, (target.x - c.x) * ux + (target.y - c.y) * uy);
      if (entity.type === 'circle') return at(wrap(angle) / tau);
      const sweep = wrap(entity.endAngle - entity.startAngle) || tau,
        delta = wrap(angle - entity.startAngle);
      if (delta <= sweep) return at(delta / sweep);
      const a = at(0),
        b = at(1);
      return a.distance <= b.distance ? a : b;
    }
  }
  const steps = 256,
    samples = Array.from({ length: steps + 1 }, (_, i) => at(i / steps));
  let best = samples[0]!;
  for (let i = 0; i <= steps; i++) {
    const sample = samples[i]!;
    if (sample.distance < best.distance) best = sample;
    if ((i > 0 && sample.distance > samples[i - 1]!.distance) || (i < steps && sample.distance > samples[i + 1]!.distance)) continue;
    let lo = Math.max(0, (i - 1) / steps),
      hi = Math.min(1, (i + 1) / steps);
    for (let j = 0; j < 36; j++) {
      const a = lo + (hi - lo) / 3,
        b = hi - (hi - lo) / 3;
      if (at(a).distance < at(b).distance) hi = b;
      else lo = a;
    }
    const refined = at((lo + hi) / 2);
    if (refined.distance < best.distance) best = refined;
  }
  return best;
}

const distanceToSegment = (p: CadPoint, a: CadPoint, b: CadPoint) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
export function tessellateRationalCurve(data: RationalCurveData, tolerance = 0.01): CadPoint[] {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new Error('Curve tolerance must be finite and positive.');
  const result: CadPoint[] = [evaluateRationalCurve(data, 0)];
  const split = (controls: Homogeneous[], depth: number) => {
    const cartesian = controls.map(p => ({ x: p[0] / p[2], y: p[1] / p[2] }));
    // Positive rational weights give a convex-hull bound, including high-degree inflections
    // which midpoint-only sampling can miss entirely.
    if (cartesian.every(p => distanceToSegment(p, cartesian[0]!, cartesian.at(-1)!) <= tolerance)) {
      result.push(cartesian.at(-1)!);
      return;
    }
    if (depth >= 20 || result.length > 65536) throw new Error('Curve is too complex to tessellate at the required tolerance.');
    const left = [controls[0]!],
      right = [controls.at(-1)!];
    let row = controls;
    while (row.length > 1) {
      row = row.slice(0, -1).map((p, i) => p.map((v, j) => (v + row[i + 1]![j]!) / 2) as Homogeneous);
      left.push(row[0]!);
      right.unshift(row.at(-1)!);
    }
    split(left, depth + 1);
    split(right, depth + 1);
  };
  for (const span of rationalBezierSpans(data)) split(span.controls, 0);
  return result;
}
export interface RationalBezierSpan {
  controls: Homogeneous[];
  start: number;
  end: number;
}
export function rationalBezierSpans(data: RationalCurveData): RationalBezierSpan[] {
  const lo = data.knots[data.degree]!,
    hi = data.knots[data.poles.length]!;
  const breaks = [...new Set(data.knots.filter(k => k >= lo && k <= hi))],
    poles = homogeneous(data);
  const result: RationalBezierSpan[] = [];
  for (let i = 1; i < breaks.length; i++) {
    const a = breaks[i - 1]!,
      b = breaks[i]!;
    if (breaks.length === 2) {
      result.push({ controls: poles, start: 0, end: 1 });
      continue;
    }
    // A B-spline is a polynomial in homogeneous space on each knot span. Extract
    // its exact Bézier hull (our fit splines have degree <=3), then use the same bound.
    const d = data.degree,
      values = Array.from({ length: d + 1 }, (_, j) => deBoor(poles, data.knots, d, a + ((b - a) * j) / d));
    const choose = (n: number, k: number) => {
      let v = 1;
      for (let j = 1; j <= k; j++) v = (v * (n - j + 1)) / j;
      return v;
    };
    const matrix = values.map((_, j) => Array.from({ length: d + 1 }, (_, k) => choose(d, k) * (j / d) ** k * (1 - j / d) ** (d - k)));
    const xy = solveCoordinates(
      matrix,
      values.map(p => ({ x: p[0], y: p[1] }))
    );
    const w = solveCoordinates(
      matrix,
      values.map(p => ({ x: p[2], y: 0 }))
    );
    result.push({ controls: xy.map((p, j) => [p.x, p.y, w[j]!.x]), start: (a - lo) / (hi - lo), end: (b - lo) / (hi - lo) });
  }
  return result;
}

export function tessellateCurve(
  entity: Exclude<CadEntity, { type: 'point' }>,
  points: ReadonlyMap<string, CadPoint>,
  tolerance = 0.01
): CadPoint[] {
  if (isNurbsCurve(entity)) return tessellateRationalCurve(rationalCurveData(entity, points), tolerance);
  if (entity.type === 'line') return [points.get(entity.startId)!, points.get(entity.endId)!];
  const sweep = entity.type === 'arc' ? wrap(entity.endAngle - entity.startAngle) || tau : tau;
  const count = Math.max(4, Math.min(65536, Math.ceil(sweep / (2 * Math.acos(Math.max(-1, 1 - tolerance / entity.radius))))));
  return Array.from({ length: count + 1 }, (_, i) => evaluateCurvePoint(entity, points, i / count));
}

function solveCoordinates(matrix: number[][], points: CadPoint[]): CadPoint[] {
  const n = matrix.length,
    a = matrix.map((row, i) => [...row, points[i]!.x, points[i]!.y]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i]![k]!) > Math.abs(a[pivot]![k]!)) pivot = i;
    if (Math.abs(a[pivot]![k]!) < 1e-12) throw new Error('Spline fit points are too close together.');
    [a[k], a[pivot]] = [a[pivot]!, a[k]!];
    const scale = a[k]![k]!;
    for (let j = k; j < n + 2; j++) a[k]![j] = a[k]![j]! / scale;
    for (let i = 0; i < n; i++)
      if (i !== k) {
        const factor = a[i]![k]!;
        for (let j = k; j < n + 2; j++) a[i]![j] = a[i]![j]! - factor * a[k]![j]!;
      }
  }
  return a.map(row => ({ x: row[n]!, y: row[n + 1]! }));
}
function basisRow(knots: number[], degree: number, count: number, u: number): number[] {
  const span = spanAt(knots, degree, count, u),
    basis = Array(degree + 1).fill(0),
    left = Array(degree + 1).fill(0),
    right = Array(degree + 1).fill(0);
  basis[0] = 1;
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j]!;
    right[j] = knots[span + j]! - u;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const denominator = right[r + 1]! + left[j - r]!,
        temp = denominator ? basis[r]! / denominator : 0;
      basis[r] = saved + right[r + 1]! * temp;
      saved = left[j - r]! * temp;
    }
    basis[j] = saved;
  }
  const row = Array(count).fill(0);
  for (let j = 0; j <= degree; j++) row[span - degree + j] = basis[j]!;
  return row;
}
export function fitSplineData(points: readonly CadPoint[], closed = false): RationalCurveData & { parameters: number[] } {
  const n = points.length;
  if (n < (closed ? 3 : 2) || n > 64 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('A spline needs 2–64 finite fit points (at least 3 when closed).');
  if (closed) {
    const matrix = Array.from({ length: n }, (_, i) => {
      const row = Array(n).fill(0);
      row[i] = 4 / 6;
      row[(i + n - 1) % n] += 1 / 6;
      row[(i + 1) % n] += 1 / 6;
      return row;
    });
    const controls = solveCoordinates(matrix, [...points]);
    return {
      poles: controls,
      weights: Array(n).fill(1),
      degree: 3,
      knots: Array.from({ length: n + 7 }, (_, i) => i - 3),
      parameters: points.map((_, i) => i / n),
    };
  }
  const degree = 3,
    distances = points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
  if (distances.some(d => d < 1e-7)) throw new Error('Choose distinct consecutive spline fit points.');
  const total = distances.reduce((sum, d) => sum + d, 0),
    parameters = [0];
  for (const d of distances) parameters.push(parameters.at(-1)! + d / total);
  parameters[n - 1] = 1;
  const count = n + 2,
    knots = [0, 0, 0, 0, ...parameters.slice(1, -1), 1, 1, 1, 1];
  const naturalStart = Array(count).fill(0),
    naturalEnd = Array(count).fill(0);
  const a = knots[4]!,
    b = knots[5]!;
  naturalStart[0] = 1 / a;
  naturalStart[1] = -1 / a - 1 / b;
  naturalStart[2] = 1 / b;
  const c = 1 - knots[count - 1]!,
    d = 1 - knots[count - 2]!;
  naturalEnd[count - 1] = 1 / c;
  naturalEnd[count - 2] = -1 / c - 1 / d;
  naturalEnd[count - 3] = 1 / d;
  const normalize = (row: number[]) => {
    const scale = Math.max(...row.map(Math.abs));
    return row.map(v => v / scale);
  };
  const poles = solveCoordinates(
    [...parameters.map(u => basisRow(knots, degree, count, u)), normalize(naturalStart), normalize(naturalEnd)],
    [...points, { x: 0, y: 0 }, { x: 0, y: 0 }]
  );
  // Natural curvature only initializes the handles. The native fit equations retain
  // their four scalar tangent-handle freedoms for subsequent independent editing.
  return { poles, weights: Array(count).fill(1), knots, degree, parameters };
}

export function splineNativePoleIds(entity: CadSplineEntity): string[] {
  // Native periodic BSpline owns the unpadded ring; its evaluator pads knots and
  // wraps poles itself. Source evaluation keeps an explicit equivalent padded basis.
  return entity.closed ? [entity.controlPointIds.at(-1)!, ...entity.controlPointIds.slice(0, -1)] : entity.controlPointIds;
}

/** Boehm knot insertion increases editable freedom without moving the analytic curve. */
export function insertRationalKnot(data: RationalCurveData, parameter: number): RationalCurveData & { insertedIndex: number } {
  if (!Number.isFinite(parameter) || parameter <= 0 || parameter >= 1) throw new Error('Choose an interior point on the spline.');
  const p = data.degree,
    n = data.poles.length - 1,
    a = data.knots[p]!,
    b = data.knots[n + 1]!,
    u = a + parameter * (b - a),
    k = spanAt(data.knots, p, n + 1, u),
    s = data.knots.filter(value => Math.abs(value - u) < 1e-12).length;
  if (s >= p) throw new Error('That spline knot already has its maximum multiplicity.');
  const old = homogeneous(data),
    next: Homogeneous[] = Array(n + 2);
  for (let i = 0; i <= k - p; i++) next[i] = old[i]!;
  for (let i = k - s; i <= n; i++) next[i + 1] = old[i]!;
  for (let i = k - p + 1; i <= k - s; i++) {
    const alpha = (u - data.knots[i]!) / (data.knots[i + p]! - data.knots[i]!);
    next[i] = old[i]!.map((v, j) => alpha * v + (1 - alpha) * old[i - 1]![j]!) as Homogeneous;
  }
  return {
    poles: next.map(h => ({ x: h[0] / h[2], y: h[1] / h[2] })),
    weights: next.map(h => h[2]),
    degree: p,
    knots: [...data.knots.slice(0, k + 1), u, ...data.knots.slice(k + 1)],
    insertedIndex: k - s,
  };
}

/** Exact homogeneous degree elevation adds one Bézier control without changing its shape. */
export function elevateBezierData(data: RationalCurveData): RationalCurveData {
  const n = data.degree;
  if (n >= 15) throw new Error('Bézier degree cannot exceed 15.');
  const old = homogeneous(data),
    next = [old[0]!];
  for (let i = 1; i <= n; i++) {
    const alpha = i / (n + 1);
    next.push(old[i - 1]!.map((v, j) => alpha * v + (1 - alpha) * old[i]![j]!) as Homogeneous);
  }
  next.push(old.at(-1)!);
  return {
    poles: next.map(h => ({ x: h[0] / h[2], y: h[1] / h[2] })),
    weights: next.map(h => h[2]),
    degree: n + 1,
    knots: [...Array(n + 2).fill(0), ...Array(n + 2).fill(1)],
  };
}
