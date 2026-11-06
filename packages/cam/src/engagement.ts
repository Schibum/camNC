import {
  clipLines,
  difference,
  intersect,
  offset,
  pathLength,
  polyArea,
  union,
  unionMany,
  type PathD,
  type PathsD,
  type Vec3,
} from './geom';
import { StockModel, sweptCapsule } from './stock';
import type { Pass, Tool } from './toolpaths';
import type { MotionRole } from './motion';
import { parsedPostNumber } from './postValidation';

export interface ControlledPocketOptions {
  toolRadius: number;
  stepover: number;
  minimumTurnRadius: number;
  /** Rough paths reserve this much wall material for controlled cleanup. */
  radialAllowance: number;
  tolerance?: number;
}

export interface ControlledPocketPlan {
  /** Sampled tangent lines/arcs, inside-out. Entry motion is planned separately. */
  roughing: PathD[];
  /** Cleanup contours can contain sharp turns; the roughing minimum radius does not apply to these. */
  cleanup: PathD[];
  remaining: PathsD;
  unreachable: PathsD;
  reachableResidualArea: number;
  entryExceptions: { kind: 'roughing' | 'cleanup'; path: number; reason: 'full-slot-candidate' | 'uncleared-entry' }[];
  diagnostics: string[];
}

const positive = (value: number) => Number.isFinite(value) && value > 0;
const closed = (path: PathD): PathD => [...path, path[0]];

function rings(region: PathsD, radius: number, stepover: number, tolerance: number): PathsD[] {
  const layers: PathsD[] = [];
  let inset = radius;
  let current = offset(region, -inset, tolerance);
  for (let i = 0; current.length; i++) {
    if (i === 10000) throw new Error('Pocket roughing exceeds the supported offset count');
    layers.push(current);
    inset += stepover;
    const next = offset(region, -inset, tolerance);
    if (next.length && polyArea(next) >= polyArea(current) - 1e-8) throw new Error('Pocket stepover is below the geometry resolution');
    current = next;
  }
  return layers;
}

/** Fillets every turn at the requested radius, or refuses a loop whose edges cannot fit it. */
export function filletLoop(path: PathD, radius: number, tolerance = 0.005): PathD | undefined {
  if (!positive(radius) || !positive(tolerance) || path.length < 3) return undefined;
  const vertices = path.map((point, i) => {
    const before = path[(i + path.length - 1) % path.length],
      after = path[(i + 1) % path.length];
    const incoming = { x: point.x - before.x, y: point.y - before.y };
    const outgoing = { x: after.x - point.x, y: after.y - point.y };
    const inLength = Math.hypot(incoming.x, incoming.y),
      outLength = Math.hypot(outgoing.x, outgoing.y);
    if (inLength < 1e-8 || outLength < 1e-8) return undefined;
    const u = { x: incoming.x / inLength, y: incoming.y / inLength },
      v = { x: outgoing.x / outLength, y: outgoing.y / outLength };
    const angle = Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y);
    const distance = radius * Math.tan(Math.abs(angle) / 2);
    return { point, u, v, angle, distance, outLength };
  });
  if (vertices.some(vertex => !vertex || !Number.isFinite(vertex.distance))) return undefined;
  const valid = vertices as NonNullable<(typeof vertices)[number]>[];
  if (valid.some((vertex, i) => vertex.distance + valid[(i + 1) % valid.length].distance > vertex.outLength - 0.0002)) return undefined;
  const maxAngle = 2 * Math.acos(Math.max(-1, 1 - Math.min(tolerance, radius / 4) / radius));
  return valid.flatMap(({ point, u, v, angle, distance }) => {
    if (Math.abs(angle) < 1e-7) return [{ ...point }];
    const start = { x: point.x - u.x * distance, y: point.y - u.y * distance };
    const end = { x: point.x + v.x * distance, y: point.y + v.y * distance };
    const sign = Math.sign(angle);
    const center = { x: start.x - sign * u.y * radius, y: start.y + sign * u.x * radius };
    const a0 = Math.atan2(start.y - center.y, start.x - center.x);
    // At least three chords retain enough samples for downstream arc fitting.
    const count = Math.max(3, Math.ceil(Math.abs(angle) / maxAngle));
    if (count > 4096) throw new Error('Corner tolerance is below the supported geometry resolution');
    return Array.from({ length: count + 1 }, (_, k) =>
      k === count
        ? end
        : {
            x: center.x + radius * Math.cos(a0 + (angle * k) / count),
            y: center.y + radius * Math.sin(a0 + (angle * k) / count),
          }
    );
  });
}

function swept(paths: PathD[], radius: number, tolerance: number, side: 'inner' | 'outer'): PathsD {
  const capsules = paths
    .flatMap(path => path.slice(1).map((point, i) => sweptCapsule(path[i], point, radius, tolerance, side)))
    .filter(path => path.length > 2);
  return capsules.length ? unionMany(capsules) : [];
}

/** Offset roughing with explicit curvature and residual-stock contracts; it is not an adaptive strategy. */
export function planControlledPocket(region: PathsD, options: ControlledPocketOptions): ControlledPocketPlan {
  const { toolRadius, stepover, minimumTurnRadius, radialAllowance } = options;
  const tolerance = options.tolerance ?? 0.005;
  if (![toolRadius, stepover, minimumTurnRadius, radialAllowance, tolerance].every(positive))
    throw new Error('Controlled pocket dimensions and tolerances must be positive and finite');
  if (stepover > 2 * toolRadius || stepover < 0.0004)
    throw new Error('Pocket stepover must overlap cutter sweeps and exceed geometry resolution');
  if (toolRadius <= 2 * tolerance) throw new Error('Pocket tolerance must be small compared with the cutter radius');
  const roughing: PathD[] = [],
    diagnostics: string[] = [];
  let rejected = 0;
  const roughLayers = rings(region, toolRadius + radialAllowance, stepover, tolerance);
  for (const layer of roughLayers.reverse())
    for (const loop of layer) {
      const filleted = filletLoop(loop, minimumTurnRadius, tolerance);
      if (!filleted) {
        rejected++;
        continue;
      }
      const path = closed(filleted);
      // Inflating by the sampling error also bounds the true fillet between its chord samples.
      const envelope = swept([path], toolRadius + tolerance, tolerance, 'outer');
      if (difference(envelope, region).length) {
        rejected++;
        continue;
      }
      roughing.push(path);
    }
  if (rejected) diagnostics.push(`${rejected} roughing loops left for cleanup because the requested turn radius does not fit`);
  const removedRoughing = swept(roughing, toolRadius - tolerance, tolerance, 'inner');
  const remainingRoughing = difference(region, removedRoughing);
  const cleanupRegion = offset(remainingRoughing, toolRadius + tolerance, tolerance);
  // Keep the complete selected contour so cleanup has room for a bounded ramp entry.
  const cleanup = rings(region, toolRadius, stepover, tolerance)
    .reverse()
    .flatMap(layer => layer.map(closed))
    .filter(path => clipLines([path], cleanupRegion).some(piece => pathLength(piece, false) > 0.0002));
  const removed = union(removedRoughing, swept(cleanup, toolRadius, tolerance, 'inner'));
  const remaining = difference(region, removed);
  // Expand the reach estimate by both offset errors before labelling stock unreachable.
  const reachGuard = 2 * tolerance + 0.0004;
  const reachable = intersect(region, offset(offset(region, -toolRadius + reachGuard, tolerance), toolRadius + reachGuard, tolerance));
  const unreachable = difference(region, reachable);
  const reachableResidualArea = Math.max(0, polyArea(intersect(remaining, reachable)));
  if (reachableResidualArea > tolerance * region.reduce((sum, path) => sum + pathLength(path, true), 0))
    diagnostics.push(`${reachableResidualArea.toFixed(3)} mm2 of reachable stock remains after cleanup`);
  const entryStock = new StockModel({ stockTop: 1, tolerance });
  const entryExceptions: ControlledPocketPlan['entryExceptions'] = [];
  for (const [kind, paths] of [
    ['roughing', roughing],
    ['cleanup', cleanup],
  ] as const)
    paths.forEach((path, index) => {
      const points = path.map(point => [point.x, point.y, 0] as Vec3),
        first = points[0];
      if (!entryStock.certifyLink(first, first, toolRadius).clear) {
        const engaged = entryStock.measureMove(first, first, toolRadius).newArea;
        entryExceptions.push({
          kind,
          path: index,
          reason: engaged >= Math.PI * toolRadius ** 2 * 0.95 ? 'full-slot-candidate' : 'uncleared-entry',
        });
      }
      entryStock.recordPath(points, toolRadius);
    });
  return { roughing, cleanup, remaining, unreachable, reachableResidualArea, entryExceptions, diagnostics };
}

export interface RemovalRateOptions {
  /** Maximum new planar frontier per minute over each block, mm2/min; axial floor removal is separate. */
  maxPlanarRemovalRate: number;
  minimumFeed: number;
  sampleLength?: number;
  plungeFeed?: number;
  /** Bound detailed polygon analysis; later moves use the conservative full-slot frontier bound. */
  maxDetailedQueries?: number;
  maxDetailedSweeps?: number;
}

export interface RemovalRateResult {
  passes: RatedPass[];
  limitedSegments: number;
  maximumAreaRate: number;
  /** Pure axial entries need a separate plunge/axial-depth policy; no planar-rate claim is made for them. */
  axialEntries: number;
  descendingSegments: number;
  retractedLinks: number;
  conservativeFrontierSegments: number;
}

type RatedPass = Pass & { roles?: MotionRole[] };

/** Limit material-area removal using prior sweeps; geometric engagement and axial load remain separate constraints. */
export function limitRemovalRate(passes: RatedPass[], tool: Tool, stock: StockModel, options: RemovalRateOptions): RemovalRateResult {
  const radius = tool.diameter / 2,
    step = options.sampleLength ?? radius / 2;
  if (![radius, step, options.maxPlanarRemovalRate, options.minimumFeed].every(positive))
    throw new Error('Invalid material removal-rate policy');
  if (options.plungeFeed !== undefined && !positive(options.plungeFeed)) throw new Error('Invalid material removal plunge feed');
  const queryBudget = options.maxDetailedQueries ?? 64,
    sweepBudget = options.maxDetailedSweeps ?? 128;
  if (![queryBudget, sweepBudget].every(value => Number.isInteger(value) && value >= 0))
    throw new Error('Invalid material analysis budget');
  let detailedQueries = 0,
    conservativeFrontierSegments = 0;
  let limitedSegments = 0,
    maximumAreaRate = 0,
    axialEntries = 0,
    descendingSegments = 0,
    retractedLinks = 0;
  const resolve = (from: Vec3, to: Vec3, requestedFeed: number): number => {
    if (!positive(requestedFeed)) throw new Error('Cutting feed must be positive and finite');
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (to[2] < from[2]) descendingSegments++;
    if (length === 0) {
      if (to[2] < from[2] && to[2] < stock.stockTop) axialEntries++;
      stock.recordPath([from, to], radius);
      return requestedFeed;
    }
    // A translated disk adds at most D * length outside its occupied starting disk.
    // This excludes axial removal under that disk, which ramp/plunge limits govern separately.
    let frontierArea = 2 * radius * length;
    let fullSlot = true;
    if (requestedFeed > options.maxPlanarRemovalRate / (2 * radius) && detailedQueries < queryBudget && stock.checkpoint() <= sweepBudget) {
      detailedQueries++;
      const measured = stock.measureMove(from, to, radius).newArea;
      if (measured < frontierArea) {
        frontierArea = measured;
        fullSlot = false;
      }
    } else conservativeFrontierSegments++;
    const allowed = fullSlot
      ? options.maxPlanarRemovalRate / (2 * radius)
      : frontierArea > 0
        ? (options.maxPlanarRemovalRate * length) / frontierArea
        : requestedFeed;
    const target = Math.min(requestedFeed, allowed);
    let feed = Math.floor(target * 1000) / 1000;
    // Keep an exactly representable boundary feed; otherwise reserve parsing error before rounding down.
    if (frontierArea > 0 && parsedPostNumber(feed) > allowed) {
      const margin = 0.001 + target * 2 ** -20;
      feed = Math.floor(Math.max(0, target - margin) * 1000) / 1000;
      if (parsedPostNumber(feed) > allowed) throw new Error('Material removal bound is not representable at the posted feed precision');
    }
    if (feed < options.minimumFeed - 1e-9) throw new Error('Material removal bound cannot be met at the minimum permitted feed');
    if (feed < requestedFeed - 1e-9) limitedSegments++;
    maximumAreaRate = Math.max(maximumAreaRate, (frontierArea / length) * parsedPostNumber(feed));
    stock.recordPath([from, to], radius);
    return feed;
  };
  const checkpoint = stock.checkpoint();
  try {
    let last: Vec3 | undefined;
    const resolved = passes.map((pass, pi) => {
      if (!pass.pts.length || pass.pts.length !== pass.feeds.length)
        throw new Error('Material removal policy requires nonempty point/feed pairs');
      const first = pass.pts[0];
      let approachFeed = pass.feeds[0];
      let link = pass.link,
        clearLink = false;
      if (pi > 0 && link === 'direct' && last) {
        clearLink = last.every((value, axis) => value === first[axis]) || stock.certifyLink(last, first, radius).clear;
        if (!clearLink) {
          link = 'retract';
          retractedLinks++;
        }
      }
      if (pi === 0 || link === 'retract') {
        approachFeed = Math.min(approachFeed, tool.plungeFeed ?? options.plungeFeed ?? approachFeed);
        resolve([first[0], first[1], Math.max(stock.stockTop, first[2])], first, approachFeed);
      } else if (last) approachFeed = resolve(last, first, approachFeed);
      const pts: Vec3[] = [[...first]],
        feeds = [approachFeed];
      const roles = pass.roles ? [pi === 0 || link === 'retract' ? ('approach' as const) : pass.roles[0]] : undefined;
      for (let i = 1; i < pass.pts.length; i++) {
        const from = pass.pts[i - 1],
          to = pass.pts[i];
        const count = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step));
        if (count > 100000) throw new Error('Material removal policy exceeds the supported segment count');
        for (let k = 1; k <= count; k++) {
          const next: Vec3 = k === count ? [...to] : (from.map((value, axis) => value + ((to[axis] - value) * k) / count) as Vec3);
          feeds.push(resolve(pts[pts.length - 1], next, pass.feeds[i]));
          pts.push(next);
          roles?.push(pass.roles![i]);
        }
      }
      last = pts[pts.length - 1];
      return { ...pass, pts, feeds, link, clearLink, ...(roles ? { roles } : {}) };
    });
    return {
      passes: resolved,
      limitedSegments,
      maximumAreaRate,
      axialEntries,
      descendingSegments,
      retractedLinks,
      conservativeFrontierSegments,
    };
  } catch (error) {
    stock.rollback(checkpoint);
    throw error;
  }
}
