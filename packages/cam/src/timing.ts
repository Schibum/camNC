import type { Vec3 } from './geom';

export interface MachineTimingProfile {
  id: string;
  name: string;
  provenance: 'reference' | 'machine';
  maxRateMmPerMin: readonly [number, number, number];
  accelerationMmPerSec2: readonly [number, number, number];
  junctionDeviationMm: number;
  arcToleranceMm: number;
  plannerBlocks: number;
}

/** Reference configuration, not a measurement of a connected machine. */
export const LOWRIDER_V4_REFERENCE_PROFILE: MachineTimingProfile = Object.freeze({
  id: 'lowrider-v4-reference',
  name: 'LowRider V4 reference',
  provenance: 'reference',
  maxRateMmPerMin: Object.freeze([9000, 9000, 1200] as const),
  accelerationMmPerSec2: Object.freeze([200, 200, 80] as const),
  junctionDeviationMm: 0.01,
  arcToleranceMm: 0.002,
  plannerBlocks: 32,
});

export interface ProgramTimingOptions {
  initialWorkPosition?: Vec3;
  initialMachinePosition?: Vec3;
  /** Machine position minus work position, in mm, for the initial active work offset. */
  workOffset?: Vec3;
  /** Resource bound for arc interpolation and lookahead, default 200,000 segments. */
  maxSegments?: number;
}

export interface ProgramTimeEstimate {
  profileId: string;
  profileProvenance: MachineTimingProfile['provenance'];
  motionLowerBoundSeconds: number;
  motionEstimateSeconds: number;
  /** Conservative scenario: stop at every interpolated motion segment. */
  fullStopMotionSeconds: number;
  dwellSeconds: number;
  minimumAutomaticSeconds: number;
  estimatedAutomaticSeconds: number;
  fullStopAutomaticSeconds: number;
  manualPauseCount: number;
  optionalPauseCount: number;
  timedMotionSegments: number;
  skippedMotionCount: number;
  /** False when motion, coordinate state, or commands could not be fully interpreted. */
  complete: boolean;
  warnings: string[];
  uncertainty: string[];
}

interface Segment {
  length: number;
  unit: Vec3;
  speed: number;
  acceleration: number;
}

type Position = [number | undefined, number | undefined, number | undefined];
const axes = ['X', 'Y', 'Z'] as const;
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): number => Math.hypot(...a);

function validateProfile(profile: MachineTimingProfile, options: ProgramTimingOptions): void {
  const positive = (v: number) => Number.isFinite(v) && v > 0;
  if (
    ![...profile.maxRateMmPerMin, ...profile.accelerationMmPerSec2, profile.arcToleranceMm].every(positive) ||
    !Number.isFinite(profile.junctionDeviationMm) ||
    profile.junctionDeviationMm < 0 ||
    !Number.isInteger(profile.plannerBlocks) ||
    profile.plannerBlocks < 2 ||
    profile.plannerBlocks > 256
  )
    throw new Error('Timing profile requires positive axis limits, a nonnegative junction deviation, and 2–256 planner blocks');
  if (
    options.maxSegments !== undefined &&
    (!Number.isInteger(options.maxSegments) || options.maxSegments < 1 || options.maxSegments > 1_000_000)
  )
    throw new Error('Timing segment limit must be an integer from 1 to 1000000');
  for (const position of [options.initialWorkPosition, options.initialMachinePosition, options.workOffset])
    if (position && (position.length !== 3 || !position.every(Number.isFinite)))
      throw new Error('Timing positions must contain finite XYZ coordinates');
}

function axisLimit(unit: Vec3, limits: readonly number[]): number {
  return Math.min(...unit.map((v, axis) => (Math.abs(v) > 1e-12 ? limits[axis] / Math.abs(v) : Infinity)));
}

function segmentTime(segment: Segment, entry: number, exit: number): number {
  const { length, speed, acceleration: a } = segment;
  const peak = Math.min(speed, Math.sqrt(a * length + (entry * entry + exit * exit) / 2));
  const accelerating = Math.max(0, (peak * peak - entry * entry) / (2 * a));
  const decelerating = Math.max(0, (peak * peak - exit * exit) / (2 * a));
  return Math.max(0, (peak - entry) / a) + Math.max(0, (peak - exit) / a) + Math.max(0, length - accelerating - decelerating) / peak;
}

function junctionSpeed(a: Segment, b: Segment, profile: MachineTimingProfile): number {
  const cosine = Math.max(-1, Math.min(1, dot(a.unit, b.unit)));
  if (cosine > 1 - 1e-10) return Math.min(a.speed, b.speed);
  if (cosine < -1 + 1e-10 || profile.junctionDeviationMm === 0) return 0;
  const change: Vec3 = a.unit.map((v, axis) => b.unit[axis] - v) as Vec3;
  const size = norm(change);
  const acceleration = axisLimit(change.map(v => v / size) as Vec3, profile.accelerationMmPerSec2);
  const sine = Math.sqrt((1 + cosine) / 2);
  return Math.min(a.speed, b.speed, Math.sqrt((acceleration * profile.junctionDeviationMm * sine) / (1 - sine)));
}

function groupTime(group: Segment[], profile: MachineTimingProfile): number {
  if (!group.length) return 0;
  const count = group.length;
  const boundaries = Array.from({ length: count + 1 }, (_, index) =>
    index === 0 || index === count ? 0 : junctionSpeed(group[index - 1], group[index], profile)
  );
  // Each lookahead window must be able to stop at its buffered end. Forward and
  // reverse passes then enforce acceleration/deceleration between these limits.
  const limits = boundaries.slice();
  for (let index = 1; index < count; index++) {
    let reachable = 0;
    for (let future = Math.min(count, index + profile.plannerBlocks) - 1; future >= index; future--)
      reachable = Math.min(boundaries[future], Math.sqrt(reachable * reachable + 2 * group[future].acceleration * group[future].length));
    limits[index] = reachable;
  }
  for (let index = 0; index < count; index++)
    limits[index + 1] = Math.min(
      limits[index + 1],
      Math.sqrt(limits[index] * limits[index] + 2 * group[index].acceleration * group[index].length)
    );
  for (let index = count - 1; index >= 0; index--)
    limits[index] = Math.min(
      limits[index],
      Math.sqrt(limits[index + 1] * limits[index + 1] + 2 * group[index].acceleration * group[index].length)
    );
  return group.reduce((seconds, segment, index) => seconds + segmentTime(segment, limits[index], limits[index + 1]), 0);
}

/**
 * A machine-profile model for metric/inch, absolute/incremental G0–G3 programs.
 * It models programmed dwells and counts operator stops without assigning them
 * a made-up duration. Unknown starting/retract distances remain explicitly unknown.
 */
export function estimateProgramTime(
  program: string,
  profile: MachineTimingProfile = LOWRIDER_V4_REFERENCE_PROFILE,
  options: ProgramTimingOptions = {}
): ProgramTimeEstimate {
  validateProfile(profile, options);
  const warnings = new Set<string>();
  let complete = true,
    skippedMotionCount = 0,
    manualPauseCount = 0,
    optionalPauseCount = 0,
    dwellSeconds = 0;
  let motionLowerBoundSeconds = 0,
    motionEstimateSeconds = 0,
    fullStopMotionSeconds = 0,
    timedMotionSegments = 0;
  const maxSegments = options.maxSegments ?? 200_000;
  let group: Segment[] = [];
  const flush = () => {
    motionEstimateSeconds += groupTime(group, profile);
    group = [];
  };
  const issue = (message: string) => {
    complete = false;
    warnings.add(message);
  };
  let work: Position = options.initialWorkPosition ? [...options.initialWorkPosition] : [undefined, undefined, undefined];
  let machine: Position = options.initialMachinePosition ? [...options.initialMachinePosition] : [undefined, undefined, undefined];
  let offset = options.workOffset;
  if (!offset && options.initialWorkPosition && options.initialMachinePosition)
    offset = options.initialMachinePosition.map((v, i) => v - options.initialWorkPosition![i]) as Vec3;
  if (offset) {
    work = work.map((v, i) => v ?? (machine[i] === undefined ? undefined : machine[i]! - offset![i])) as Position;
    machine = machine.map((v, i) => v ?? (work[i] === undefined ? undefined : work[i]! + offset![i])) as Position;
  }
  let units = 1,
    absolute = true,
    plane = 17,
    motion: number | undefined = 0,
    feed = 0,
    feedModeValid = true,
    wcs = 54;
  const ratesPerSecond = profile.maxRateMmPerMin.map(v => v / 60);
  const append = (delta: Vec3, rapid: boolean) => {
    const length = norm(delta);
    if (length <= 1e-12) return;
    const unit = delta.map(v => v / length) as Vec3;
    const speed = Math.min(rapid ? Infinity : feed / 60, axisLimit(unit, ratesPerSecond));
    const segment = { length, unit, speed, acceleration: axisLimit(unit, profile.accelerationMmPerSec2) };
    if (![length, speed, segment.acceleration, length / speed, segmentTime(segment, 0, 0)].every(Number.isFinite) || speed <= 0) {
      skippedMotionCount++;
      issue('Motion exceeds the numerical range of the timing model');
      flush();
      return;
    }
    group.push(segment);
    motionLowerBoundSeconds += length / speed;
    fullStopMotionSeconds += segmentTime(segment, 0, 0);
    timedMotionSegments++;
  };
  for (const [lineIndex, raw] of program.split(/\r?\n/).entries()) {
    const text = raw
      .replace(/\([^()\n]*\)/g, '')
      .replace(/;.*/, '')
      .trim()
      .toUpperCase();
    if (!text || text === '%') continue;
    const words = [...text.matchAll(/([A-Z])[ \t]*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g)].map(m => [m[1], Number(m[2])] as const);
    if (
      text.replace(/([A-Z])[ \t]*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/g, '').trim() ||
      words.some(([letter, value]) => !Number.isFinite(value) || !'GMXYZIJKRFSPNT'.includes(letter))
    ) {
      issue(`Line ${lineIndex + 1}: invalid or unsupported numeric syntax`);
      work = [undefined, undefined, undefined];
      machine = [undefined, undefined, undefined];
      flush();
      continue;
    }
    const values = Object.fromEntries(words);
    const codes = words.filter(([letter]) => letter === 'G').map(([, value]) => value);
    const mcodes = words.filter(([letter]) => letter === 'M').map(([, value]) => value);
    const unsupported = codes.filter(
      code => ![0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 40, 49, 53, 54, 55, 56, 57, 58, 59, 80, 90, 91, 91.1, 93, 94].includes(code)
    );
    if (unsupported.length) {
      issue(`Line ${lineIndex + 1}: unsupported coordinate or motion command ${unsupported.map(v => `G${v}`).join(', ')}`);
      skippedMotionCount++;
      work = [undefined, undefined, undefined];
      machine = [undefined, undefined, undefined];
      flush();
      continue;
    }
    for (const code of codes) {
      if (code <= 3) motion = code;
      else if (code === 17 || code === 18 || code === 19) plane = code;
      else if (code === 20) units = 25.4;
      else if (code === 21) units = 1;
      else if (code === 90) absolute = true;
      else if (code === 91) absolute = false;
      else if (code === 80) motion = undefined;
      else if (code === 93) {
        feedModeValid = false;
        issue('Inverse-time feed is not included in the timing model');
      } else if (code === 94) feedModeValid = true;
      else if (code >= 54 && code <= 59 && code !== wcs) {
        issue('Changed work offsets require coordinates not supplied to the timing model');
        work = [undefined, undefined, undefined];
        offset = undefined;
        wcs = code;
        flush();
      }
    }
    if (values.F !== undefined) feed = values.F * units;
    for (const m of mcodes) {
      if (m === 0 || m === 6) manualPauseCount++;
      else if (m === 1) optionalPauseCount++;
      else if (![2, 3, 4, 5, 7, 8, 9, 30].includes(m)) issue(`Line ${lineIndex + 1}: M${m} may add unmodeled time`);
    }
    if (codes.includes(4)) {
      flush();
      if (values.P === undefined || values.P < 0) issue(`Line ${lineIndex + 1}: dwell requires a nonnegative P in seconds`);
      else dwellSeconds += values.P;
      if (mcodes.some(m => m === 2 || m === 30)) break;
      continue;
    }
    const machineMove = codes.includes(53);
    const circular = motion === 2 || motion === 3;
    const hasMove = axes.some(axis => values[axis] !== undefined) || (circular && ['I', 'J', 'K'].some(axis => values[axis] !== undefined));
    if (hasMove) {
      const current = machineMove ? machine : work;
      const target = current.slice() as Position;
      const delta: Position = [0, 0, 0];
      axes.forEach((axis, i) => {
        if (values[axis] === undefined) return;
        const value = values[axis] * units;
        if (absolute || machineMove) {
          target[i] = value;
          delta[i] = current[i] === undefined ? undefined : value - current[i]!;
        } else {
          target[i] = current[i] === undefined ? undefined : current[i]! + value;
          delta[i] = value;
        }
      });
      if (machineMove) {
        machine = target;
        axes.forEach((axis, i) => {
          if (values[axis] !== undefined) work[i] = offset && target[i] !== undefined ? target[i]! - offset[i] : undefined;
        });
      } else {
        work = target;
        axes.forEach((axis, i) => {
          if (values[axis] !== undefined) machine[i] = offset && target[i] !== undefined ? target[i]! + offset[i] : undefined;
        });
      }
      let skip =
        delta.some(v => v === undefined || !Number.isFinite(v)) ||
        motion === undefined ||
        (machineMove && circular) ||
        (motion !== 0 && (!feedModeValid || !Number.isFinite(feed) || feed <= 0));
      if (!skip && timedMotionSegments >= maxSegments) {
        skip = true;
        issue('Timing interpolation reached its configured segment limit');
      }
      if (skip) {
        skippedMotionCount++;
        issue(`Line ${lineIndex + 1}: motion distance, feed, or coordinate mode is unresolved`);
        flush();
      } else if (!circular) append(delta as Vec3, motion === 0);
      else {
        const [u, v, axial] = plane === 17 ? [0, 1, 2] : plane === 18 ? [2, 0, 1] : [1, 2, 0];
        const center = ['I', 'J', 'K'].map(axis => (values[axis] ?? 0) * units);
        const radius = Math.hypot(center[u], center[v]);
        const d = delta as Vec3;
        const radiusError = Math.abs(Math.hypot(d[u] - center[u], d[v] - center[v]) - radius);
        if (values.R !== undefined || radius <= 0 || (radiusError > 0.005 && (radiusError > 0.5 || radiusError > 0.001 * radius))) {
          skippedMotionCount++;
          issue(`Line ${lineIndex + 1}: unsupported or inconsistent arc geometry`);
          flush();
        } else {
          const begin = Math.atan2(-center[v], -center[u]);
          let sweep = Math.atan2(d[v] - center[v], d[u] - center[u]) - begin;
          if (motion === 2 && sweep >= -1e-9) sweep -= 2 * Math.PI;
          if (motion === 3 && sweep <= 1e-9) sweep += 2 * Math.PI;
          const angle = 2 * Math.acos(Math.max(-1, 1 - Math.min(profile.arcToleranceMm, radius) / radius));
          const count = Math.max(2, Math.ceil(Math.abs(sweep) / Math.max(angle, 1e-6)));
          if (timedMotionSegments + count > maxSegments) {
            skippedMotionCount++;
            issue('Timing interpolation reached its configured segment limit');
            flush();
          } else {
            let previous: Vec3 = [0, 0, 0];
            for (let index = 1; index <= count; index++) {
              const t = index / count;
              const point: Vec3 = [0, 0, 0];
              point[u] = center[u] + radius * Math.cos(begin + sweep * t);
              point[v] = center[v] + radius * Math.sin(begin + sweep * t);
              point[axial] = d[axial] * t;
              if (index === count) {
                point[u] = d[u];
                point[v] = d[v];
              }
              append(point.map((value, axis) => value - previous[axis]) as Vec3, false);
              previous = point;
            }
          }
        }
      }
    }
    if (mcodes.some(m => m === 0 || m === 1 || m === 6)) flush();
    if (mcodes.some(m => m === 2 || m === 30)) break;
  }
  flush();
  return {
    profileId: profile.id,
    profileProvenance: profile.provenance,
    motionLowerBoundSeconds,
    motionEstimateSeconds,
    fullStopMotionSeconds,
    dwellSeconds,
    minimumAutomaticSeconds: motionLowerBoundSeconds + dwellSeconds,
    estimatedAutomaticSeconds: motionEstimateSeconds + dwellSeconds,
    fullStopAutomaticSeconds: fullStopMotionSeconds + dwellSeconds,
    manualPauseCount,
    optionalPauseCount,
    timedMotionSegments,
    skippedMotionCount,
    complete,
    warnings: [...warnings],
    uncertainty: [
      profile.provenance === 'reference'
        ? 'Axis limits are a reference configuration, not measurements of the connected machine.'
        : 'Axis limits are supplied by the caller and may differ from active controller settings.',
      'The estimate assumes a filled planner buffer and models acceleration and junction speeds; it is not measured machine time.',
      'The full-stop scenario stops at every interpolated segment; controller starvation or external waits can still take longer.',
      'Operator pauses, tool changes, transport latency, and spindle spin-up without an explicit dwell have no assigned duration.',
      ...(complete ? [] : ['Unresolved motion is excluded; all reported times cover only the interpreted portion of the program.']),
    ],
  };
}
