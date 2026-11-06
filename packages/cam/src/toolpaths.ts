import type { SpindleSwitch } from './gcode';
import { CamInputError, validateCamSettings, validateFeatures, validateDepthRange, validatePaths, validateTool } from './validation';
import { areaD, pointInPolygonD, PointInPolygonResult, simplifyPathsD, type PathD, type PathsD } from 'clipper2-ts';
import { openPocketRegion, type PartFeatures } from './features';
import { cleanRegion, clipLines, difference, intersect, offset, pathLength, polyArea, union, type Vec3 } from './geom';
import { applyFeedPolicy, type CornerFeedSettings, type MotionRole } from './motion';
import { profileEntryRegion, tangentLoopPass } from './entry';
import { applyTabMotion, repeatTabIntervals } from './tabMotion';
import { correctCircularFinish, verticalEntryBlend, verticalExitBlend } from './finishing';
import { geometryTolerances, planAccuracy, type PlanAccuracy } from './accuracy';
import { planControlledPocket } from './engagement';
import { finalizePlan, type StockSummary } from './finalizePlan';
import type { PocketTransitionPolicy } from './stock';

export interface Tool {
  number: number;
  /** Stable tool-library identity, independent of its editable name. */
  guid?: string;
  presetId?: string;
  presetName?: string;
  /** Flat end mill diameter in mm. */
  diameter: number;
  name?: string;
  /** Depth per pass with this bit (its cutting data); default: the material's share of the diameter. */
  stepdown?: number;
  /** The rest of this bit's cutting data; default: the job's (`CamSettings`). */
  feed?: number;
  plungeFeed?: number;
  rampFeed?: number;
  leadFeed?: number;
  leadOutFeed?: number;
  finishFeed?: number;
  reducedFeed?: number;
  transitionFeed?: number;
  /** Spindle speed of the program this bit cuts (M3 S). */
  rpm?: number;
  /** Sideways step between pocket rings, mm. */
  stepover?: number;
  finalFeedFactor?: number;
  /** Length of cut, mm: deeper cuts get a warning. */
  fluteLength?: number;
  flutes?: number;
  /** Measured distance from the collet nut to the tip, mm. */
  stickout?: number;
}

export { MATERIALS, DEFAULT_TABS, type Material, type TabSettings } from './settings';
import { MATERIALS, DEFAULT_TABS, type Material, type TabSettings } from './settings';
import type { PartHolding } from './tabPlan';

export interface CamSettings {
  /** Only for the G-code (`GcodeOptions.spindle`): the toolpaths are the same. */
  spindle?: SpindleSwitch;
  tools: Tool[];
  material: Material;
  feed: number;
  plungeFeed: number;
  /** Defaults to the effective plunge feed. */
  rampFeed?: number;
  /** Tangent entry/exit feeds default to the cutting feed. */
  leadFeed?: number;
  leadOutFeed?: number;
  finishFeed?: number;
  reducedFeed?: number;
  transitionFeed?: number;
  /** Undefined uses tool-size-based defaults; false disables geometric corner reduction. */
  cornerFeed?: CornerFeedSettings | false;
  profileEntry?: 'plunge' | 'ramp' | 'tangent';
  profileLeadRadius?: number;
  /** Optional vertical entry blend, constrained by the axial step and first segment; 0 = off. */
  profileVerticalLeadRadius?: number;
  /** Optional upward blend after a complete inside-hole lap; 0 = off. Outside profiles retain their final template. */
  profileVerticalExitRadius?: number;
  /** Repeated complete finishing laps at the final depth, 0..5. */
  profileSpringPasses?: number;
  pocketSpringPasses?: number;
  /** Correct contact speed only on positively identified circular inside finishing motion. */
  circularFinishFeed?: boolean;
  pocketStrategy?: 'offset' | 'controlled';
  minimumRoughingRadius?: number;
  /** Configured feature-to-motion tolerance. Source error is included only when explicitly declared. */
  geometryTolerance?: number;
  sourceTolerance?: number;
  /** Newly swept planar material area per minute, evaluated over each resolved block. Axial entries are separate. */
  maxPlanarRemovalRate?: number;
  minimumCuttingFeed?: number;
  /** Explicit original blank boundary; omit when surrounding stock is unknown. */
  blankFootprint?: PathsD;
  stepoverFactor: number;
  /** Spindle speed the program starts the spindle at (M3 S), for a bit without its own. */
  spindleRpm?: number;
  /** Max stepdown in mm for pockets and outline roughing; default: the material's factor × the bit diameter. */
  maxStepdown?: number;
  /** Max stepdown for outline roughing, overriding the general cutting depth. */
  profileStepdown?: number;
  /** Optional maximum profile finishing depth increment; omit for one full-depth finish. */
  profileFinishStepdown?: number;
  /** Roughing passes stop this high above the stock bottom... */
  profileRoughBottom: number;
  /** ...leaving this much radial stock for the final pass: the outline's wall allowance. */
  leaveStock: number;
  /**
   * Pocket wall allowance: roughing stays this far off the walls, then bounded-depth wall passes cut them to size.
   * 0 = off: the wall ring is cut at every depth.
   */
  pocketWallAllowance: number;
  /** Axial stock left by roughing, then removed by floor finishing. */
  pocketFloorAllowance?: number;
  /** Maximum axial depth of wall/floor finishing; defaults to the roughing stepdown. */
  pocketFinishStepdown?: number;
  /**
   * The same for pockets open to the edge (rabbets), where it's on by default: rows cut toward the walls stop this
   * far off them, then bounded-depth climb passes finish the walls. 0 = the last row cuts the walls.
   */
  openWallAllowance?: number;
  pocketFinishFeedFactor: number;
  /** Rounds the corners of inner pocket rings (not the wall ring) so the bit doesn't stop and turn; 0 = sharp. */
  innerCornerRadius: number;
  /** Final outline pass goes down to here (below the stock bottom). */
  finalZ: number;
  /**
   * The outline's final pass stops here instead (above the stock bottom): a bottom skin holds the part in the board
   * until it's freed at the machine. Holes still go through.
   */
  outlineFloor?: number;
  finalFeedFactor: number;
  climb: boolean;
  rampAngleDeg: number;
  /** Clearance heights, relative to the stock top. */
  safeHeight: number;
  retractHeight: number;
  tabs: TabSettings | false;
  /**
   * Z of the stock top when the board is thicker than the part (allowance, or measured at the machine). Cuts start
   * there; the part's top face is not faced. Default: the part's top.
   */
  stockTop?: number;
  /** Cut through holes and outlines (off for a flipped second setup that only does the bottom pockets). */
  cutThrough: boolean;
}

export const DEFAULT_TOOL: Tool = { number: 1, diameter: 3.175, name: 'flat end mill' };

export const DEFAULT_SETTINGS: CamSettings = {
  tools: [DEFAULT_TOOL],
  material: MATERIALS.oak,
  feed: 1800,
  plungeFeed: 480,
  stepoverFactor: 0.4,
  profileRoughBottom: 1,
  leaveStock: 0.1,
  pocketWallAllowance: 0,
  pocketFinishFeedFactor: 1,
  innerCornerRadius: 0.3,
  finalZ: -0.3,
  finalFeedFactor: 0.5,
  climb: true,
  rampAngleDeg: 3,
  profileEntry: 'ramp',
  pocketStrategy: 'offset',
  geometryTolerance: 0.05,
  safeHeight: 5,
  retractHeight: 2,
  tabs: false,
  cutThrough: true,
};

/** A continuous cutting move. The tool reaches pts[0] either by retract/rapid/plunge or by a direct feed move. */
export interface Pass {
  pts: Vec3[];
  /** Feed of the move ending at pts[i]; feeds[0] is used for the approach. */
  feeds: number[];
  roles?: MotionRole[];
  /** Known side of the remaining wall material; omitted when no geometric side is established. */
  materialSide?: 'left' | 'right';
  phase?: 'rough' | 'finish';
  entry?: 'plunge' | 'ramp' | 'tangent';
  spring?: boolean;
  circularFeedFactor?: number;
  verticalBlendRadius?: number;
  auxiliary?: 'entry' | 'exit';
  link: 'retract' | 'direct';
  /** The straight link to pts[0] runs through material already cleared at this depth (may be longer than D). */
  clearLink?: boolean;
  /** Generated cutting stepover; its explicit prefix is independently rechecked after ordering and at post. */
  cuttingTransition?: { from: Vec3; to: Vec3 };
}

export interface Operation {
  name: string;
  kind: 'pocket' | 'profile';
  /** What it cuts: board programs put inner features (pockets, holes) before outlines. */
  feature: 'pocket' | 'hole' | 'outline';
  tool: Tool;
  /** Resolved approach feed, retained when the post must replace an unproved link with a plunge. */
  plungeFeed?: number;
  pocketTransition?: PocketTransitionPolicy;
  passes: Pass[];
  /** Pause (M0) before this operation with this message, e.g. guided tab removal. */
  pauseBefore?: string;
  /** For people, in the words of the Model step's feature list: "9 pockets 4.2 deep + edge groove to 4.2". */
  title?: string;
  /** Planning choices that required a conservative entry fallback. */
  warnings?: string[];
  residualStock?: { floorZ: number; remaining: PathsD; unreachable: PathsD; reachableArea: number; minimumTurnRadius: number };
  /** Pause (M0) after this operation with this message, the spindle off and the bit up (e.g. "take the part out"). */
  pauseAfter?: string;
  /** The part this operation frees or cuts the tabs of: named in the pause marker (`pauseMarker`) for the machine view. */
  part?: string;
}

export interface PartCam {
  stockTop: number;
  operations: Operation[];
  warnings: string[];
  /** Boards with tabs or a skin: how each part is held (tabs where they hold, a skin, or nothing). */
  holding?: PartHolding[];
  /** Absolute Z of moves between operations, above the stock and any holds. */
  safeZ?: number;
  /** The same for retract links between passes. */
  retractZ?: number;
  /** Original blank material; through holes and final cutouts are not initial air. */
  stockFootprint?: PathsD;
  /** Configured stage limits, not a measured source/CAD accuracy certificate. */
  accuracy?: PlanAccuracy;
  stockSummary?: StockSummary;
}

// ---- helpers ----

type Loop = PathD;

const offsetToleranceFor = (settings: CamSettings) => geometryTolerances(settings.geometryTolerance, settings.sourceTolerance).offset;

const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

/** Start the loop at the point on it (vertex or edge) nearest to p. */
function rotateToNearest(loop: Loop, p: { x: number; y: number }): Loop {
  let best = 0,
    bd = Infinity,
    bq = loop[0];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = dist2(p, q);
    if (d < bd) {
      bd = d;
      best = i;
      bq = q;
    }
  }
  const rest = [...loop.slice(best + 1), ...loop.slice(0, best + 1)];
  // Avoid a zero-length first segment when the nearest point is a vertex.
  if (dist2(rest[rest.length - 1], bq) < 1e-12) rest.pop();
  if (dist2(rest[0], bq) < 1e-12) rest.shift();
  return [bq, ...rest];
}

const outsideAll = (p: { x: number; y: number }, solid: PathsD) =>
  solid.every(o => pointInPolygonD(p, o) === PointInPolygonResult.IsOutside);

/**
 * For a pocket that is open to the part's edge: the loop rotated to start at the longest edge that lies in the waste
 * outside the part (loop[0] -> loop[1]). Undefined for closed pockets.
 */
function rotateToWaste(loop: Loop, solid: PathsD): Loop | undefined {
  let best = -1,
    bl = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    const l = dist2(a, b);
    if (l > bl && outsideAll(a, solid) && outsideAll(b, solid)) {
      bl = l;
      best = i;
    }
  }
  if (best < 0) return undefined;
  return [...loop.slice(best), ...loop.slice(0, best)];
}

/**
 * Entry for a loop that starts on a waste edge (see rotateToWaste): zigzag ramp along that edge until zTo, so the
 * whole descent stays outside the part however long the ramp, then one full lap at zTo from there.
 */
function rampOnWasteEdge(loop: Loop, zFrom: number, zTo: number, s: CamSettings): Pass {
  const [a, b] = loop;
  const edge = Math.sqrt(dist2(a, b));
  const slope = Math.tan((s.rampAngleDeg * Math.PI) / 180);
  if ((zFrom - zTo) / (edge * slope) > 1000)
    throw new CamInputError([{ field: 'rampAngleDeg', message: 'would require more than 1000 entry traversals' }]);
  const pts: Vec3[] = [[a.x, a.y, zFrom]];
  const feeds = [s.plungeFeed];
  let z = zFrom,
    forward = true;
  for (let leg = 0; z > zTo && leg < 1000; leg++, forward = !forward) {
    const drop = edge * slope;
    const t = z - drop > zTo ? 1 : (z - zTo) / drop;
    const [from, to] = forward ? [a, b] : [b, a];
    z = Math.max(zTo, z - drop);
    pts.push([from.x + t * (to.x - from.x), from.y + t * (to.y - from.y), z]);
    feeds.push(s.feed);
  }
  // Lap at depth: on to b, around the loop back to a, then to where the ramp ended.
  const end = pts[pts.length - 1];
  for (const p of [...loop.slice(1), a]) {
    pts.push([p.x, p.y, zTo]);
    feeds.push(s.feed);
  }
  pts.push([end[0], end[1], zTo]);
  feeds.push(s.feed);
  return { pts, feeds, link: 'retract' };
}

/** Inside a region given as Clipper paths (outer loops + holes), by crossing parity. */
function insideRegion(p: { x: number; y: number }, region: PathsD) {
  let n = 0;
  for (const path of region) if (pointInPolygonD(p, path) === PointInPolygonResult.IsInside) n++;
  return n % 2 === 1;
}

function segmentInside(a: { x: number; y: number }, b: { x: number; y: number }, region: PathsD) {
  const n = Math.max(2, Math.ceil(Math.sqrt(dist2(a, b)) / 0.5));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!insideRegion({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }, region)) return false;
  }
  return true;
}

/**
 * A wall pass with tangent quarter-arc lead-in and lead-out from the pocket interior: the bit never
 * moves into the wall, it joins and leaves it along its direction. Entry in the middle of the straight wall segment
 * nearest to `from`; the arc radius starts at r and shrinks until the arcs fit into `free` (where the bit center can
 * go). Undefined if no arc fits (then the caller cuts the loop plainly).
 */
function wallPassWithLeads(
  loop: Loop,
  from: { x: number; y: number },
  z: number,
  feed: number,
  r: number,
  free: PathsD,
  tolerance = 0.005
): Pass | undefined {
  const n = loop.length;
  const segs = loop
    .map((a, i) => ({ i, a, b: loop[(i + 1) % n], len: Math.sqrt(dist2(a, loop[(i + 1) % n])) }))
    .filter(sg => sg.len > 0.2)
    .sort((p, q) => q.len - p.len);
  if (!segs.length) return undefined;
  // Long straight segments (at least half as long as the longest) qualify; the nearest one wins.
  const long = segs.filter(sg => sg.len >= segs[0].len / 2);
  const mid = (sg: (typeof segs)[number]) => ({ x: (sg.a.x + sg.b.x) / 2, y: (sg.a.y + sg.b.y) / 2 });
  const seg = long.reduce((best, sg) => (dist2(mid(sg), from) < dist2(mid(best), from) ? sg : best));
  const P = mid(seg);
  const t = { x: (seg.b.x - seg.a.x) / seg.len, y: (seg.b.y - seg.a.y) / seg.len };
  let nrm = { x: -t.y, y: t.x };
  if (!insideRegion({ x: P.x + nrm.x * 0.05, y: P.y + nrm.y * 0.05 }, free)) nrm = { x: t.y, y: -t.x };
  // +1: the normal is t turned left, so both arcs turn left (CCW); -1 right.
  const sense = nrm.x === -t.y && nrm.y === t.x ? 1 : -1;
  for (const rho of [r, 0.75 * r, 0.5 * r, 0.25 * r]) {
    if (rho > seg.len / 2) continue;
    const C = { x: P.x + nrm.x * rho, y: P.y + nrm.y * rho };
    // Points on the circle: C + rho * rotate(-t, angle).
    const at = (deg: number) => {
      const a = (sense * deg * Math.PI) / 180;
      const vx = -t.x,
        vy = -t.y;
      return { x: C.x + rho * (vx * Math.cos(a) - vy * Math.sin(a)), y: C.y + rho * (vx * Math.sin(a) + vy * Math.cos(a)) };
    };
    const steps = Math.max(6, Math.ceil(Math.PI / 2 / (2 * Math.acos(Math.max(-1, 1 - Math.min(tolerance, rho) / rho)))));
    const leadIn = Array.from({ length: steps }, (_, i) => at((90 * i) / steps));
    const leadOut = Array.from({ length: steps }, (_, i) => at(90 + (90 * (i + 1)) / steps));
    if (![...leadIn, ...leadOut].every(q => insideRegion(q, free))) continue;
    const lap = [P, ...loop.slice(seg.i + 1), ...loop.slice(0, seg.i + 1), P];
    const pts: Vec3[] = [...leadIn, ...lap, ...leadOut].map(q => [q.x, q.y, z]);
    const roles: MotionRole[] = pts.map((_, i) =>
      i === 0 ? 'link' : i <= leadIn.length ? 'lead-in' : i < leadIn.length + lap.length ? 'cut' : 'lead-out'
    );
    return { pts, feeds: pts.map(() => feed), roles, link: 'direct' };
  }
  return undefined;
}

/** Start in the middle of the longest edge so lead-in marks don't land on a corner. */
function rotateToLongestEdge(loop: Loop): Loop {
  let best = 0,
    bl = -1;
  for (let i = 0; i < loop.length; i++) {
    const l = dist2(loop[i], loop[(i + 1) % loop.length]);
    if (l > bl) {
      bl = l;
      best = i;
    }
  }
  const a = loop[best],
    b = loop[(best + 1) % loop.length];
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return [mid, ...loop.slice(best + 1), ...loop.slice(0, best + 1)];
}

const closeLoop = (loop: Loop, z: number): Vec3[] => [...loop, loop[0]].map(p => [p.x, p.y, z]);

/** Move a contour's seam to a known point on it, retaining the exact previous XY pose. */
function contourFromPoint(loop: Loop, point: Vec3): Loop | undefined {
  const start = { x: point[0], y: point[1] };
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    if (start.x === a.x && start.y === a.y) return [start, ...loop.slice(i + 1), ...loop.slice(0, i)];
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length2 = dx * dx + dy * dy;
    if (length2 === 0) continue;
    const t = ((start.x - a.x) * dx + (start.y - a.y) * dy) / length2;
    if (t < 0 || t > 1 || Math.hypot(a.x + t * dx - start.x, a.y + t * dy - start.y) > 1e-9) continue;
    if (start.x === b.x && start.y === b.y) {
      const next = (i + 1) % loop.length;
      return [start, ...loop.slice(next + 1), ...loop.slice(0, next)];
    }
    return [start, ...loop.slice(i + 1), ...loop.slice(0, i + 1)];
  }
  return undefined;
}

/** Ramp down along a closed loop from zFrom to zTo, then one full lap at zTo. Plunges if the loop is tiny. */
function rampLoop(loop: Loop, zFrom: number, zTo: number, s: CamSettings, tool: Tool): Pass {
  const per = pathLength(loop, true);
  const pts: Vec3[] = [];
  const feeds: number[] = [];
  if (per < tool.diameter || zFrom <= zTo) {
    pts.push([loop[0].x, loop[0].y, zTo]);
    feeds.push(s.plungeFeed);
  } else {
    const rampLen = (zFrom - zTo) / Math.tan((s.rampAngleDeg * Math.PI) / 180);
    if (Math.ceil(rampLen / per) * loop.length > 100_000)
      throw new CamInputError([{ field: 'rampAngleDeg', message: 'would require more than 100000 entry segments' }]);
    pts.push([loop[0].x, loop[0].y, zFrom]);
    feeds.push(s.plungeFeed);
    let travelled = 0;
    const closed = [...loop, loop[0]];
    outer: for (;;) {
      for (let i = 1; i < closed.length; i++) {
        const a = closed[i - 1],
          b = closed[i];
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (travelled + seg >= rampLen) {
          const t = (rampLen - travelled) / seg;
          const bottom: Vec3 = [a.x + t * (b.x - a.x), a.y + t * (b.y - a.y), zTo];
          pts.push(bottom);
          feeds.push(s.feed);
          // Continue from here for a full lap at depth, back to where the ramp reached the bottom.
          for (const p of [...closed.slice(i, closed.length - 1), ...closed.slice(0, i)]) {
            pts.push([p.x, p.y, zTo]);
            feeds.push(s.feed);
          }
          pts.push([...bottom]);
          feeds.push(s.feed);
          break outer;
        }
        travelled += seg;
        pts.push([b.x, b.y, zFrom - (travelled / rampLen) * (zFrom - zTo)]);
        feeds.push(s.feed);
      }
    }
  }
  if (pts.length === 1) {
    for (const p of closeLoop(loop, zTo).slice(1)) {
      pts.push(p);
      feeds.push(s.feed);
    }
  }
  return { pts, feeds, link: 'retract' };
}

/** Split polygons-with-holes into components (outer + the holes inside it). */
const round2 = (v: number) => +v.toFixed(2);
const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);

/**
 * What a pocket operation cuts, as the Model step names features: closed pockets and edge grooves (open to the
 * outline) that end at this floor, and the ones it only cuts the first part of (they go deeper later).
 */
function pocketTitle(f: PartFeatures, i: number, region: PathsD, top: number): string {
  const p = f.pockets[i];
  const depth = round2(f.thickness - p.floorZ);
  const deeper = f.pockets.slice(i + 1).flatMap(q => q.strictRegion);
  const n = { pockets: 0, grooves: 0, pocketsOn: 0, groovesOn: 0 };
  for (const c of components(region)) {
    if (polyArea(c) < 1) continue;
    // Its floor is here only where it doesn't go on to a deeper level.
    const own = intersect(c, p.strictRegion);
    const endsHere = polyArea(deeper.length ? difference(own, deeper) : own) > 1;
    const open = polyArea(difference(c, f.outlines)) > 0.01;
    const goesOn = !endsHere && deeper.length > 0 && polyArea(intersect(c, deeper)) > 1;
    n[open ? (goesOn ? 'groovesOn' : 'grooves') : goesOn ? 'pocketsOn' : 'pockets']++;
  }
  const grooveWord = (k: number) => (k > 1 ? `${k} edge grooves` : 'edge groove');
  const done = [n.pockets && `${plural(n.pockets, 'pocket')} ${depth} deep`, n.grooves && `${grooveWord(n.grooves)} ${depth} deep`];
  const onward = [n.pocketsOn && plural(n.pocketsOn, 'pocket'), n.groovesOn && grooveWord(n.groovesOn)].filter(Boolean);
  const what = [...done, onward.length && `${onward.join(' and ')} to ${depth}`].filter(Boolean);
  const from = top < f.thickness - 1e-6 ? `, from ${round2(f.thickness - top)}` : '';
  return what.length ? `${what.join(' + ')}${from}` : `Pocket ${depth} deep`;
}

function components(paths: PathsD): PathsD[] {
  const outers = paths.filter(p => areaD(p) > 0);
  const holes = paths.filter(p => areaD(p) < 0);
  const comps = outers.map(o => [o]);
  for (const h of holes) {
    const c = comps.find(c => pointInPolygonD(h[0], c[0]) !== PointInPolygonResult.IsOutside);
    c?.push(h);
  }
  return comps;
}

/** How deep one pass cuts with this bit: a max stepdown for all bits, else the bit's own, else the material's share. */
export function stepdownFor(tool: Tool, s: Pick<CamSettings, 'maxStepdown' | 'material'>): number {
  return s.maxStepdown ?? tool.stepdown ?? s.material.stepdownFactor * tool.diameter;
}

function depthLevels(top: number, bottom: number, maxStep: number): number[] {
  validateDepthRange(top, bottom, maxStep);
  const n = Math.max(1, Math.ceil((top - bottom) / maxStep - 1e-9));
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? bottom : top - ((k + 1) * (top - bottom)) / n));
}

// ---- operations ----

/** The settings a bit cuts with: its own cutting data over the job's. */
function cuttingWith(tool: Tool, s: CamSettings): CamSettings {
  return {
    ...s,
    feed: tool.feed ?? s.feed,
    plungeFeed: tool.plungeFeed ?? s.plungeFeed,
    rampFeed: tool.rampFeed ?? s.rampFeed,
    leadFeed: tool.leadFeed ?? s.leadFeed,
    leadOutFeed: tool.leadOutFeed ?? s.leadOutFeed,
    finishFeed: tool.finishFeed ?? s.finishFeed,
    reducedFeed: tool.reducedFeed ?? s.reducedFeed,
    transitionFeed: tool.transitionFeed ?? s.transitionFeed,
    stepoverFactor: tool.stepover ? tool.stepover / tool.diameter : s.stepoverFactor,
    finalFeedFactor: tool.finalFeedFactor ?? s.finalFeedFactor,
  };
}

function scheduledPass(pass: Pass, s: CamSettings, tool: Tool, role: MotionRole = 'cut'): Pass {
  const scheduled = applyFeedPolicy(
    { ...pass, phase: pass.phase ?? 'rough' },
    {
      plungeFeed: s.plungeFeed,
      rampFeed: s.rampFeed ?? s.plungeFeed,
      leadFeed: s.leadFeed ?? s.feed,
      leadOutFeed: s.leadOutFeed ?? s.leadFeed ?? s.feed,
      transitionFeed: s.transitionFeed ?? s.feed,
      reducedFeed: s.reducedFeed,
      materialSide: pass.materialSide,
      cornerFeed: s.cornerFeed ?? { factor: 0.5, minAngleDeg: 30, maxRadius: tool.diameter / 2, distance: tool.diameter / 4 },
    },
    role
  );
  return s.circularFinishFeed
    ? correctCircularFinish(
        scheduled,
        tool.diameter / 2,
        Math.min(0.01, planAccuracy(s.geometryTolerance, s.sourceTolerance).budget.offset)
      )
    : scheduled;
}

function finishRoles(pass: Pass): Pass {
  return {
    ...pass,
    phase: 'finish',
    roles: pass.pts.map((p, i) =>
      pass.roles?.[i] === 'cut'
        ? 'finish'
        : (pass.roles?.[i] ??
          (i === 0 ? (pass.link === 'direct' ? 'link' : 'approach') : p[2] < pass.pts[i - 1][2] - 1e-8 ? 'ramp' : 'finish'))
    ),
  };
}

/** Default radial wall allowance for pockets open to the edge. */
const kOpenWallAllowance = 0.2;

/** `line` turned so that `walls` (a region it runs along the boundary of) is on its right: climb with an M3 spindle. */
function wallsOnRight(line: PathD, walls: PathsD): PathD {
  let best = 1;
  for (let i = 2; i < line.length; i++) if (dist2(line[i - 1], line[i]) > dist2(line[best - 1], line[best])) best = i;
  const a = line[best - 1],
    b = line[best];
  const len = Math.sqrt(dist2(a, b)) || 1;
  // A point just to the right of the longest segment.
  const probe = { x: (a.x + b.x) / 2 + ((b.y - a.y) / len) * 0.01, y: (a.y + b.y) / 2 - ((b.x - a.x) / len) * 0.01 };
  return insideRegion(probe, walls) ? line : [...line].reverse();
}

/** Distance from p to the nearest edge of `paths` (closed loops). */
function distToEdges(p: { x: number; y: number }, paths: PathsD): number {
  let best = Infinity;
  for (const loop of paths)
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i],
        b = loop[(i + 1) % loop.length];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, (a.x + t * dx - p.x) ** 2 + (a.y + t * dy - p.y) ** 2);
    }
  return Math.sqrt(best);
}

/** Points of `line` up to arc length `len` (the last one interpolated). */
function prefix(line: PathD, len: number): PathD {
  const out = [line[0]];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const d = Math.sqrt(dist2(line[i - 1], line[i]));
    if (acc + d >= len) {
      const t = (len - acc) / (d || 1);
      out.push({ x: line[i - 1].x + t * (line[i].x - line[i - 1].x), y: line[i - 1].y + t * (line[i].y - line[i - 1].y) });
      return out;
    }
    acc += d;
    out.push(line[i]);
  }
  return out;
}

/** Ramp down from zFrom to zTo going back and forth along the start of `line`, then run all of it at zTo. */
function rampAlong(line: PathD, zFrom: number, zTo: number, s: CamSettings): Pass {
  const slope = Math.tan((s.rampAngleDeg * Math.PI) / 180);
  const leg = prefix(line, Math.min(pathLength(line, false), 30));
  const legLen = pathLength(leg, false);
  if (legLen <= 0 || (zFrom - zTo) / (legLen * slope) > 1000)
    throw new CamInputError([{ field: 'rampAngleDeg', message: 'entry cannot reach the floor within 1000 traversals' }]);
  const pts: Vec3[] = [[leg[0].x, leg[0].y, zFrom]];
  const feeds = [s.plungeFeed];
  let z = zFrom,
    forward = true;
  for (let n = 0; z > zTo + 1e-9 && n < 1000 && legLen > 0; n++, forward = !forward) {
    const way = forward ? leg : [...leg].reverse();
    for (let i = 1; i < way.length && z > zTo + 1e-9; i++) {
      const d = Math.sqrt(dist2(way[i - 1], way[i]));
      const t = Math.min(1, (z - zTo) / (d * slope || 1e-9));
      z = Math.max(zTo, z - d * t * slope);
      pts.push([way[i - 1].x + t * (way[i].x - way[i - 1].x), way[i - 1].y + t * (way[i].y - way[i - 1].y), z]);
      feeds.push(s.feed);
    }
  }
  // Down: back to the start of the line along it, then the whole line at depth.
  const at = pts[pts.length - 1];
  const back = leg.filter((_, i) => i > 0 && !(forward === false && i === leg.length - 1));
  const k = back.findIndex(q => Math.abs(q.x - at[0]) < 1e-9 && Math.abs(q.y - at[1]) < 1e-9);
  for (const q of [...(k >= 0 ? back.slice(0, k) : back)].reverse()) {
    pts.push([q.x, q.y, zTo]);
    feeds.push(s.feed);
  }
  for (const q of line) {
    pts.push([q.x, q.y, zTo]);
    feeds.push(s.feed);
  }
  return { pts, feeds, link: 'retract' };
}

/**
 * A pocket open to the part's edge (rabbet, edge groove): passes parallel to its walls, from the far (waste) side in
 * towards them, each at most a stepover closer, so the bit is never buried in a full-width cut next to a wall. Per
 * depth the farthest pass ramps in, the nearest runs `allowance` off the walls, climb; then bounded finishing passes
 * finishes the walls. Every pass starts and ends where the region meets the waste and runs along the end walls and
 * around their corners: no move straight into a wall, no sharp turn onto it.
 */
function openPocketPasses(comp: PathsD, walls: PathsD, topZ: number, floorZ: number, tool: Tool, s: CamSettings): Pass[] {
  const r = tool.diameter / 2;
  const offsetPaths = (paths: PathsD, delta: number) => offset(paths, delta, offsetToleranceFor(s));
  const stepdown = stepdownFor(tool, s);
  const levels = depthLevels(topZ, floorZ, stepdown);
  // The load on the bit is width x depth: shallow levels (e.g. the last 0.3 mm of a rabbet) may take wider rows,
  // up to 0.9 D so that neighbouring rows still overlap.
  const depth = topZ - floorZ > 0 ? (topZ - floorZ) / levels.length : stepdown;
  const stepover = Math.min(0.9 * tool.diameter, s.stepoverFactor * tool.diameter * Math.max(1, stepdown / depth));
  // A shallow pocket (the last few tenths of a rabbet) cuts its walls lightly anyway: no separate finishing pass.
  const allowance = s.pocketWallAllowance || (topZ - floorZ > 1 ? (s.openWallAllowance ?? kOpenWallAllowance) : 0);
  const free = offsetPaths(comp, -r);
  // A path right at the free area's edge (the row next to the walls) would come out of the clip in slivers: clip to
  // a hair more. Paths are at least `d` >= r from the walls anyway.
  const clipArea = offsetPaths(free, 0.01);
  // How far a pass can be from the walls: the farthest point of the free area's edge (in the waste for a rabbet),
  // measured directly; then further out while there are still passes (a wider pocket's middle).
  let far = 0;
  for (const loop of free)
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i],
        b = loop[(i + 1) % loop.length];
      const steps = Math.max(1, Math.ceil(Math.sqrt(dist2(a, b))));
      for (let k = 0; k < steps; k++)
        far = Math.max(far, distToEdges({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }, walls));
    }
  // Only the walls within reach matter: offsetting the whole part for every pass is what's slow.
  const xs = comp.flat().map(q => q.x),
    ys = comp.flat().map(q => q.y);
  const reach = (m: number) => {
    const [x0, y0, x1, y1] = [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
    return intersect(walls, [
      [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
    ]);
  };
  let localWalls = reach(far + r + 2);
  // The bit-center paths `d` away from the walls, inside the free area, walls on the right.
  const cache = new Map<number, PathD[]>();
  const along = (d: number) => {
    const hit = cache.get(d);
    if (hit) return hit;
    const around = offsetPaths(localWalls, d);
    const out = clipLines(
      around.map(l => [...l, l[0]]),
      clipArea
    )
      .filter(l => l.length > 1 && pathLength(l, false) > 0.5)
      .map(l => wallsOnRight(l, around));
    cache.set(d, out);
    return out;
  };
  const near = r + allowance;
  if (!along(near).length) return [];
  let lo = Math.max(near, far - 0.01);
  for (let i = 0; i < 200 && along(lo + 0.5 * stepover).length; i++) {
    lo += 0.5 * stepover;
    if (lo + r + 2 > far + r + 2) {
      far = lo;
      localWalls = reach(far + r + 2);
      cache.clear();
    }
  }
  while (lo > near && !along(lo).length) lo = Math.max(near, lo - 0.05);
  // Rows evenly spaced, at most a quarter wider than the stepover (a whole extra row for a few tenths isn't worth it).
  const span = lo - near;
  let n = Math.max(span > 1e-6 ? 1 : 0, Math.round(span / stepover));
  if (n && span / n > 1.25 * stepover) n = Math.ceil(span / stepover - 1e-9);
  const rows = Array.from({ length: n + 1 }, (_, k) => along(n ? lo - (k * (lo - near)) / n : near));
  // The row next to the walls is climb; each row before it runs the way that ends where the next one starts.
  for (let k = n - 1; k >= 0; k--) {
    const next = rows[k + 1][0]?.[0];
    if (next) rows[k] = rows[k].map(l => (dist2(l[0], next) < dist2(l[l.length - 1], next) ? [...l].reverse() : l));
  }
  const passes: Pass[] = [];
  let last: Vec3 | undefined;
  const run = (line: PathD, z: number, feed: number, rampFrom?: number) => {
    const hop = last ? Math.sqrt(dist2({ x: last[0], y: last[1] }, line[0])) : Infinity;
    const pass: Pass =
      rampFrom !== undefined
        ? rampAlong(line, rampFrom, z, s)
        : hop <= tool.diameter && last && Math.abs(last[2] - z) < 1e-8
          ? { pts: line.map(q => [q.x, q.y, z]), feeds: line.map(() => feed), link: 'direct' }
          : { pts: line.map(q => [q.x, q.y, z]), feeds: line.map((_, k) => (k === 0 ? s.plungeFeed : feed)), link: 'retract' };
    passes.push(pass);
    last = pass.pts[pass.pts.length - 1];
  };
  let prevZ = topZ;
  for (const z of levels) {
    rows.forEach((row, k) => row.forEach((line, i) => run(line, z, s.feed, k === 0 && i === 0 ? prevZ : undefined)));
    prevZ = z;
  }
  // Finish the walls at bounded axial depths, climb.
  if (allowance > 0)
    for (const z of depthLevels(topZ, floorZ, s.pocketFinishStepdown ?? stepdown))
      for (const line of along(r)) {
        run(line, z, s.finishFeed ?? s.feed * s.pocketFinishFeedFactor);
        passes[passes.length - 1] = finishRoles(passes[passes.length - 1]);
      }
  return passes;
}

/** Contour-parallel (offset) pocket, innermost ring first, ramped entries, climb by default. */
/** `solid`: the part's outlines; ramp entries of pockets open to the edge then start in the waste outside them. */
function pocketTransitionDeviation(settings: CamSettings): number {
  const budget = planAccuracy(settings.geometryTolerance, settings.sourceTolerance).budget;
  return budget.fitting + budget.outputRounding + budget.controllerRounding;
}

function pocketRingSpacing(settings: CamSettings, diameter: number): number {
  const selected = settings.stepoverFactor * diameter;
  const reserve = 2 * pocketTransitionDeviation(settings) + 0.001;
  return selected > 2 * reserve ? selected - reserve : selected;
}

function withPocketTransitions(
  operation: Operation,
  region: PathsD,
  settings: CamSettings,
  wallAllowance = settings.pocketWallAllowance
): Operation {
  const maximumStepover = settings.stepoverFactor * operation.tool.diameter;
  let last: Vec3 | undefined;
  const passes = operation.passes.map(pass => {
    const first = pass.pts[0];
    const candidate =
      pass.link === 'direct' &&
      last &&
      last[2] === first[2] &&
      Math.hypot(last[0] - first[0], last[1] - first[1]) > 0 &&
      Math.hypot(last[0] - first[0], last[1] - first[1]) <= maximumStepover;
    const resolved = candidate ? { ...pass, cuttingTransition: { from: [...last!] as Vec3, to: [...first] as Vec3 } } : pass;
    last = pass.pts.at(-1);
    return resolved;
  });
  return {
    ...operation,
    plungeFeed: settings.plungeFeed,
    pocketTransition: {
      region: region.map(path => path.map(point => ({ ...point }))),
      maximumStepover,
      cutFeed: settings.feed,
      transitionFeed: settings.transitionFeed ?? settings.feed,
      wallAllowance,
    },
    passes,
  };
}

export function pocketOperation(
  name: string,
  region: PathsD,
  topZ: number,
  floorZ: number,
  tool: Tool,
  settings: CamSettings,
  solid?: PathsD
): Operation {
  validateCamSettings(settings);
  validateTool(tool);
  validatePaths(region, 'pocket');
  validateDepthRange(topZ, floorZ, stepdownFor(tool, settings));
  const s = cuttingWith(tool, settings);
  if (s.pocketFinishStepdown !== undefined) validateDepthRange(topZ, floorZ, s.pocketFinishStepdown);
  if ((s.pocketSpringPasses ?? 0) > 0) {
    const base = pocketOperation(name, region, topZ, floorZ, tool, { ...s, pocketSpringPasses: 0 }, solid);
    const passes = [...base.passes];
    const free = offset(region, -tool.diameter / 2, offsetToleranceFor(s));
    for (let repeat = 0; repeat < s.pocketSpringPasses!; repeat++)
      for (const raw of free) {
        const loop = s.climb ? raw : [...raw].reverse();
        const last = passes.at(-1)?.pts.at(-1);
        const oriented = rotateToNearest(loop, last ? { x: last[0], y: last[1] } : loop[0]);
        const pts = closeLoop(oriented, floorZ),
          feed = s.finishFeed ?? s.feed * s.pocketFinishFeedFactor;
        passes.push(
          scheduledPass(
            finishRoles({
              pts,
              feeds: pts.map((_, i) => (i ? feed : s.plungeFeed)),
              link: 'retract',
              materialSide: s.climb ? 'right' : 'left',
              spring: true,
            }),
            s,
            tool,
            'finish'
          )
        );
      }
    return withPocketTransitions({ ...base, passes }, region, s, base.pocketTransition?.wallAllowance);
  }
  if ((s.pocketFloorAllowance ?? 0) > 0 && topZ > floorZ + 1e-8) {
    const roughFloor = Math.min(topZ, floorZ + s.pocketFloorAllowance!);
    const withoutFloor = { ...s, pocketFloorAllowance: 0 };
    const roughOperation =
      roughFloor < topZ - 1e-8 ? pocketOperation(name, region, topZ, roughFloor, tool, withoutFloor, solid) : undefined;
    const finishFeed = s.finishFeed ?? s.feed * s.pocketFinishFeedFactor;
    const finishingTool = { ...tool, feed: finishFeed };
    const finishOperation = pocketOperation(
      name,
      region,
      roughFloor,
      floorZ,
      finishingTool,
      {
        ...withoutFloor,
        feed: finishFeed,
        maxStepdown: s.pocketFinishStepdown ?? stepdownFor(tool, s),
        pocketWallAllowance: 0,
        openWallAllowance: 0,
        pocketFinishFeedFactor: 1,
      },
      solid
    );
    return withPocketTransitions(
      {
        ...finishOperation,
        name,
        tool,
        passes: [
          ...(roughOperation?.passes ?? []),
          ...finishOperation.passes.map(pass => {
            const finished = finishRoles(pass);
            return s.circularFinishFeed
              ? correctCircularFinish(
                  finished,
                  tool.diameter / 2,
                  Math.min(0.01, planAccuracy(s.geometryTolerance, s.sourceTolerance).budget.offset)
                )
              : finished;
          }),
        ],
        warnings: [...new Set([...(roughOperation?.warnings ?? []), ...(finishOperation.warnings ?? [])])],
      },
      region,
      s,
      roughOperation?.pocketTransition?.wallAllowance
    );
  }
  if (s.pocketStrategy === 'controlled') {
    const local = geometryTolerances(s.geometryTolerance, s.sourceTolerance);
    const tolerance = Math.min(local.offset, local.opening);
    const minimumTurnRadius = s.minimumRoughingRadius ?? Math.max(s.innerCornerRadius, tool.diameter * 0.1);
    const plan = planControlledPocket(region, {
      toolRadius: tool.diameter / 2,
      stepover: pocketRingSpacing(s, tool.diameter),
      minimumTurnRadius,
      radialAllowance: Math.max(s.pocketWallAllowance, tool.diameter * 0.05, tolerance * 4),
      tolerance,
    });
    const passes: Pass[] = [],
      warnings = [...plan.diagnostics];
    let previousZ = topZ,
      plungeFallbacks = 0;
    for (const z of depthLevels(topZ, floorZ, Math.min(stepdownFor(tool, s), s.pocketFinishStepdown ?? Infinity))) {
      for (const [phase, paths] of [
        ['rough', plan.roughing],
        ['finish', plan.cleanup],
      ] as const)
        for (const path of paths) {
          const loop = s.climb ? path.slice(0, -1) : path.slice(0, -1).reverse();
          const feed = phase === 'finish' ? (s.finishFeed ?? s.feed * s.pocketFinishFeedFactor) : s.feed;
          const tiny = pathLength(loop, true) < tool.diameter;
          if (tiny && previousZ > z) plungeFallbacks++;
          const last = passes.at(-1)?.pts.at(-1);
          const nearest = rotateToNearest(loop, last ? { x: last[0], y: last[1] } : loop[0]);
          const hop = last ? Math.hypot(last[0] - nearest[0].x, last[1] - nearest[0].y) : Infinity;
          const continuous = last && last[2] === z && hop + 2 * pocketTransitionDeviation(s) < s.stepoverFactor * tool.diameter;
          const pass: Pass = continuous
            ? { pts: closeLoop(nearest, z), feeds: closeLoop(nearest, z).map(() => feed), link: 'direct' }
            : rampLoop(nearest, previousZ, z, { ...s, feed }, tool);
          passes.push(
            scheduledPass(
              {
                ...pass,
                phase,
                entry: continuous ? undefined : tiny ? 'plunge' : 'ramp',
                materialSide: s.climb ? 'right' : 'left',
              },
              { ...s, feed },
              tool,
              phase === 'finish' ? 'finish' : 'cut'
            )
          );
        }
      previousZ = z;
    }
    const fullSlotEntries = plan.entryExceptions.filter(entry => entry.reason === 'full-slot-candidate').length;
    if (fullSlotEntries)
      warnings.push(
        `${fullSlotEntries} controlled pocket entry locations require full-width entry; ramp feed and stepdown remain separate limits`
      );
    if (plungeFallbacks)
      warnings.push(
        `${plungeFallbacks} small controlled pocket entries use a bounded plunge because the contour is too short for the selected ramp policy`
      );
    return withPocketTransitions(
      {
        name,
        kind: 'pocket',
        feature: 'pocket',
        tool,
        passes,
        warnings,
        residualStock: {
          floorZ,
          remaining: plan.remaining,
          unreachable: plan.unreachable,
          reachableArea: plan.reachableResidualArea,
          minimumTurnRadius,
        },
      },
      region,
      s,
      Math.max(s.pocketWallAllowance, tool.diameter * 0.05, tolerance * 4)
    );
  }
  const offsetPaths = (paths: PathsD, delta: number) => offset(paths, delta, offsetToleranceFor(s));
  const leadTolerance = geometryTolerances(s.geometryTolerance, s.sourceTolerance).lead;
  const r = tool.diameter / 2;
  // Leave room for both endpoint deviations while keeping the physical hop within the selected stepover.
  const stepover = pocketRingSpacing(s, tool.diameter);
  const stepdown = stepdownFor(tool, s);
  const passes: Pass[] = [];
  let roughWallAllowance = s.pocketWallAllowance;
  let pos = { x: 0, y: 0 };
  const comps = components(region);
  // The material the pocket's walls belong to, for pockets open to the edge.
  const walls = solid && difference(solid, region);
  const remaining = new Set(comps.map((_, i) => i));
  while (remaining.size) {
    // Nearest pocket next.
    let ci = -1,
      bd = Infinity;
    for (const i of remaining) {
      const d = Math.min(...comps[i][0].map(p => dist2(p, pos)));
      if (d < bd) {
        bd = d;
        ci = i;
      }
    }
    remaining.delete(ci);
    if (solid && walls && offsetPaths(comps[ci], -r).some(l => rotateToWaste(l, solid))) {
      const open = openPocketPasses(comps[ci], walls, topZ, floorZ, tool, s);
      if (open.length) {
        roughWallAllowance = Math.max(
          roughWallAllowance,
          s.pocketWallAllowance || (topZ - floorZ > 1 ? (s.openWallAllowance ?? kOpenWallAllowance) : 0)
        );
        passes.push(...open);
        const end = open[open.length - 1].pts.at(-1)!;
        pos = { x: end[0], y: end[1] };
        continue;
      }
    }
    const entry = (oriented: Loop, nearest: Loop, zFrom: number, zTo: number): Pass => {
      const waste = solid && rotateToWaste(oriented, solid);
      return waste ? rampOnWasteEdge(waste, zFrom, zTo, s) : rampLoop(nearest, zFrom, zTo, s, tool);
    };
    // Where the bit center may go (the wall ring is its boundary), and where roughing stops.
    const free = offsetPaths(comps[ci], -r);
    const allowance = s.pocketWallAllowance;
    const rings: PathsD[] = [];
    const c = s.innerCornerRadius;
    let inset = r + allowance;
    for (let cur = allowance > 0 ? offsetPaths(comps[ci], -inset) : free; cur.length; ) {
      if (rings.length >= 10_000)
        throw new CamInputError([{ field: 'stepoverFactor', message: 'would require more than 10000 pocket rings' }]);
      // Inner rings get rounded corners (an opening keeps them inside the ring); the wall ring keeps its shape.
      // (Simplified: the double offset leaves near-collinear micro-segments that arc fitting can't merge.)
      const smoothingTolerance = geometryTolerances(s.geometryTolerance, s.sourceTolerance).opening;
      const rounded =
        rings.length && c > 0
          ? simplifyPathsD(offset(offset(cur, -c, smoothingTolerance), c, smoothingTolerance), smoothingTolerance, true)
          : cur;
      rings.push(rounded.length ? rounded : cur);
      // The bit running along this ring clears r inwards; stop once nothing is left inside that.
      if (!offsetPaths(cur, -r).length) break;
      const next = offsetPaths(comps[ci], -inset - stepover);
      // A strip narrower than 2 stepovers but wider than D stays in the middle: one more ring closer in.
      inset += next.length ? stepover : stepover / 2;
      cur = next.length ? next : offsetPaths(comps[ci], -inset);
    }
    let prevZ = topZ;
    for (const z of depthLevels(topZ, floorZ, stepdown)) {
      let last: Vec3 | undefined;
      // Closed pockets clear from the center out. Open to the edge: the outer ring first, entering from the waste,
      // then inwards, keeping the edge supported by waste during its cut.
      const open = !!solid && !!rings[0]?.some(l => rotateToWaste(l, solid));
      const order = rings.map((_, i) => i);
      if (!open) order.reverse();
      for (const ri of order) {
        for (const raw of rings[ri]) {
          // Clipper: outer loops CCW, holes CW -> material on the right = climb with an M3 spindle.
          const oriented = s.climb ? raw : [...raw].reverse();
          // The wall ring of a closed pocket, reached from an inner ring: join and leave it on tangent arcs.
          if (!open && ri === 0 && allowance === 0 && last) {
            const lead = wallPassWithLeads(oriented, { x: last[0], y: last[1] }, z, s.feed, r, free, leadTolerance);
            if (lead && segmentInside({ x: last[0], y: last[1] }, { x: lead.pts[0][0], y: lead.pts[0][1] }, free)) {
              passes.push({ ...lead, clearLink: true, materialSide: s.climb ? 'right' : 'left' });
              last = lead.pts[lead.pts.length - 1];
              continue;
            }
          }
          const nearest = rotateToNearest(oriented, last ? { x: last[0], y: last[1] } : pos);
          const near = last && Math.sqrt(dist2({ x: last[0], y: last[1] }, nearest[0])) <= stepover * 1.5;
          const pass: Pass = near
            ? { pts: closeLoop(nearest, z), feeds: closeLoop(nearest, z).map(() => s.feed), link: 'direct' }
            : entry(oriented, nearest, prevZ, z);
          passes.push({ ...pass, materialSide: s.climb ? 'right' : 'left' });
          last = pass.pts[pass.pts.length - 1];
        }
      }
      if (last) pos = { x: last[0], y: last[1] };
      prevZ = z;
    }
    // Bound axial engagement while the radial finishing allowance is removed.
    if (allowance > 0 && rings.length) {
      let last: Vec3 = passes[passes.length - 1].pts.at(-1)!;
      for (const z of depthLevels(topZ, floorZ, s.pocketFinishStepdown ?? stepdown))
        for (const raw of free) {
          const oriented = s.climb ? raw : [...raw].reverse();
          const feed = s.finishFeed ?? s.feed * s.pocketFinishFeedFactor;
          const lead = wallPassWithLeads(oriented, { x: last[0], y: last[1] }, z, feed, r, free, leadTolerance);
          const pass: Pass =
            lead && segmentInside({ x: last[0], y: last[1] }, { x: lead.pts[0][0], y: lead.pts[0][1] }, free)
              ? { ...lead, clearLink: true }
              : { ...rampLoop(rotateToNearest(oriented, { x: last[0], y: last[1] }), z, z, s, tool), feeds: [] };
          if (Math.abs(last[2] - z) > 1e-8) {
            pass.link = 'retract';
            pass.clearLink = false;
            if (pass.roles) pass.roles[0] = 'approach';
          }
          if (!pass.feeds.length) pass.feeds = pass.pts.map((_, k) => (k === 0 ? s.plungeFeed : feed));
          passes.push({ ...finishRoles(pass), materialSide: s.climb ? 'right' : 'left' });
          last = pass.pts[pass.pts.length - 1];
        }
    }
  }
  return withPocketTransitions(
    { name, kind: 'pocket', feature: 'pocket', tool, passes: passes.map(pass => scheduledPass(pass, s, tool)) },
    region,
    s,
    roughWallAllowance
  );
}

/** Tab intervals (arc length along `loop`) centered on the given points. */
function tabIntervals(loop: Vec3[], centers: { x: number; y: number }[], halfLen: number) {
  const cum = [0];
  for (let i = 1; i < loop.length; i++) cum.push(cum[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]));
  return centers.map(c => {
    let best = 0,
      bd = Infinity;
    for (let i = 1; i < loop.length; i++) {
      const [ax, ay] = loop[i - 1],
        [bx, by] = loop[i];
      const dx = bx - ax,
        dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.y - ay) * dy) / l2)) : 0;
      const d = (ax + t * dx - c.x) ** 2 + (ay + t * dy - c.y) ** 2;
      if (d < bd) {
        bd = d;
        best = cum[i - 1] + t * Math.sqrt(l2);
      }
    }
    return [best - halfLen, best + halfLen] as const;
  });
}

/**
 * Raise the path to tabZ inside the given arc-length intervals (vertical steps at the borders). A step down goes into
 * uncut wood: at the plunge feed. `feeds` stays one per point; arc fitting only looks at runs of constant feed.
 */
function applyTabs(pass: Pass, intervals: (readonly [number, number])[], tabZ: number, plungeFeed: number, rampLength = 0): Pass {
  return applyTabMotion(pass, intervals, tabZ, plungeFeed, rampLength);
}

/** Evenly spread tabs over the long straight runs of a loop. */
export function placeTabs(loop: Loop, tabs: TabSettings, tool: Tool): { x: number; y: number }[] {
  const per = pathLength(loop, true);
  const count = Math.max(tabs.minCount, Math.round(per / tabs.spacing));
  const minRun = tabs.width + 3 * tool.diameter;
  // Merge collinear segments into straight runs.
  const runs: { a: { x: number; y: number }; b: { x: number; y: number }; len: number }[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[i],
      b = loop[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const prev = runs[runs.length - 1];
    if (prev) {
      const c = ((prev.b.x - prev.a.x) * (b.y - a.y) - (prev.b.y - prev.a.y) * (b.x - a.x)) / (prev.len * len || 1);
      if (Math.abs(c) < 0.01 && prev.b === a) {
        prev.b = b;
        prev.len = Math.hypot(b.x - prev.a.x, b.y - prev.a.y);
        continue;
      }
    }
    runs.push({ a, b, len });
  }
  const long = runs.filter(r => r.len >= minRun);
  if (!long.length) return [];
  const counts = long.map(() => 0);
  for (let k = 0; k < count; k++) {
    let bi = 0;
    long.forEach((r, i) => {
      if (r.len / (counts[i] + 1) > long[bi].len / (counts[bi] + 1)) bi = i;
    });
    counts[bi]++;
  }
  return long.flatMap((r, i) =>
    Array.from({ length: counts[i] }, (_, k) => {
      const t = (k + 1) / (counts[i] + 1);
      return { x: r.a.x + t * (r.b.x - r.a.x), y: r.a.y + t * (r.b.y - r.a.y) };
    })
  );
}

/**
 * Outline profile: bounded roughing, a full-depth radial finish unless explicitly stepped, and deliberate entry motion.
 * `inside` = through hole (tool inside the loop).
 */
/** profileOperation's bit loops per shape (and bit radius, allowance, direction). */
const loopCache = new WeakMap<PathD, Map<string, { rough: Loop; final: Loop } | null>>();

export function profileOperation(
  name: string,
  loopShape: PathD,
  topZ: number,
  tool: Tool,
  settings: CamSettings,
  inside = false
): Operation {
  validateCamSettings(settings);
  validateTool(tool);
  validatePaths([loopShape], 'profile');
  const s = cuttingWith(tool, settings);
  const offsetTolerance = offsetToleranceFor(s);
  const r = tool.diameter / 2;
  const sign = inside ? -1 : 1;
  const shape = [inside ? [...loopShape].reverse() : loopShape];
  const one = (paths: PathsD) => paths.sort((a, b) => Math.abs(areaD(b)) - Math.abs(areaD(a)))[0];
  const orient = (p: PathD) => {
    // Clipper keeps the input orientation; outer loop CCW. Climb (material on the right) = CW around the part,
    // CCW inside a hole.
    const ccw = areaD(p) > 0;
    const wantCcw = inside === s.climb;
    return ccw === wantCcw ? p : [...p].reverse();
  };
  // The bit's loops around the shape: the costly part (Clipper offsets), the same for the board's tab plan and its
  // program, so kept per shape.
  const key = `${sign}:${r}:${s.leaveStock}:${s.climb}:${offsetTolerance}`;
  let loops = loopCache.get(loopShape)?.get(key);
  if (!loops) {
    const finalRaw = one(offset(shape, sign * r, offsetTolerance));
    const roughRaw = one(offset(shape, sign * (r + s.leaveStock), offsetTolerance));
    // A hole hardly wider than the bit has no room for the allowance: rough on the final path.
    const roughPath = roughRaw ?? finalRaw;
    const rough = roughPath && rotateToLongestEdge(orient(roughPath));
    loops = rough && finalRaw ? { rough, final: rotateToNearest(orient(finalRaw), rough[0]) } : null;
    if (!loopCache.has(loopShape)) loopCache.set(loopShape, new Map());
    loopCache.get(loopShape)!.set(key, loops);
  }
  const passes: Pass[] = [];
  if (!loops) return { name, kind: 'profile', feature: inside ? 'hole' : 'outline', tool, passes };
  const { rough, final } = loops;
  const warnings = new Set<string>();
  const sourceLoops = new WeakMap<Pass, { loop: Loop; start: number; zFrom: number }>();

  // A bottom skin (outlines only): the final pass stops there, and roughing never goes below it.
  const floorZ = inside ? s.finalZ : (s.outlineFloor ?? s.finalZ);
  const roughBottom = Math.min(topZ, Math.max(s.profileRoughBottom, floorZ));
  const profileStep = s.profileStepdown ?? stepdownFor(tool, s);
  validateDepthRange(topZ, floorZ, profileStep);
  if (s.profileFinishStepdown !== undefined) validateDepthRange(topZ, floorZ, s.profileFinishStepdown);
  // The strip under the roughing floor is a new axial cut, even with a light radial finish allowance.
  const extendRoughing = roughBottom - floorZ > profileStep + 1e-9;
  const roughTo = extendRoughing ? floorZ : roughBottom;
  const roughLevels = topZ - roughTo > 0.01 ? depthLevels(topZ, roughTo, profileStep) : [];
  if (extendRoughing) roughLevels.pop();
  const append = (baseLoop: Loop, zFrom: number, z: number, feed: number, phase: 'rough' | 'finish') => {
    const requested = s.profileEntry ?? 'ramp';
    let loop = baseLoop;
    const previous = passes.at(-1)?.pts.at(-1);
    let pass: Pass | undefined;
    if (requested === 'tangent' && !(s.tabs && !inside)) {
      const leadRadius = s.profileLeadRadius ?? r;
      pass = tangentLoopPass(
        loop,
        z,
        feed,
        leadRadius,
        profileEntryRegion(loopShape, r, leadRadius, inside, offsetTolerance),
        loop[0],
        geometryTolerances(s.geometryTolerance, s.sourceTolerance).lead
      );
      if (pass) pass.entry = 'tangent';
      else warnings.add('Tangent entry does not fit the cutter-centre region; using a contour ramp');
    } else if (requested === 'tangent') warnings.add('Tangent entry with tabs uses a contour ramp to preserve the holding material');
    if (!pass) {
      if (requested === 'plunge') {
        const pts = closeLoop(loop, z);
        pass = { pts, feeds: pts.map((_, i) => (i ? feed : s.plungeFeed)), link: 'retract', entry: 'plunge' };
      } else {
        // Begin the next depth at the prior lap's actual pose. The following descent is an explicit
        // slope/feed-limited cut, rather than a travel link assumed clear below the previous floor.
        if (previous?.[2] === zFrom) loop = contourFromPoint(baseLoop, previous) ?? baseLoop;
        pass = { ...rampLoop(loop, zFrom, z, { ...s, feed }, tool), entry: 'ramp' };
        if (pathLength(loop, true) < tool.diameter && zFrom > z) {
          pass.entry = 'plunge';
          warnings.add('Contour entry loop is too small for a ramp; using a bounded plunge');
        }
      }
    }
    const record = (next: Pass, start: number, entryTop = zFrom) => {
      next.phase = phase;
      next.materialSide = s.climb ? 'right' : 'left';
      if (phase === 'finish') next = finishRoles(next);
      passes.push(next);
      sourceLoops.set(next, { loop, start, zFrom: entryTop });
    };
    pass.link = previous && previous.every((value, axis) => value === pass!.pts[0][axis]) ? 'direct' : 'retract';
    const atDepth = pass.pts.findIndex(p => Math.abs(p[2] - z) < 1e-8);
    if (pass.entry === 'ramp' && atDepth > 0 && atDepth < pass.pts.length - 1) {
      const entry = { ...pass, pts: pass.pts.slice(0, atDepth + 1), feeds: pass.feeds.slice(0, atDepth + 1) };
      const lap = { ...pass, pts: pass.pts.slice(atDepth), feeds: pass.feeds.slice(atDepth), link: 'direct' as const, entry: undefined };
      const start = pathLength(
        entry.pts.map(q => ({ x: q[0], y: q[1] })),
        false
      );
      record(entry, 0);
      record(lap, start, z);
    } else record(pass, 0);
  };
  let previousZ = topZ;
  for (const z of roughLevels) {
    append(rough, previousZ, z, s.feed, 'rough');
    previousZ = z;
  }
  const ffeed = s.finishFeed ?? s.feed * s.finalFeedFactor;
  const finishTop = s.leaveStock > 0 && s.profileFinishStepdown !== undefined ? topZ : previousZ;
  const finishLevels = s.profileFinishStepdown !== undefined ? depthLevels(finishTop, floorZ, s.profileFinishStepdown) : [floorZ];
  previousZ = finishTop;
  for (const z of finishLevels) {
    append(final, previousZ, z, ffeed, 'finish');
    previousZ = z;
  }
  for (let repeat = 0; repeat < (s.profileSpringPasses ?? 0); repeat++) {
    const pts = closeLoop(final, floorZ);
    const pass = finishRoles({
      pts,
      feeds: pts.map((_, i) => (i ? ffeed : s.plungeFeed)),
      link: 'retract',
      materialSide: s.climb ? 'right' : 'left',
      spring: true,
    });
    passes.push(pass);
    sourceLoops.set(pass, { loop: final, start: 0, zFrom: floorZ });
  }

  if (s.tabs && !inside) {
    const centers = s.tabs.centers ?? placeTabs(final, s.tabs, tool);
    const half = (s.tabs.width + tool.diameter) / 2;
    for (let i = 0; i < passes.length; i++) {
      const p = passes[i];
      if (Math.min(...p.pts.map(q => q[2])) >= s.tabs.height) continue;
      const { loop, start } = sourceLoops.get(p)!;
      const perimeter = pathLength(loop, true);
      const travel = pathLength(
        p.pts.map(q => ({ x: q[0], y: q[1] })),
        false
      );
      const intervals = repeatTabIntervals(
        tabIntervals(closeLoop(loop, 0), centers, half).map(([a, b]) => [a - start, b - start] as const),
        perimeter,
        travel
      );
      passes[i] = applyTabs(p, intervals, s.tabs.height, s.plungeFeed, s.tabs.rampLength);
      sourceLoops.set(passes[i], sourceLoops.get(p)!);
    }
  }
  if ((s.profileVerticalExitRadius ?? 0) > 0 && !inside)
    warnings.add('Vertical exit blends are only supported inside holes; outside profiles retain their complete final contour lap');
  const plannedPasses = passes.flatMap(pass => {
    const scheduled = scheduledPass(pass, s, tool, pass.phase === 'finish' ? 'finish' : 'cut');
    let entry = [scheduled];
    if ((s.profileVerticalLeadRadius ?? 0) > 0 && pass.entry) {
      const blend = verticalEntryBlend(scheduled, {
        radius: s.profileVerticalLeadRadius!,
        axialStep: Math.max(0, sourceLoops.get(pass)!.zFrom - Math.min(...pass.pts.map(p => p[2]))),
        plungeFeed: s.plungeFeed,
        tolerance: geometryTolerances(s.geometryTolerance, s.sourceTolerance).lead,
      });
      if (blend.warning) warnings.add(blend.warning);
      entry = blend.passes;
    }
    if (!inside || !(s.profileVerticalExitRadius! > 0)) return entry;
    return entry.flatMap(next => {
      if (next.auxiliary || next.entry === 'ramp') return [next];
      const blend = verticalExitBlend(next, {
        radius: s.profileVerticalExitRadius!,
        plungeFeed: s.plungeFeed,
        tolerance: geometryTolerances(s.geometryTolerance, s.sourceTolerance).lead,
      });
      if (blend.warning) warnings.add(blend.warning);
      return blend.passes;
    });
  });
  return {
    name,
    kind: 'profile',
    feature: inside ? 'hole' : 'outline',
    tool,
    plungeFeed: s.plungeFeed,
    passes: plannedPasses,
    ...(warnings.size ? { warnings: [...warnings] } : {}),
  };
}

/** Where a bit of radius r can cut in a region. */
const reachOf = (region: PathsD, r: number, tolerance: number) => offset(offset(region, -r, tolerance), r, tolerance);

/** A bit fits a spot if it does at this share of its radius (it may be just as wide as the bit). */
const kNarrowSpotFit = 0.9;

/**
 * What a smaller bit should cut of a region, given what bigger bits `reached`: the spots it fits into whole, such as a
 * slot off a wider pocket. Rounded inside corners aren't: the bit doesn't fit into what they leave. The spots grow by
 * the bit's diameter into the rest of the region, so that the bit reaches all of them and leaves no wall where they join it.
 */
function narrowSpots(region: PathsD, reached: PathsD, tool: Tool, settings: CamSettings): PathsD {
  const r = tool.diameter / 2;
  const tolerance = geometryTolerances(settings.geometryTolerance, settings.sourceTolerance);
  const left = cleanRegion(difference(reachOf(region, r, tolerance.offset), reached), tolerance.cleanup, 0.5, tolerance.simplify);
  const spots = components(left).filter(c => offset(c, -kNarrowSpotFit * r, tolerance.offset).length > 0);
  if (!spots.length) return [];
  const grown = intersect(offset(spots.flat(), tool.diameter, tolerance.offset), region);
  return intersect(cleanRegion(grown, tolerance.cleanup, 0.05, tolerance.simplify), region);
}

/**
 * All operations for one flat board. Each feature uses the largest tool that fits, smaller ones then cut the narrow
 * spots of a pocket that it doesn't reach; operations are ordered smallest tool first, inner features (pockets high to
 * low, then holes) before the outline.
 */
/**
 * Only what cuts through: a part's through holes and outlines, no tabs (for the board's tab plan, which needs to know
 * what stock is left, not the pockets).
 */
export function throughCuts(features: PartFeatures, settings: Partial<CamSettings> = {}): Operation[] {
  const s: CamSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    tabs: false,
    outlineFloor: undefined,
    profileEntry: 'plunge',
    profileVerticalLeadRadius: 0,
    profileVerticalExitRadius: 0,
    profileSpringPasses: 0,
    circularFinishFeed: false,
  };
  validateCamSettings(s);
  validateFeatures(features);
  const top = Math.max(s.stockTop ?? 0, features.levels[0]?.z ?? features.thickness);
  const tools = [...s.tools].sort((a, b) => b.diameter - a.diameter);
  const fits = (region: PathsD) => (t: Tool) => offset(region, -t.diameter / 2, offsetToleranceFor(s)).length > 0;
  return [
    ...features.throughHoles.flatMap((h, i) => {
      const tool = tools.find(fits([h]));
      return tool ? [profileOperation(`Hole ${i + 1}`, h, top, tool, s, true)] : [];
    }),
    ...features.outlines.map((o, i) => profileOperation(`Outline ${i + 1}`, o, top, tools[0], s)),
  ];
}

/**
 * Bits that go deeper than their flutes are long (from the stock top, the deepest cut of all their operations): the
 * shank would rub. A warning, not a stop: a library's flute length may be conservative.
 */
export function fluteWarnings(ops: Operation[], stockTop: number): string[] {
  const out: string[] = [];
  for (const tool of new Set(ops.map(o => o.tool))) {
    if (!tool.fluteLength) continue;
    const zs = ops.filter(o => o.tool === tool).flatMap(o => o.passes.flatMap(p => p.pts.map(q => q[2])));
    const depth = stockTop - Math.min(...zs);
    if (depth > tool.fluteLength + 1e-6)
      out.push(`bit D=${tool.diameter} cuts ${round2(depth)} mm deep from the stock top, its flutes are ${tool.fluteLength} mm long`);
  }
  return out;
}

/** The piece inside a through hole is worth a warning above this, mm² (50 x 50 mm). */
const kLooseSlugArea = 2500;

export function camPart(features: PartFeatures, settings: Partial<CamSettings> = {}): PartCam {
  const s: CamSettings = { ...DEFAULT_SETTINGS, ...settings };
  validateCamSettings(s);
  validateFeatures(features);
  const top = Math.max(s.stockTop ?? 0, features.levels[0]?.z ?? features.thickness);
  const tools = [...s.tools].sort((a, b) => b.diameter - a.diameter);
  const warnings: string[] = [];
  const ops: Operation[] = [];
  const fits = (region: PathsD, inward: boolean) => (t: Tool) =>
    offset(region, (inward ? -1 : 1) * (t.diameter / 2), offsetToleranceFor(s)).length > 0;

  // Pockets come top-down and each region contains the deeper ones, so a pocket starts at the previous floor --
  // unless that floor was cleared by another (bigger) bit that couldn't reach into this one.
  let pocketTop = top;
  let prevTool: Tool | undefined;
  features.pockets.forEach((p, i) => {
    // Open to the edge: run the bit 1mm past the edge into the waste, whatever its size. A bit only has to fit
    // that extended region (a 6mm bit cuts a 3.5mm rabbet).
    const openFor = (t: Tool) =>
      openPocketRegion(features.outlines, p, t.diameter / 2 + 1, geometryTolerances(s.geometryTolerance, s.sourceTolerance));
    const tool = tools.find(t => fits(openFor(t), true)(t));
    if (!tool) return warnings.push(`pocket z=${p.floorZ}: no tool fits`);
    if (prevTool && prevTool !== tool) pocketTop = top;
    prevTool = tool;
    const region = openFor(tool);
    ops.push({
      ...pocketOperation(`Pocket ${i + 1} z=${p.floorZ}`, region, pocketTop, p.floorZ, tool, s, features.outlines),
      title: pocketTitle(features, i, region, pocketTop),
    });
    let reached = reachOf(region, tool.diameter / 2, offsetToleranceFor(s));
    for (const small of tools.filter(t => t.diameter < tool.diameter)) {
      const spots = narrowSpots(openFor(small), reached, small, s);
      if (!spots.length) continue;
      // From the stock top: smaller bits go first, nothing has cleared these spots' surroundings yet.
      ops.push({
        ...pocketOperation(`Pocket ${i + 1} z=${p.floorZ} narrow spots`, spots, top, p.floorZ, small, s, features.outlines),
        title: `${plural(components(spots).length, 'narrow spot')} ${round2(features.thickness - p.floorZ)} deep`,
      });
      reached = union(reached, reachOf(spots, small.diameter / 2, offsetToleranceFor(s)));
    }
    const uncut = polyArea(difference(region, reached));
    if (uncut > 1) warnings.push(`pocket z=${p.floorZ}: ${uncut.toFixed(1)}mm² left in corners/narrow spots with D=${tool.diameter}`);
    pocketTop = p.floorZ;
  });
  if (s.cutThrough)
    features.throughHoles.forEach((h, i) => {
      const tool = tools.find(fits([h], true));
      if (!tool) return warnings.push(`through hole ${i + 1}: no tool fits`);
      ops.push(profileOperation(`Hole ${i + 1}`, h, top, tool, s, true));
      // Nothing holds the piece in the middle (if the bit leaves one): free on the last lap, it can catch the bit.
      if (Math.abs(polyArea([h])) > kLooseSlugArea && offset([h], -tool.diameter, offsetToleranceFor(s)).length) {
        const [xs, ys] = [h.map(q => q.x), h.map(q => q.y)];
        const size = `${round2(Math.max(...xs) - Math.min(...xs))} x ${round2(Math.max(...ys) - Math.min(...ys))} mm`;
        warnings.push(
          `through hole ${i + 1}: the ${size} piece inside it comes loose on the last pass and can catch the bit. Tape it down, or stop before the last pass and take it out.`
        );
      }
    });
  if (s.cutThrough) features.outlines.forEach((o, i) => ops.push(profileOperation(`Outline ${i + 1}`, o, top, tools[0], s)));
  if (features.bottomFaces.length && s.cutThrough)
    warnings.push(`bottom-side features at z=${features.bottomFaces.map(b => b.z).join(', ')}: need a second (flipped) setup`);
  if (features.slopedArea > 1) warnings.push(`${features.slopedArea.toFixed(0)}mm² of sloped faces ignored (not 2.5D)`);

  warnings.push(...ops.flatMap(op => op.warnings ?? []), ...fluteWarnings(ops, top));

  // Stable sort: smallest tool first, keeps pockets -> holes -> outline within a tool.
  const operations = ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => a.op.tool.diameter - b.op.tool.diameter || a.i - b.i)
    .map(x => x.op);
  return finalizePlan(
    { stockTop: top, safeZ: top + s.safeHeight, retractZ: top + s.retractHeight, operations, warnings },
    s,
    s.blankFootprint
  );
}
