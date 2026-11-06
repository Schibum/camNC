import { difference, intersect, polyArea, union, unionMany, type PathD, type PathsD, type Pt, type Vec3 } from './geom';

const kGridGuard = 0.0002;
const kEpsilon = 1e-9;
type Interval = readonly [number, number];
interface Sweep {
  from: Vec3;
  to: Vec3;
  radius: number;
  /** Original commanded endpoint and cutter, retained only to anchor continuous cutting motion. */
  occupiedPose: Vec3;
  cutterRadius: number;
}

export interface StockOptions {
  stockTop: number;
  /** Initial material footprint, with holes; omit to conservatively assume material everywhere. */
  footprint?: PathsD;
  /** Maximum circle approximation error, mm. Smaller values give tighter, slower certificates. */
  tolerance?: number;
  /** Reserved deviation of previously cut and proposed paths from the supplied centerlines. */
  pathTolerance?: number;
  /** Reserved Z uncertainty; defaults to pathTolerance. Zero requires independently exact Z motion. */
  verticalTolerance?: number;
}

export interface LinkCertificate {
  clear: boolean;
  reason: 'above-stock' | 'previous-sweep' | 'swept-region' | 'uncleared';
  /** The deepest point is used for the entire link, making sloping links conservative. */
  depthPlane: number;
  /** Conservative area not proved clear; zero for an analytic previous-sweep proof. */
  unclearedArea: number;
}

export interface MoveEngagement {
  length: number;
  /** Upper bounds at the move's deepest plane, not a peak angular engagement estimate. */
  sweptArea: number;
  newArea: number;
  averageWidth: number;
}

export interface PocketTransitionPolicy {
  /** Actual removable pocket, with retained islands represented by its inner boundaries. */
  region: PathsD;
  maximumStepover: number;
  cutFeed: number;
  transitionFeed: number;
  /** Additional radial material retained by roughing transitions. */
  wallAllowance?: number;
}

export interface CuttingTransitionCertificate {
  allowed: boolean;
  reason: 'bounded-cut' | 'pose-unproven' | 'depth-change' | 'stepover-exceeded' | 'outside-pocket';
  /** Radial penetration from the currently occupied disk, including independent XY endpoint deviations. */
  maximumImmersion: number;
  /** Full-slot translated-disk frontier bound, not an angular engagement estimate. */
  maximumFrontierWidth: number;
  feed: number;
}

function finitePoint(point: Vec3): void {
  if (point.length !== 3 || point.some(value => !Number.isFinite(value))) throw new Error('Stock paths require finite XYZ points');
}

function positiveRadius(radius: number): void {
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Cutter radius must be positive and finite');
}

function hull(points: Pt[]): PathD {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: Pt[] = [],
    upper: Pt[] = [];
  for (const point of sorted) {
    while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  for (const point of sorted.reverse()) {
    while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** A polygon strictly inside a removed capsule, or outside a proposed cutter capsule. */
export function sweptCapsule(from: Pt, to: Pt, radius: number, tolerance = 0.01, side: 'inner' | 'outer' = 'outer'): PathD {
  positiveRadius(radius);
  if (!Number.isFinite(from.x + from.y + to.x + to.y) || !Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error('Invalid swept-capsule geometry');
  const angle = Math.acos(Math.max(-1, Math.min(1, 1 - Math.min(tolerance, radius / 4) / radius)));
  const count = Math.max(12, Math.ceil(Math.PI / angle));
  if (count > 4096) throw new Error('Swept-capsule tolerance is below the supported geometry resolution');
  const adjusted = side === 'inner' ? Math.max(0, radius - kGridGuard) : radius / Math.cos(Math.PI / count) + kGridGuard;
  if (adjusted === 0) return [];
  return hull(
    [from, to].flatMap(center =>
      Array.from({ length: count }, (_, i) => ({
        x: center.x + adjusted * Math.cos((i * 2 * Math.PI) / count),
        y: center.y + adjusted * Math.sin((i * 2 * Math.PI) / count),
      }))
    )
  );
}

function below(sweep: Sweep, z: number): Sweep | undefined {
  const [a, b] = [sweep.from, sweep.to];
  if (Math.min(a[2], b[2]) > z) return undefined;
  if (Math.max(a[2], b[2]) <= z) return sweep;
  const t = (z - a[2]) / (b[2] - a[2]);
  const at: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z];
  return a[2] <= z ? { ...sweep, to: at } : { ...sweep, from: at };
}

function materialEnvelope(region: PathsD): PathsD {
  const edgeCount = region.reduce((sum, path) => sum + path.length, 0);
  // Boundary tubes retain thin material that could otherwise disappear on polygon quantization.
  const guard = kGridGuard * (2 + Math.ceil(Math.log2(Math.max(1, edgeCount / 256))));
  const boundaries = region.flatMap(path =>
    path.map((point, i) => sweptCapsule(point, path[(i + 1) % path.length], guard, guard / 4, 'outer'))
  );
  return union(region, boundaries.length ? unionMany(boundaries) : []);
}

function boxOverlaps(a: Pt, b: Pt, radius: number, sweep: Sweep): boolean {
  const reach = radius + sweep.radius;
  return (
    Math.min(a.x, b.x) <= Math.max(sweep.from[0], sweep.to[0]) + reach &&
    Math.max(a.x, b.x) >= Math.min(sweep.from[0], sweep.to[0]) - reach &&
    Math.min(a.y, b.y) <= Math.max(sweep.from[1], sweep.to[1]) + reach &&
    Math.max(a.y, b.y) >= Math.min(sweep.from[1], sweep.to[1]) - reach
  );
}

function circleInterval(a: Pt, b: Pt, center: Pt, radius: number): Interval | undefined {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    x = a.x - center.x,
    y = a.y - center.y;
  const aa = dx * dx + dy * dy;
  if (aa <= kEpsilon * kEpsilon) return Math.hypot(x, y) <= radius ? [0, 1] : undefined;
  const bb = 2 * (x * dx + y * dy),
    cc = x * x + y * y - radius * radius;
  const d = bb * bb - 4 * aa * cc;
  if (d < 0) return undefined;
  const root = Math.sqrt(d),
    lo = Math.max(0, (-bb - root) / (2 * aa)),
    hi = Math.min(1, (-bb + root) / (2 * aa));
  return hi >= lo ? [lo, hi] : undefined;
}

function pointSegmentDistance(point: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const square = dx * dx + dy * dy;
  const t = square ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / square)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const cross = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const [abc, abd, cda, cdb] = [cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)];
  if (((abc > 0 && abd < 0) || (abc < 0 && abd > 0)) && ((cda > 0 && cdb < 0) || (cda < 0 && cdb > 0))) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b)
  );
}

/** Analytic boundary test retains islands even when their width is below the polygon clipping grid. */
function capsuleInsideRegion(a: Pt, b: Pt, radius: number, region: PathsD): boolean {
  let winding = 0;
  for (const path of region) {
    if (path.length < 3) throw new Error('Pocket transition boundaries need at least three points');
    for (let i = 0; i < path.length; i++) {
      const p = path[i],
        q = path[(i + 1) % path.length];
      if (![p.x, p.y, q.x, q.y].every(Number.isFinite)) throw new Error('Pocket transition boundaries need finite points');
      const distance = segmentDistance(a, b, p, q);
      if (!Number.isFinite(distance) || distance <= radius + kGridGuard) return false;
      const cross = (q.x - p.x) * (a.y - p.y) - (q.y - p.y) * (a.x - p.x);
      if (!Number.isFinite(cross)) return false;
      if (p.y <= a.y && q.y > a.y && cross > 0) winding++;
      else if (p.y > a.y && q.y <= a.y && cross < 0) winding--;
    }
  }
  return winding !== 0;
}

/** Centerline parameter range whose complete cutter disk fits inside one previous capsule. */
function capsuleInterval(a: Pt, b: Pt, sweep: Sweep, radius: number): Interval | undefined {
  const margin = sweep.radius - radius;
  if (margin < 0) return undefined;
  const p = { x: sweep.from[0], y: sweep.from[1] },
    q = { x: sweep.to[0], y: sweep.to[1] };
  const dx = q.x - p.x,
    dy = q.y - p.y,
    length = Math.hypot(dx, dy);
  if (length <= kEpsilon) return circleInterval(a, b, p, margin);
  const u = { x: dx / length, y: dy / length };
  const local = (point: Pt) => ({ x: (point.x - p.x) * u.x + (point.y - p.y) * u.y, y: -(point.x - p.x) * u.y + (point.y - p.y) * u.x });
  const aa = local(a),
    bb = local(b);
  if (margin === 0) {
    if (Math.abs(aa.y) > kEpsilon || Math.abs(bb.y) > kEpsilon) return undefined;
    if (Math.abs(bb.x - aa.x) <= kEpsilon) return aa.x >= 0 && aa.x <= length ? [0, 1] : undefined;
    const ta = -aa.x / (bb.x - aa.x),
      tb = (length - aa.x) / (bb.x - aa.x);
    const lo = Math.max(0, Math.min(ta, tb)),
      hi = Math.min(1, Math.max(ta, tb));
    return hi >= lo ? [lo, hi] : undefined;
  }
  let lo = 0,
    hi = 1;
  for (const [start, end, min, max] of [
    [aa.x, bb.x, 0, length],
    [aa.y, bb.y, -margin, margin],
  ]) {
    const delta = end - start;
    if (Math.abs(delta) <= kEpsilon) {
      if (start < min || start > max) {
        lo = 1;
        hi = 0;
        break;
      }
    } else {
      const t0 = (min - start) / delta,
        t1 = (max - start) / delta;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
    }
  }
  const ranges: Interval[] = [
    circleInterval(a, b, p, margin),
    circleInterval(a, b, q, margin),
    hi >= lo ? ([lo, hi] as const) : undefined,
  ].filter((value): value is Interval => value !== undefined);
  return ranges.length ? [Math.min(...ranges.map(r => r[0])), Math.max(...ranges.map(r => r[1]))] : undefined;
}

/** Conservative 2.5D removal history; it tracks stock, not fixtures, shanks or machine travel. */
export class StockModel {
  readonly stockTop: number;
  readonly tolerance: number;
  readonly pathTolerance: number;
  readonly verticalTolerance: number;
  private readonly footprint?: PathsD;
  private readonly sweeps: Sweep[] = [];
  private readonly planes = new Map<number, PathsD>();

  constructor(options: StockOptions) {
    this.stockTop = options.stockTop;
    this.tolerance = options.tolerance ?? 0.01;
    this.pathTolerance = options.pathTolerance ?? 0;
    this.verticalTolerance = options.verticalTolerance ?? this.pathTolerance;
    if (
      !Number.isFinite(this.stockTop) ||
      !Number.isFinite(this.tolerance) ||
      this.tolerance <= 0 ||
      !Number.isFinite(this.pathTolerance) ||
      this.pathTolerance < 0 ||
      !Number.isFinite(this.verticalTolerance) ||
      this.verticalTolerance < 0
    )
      throw new Error('Invalid stock model options');
    const footprint = options.footprint?.map(path =>
      path.map(point => {
        if (!Number.isFinite(point.x + point.y)) throw new Error('Stock footprint requires finite points');
        return { ...point };
      })
    );
    if (footprint?.some(path => path.length < 3)) throw new Error('Stock footprint boundaries need at least three points');
    this.footprint = footprint ? materialEnvelope(footprint) : undefined;
  }

  /** Call only for actual material-engaging motion, including an approach when it removes material. */
  recordPath(points: Vec3[], radius: number): void {
    positiveRadius(radius);
    points.forEach(finitePoint);
    if (!points.length) return;
    const effective = radius - this.pathTolerance;
    if (effective <= 0) throw new Error('Path uncertainty is greater than the cutter radius');
    const uncertain = (point: Vec3): Vec3 => [point[0], point[1], point[2] + this.verticalTolerance];
    for (let i = 0; i < Math.max(1, points.length - 1); i++)
      this.sweeps.push({
        from: uncertain(points[i]),
        to: uncertain(points[Math.min(i + 1, points.length - 1)]),
        radius: effective,
        occupiedPose: [...points[Math.min(i + 1, points.length - 1)]],
        cutterRadius: radius,
      });
    this.planes.clear();
  }

  checkpoint(): number {
    return this.sweeps.length;
  }

  rollback(checkpoint: number): void {
    if (!Number.isInteger(checkpoint) || checkpoint < 0 || checkpoint > this.sweeps.length) throw new Error('Invalid stock checkpoint');
    this.sweeps.length = checkpoint;
    this.planes.clear();
  }

  private at(z: number, a?: Pt, b?: Pt, radius = 0): Sweep[] {
    return this.sweeps.flatMap(sweep => {
      if (a && b && !boxOverlaps(a, b, radius, sweep)) return [];
      const clipped = below(sweep, z);
      return clipped ? [clipped] : [];
    });
  }

  private removal(sweeps: Sweep[]): PathsD {
    const unionGuard = kGridGuard * Math.ceil(Math.log2(Math.max(1, sweeps.length / 256)));
    const capsules = sweeps
      .flatMap(sweep =>
        sweep.radius > unionGuard
          ? [
              sweptCapsule(
                { x: sweep.from[0], y: sweep.from[1] },
                { x: sweep.to[0], y: sweep.to[1] },
                sweep.radius - unionGuard,
                this.tolerance,
                'inner'
              ),
            ]
          : []
      )
      .filter(path => path.length > 2);
    return capsules.length ? unionMany(capsules) : [];
  }

  clearedAt(z: number): PathsD {
    if (!Number.isFinite(z)) throw new Error('Stock depth must be finite');
    let region = this.planes.get(z);
    if (!region) {
      region = this.removal(this.at(z));
      this.planes.set(z, region);
    }
    return region.map(path => path.map(point => ({ ...point })));
  }

  remainingAt(z: number, region: PathsD = this.footprint ?? []): PathsD {
    if (!region.length && !this.footprint) throw new Error('Remaining stock needs a bounded material region');
    return z >= this.stockTop ? [] : difference(region, this.clearedAt(z));
  }

  certifyLink(from: Vec3, to: Vec3, radius: number): LinkCertificate {
    finitePoint(from);
    finitePoint(to);
    positiveRadius(radius);
    const depthPlane = Math.min(from[2], to[2]) - this.verticalTolerance;
    if (depthPlane >= this.stockTop) return { clear: true, reason: 'above-stock', depthPlane, unclearedArea: 0 };
    const a = { x: from[0], y: from[1] },
      b = { x: to[0], y: to[1] };
    const queryRadius = radius + this.pathTolerance;
    const candidates = this.at(depthPlane, a, b, queryRadius);
    const intervals = candidates
      .map(sweep => capsuleInterval(a, b, sweep, queryRadius))
      .filter((range): range is Interval => range !== undefined)
      .sort((a, b) => a[0] - b[0]);
    const parameterEpsilon = kEpsilon / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    let reached = 0;
    for (const [lo, hi] of intervals) {
      if (lo > reached + parameterEpsilon) break;
      reached = Math.max(reached, hi);
      if (reached >= 1 - parameterEpsilon) return { clear: true, reason: 'previous-sweep', depthPlane, unclearedArea: 0 };
    }
    const query = [sweptCapsule(a, b, queryRadius, this.tolerance, 'outer')];
    const material = this.footprint ? intersect(query, this.footprint) : query;
    const remaining = difference(material, this.removal(candidates));
    return {
      clear: remaining.length === 0,
      reason: remaining.length ? 'uncleared' : 'swept-region',
      depthPlane,
      unclearedArea: Math.max(0, polyArea(remaining)),
    };
  }

  /** A material-engaging pocket stepover, anchored to the actual immediately preceding cutter pose. */
  certifyCuttingTransition(from: Vec3, to: Vec3, radius: number, policy: PocketTransitionPolicy): CuttingTransitionCertificate {
    finitePoint(from);
    finitePoint(to);
    positiveRadius(radius);
    if (![policy.maximumStepover, policy.cutFeed, policy.transitionFeed].every(value => Number.isFinite(value) && value > 0))
      throw new Error('Pocket cutting transitions require positive finite limits');
    if (policy.maximumStepover > 2 * radius) throw new Error('Pocket cutting transition stepover exceeds the cutter diameter');
    const allowance = policy.wallAllowance ?? 0;
    if (!Number.isFinite(allowance) || allowance < 0) throw new Error('Pocket cutting transition allowance must be nonnegative and finite');
    const maximumImmersion = Math.hypot(to[0] - from[0], to[1] - from[1]) + 2 * this.pathTolerance;
    const maximumFrontierWidth = 2 * (radius + this.pathTolerance);
    const feed = Math.min(policy.cutFeed, policy.transitionFeed, (policy.cutFeed * policy.maximumStepover) / maximumFrontierWidth);
    const result = (allowed: boolean, reason: CuttingTransitionCertificate['reason']): CuttingTransitionCertificate => ({
      allowed,
      reason,
      maximumImmersion,
      maximumFrontierWidth,
      feed,
    });
    const previous = this.sweeps.at(-1);
    if (!previous || previous.cutterRadius !== radius || previous.occupiedPose.some((value, axis) => value !== from[axis]))
      return result(false, 'pose-unproven');
    if (from[2] !== to[2]) return result(false, 'depth-change');
    if (maximumImmersion > policy.maximumStepover) return result(false, 'stepover-exceeded');
    if (!capsuleInsideRegion({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, radius + this.pathTolerance + allowance, policy.region))
      return result(false, 'outside-pocket');
    return result(true, 'bounded-cut');
  }

  measureMove(from: Vec3, to: Vec3, radius: number): MoveEngagement {
    finitePoint(from);
    finitePoint(to);
    positiveRadius(radius);
    const z = Math.min(from[2], to[2]) - this.verticalTolerance,
      length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (z >= this.stockTop) return { length, sweptArea: 0, newArea: 0, averageWidth: 0 };
    const a = { x: from[0], y: from[1] },
      b = { x: to[0], y: to[1] };
    const query = [sweptCapsule(a, b, radius + this.pathTolerance, this.tolerance, 'outer')];
    const material = this.footprint ? intersect(query, this.footprint) : query;
    const newArea = Math.max(0, polyArea(difference(material, this.removal(this.at(z, a, b, radius)))));
    return { length, sweptArea: Math.max(0, polyArea(material)), newArea, averageWidth: length > 0 ? newArea / length : Infinity };
  }
}
