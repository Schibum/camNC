import {
  closestCurvePoint,
  curveEndpointIds,
  isNurbsCurve,
  rationalBezierSpans,
  rationalCurveData,
  type RationalBezierSpan,
} from './curves';
import type { CadEntity, CadPoint, NewCadConstraint } from './types';
import type { CadPointEquivalence } from './pointEquivalence';
type Curve = Exclude<CadEntity, { type: 'point' }>;
type H = RationalBezierSpan['controls'][number];
const tau = 2 * Math.PI;
const xy = (p: H): CadPoint => ({ x: p[0] / p[2], y: p[1] / p[2] });
function spans(curve: Curve, points: ReadonlyMap<string, CadPoint>): H[][] {
  if (isNurbsCurve(curve)) return rationalBezierSpans(rationalCurveData(curve, points)).map(span => span.controls);
  if (curve.type === 'line') return [[points.get(curve.startId)!, points.get(curve.endId)!].map(p => [p.x, p.y, 1])];
  const c = points.get(curve.centerId)!,
    start = curve.type === 'arc' ? curve.startAngle : 0;
  const sweep = curve.type === 'arc' ? (((curve.endAngle - start) % tau) + tau) % tau || tau : tau,
    count = Math.ceil(sweep / (Math.PI / 2));
  return Array.from({ length: count }, (_, i) => {
    const a = start + (sweep * i) / count,
      b = start + (sweep * (i + 1)) / count,
      m = (a + b) / 2,
      w = Math.cos((b - a) / 2),
      r = curve.radius;
    return [
      [c.x + r * Math.cos(a), c.y + r * Math.sin(a), 1],
      [c.x * w + r * Math.cos(m), c.y * w + r * Math.sin(m), w],
      [c.x + r * Math.cos(b), c.y + r * Math.sin(b), 1],
    ];
  });
}
const bounds = (controls: H[]) => {
  const p = controls.map(xy),
    xs = p.map(p => p.x),
    ys = p.map(p => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
function halves(controls: H[]): [H[], H[]] {
  const a = [controls[0]!],
    b = [controls.at(-1)!];
  let row = controls;
  while (row.length > 1) {
    row = row.slice(0, -1).map((p, i) => p.map((v, j) => (v + row[i + 1]![j]!) / 2) as H);
    a.push(row[0]!);
    b.unshift(row.at(-1)!);
  }
  return [a, b];
}

/** A roundoff-sized endpoint sliver belongs to its real joined vertex, not another cut intersection. */
export function isNumericalJoinedEndpointContact(
  a: Curve,
  b: Curve,
  contact: CadPoint,
  points: ReadonlyMap<string, CadPoint>,
  equivalent: CadPointEquivalence,
  tolerance: number
): boolean {
  const line = a.type === 'line' ? a : b.type === 'line' ? b : undefined;
  const curve = line === a ? b : a;
  if (!line || !isNurbsCurve(curve)) return false;
  const lineEnds = [line.startId, line.endId];
  const curveEnds = curveEndpointIds(curve);
  const pieces = rationalBezierSpans(rationalCurveData(curve, points));
  for (let end = 0; end < curveEnds.length; end++) {
    const id = curveEnds[end]!;
    const lineEnd = lineEnds.findIndex(other => equivalent.equivalent(id, other));
    if (lineEnd < 0) continue;
    const shared = points.get(id)!,
      origin = points.get(lineEnds[lineEnd]!)!,
      other = points.get(lineEnds[1 - lineEnd]!)!;
    if (Math.hypot(shared.x - origin.x, shared.y - origin.y) > tolerance) continue;
    const length = Math.hypot(other.x - origin.x, other.y - origin.y);
    if (length <= tolerance) continue;
    const ux = (other.x - origin.x) / length,
      uy = (other.y - origin.y) / length;
    let prefix = end === 0 ? pieces[0]!.controls : [...pieces.at(-1)!.controls].reverse();
    // Coordinate arithmetic sets this bound; it never grows beyond the existing model tolerance.
    const scale = Math.max(
      1,
      length,
      Math.abs(origin.x),
      Math.abs(origin.y),
      Math.abs(other.x),
      Math.abs(other.y),
      ...prefix.flatMap(control => {
        const p = xy(control);
        return [Math.abs(p.x), Math.abs(p.y)];
      })
    );
    const roundoff = Math.min(tolerance, 64 * Number.EPSILON * scale);
    const along = (p: CadPoint) => (p.x - origin.x) * ux + (p.y - origin.y) * uy;
    const target = along(contact);
    if (target < -roundoff) continue;
    for (let depth = 0; depth < 64; depth++) {
      const polygon = prefix.map(xy),
        projections = polygon.map(along);
      const monotone = projections.every((value, i) => i === 0 || value >= projections[i - 1]! - roundoff);
      const flat = polygon.every(p => Math.abs((p.x - origin.x) * uy - (p.y - origin.y) * ux) <= roundoff);
      // Positive rational weights keep the complete prefix in this hull. Its monotone
      // projection proves this is the endpoint-connected piece reaching the contact.
      if (flat && monotone && target <= projections.at(-1)! + roundoff) return true;
      if (monotone && target > projections.at(-1)! + roundoff) break;
      prefix = halves(prefix)[0];
    }
  }
  return false;
}
/** Exact positive rational hull subdivision catches tangencies which inscribed export polylines miss. */
export function rationalCurveContacts(a: Curve, b: Curve, points: ReadonlyMap<string, CadPoint>, tolerance = 1e-6): CadPoint[] {
  const result: CadPoint[] = [];
  let workingPoints = points;
  let restore = (p: CadPoint) => p;
  const line = a.type === 'line' ? a : b.type === 'line' ? b : undefined;
  const rational = line === a ? b : a;
  if (line && isNurbsCurve(rational)) {
    const origin = points.get(line.startId)!,
      end = points.get(line.endId)!,
      length = Math.hypot(end.x - origin.x, end.y - origin.y);
    if (length > 0) {
      const ux = (end.x - origin.x) / length,
        uy = (end.y - origin.y) / length;
      const ids = new Set([
        line.startId,
        line.endId,
        ...(rational.type === 'conic' ? [rational.startId, rational.controlId, rational.endId] : rational.controlPointIds),
      ]);
      // A diagonal line's axis-aligned boxes overlap a near-tangent prefix at every
      // subdivision. The same rigid line frame avoids that artificial explosion.
      workingPoints = new Map(
        [...ids].map(id => {
          const p = points.get(id)!,
            dx = p.x - origin.x,
            dy = p.y - origin.y;
          return [id, { x: dx * ux + dy * uy, y: -dx * uy + dy * ux }];
        })
      );
      restore = p => ({ x: origin.x + p.x * ux - p.y * uy, y: origin.y + p.x * uy + p.y * ux });
    }
  }
  let visits = 0;
  const add = (p: CadPoint) => {
    if (!result.some(q => Math.hypot(p.x - q.x, p.y - q.y) < tolerance / 2)) result.push(p);
  };
  const visit = (a: H[], b: H[], depth: number) => {
    if (++visits > 100000) throw Error('Curve contact analysis exceeded its safe complexity limit.');
    const p = bounds(a),
      q = bounds(b);
    if (p.x1 < q.x0 || q.x1 < p.x0 || p.y1 < q.y0 || q.y1 < p.y0) return;
    const sizeA = Math.max(p.x1 - p.x0, p.y1 - p.y0),
      sizeB = Math.max(q.x1 - q.x0, q.y1 - q.y0);
    if (Math.max(sizeA, sizeB) < tolerance / 8 || depth >= 100) {
      add({ x: (Math.max(p.x0, q.x0) + Math.min(p.x1, q.x1)) / 2, y: (Math.max(p.y0, q.y0) + Math.min(p.y1, q.y1)) / 2 });
      return;
    }
    if (
      a.length === b.length &&
      (a.every((v, i) => Math.hypot(xy(v).x - xy(b[i]!).x, xy(v).y - xy(b[i]!).y) < tolerance / 16) ||
        a.every((v, i) => Math.hypot(xy(v).x - xy(b[b.length - 1 - i]!).x, xy(v).y - xy(b[b.length - 1 - i]!).y) < tolerance / 16))
    ) {
      add(xy(a[0]!));
      add(xy(a.at(-1)!));
      const half = halves(a)[0];
      add(xy(half.at(-1)!));
      return;
    }
    if (sizeA >= sizeB) {
      for (const half of halves(a)) visit(half, b, depth + 1);
    } else for (const half of halves(b)) visit(a, half, depth + 1);
  };
  for (const left of spans(a, workingPoints)) for (const right of spans(b, workingPoints)) visit(left, right, 0);
  return result.map(restore);
}

const distance = (a: CadPoint, b: CadPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const wrap = (angle: number) => ((angle % tau) + tau) % tau;
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
function onFiniteArc(point: CadPoint, curve: Curve, points: ReadonlyMap<string, CadPoint>, tolerance: number): boolean {
  if (curve.type !== 'arc') return true;
  const center = points.get(curve.centerId)!;
  const delta = wrap(Math.atan2(point.y - center.y, point.x - center.x) - curve.startAngle);
  const sweep = wrap(curve.endAngle - curve.startAngle) || tau;
  return delta <= sweep + tolerance / curve.radius || tau - delta <= tolerance / curve.radius;
}

/** Finite-curve contacts use one absolute model-space tolerance, never display tessellation or parameter fractions. */
function finiteContactPoints(a: Curve, b: Curve, points: ReadonlyMap<string, CadPoint>, tolerance: number): CadPoint[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Curve contact tolerance must be finite and positive.');
  let contacts: CadPoint[] = [];
  if (isNurbsCurve(a) || isNurbsCurve(b)) contacts = rationalCurveContacts(a, b, points, tolerance);
  else if (a.type === 'line' && b.type === 'line') {
    const p = points.get(a.startId)!,
      q = points.get(a.endId)!,
      r = points.get(b.startId)!,
      s = points.get(b.endId)!;
    const ax = q.x - p.x,
      ay = q.y - p.y,
      bx = s.x - r.x,
      by = s.y - r.y;
    const lengthA = Math.hypot(ax, ay),
      lengthB = Math.hypot(bx, by);
    if (lengthA <= tolerance || lengthB <= tolerance) return [];
    const dx = r.x - p.x,
      dy = r.y - p.y,
      determinant = cross(ax, ay, bx, by);
    if (Math.abs(determinant) <= tolerance * Math.max(lengthA, lengthB)) {
      if (Math.abs(cross(dx, dy, ax, ay)) > tolerance * lengthA) return [];
      for (const point of [p, q, r, s]) {
        const ta = ((point.x - p.x) * ax + (point.y - p.y) * ay) / (lengthA * lengthA);
        const tb = ((point.x - r.x) * bx + (point.y - r.y) * by) / (lengthB * lengthB);
        if (ta >= -tolerance / lengthA && ta <= 1 + tolerance / lengthA && tb >= -tolerance / lengthB && tb <= 1 + tolerance / lengthB)
          contacts.push(point);
      }
    } else {
      const ta = cross(dx, dy, bx, by) / determinant,
        tb = cross(dx, dy, ax, ay) / determinant;
      if (ta >= -tolerance / lengthA && ta <= 1 + tolerance / lengthA && tb >= -tolerance / lengthB && tb <= 1 + tolerance / lengthB)
        contacts.push({ x: p.x + Math.max(0, Math.min(1, ta)) * ax, y: p.y + Math.max(0, Math.min(1, ta)) * ay });
    }
  } else {
    if (b.type === 'line') return finiteContactPoints(b, a, points, tolerance);
    const centerB = points.get(b.centerId)!;
    if (a.type === 'line') {
      const p = points.get(a.startId)!,
        q = points.get(a.endId)!;
      const length = distance(p, q);
      if (length <= tolerance) return [];
      const ux = (q.x - p.x) / length,
        uy = (q.y - p.y) / length;
      const cx = centerB.x - p.x,
        cy = centerB.y - p.y;
      const along = cx * ux + cy * uy,
        perpendicular = Math.abs(cx * uy - cy * ux);
      if (perpendicular > b.radius + tolerance) return [];
      const roundoff =
        32 *
        Number.EPSILON *
        Math.max(1, b.radius, length, Math.abs(centerB.x), Math.abs(centerB.y), Math.abs(p.x), Math.abs(p.y), Math.abs(q.x), Math.abs(q.y));
      const halfChord =
        Math.abs(b.radius - perpendicular) <= roundoff
          ? 0
          : Math.sqrt(Math.max(0, (b.radius - perpendicular) * (b.radius + perpendicular)));
      for (const offset of [along - halfChord, along + halfChord])
        if (offset >= -tolerance && offset <= length + tolerance) contacts.push({ x: p.x + offset * ux, y: p.y + offset * uy });
    } else {
      const centerA = points.get(a.centerId)!,
        d = distance(centerA, centerB),
        r = a.radius,
        s = b.radius;
      if (d <= tolerance) {
        if (Math.abs(r - s) <= tolerance) {
          contacts = [...curveEndpointIds(a), ...curveEndpointIds(b)].map(id => points.get(id)!);
        }
      } else if (d <= r + s + tolerance && d >= Math.abs(r - s) - tolerance) {
        const along = ((r - s) * (r + s) + d * d) / (2 * d);
        const roundoff =
          32 * Number.EPSILON * Math.max(1, r, s, d, Math.abs(centerA.x), Math.abs(centerA.y), Math.abs(centerB.x), Math.abs(centerB.y));
        const tangent = Math.abs(d - r - s) <= roundoff || Math.abs(d - Math.abs(r - s)) <= roundoff;
        const height = tangent ? 0 : Math.sqrt(Math.max(0, (r + s - d) * (r + s + d) * (d - r + s) * (d + r - s))) / (2 * d);
        const ux = (centerB.x - centerA.x) / d,
          uy = (centerB.y - centerA.y) / d;
        const x = centerA.x + along * ux,
          y = centerA.y + along * uy;
        contacts.push({ x: x - height * uy, y: y + height * ux }, { x: x + height * uy, y: y - height * ux });
      }
    }
  }
  const distinct: CadPoint[] = [];
  for (const point of contacts)
    if (
      onFiniteArc(point, a, points, tolerance) &&
      onFiniteArc(point, b, points, tolerance) &&
      !distinct.some(previous => distance(previous, point) <= tolerance)
    )
      distinct.push(point);
  return distinct;
}

export interface CadCurveContacts {
  points: CadPoint[];
  /** Proven coincident supports have a shared interval, rather than isolated trim boundaries. */
  overlap: boolean;
}

function rationalLinearOverlap(
  line: Extract<Curve, { type: 'line' }>,
  rational: Curve,
  points: ReadonlyMap<string, CadPoint>,
  tolerance: number
): boolean {
  if (!isNurbsCurve(rational)) return false;
  const a = points.get(line.startId)!,
    b = points.get(line.endId)!;
  const length = distance(a, b);
  if (length <= tolerance) return false;
  const ux = (b.x - a.x) / length,
    uy = (b.y - a.y) / length;
  return rationalBezierSpans(rationalCurveData(rational, points)).some(span => {
    // A positive rational curve is on this support only if every Bernstein control is on it.
    if (
      !span.controls.every(control => {
        const p = xy(control);
        const roundoff = 32 * Number.EPSILON * (Math.abs(p.x) + Math.abs(p.y) + Math.abs(a.x) + Math.abs(a.y) + length);
        return Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux) <= roundoff;
      })
    )
      return false;
    // Actual curve points prove an interval by continuity, even with an overshooting control polygon.
    const samples = [span.controls[0]!, halves(span.controls)[0].at(-1)!, span.controls.at(-1)!].map(control => {
      const p = xy(control);
      return (p.x - a.x) * ux + (p.y - a.y) * uy;
    });
    return Math.min(length, Math.max(...samples)) - Math.max(0, Math.min(...samples)) > tolerance;
  });
}

function circularIntervalsOverlap(
  startA: number,
  sweepA: number,
  startB: number,
  sweepB: number,
  radius: number,
  tolerance: number
): boolean {
  const angles = [...new Set([0, wrap(startA), wrap(startA + sweepA), wrap(startB), wrap(startB + sweepB)])].sort((a, b) => a - b);
  return angles.some((angle, i) => {
    const next = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + tau;
    if ((next - angle) * radius <= tolerance) return false;
    const middle = (angle + next) / 2;
    return wrap(middle - startA) < sweepA && wrap(middle - startB) < sweepB;
  });
}
const binomial = (n: number, k: number): number => {
  let result = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) result = (result * (n - i + 1)) / i;
  return result;
};

/** Test the complete implicit-circle polynomial, not a finite set of samples on the curve. */
function rationalCircularOverlap(
  circular: Extract<Curve, { type: 'circle' | 'arc' }>,
  rational: Curve,
  points: ReadonlyMap<string, CadPoint>,
  tolerance: number
): boolean {
  if (!isNurbsCurve(rational)) return false;
  const center = points.get(circular.centerId)!;
  return rationalBezierSpans(rationalCurveData(rational, points)).some(span => {
    const controls = span.controls.map(([x, y, w]) => [x - center.x * w, y - center.y * w, w] as H);
    const errors = span.controls.map(([x, y, w]) => [
      4 * Number.EPSILON * (Math.abs(x) + Math.abs(center.x * w)),
      4 * Number.EPSILON * (Math.abs(y) + Math.abs(center.y * w)),
    ]);
    const n = controls.length - 1;
    // Bernstein products give every coefficient of X² + Y² - radius² W².
    for (let k = 0; k <= 2 * n; k++) {
      let residual = 0,
        magnitude = 0,
        roundoff = 0;
      for (let i = Math.max(0, k - n); i <= Math.min(n, k); i++) {
        const a = controls[i]!,
          b = controls[k - i]!;
        const factor = (binomial(n, i) * binomial(n, k - i)) / binomial(2 * n, k);
        const terms = [a[0] * b[0], a[1] * b[1], -circular.radius * circular.radius * a[2] * b[2]];
        residual += factor * terms.reduce((sum, term) => sum + term, 0);
        magnitude += factor * terms.reduce((sum, term) => sum + Math.abs(term), 0);
        for (const axis of [0, 1] as const)
          roundoff +=
            factor *
            (Math.abs(a[axis]) * errors[k - i]![axis]! + Math.abs(b[axis]) * errors[i]![axis]! + errors[i]![axis]! * errors[k - i]![axis]!);
      }
      if (!Number.isFinite(residual) || Math.abs(residual) > 128 * Number.EPSILON * magnitude + roundoff) return false;
    }
    const a = xy(span.controls[0]!),
      b = xy(span.controls.at(-1)!);
    if (distance(a, b) <= tolerance) return false;
    const middle = xy(halves(span.controls)[0].at(-1)!);
    const angle = (p: CadPoint) => Math.atan2(p.y - center.y, p.x - center.x);
    const start = angle(a),
      end = angle(b),
      sweep = wrap(end - start);
    const forward = wrap(angle(middle) - start) <= sweep;
    return circularIntervalsOverlap(
      circular.type === 'arc' ? circular.startAngle : 0,
      circular.type === 'arc' ? wrap(circular.endAngle - circular.startAngle) || tau : tau,
      forward ? start : end,
      forward ? sweep : tau - sweep,
      circular.radius,
      tolerance
    );
  });
}

/** Contact topology keeps overlapping supports distinct from isolated intersection points. */
export function curveContacts(a: Curve, b: Curve, points: ReadonlyMap<string, CadPoint>, tolerance: number): CadCurveContacts {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Curve contact tolerance must be finite and positive.');
  if (a.type === 'line' && b.type === 'line') {
    const p = points.get(a.startId)!,
      q = points.get(a.endId)!,
      r = points.get(b.startId)!,
      s = points.get(b.endId)!;
    const dx = q.x - p.x,
      dy = q.y - p.y,
      length = Math.hypot(dx, dy);
    if (
      length > tolerance &&
      Math.abs(dx * (r.y - p.y) - dy * (r.x - p.x)) / length <= tolerance &&
      Math.abs(dx * (s.y - p.y) - dy * (s.x - p.x)) / length <= tolerance
    ) {
      const project = (point: CadPoint) => ((point.x - p.x) * dx + (point.y - p.y) * dy) / length;
      const first = project(r),
        second = project(s);
      const overlap = Math.min(length, Math.max(first, second)) - Math.max(0, Math.min(first, second)) > tolerance;
      return { points: finiteContactPoints(a, b, points, tolerance), overlap };
    }
  }
  if (
    (a.type === 'line' && rationalLinearOverlap(a, b, points, tolerance)) ||
    (b.type === 'line' && rationalLinearOverlap(b, a, points, tolerance))
  )
    return { points: [], overlap: true };
  if (
    ((a.type === 'circle' || a.type === 'arc') && rationalCircularOverlap(a, b, points, tolerance)) ||
    ((b.type === 'circle' || b.type === 'arc') && rationalCircularOverlap(b, a, points, tolerance))
  )
    return { points: [], overlap: true };
  if ((a.type === 'circle' || a.type === 'arc') && (b.type === 'circle' || b.type === 'arc')) {
    const centerA = points.get(a.centerId)!,
      centerB = points.get(b.centerId)!;
    if (distance(centerA, centerB) <= tolerance && Math.abs(a.radius - b.radius) <= tolerance) {
      const endpoints = [...curveEndpointIds(a), ...curveEndpointIds(b)].map(id => points.get(id)!);
      const contacts = endpoints.filter(
        (point, i) =>
          onFiniteArc(point, a, points, tolerance) &&
          onFiniteArc(point, b, points, tolerance) &&
          !endpoints.slice(0, i).some(previous => distance(previous, point) <= tolerance)
      );
      const angles = [...new Set([0, ...endpoints.map(point => wrap(Math.atan2(point.y - centerA.y, point.x - centerA.x)))])].sort(
        (x, y) => x - y
      );
      const overlap = angles.some((angle, i) => {
        const next = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + tau;
        if ((next - angle) * a.radius <= tolerance) return false;
        const middle = (angle + next) / 2;
        const point = { x: centerA.x + a.radius * Math.cos(middle), y: centerA.y + a.radius * Math.sin(middle) };
        return onFiniteArc(point, a, points, tolerance) && onFiniteArc(point, b, points, tolerance);
      });
      return { points: contacts, overlap };
    }
  }
  return { points: finiteContactPoints(a, b, points, tolerance), overlap: false };
}

/** Discrete finite-curve contacts only: overlapping circles never manufacture arbitrary cardinal boundaries. */
export function curveContactPoints(a: Curve, b: Curve, points: ReadonlyMap<string, CadPoint>, tolerance: number): CadPoint[] {
  return curveContacts(a, b, points, tolerance).points;
}

/** A trim endpoint remains attached to its boundary curve without fixing a NURBS parameter. */
export function constraintForCurveContact(
  pointId: string,
  curve: Curve,
  points: ReadonlyMap<string, CadPoint>,
  point: CadPoint
): Extract<NewCadConstraint, { pointId: string; entityId: string }> {
  if (curve.type === 'line') return { type: 'pointOnLine', pointId, entityId: curve.id };
  if (curve.type === 'circle' || curve.type === 'arc') return { type: 'pointOnCircle', pointId, entityId: curve.id };
  return { type: 'pointOnCurve', pointId, entityId: curve.id, parameter: closestCurvePoint(curve, points, point).parameter };
}
