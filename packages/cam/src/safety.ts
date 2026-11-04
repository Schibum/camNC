import { readGcode } from './analyze';
import { kMaxGcodeLine, toGcode } from './gcode';
import type { PartCam } from './toolpaths';

export interface SafetyLimits {
  /** Z of the stock top (Z0 = stock bottom). */
  stockTop: number;
  /** Board size in X and Y (the part's bounding box, X0 Y0 at its lower left). */
  size: [number, number];
  /** The board lies turned by this much about the XY zero (degrees, counterclockwise), and the program with it. */
  rotationDeg?: number;
  /** Deepest allowed Z (the through-cut depth, e.g. -0.3). */
  minZ: number;
  /** Largest tool radius used: tool centers may go this far + `margin` outside the board. */
  toolRadius: number;
  /** Extra room outside the board: open pockets run r+1mm past the edge, outlines r+leave. Default 1.5 mm. */
  margin?: number;
  /** Rapids must stay this far above the stock top. Default 0.5 mm. */
  rapidClearance?: number;
  /** Fastest sane cutting feed, mm/min: a typo in the cutting data must not reach the wood. Default `kMaxFeed`. */
  maxFeed?: number;
}

/** No router this CAM drives cuts wood faster than this. */
export const kMaxFeed = 9000;

export interface SafetyIssue {
  rule: 'rapid-in-stock' | 'outside-board' | 'too-deep' | 'spindle-off' | 'bad-feed' | 'line-too-long';
  /** Index of the offending move (arcs count once per chord); -1 for a line that isn't one. */
  move: number;
  message: string;
}

/**
 * Rules every generated program must keep, whatever the settings: no rapid move into or through the stock (below its
 * top + clearance; straight-up retracts are fine), no move outside the board (+ tool radius and margin), never deeper
 * than the through-cut depth, no cut with the spindle stopped, no cutting feed that is missing or absurd. These two are
 * reported once per stretch and once per feed: a stopped spindle would otherwise count every move after it. And no
 * line FluidNC refuses for its length, which would stop the job mid-cut.
 */
export function checkGcodeSafety(gcode: string, limits: SafetyLimits): SafetyIssue[] {
  const margin = limits.margin ?? 1.5;
  const clearance = limits.rapidClearance ?? 0.5;
  const reach = limits.toolRadius + margin;
  const maxFeed = limits.maxFeed ?? kMaxFeed;
  const issues: SafetyIssue[] = [];
  const badFeeds = new Set<number>();
  let spindleFlagged = false;
  const fmt = (p: number[]) => p.map(v => +v.toFixed(3)).join(', ');
  const encoder = new TextEncoder();
  gcode.split(/\r?\n/).forEach((line, i) => {
    if (encoder.encode(line).length > kMaxGcodeLine)
      issues.push({ rule: 'line-too-long', move: -1, message: `line ${i + 1} is longer than FluidNC accepts: ${line.slice(0, 40)}…` });
  });
  // A move's place on the board: turned back by the angle the board lies at.
  const a = (-(limits.rotationDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a),
    sin = Math.sin(a);
  readGcode(gcode).forEach((m, i) => {
    // The machine starts wherever it is: the first move only says where it goes.
    if (i === 0 && m.rapid) return;
    const lowest = Math.min(m.from[2], m.to[2]);
    const sideways = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]) > 1e-6;
    // Retracting straight up out of a cut is fine; ending low or moving sideways while low is not.
    if (m.rapid && (m.to[2] < limits.stockTop + clearance || (sideways && lowest < limits.stockTop + clearance)))
      issues.push({
        rule: 'rapid-in-stock',
        move: i,
        message: `rapid move at Z${+lowest.toFixed(3)} to (${fmt(m.to)}) is inside the stock`,
      });
    const x = m.to[0] * cos - m.to[1] * sin;
    const y = m.to[0] * sin + m.to[1] * cos;
    const inside = x >= -reach && y >= -reach && x <= limits.size[0] + reach && y <= limits.size[1] + reach;
    if (!inside && lowest < limits.stockTop + clearance)
      issues.push({ rule: 'outside-board', move: i, message: `move to (${fmt(m.to)}) leaves the board` });
    if (m.to[2] < limits.minZ - 1e-3)
      issues.push({ rule: 'too-deep', move: i, message: `move to Z${+m.to[2].toFixed(3)} is below ${limits.minZ}` });
    if (m.spindle) spindleFlagged = false;
    if (m.rapid) return;
    if (!m.spindle && lowest < limits.stockTop && !spindleFlagged) {
      spindleFlagged = true;
      issues.push({ rule: 'spindle-off', move: i, message: `cutting move to (${fmt(m.to)}) with the spindle off` });
    }
    if ((m.feed <= 0 || m.feed > maxFeed) && !badFeeds.has(m.feed)) {
      badFeeds.add(m.feed);
      issues.push({
        rule: 'bad-feed',
        move: i,
        message: m.feed > 0 ? `feed F${m.feed} is above the limit of ${maxFeed} mm/min` : `move to (${fmt(m.to)}) has no feed`,
      });
    }
  });
  return issues;
}

/**
 * The rules for a program made from `cam`. Dowel pin holes go into the spoilboard on purpose: only they may go below
 * `limits.minZ`, every other operation of the program is held to it.
 */
export function checkProgramSafety(cam: PartCam, gcode: string, limits: SafetyLimits): SafetyIssue[] {
  const isDowelHole = (o: PartCam['operations'][number]) => o.name.startsWith('Dowel pin hole');
  const holes = cam.operations.filter(isDowelHole);
  if (!holes.length) return checkGcodeSafety(gcode, limits);
  const rest = cam.operations.filter(o => !isDowelHole(o));
  const deepest = Math.min(limits.minZ, ...holes.flatMap(o => o.passes.flatMap(p => p.pts.map(q => q[2]))));
  return [
    ...checkGcodeSafety(gcode, { ...limits, minZ: deepest }),
    ...(rest.length ? checkGcodeSafety(toGcode({ ...cam, operations: rest }), limits).filter(i => i.rule === 'too-deep') : []),
  ];
}
