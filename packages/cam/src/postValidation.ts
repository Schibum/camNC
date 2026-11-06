import type { Vec3 } from './geom';
import { samePhysicalTool } from './toolIdentity';
import type { PartCam } from './toolpaths';
import { MOTION_ROLES } from './motion';

/** The emitted subset keeps the active work offset established by machine setup. */
export interface FluidNCPostProfile {
  readonly id: 'fluidnc';
  readonly units: 'mm';
  readonly positionMode: 'absolute';
  readonly arcCenterMode: 'incremental';
  readonly coordinateDecimals: 3;
  readonly maxLineBytes: 127;
  readonly minimumClearance: 0.5;
  readonly startup: readonly string[];
  readonly arcPlanes: readonly [17, 18, 19];
  readonly helicalArcs: true;
}

export const FLUIDNC_POST_PROFILE: FluidNCPostProfile = Object.freeze({
  id: 'fluidnc',
  units: 'mm',
  positionMode: 'absolute',
  arcCenterMode: 'incremental',
  coordinateDecimals: 3,
  maxLineBytes: 127,
  minimumClearance: 0.5,
  startup: Object.freeze(['G21 G90 G94 G17', 'G40 G49 G80']),
  arcPlanes: Object.freeze([17, 18, 19] as const),
  helicalArcs: true,
});

export const quantizePostNumber = (value: number): number => +value.toFixed(FLUIDNC_POST_PROFILE.coordinateDecimals);

function finite(value: number, name: string): void {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) throw new Error(`${name} must be a finite decimal number`);
}

function positive(value: number, name: string): void {
  finite(value, name);
  if (value <= 0 || quantizePostNumber(value) <= 0) throw new Error(`${name} must be positive at the output precision`);
}

export interface PostInputSettings {
  safeZ: number;
  retractZ: number;
  rpm: number;
  dwell: number;
  tolerance: number;
  fallbackRpm: number;
  stockSize?: Vec3;
}

/** Reject malformed plans before any machine program can be returned. */
export function validatePostInput(cam: PartCam, settings: PostInputSettings): void {
  const { safeZ, retractZ, rpm, dwell, tolerance, fallbackRpm, stockSize } = settings;
  finite(cam.stockTop, 'Stock top');
  if (cam.stockTop < 0) throw new Error('Stock top must be at or above the stock bottom');
  finite(safeZ, 'Safe Z');
  finite(retractZ, 'Retract Z');
  const clearance = cam.stockTop + FLUIDNC_POST_PROFILE.minimumClearance;
  if (quantizePostNumber(safeZ) < clearance - 1e-9 || quantizePostNumber(retractZ) < clearance - 1e-9)
    throw new Error(`Safe Z and retract Z must clear stock top by at least ${FLUIDNC_POST_PROFILE.minimumClearance} mm`);
  if (safeZ < retractZ) throw new Error('Safe Z must be at least retract Z');
  positive(rpm, 'Spindle RPM');
  positive(fallbackRpm, 'Default spindle RPM');
  finite(dwell, 'Spindle dwell');
  if (dwell < 0) throw new Error('Spindle dwell must not be negative');
  positive(tolerance, 'Arc tolerance');
  if (tolerance < 10 ** -FLUIDNC_POST_PROFILE.coordinateDecimals) throw new Error('Arc tolerance is smaller than the output precision');
  if (stockSize) stockSize.forEach((value, axis) => positive(value, `Stock size ${axis}`));
  const firstTool = cam.operations[0]?.tool;
  cam.operations.forEach((op, operation) => {
    const where = `Operation ${operation + 1}`;
    const tool = op.tool;
    if (!Number.isInteger(tool.number) || tool.number < 1) throw new Error(`${where}: tool number must be a positive integer`);
    positive(tool.diameter, `${where}: tool diameter`);
    for (const key of ['fluteLength', 'stickout'] as const) if (tool[key] !== undefined) positive(tool[key], `${where}: ${key}`);
    if (tool.flutes !== undefined && (!Number.isInteger(tool.flutes) || tool.flutes < 1))
      throw new Error(`${where}: flutes must be a positive integer`);
    if (firstTool && !samePhysicalTool(firstTool, tool))
      throw new Error('One program per bit: split different physical tools with splitByBit first');
    const resolvedRpm = tool.rpm ?? fallbackRpm;
    positive(resolvedRpm, `${where}: spindle RPM`);
    if (resolvedRpm !== rpm) throw new Error('One spindle speed per program: split different spindle speeds with splitByBit first');
    if (!op.passes.length) throw new Error(`${where} has no passes`);
    op.passes.forEach((pass, index) => {
      const at = `${where}, pass ${index + 1}`;
      if (!pass.pts.length) throw new Error(`${at} has no points`);
      if (pass.feeds.length !== pass.pts.length) throw new Error(`${at}: every point must have a feed`);
      if (pass.roles && pass.roles.length !== pass.pts.length) throw new Error(`${at}: every point must have a motion role`);
      if (pass.roles?.some(role => !MOTION_ROLES.includes(role))) throw new Error(`${at}: unknown motion role`);
      pass.pts.forEach((point, vertex) => {
        if (point.length !== 3) throw new Error(`${at}, point ${vertex + 1} must contain X, Y and Z`);
        point.forEach((value, axis) => finite(value, `${at}, point ${vertex + 1}, axis ${axis}`));
        positive(pass.feeds[vertex], `${at}, point ${vertex + 1} feed`);
      });
    });
  });
}

type ArcPoint = { x: number; y: number; z: number };
type Arc = { c: { x: number; y: number }; cw: boolean };

const directedAngle = (a: number, b: number, cw: boolean): number => {
  let angle = cw ? a - b : b - a;
  while (angle < 0) angle += 2 * Math.PI;
  while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;
  return angle;
};

/**
 * Check the circle the controller will read after XYZ/IJ rounding. A rejected fit
 * is emitted as its original line segments, preserving the planned endpoints.
 */
export function quantizedArcIsSafe(start: ArcPoint, source: ArcPoint[], arc: Arc, tolerance: number): boolean {
  if (source.length < 2) return false;
  if (
    !Number.isFinite(tolerance) ||
    tolerance <= 0 ||
    ![start.x, start.y, start.z, arc.c.x, arc.c.y, ...source.flatMap(p => [p.x, p.y, p.z])].every(Number.isFinite)
  )
    return false;
  const end = source[source.length - 1];
  const q = quantizePostNumber;
  const sx = q(start.x),
    sy = q(start.y),
    sz = q(start.z);
  const ex = q(end.x),
    ey = q(end.y),
    ez = q(end.z);
  const i = q(arc.c.x - sx),
    j = q(arc.c.y - sy);
  if ((!i && !j) || (sx === ex && sy === ey)) return false;
  const cx = sx + i,
    cy = sy + j;
  const radius = Math.hypot(i, j);
  const targetRadius = Math.hypot(ex - cx, ey - cy);
  const radiusError = Math.abs(radius - targetRadius);
  // FluidNC's IJK acceptance test: absolute 0.005 mm or 0.1%, with a 0.5 mm hard bound.
  if (radiusError > 0.005 && (radiusError > 0.5 || radiusError > 0.001 * radius)) return false;
  const begin = Math.atan2(sy - cy, sx - cx);
  const sweep = directedAngle(begin, Math.atan2(ey - cy, ex - cx), arc.cw);
  if (sweep <= 1e-9 || sweep > 2 * Math.PI - 0.025) return false;
  let previousAngle = 0;
  let previousError = Math.abs(source[0].z - sz);
  let previousRadialError = Math.abs(Math.hypot(source[0].x - cx, source[0].y - cy) - radius);
  for (let index = 0; index < source.length; index++) {
    const p = source[index];
    const angle = index === 0 ? 0 : index === source.length - 1 ? sweep : directedAngle(begin, Math.atan2(p.y - cy, p.x - cx), arc.cw);
    if (angle < previousAngle - 1e-7 || angle > sweep + 1e-7) return false;
    const error = Math.abs(p.z - (sz + ((ez - sz) * angle) / sweep));
    const radialError = Math.abs(Math.hypot(p.x - cx, p.y - cy) - radius);
    if (Math.hypot(error, radialError) > tolerance) return false;
    if (index > 0) {
      const a = source[index - 1];
      const dx = p.x - a.x,
        dy = p.y - a.y;
      const length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / length2)) : 0;
      const nearestRadius = Math.hypot(a.x + t * dx - cx, a.y + t * dy - cy);
      const radialBound = Math.max(previousRadialError, radialError, Math.abs(nearestRadius - radius));
      const angleDelta = angle - previousAngle;
      if (angleDelta > Math.PI / 4 + 1e-7) return false;
      // Conservative bound for Z interpolation between vertices on a circular chord.
      const zCurveBound = Math.abs(p.z - a.z) * (1 - Math.cos(angleDelta / 2));
      if (Math.hypot(radialBound, Math.max(previousError, error) + zCurveBound) > tolerance) return false;
    }
    previousAngle = angle;
    previousError = error;
    previousRadialError = radialError;
  }
  return true;
}

/** Validate only the command subset emitted by this post, including modal lines. */
export function validateFluidNCOutput(program: string): void {
  const encoder = new TextEncoder();
  const gCodes = new Set([0, 1, 2, 3, 4, 17, 18, 19, 21, 40, 49, 53, 80, 90, 94]);
  const mCodes = new Set([0, 3, 5, 30]);
  for (const [index, raw] of program.split('\n').entries()) {
    if (encoder.encode(raw).length > FLUIDNC_POST_PROFILE.maxLineBytes)
      throw new Error(`Output line ${index + 1} exceeds the controller line limit`);
    const code = raw.replace(/\([^()]*\)/g, '').trim();
    const words = [...code.matchAll(/([A-Z])(-?(?:\d+(?:\.\d*)?|\.\d+))/g)];
    if (code.replace(/([A-Z])(-?(?:\d+(?:\.\d*)?|\.\d+))/g, '').trim()) throw new Error(`Invalid output on line ${index + 1}`);
    for (const [, word, number] of words) {
      const value = Number(number);
      if (!Number.isFinite(value) || (word === 'G' ? !gCodes.has(value) : word === 'M' ? !mCodes.has(value) : !'XYZIJKFSP'.includes(word)))
        throw new Error(`Unsupported output word ${word}${number} on line ${index + 1}`);
      if (word === 'F' && value <= 0) throw new Error(`Nonpositive output feed on line ${index + 1}`);
    }
  }
}
