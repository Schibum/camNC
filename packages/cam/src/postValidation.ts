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
  /** Supported magnitude of emitted absolute XYZ coordinates, mm. */
  readonly maximumCoordinate: 4096;
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
  maximumCoordinate: 4096,
  maxLineBytes: 127,
  minimumClearance: 0.5,
  startup: Object.freeze(['G21 G90 G94 G17', 'G40 G49 G80']),
  arcPlanes: Object.freeze([17, 18, 19] as const),
  helicalArcs: true,
});

export const quantizePostNumber = (value: number): number => +value.toFixed(FLUIDNC_POST_PROFILE.coordinateDecimals);

/** Parse the emitted decimal using the controller's bounded integer/float32 conversion. */
export function parsedPostNumber(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) throw new Error('Controller numbers must be finite decimals');
  const text = value.toFixed(FLUIDNC_POST_PROFILE.coordinateDecimals).replace(/\.?0+$/, '');
  let integer = 0,
    exponent = 0,
    digits = 0,
    decimal = false;
  for (const char of text) {
    if (char === '-') continue;
    if (char === '.') {
      decimal = true;
      continue;
    }
    digits++;
    if (digits <= 8) {
      if (decimal) exponent--;
      integer = integer * 10 + Number(char);
    } else if (!decimal) exponent++;
  }
  const f = Math.fround;
  let result = f(integer);
  while (exponent <= -2) {
    result = f(result * f(0.01));
    exponent += 2;
  }
  if (exponent < 0) result = f(result * f(0.1));
  while (exponent > 0) {
    result = f(result * 10);
    exponent--;
  }
  return value < 0 ? -result : result;
}

function finite(value: number, name: string): void {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e21) throw new Error(`${name} must be a finite decimal number`);
}

function positive(value: number, name: string): void {
  finite(value, name);
  if (value <= 0 || quantizePostNumber(value) <= 0) throw new Error(`${name} must be positive at the output precision`);
}

function coordinate(value: number, name: string): void {
  finite(value, name);
  if (Math.abs(value) > FLUIDNC_POST_PROFILE.maximumCoordinate)
    throw new Error(`${name} exceeds the supported ±${FLUIDNC_POST_PROFILE.maximumCoordinate} mm coordinate window`);
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
  coordinate(cam.stockTop, 'Stock top');
  if (cam.stockTop < 0) throw new Error('Stock top must be at or above the stock bottom');
  coordinate(safeZ, 'Safe Z');
  coordinate(retractZ, 'Retract Z');
  const clearance = cam.stockTop + FLUIDNC_POST_PROFILE.minimumClearance;
  if (parsedPostNumber(safeZ) < clearance - 1e-9 || parsedPostNumber(retractZ) < clearance - 1e-9)
    throw new Error(`Safe Z and retract Z must clear stock top by at least ${FLUIDNC_POST_PROFILE.minimumClearance} mm`);
  if (safeZ < retractZ) throw new Error('Safe Z must be at least retract Z');
  positive(rpm, 'Spindle RPM');
  positive(fallbackRpm, 'Default spindle RPM');
  finite(dwell, 'Spindle dwell');
  if (dwell < 0) throw new Error('Spindle dwell must not be negative');
  positive(tolerance, 'Arc tolerance');
  if (tolerance < 10 ** -FLUIDNC_POST_PROFILE.coordinateDecimals) throw new Error('Arc tolerance is smaller than the output precision');
  if (stockSize)
    stockSize.forEach((value, axis) => {
      positive(value, `Stock size ${axis}`);
      coordinate(value, `Stock size ${axis}`);
    });
  const firstTool = cam.operations[0]?.tool;
  cam.operations.forEach((op, operation) => {
    const where = `Operation ${operation + 1}`;
    const tool = op.tool;
    if (!Number.isInteger(tool.number) || tool.number < 0) throw new Error(`${where}: tool number must be a nonnegative integer`);
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
        point.forEach((value, axis) => coordinate(value, `${at}, point ${vertex + 1}, axis ${axis}`));
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
 * The command-frame proof reserves separate controller rounding for offset
 * arithmetic within the supported coordinate window; it cannot inspect an active work offset.
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
  const p = parsedPostNumber,
    f = Math.fround;
  if ([start, ...source].some(point => [point.x, point.y, point.z].some(value => Math.abs(value) > FLUIDNC_POST_PROFILE.maximumCoordinate)))
    return false;
  const sx = p(start.x),
    sy = p(start.y),
    sz = p(start.z);
  const ex = p(end.x),
    ey = p(end.y),
    ez = p(end.z);
  // The emitted IJ offset is relative to the decimal start, not its parsed float.
  const i = p(arc.c.x - q(start.x)),
    j = p(arc.c.y - q(start.y));
  if ((!i && !j) || (sx === ex && sy === ey)) return false;
  const cx = f(sx + i),
    cy = f(sy + j);
  // Motion rotates the parsed IJ vector; its norm defines the continuous envelope.
  // The separate float32 norm below controls parser acceptance and segment count.
  const radius = Math.hypot(i, j);
  const hypot = (x: number, y: number) => f(Math.sqrt(f(f(x * x) + f(y * y))));
  const controllerRadius = hypot(i, j);
  const targetRadius = hypot(f(f(ex - sx) - i), f(f(ey - sy) - j));
  const radiusError = f(Math.abs(f(controllerRadius - targetRadius)));
  // FluidNC's IJK acceptance test: absolute 0.005 mm or 0.1%, with a 0.5 mm hard bound.
  if (radiusError > 0.005 && (radiusError > 0.5 || radiusError > 0.001 * controllerRadius)) return false;
  const rx = -i,
    ry = -j,
    tx = f(ex - cx),
    ty = f(ey - cy);
  const begin = Math.atan2(ry, rx);
  let travel = f(Math.atan2(f(f(rx * ty) - f(ry * tx)), f(f(rx * tx) + f(ry * ty))));
  if (arc.cw && travel >= -5e-7) travel = f(travel - f(2 * f(Math.PI)));
  if (!arc.cw && travel <= 5e-7) travel = f(travel + f(2 * f(Math.PI)));
  const sweep = Math.abs(travel);
  if (sweep <= 1e-9 || sweep > 2 * Math.PI - 0.025) return false;
  let previousAngle = 0;
  let previousError = Math.abs(source[0].z - sz);
  let previousXYError = Math.hypot(source[0].x - sx, source[0].y - sy);
  for (let index = 0; index < source.length; index++) {
    const point = source[index];
    const angle =
      index === 0 ? 0 : index === source.length - 1 ? sweep : directedAngle(begin, Math.atan2(point.y - cy, point.x - cx), arc.cw);
    if (angle < previousAngle - 1e-7 || angle > sweep + 1e-7) return false;
    const error = Math.abs(point.z - (sz + ((ez - sz) * angle) / sweep));
    const theta = begin + (arc.cw ? -angle : angle);
    let xyError = Math.hypot(point.x - (cx + radius * Math.cos(theta)), point.y - (cy + radius * Math.sin(theta)));
    if (index === 0) xyError = Math.max(xyError, Math.hypot(point.x - sx, point.y - sy));
    if (index === source.length - 1) xyError = Math.max(xyError, Math.hypot(point.x - ex, point.y - ey));
    if (Math.hypot(error, xyError) > tolerance) return false;
    if (index > 0) {
      const angleDelta = angle - previousAngle;
      if (angleDelta > Math.PI / 4 + 1e-7) return false;
      // Couple each source chord and circle interval by the same linear angular
      // parameter. Endpoint XY error interpolates convexly; the circle's second
      // derivative bounds interpolation error by R * angle² / 8. Z is affine.
      const xyBound = Math.max(previousXYError, xyError) + (radius * angleDelta * angleDelta) / 8;
      if (Math.hypot(xyBound, Math.max(previousError, error)) > tolerance) return false;
    }
    previousAngle = angle;
    previousError = error;
    previousXYError = xyError;
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
      if ('XYZ'.includes(word)) coordinate(value, `Output ${word} on line ${index + 1}`);
    }
  }
}
