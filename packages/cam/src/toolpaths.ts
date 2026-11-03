import { areaD, pointInPolygonD, PointInPolygonResult, simplifyPathsD, type PathD, type PathsD } from 'clipper2-ts';
import { openPocketRegion, type PartFeatures } from './features';
import { difference, offset, pathLength, polyArea, type Vec3 } from './geom';

export interface Tool {
  number: number;
  /** Flat end mill diameter in mm. */
  diameter: number;
  name?: string;
}

export { MATERIALS, DEFAULT_TABS, type Material, type TabSettings } from './settings';
import { MATERIALS, DEFAULT_TABS, type Material, type TabSettings } from './settings';

export interface CamSettings {
  tools: Tool[];
  material: Material;
  feed: number;
  plungeFeed: number;
  stepoverFactor: number;
  /** Max stepdown for the outline roughing passes. */
  profileStepdown: number;
  /** Roughing passes stop this high above the stock bottom... */
  profileRoughBottom: number;
  /** ...leaving this much radial stock for the final pass: the outline's wall allowance. */
  leaveStock: number;
  /**
   * Pocket wall allowance: roughing stays this far off the pocket walls, then one full-depth pass at the floor cuts
   * them to size (at feed × pocketFinishFeedFactor). 0 = off: the wall ring is cut at every depth.
   */
  pocketWallAllowance: number;
  pocketFinishFeedFactor: number;
  /** Rounds the corners of inner pocket rings (not the wall ring) so the bit doesn't stop and turn; 0 = sharp. */
  innerCornerRadius: number;
  /** Final outline pass goes down to here (below the stock bottom). */
  finalZ: number;
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
  profileStepdown: 4,
  profileRoughBottom: 1,
  leaveStock: 0.1,
  pocketWallAllowance: 0,
  pocketFinishFeedFactor: 1,
  innerCornerRadius: 0.3,
  finalZ: -0.3,
  finalFeedFactor: 0.5,
  climb: true,
  rampAngleDeg: 3,
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
  link: 'retract' | 'direct';
  /** The straight link to pts[0] runs through material already cleared at this depth (may be longer than D). */
  clearLink?: boolean;
}

export interface Operation {
  name: string;
  kind: 'pocket' | 'profile';
  /** What it cuts: board programs put inner features (pockets, holes) before outlines. */
  feature: 'pocket' | 'hole' | 'outline';
  tool: Tool;
  passes: Pass[];
  /** Pause (M0) before this operation with this message, e.g. guided tab removal. */
  pauseBefore?: string;
}

export interface PartCam {
  stockTop: number;
  operations: Operation[];
  warnings: string[];
}

// ---- helpers ----

type Loop = PathD;

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
 * A wall pass with tangent quarter-arc lead-in and lead-out from the pocket interior, like Fusion's: the bit never
 * moves into the wall, it joins and leaves it along its direction. Entry in the middle of the straight wall segment
 * nearest to `from`; the arc radius starts at r and shrinks until the arcs fit into `free` (where the bit center can
 * go). Undefined if no arc fits (then the caller cuts the loop plainly).
 */
function wallPassWithLeads(loop: Loop, from: { x: number; y: number }, z: number, feed: number, r: number, free: PathsD): Pass | undefined {
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
    const leadIn = [0, 15, 30, 45, 60, 75].map(at);
    const leadOut = [105, 120, 135, 150, 165, 180].map(at);
    if (![...leadIn, ...leadOut].every(q => insideRegion(q, free))) continue;
    const lap = [P, ...loop.slice(seg.i + 1), ...loop.slice(0, seg.i + 1), P];
    const pts: Vec3[] = [...leadIn, ...lap, ...leadOut].map(q => [q.x, q.y, z]);
    return { pts, feeds: pts.map(() => feed), link: 'direct' };
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

function depthLevels(top: number, bottom: number, maxStep: number): number[] {
  const n = Math.max(1, Math.ceil((top - bottom) / maxStep - 1e-9));
  return Array.from({ length: n }, (_, k) => top - ((k + 1) * (top - bottom)) / n);
}

// ---- operations ----

/** Contour-parallel (offset) pocket, innermost ring first, ramped entries, climb by default. */
/** `solid`: the part's outlines; ramp entries of pockets open to the edge then start in the waste outside them. */
export function pocketOperation(
  name: string,
  region: PathsD,
  topZ: number,
  floorZ: number,
  tool: Tool,
  s: CamSettings,
  solid?: PathsD
): Operation {
  const r = tool.diameter / 2;
  const stepover = s.stepoverFactor * tool.diameter;
  const stepdown = s.material.stepdownFactor * tool.diameter;
  const passes: Pass[] = [];
  let pos = { x: 0, y: 0 };
  const comps = components(region);
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
    const entry = (oriented: Loop, nearest: Loop, zFrom: number, zTo: number): Pass => {
      const waste = solid && rotateToWaste(oriented, solid);
      return waste ? rampOnWasteEdge(waste, zFrom, zTo, s) : rampLoop(nearest, zFrom, zTo, s, tool);
    };
    // Where the bit center may go (the wall ring is its boundary), and where roughing stops.
    const free = offset(comps[ci], -r);
    const allowance = s.pocketWallAllowance;
    const rings: PathsD[] = [];
    const c = s.innerCornerRadius;
    for (let cur = allowance > 0 ? offset(comps[ci], -r - allowance) : free; cur.length; ) {
      // Inner rings get rounded corners (an opening keeps them inside the ring); the wall ring keeps its shape.
      // (Simplified: the double offset leaves near-collinear micro-segments that arc fitting can't merge.)
      const rounded = rings.length && c > 0 ? simplifyPathsD(offset(offset(cur, -c), c), 0.002, true) : cur;
      rings.push(rounded.length ? rounded : cur);
      // The bit running along this ring clears r inwards; stop once nothing is left inside that.
      if (!offset(cur, -r).length) break;
      const next = offset(cur, -stepover);
      // A strip narrower than 2 stepovers but wider than D stays in the middle: one more ring closer in.
      cur = next.length ? next : offset(cur, -stepover / 2);
    }
    let prevZ = topZ;
    for (const z of depthLevels(topZ, floorZ, stepdown)) {
      let last: Vec3 | undefined;
      // Closed pockets clear from the center out. Open to the edge: the outer ring first, entering from the waste,
      // then inwards linked without retracts -- the edge is cut while the waste still supports it (like Fusion).
      const open = !!solid && !!rings[0]?.some(l => rotateToWaste(l, solid));
      const order = rings.map((_, i) => i);
      if (!open) order.reverse();
      for (const ri of order) {
        for (const raw of rings[ri]) {
          // Clipper: outer loops CCW, holes CW -> material on the right = climb with an M3 spindle.
          const oriented = s.climb ? raw : [...raw].reverse();
          // The wall ring of a closed pocket, reached from an inner ring: join and leave it on tangent arcs.
          if (!open && ri === 0 && allowance === 0 && last) {
            const lead = wallPassWithLeads(oriented, { x: last[0], y: last[1] }, z, s.feed, r, free);
            if (lead && segmentInside({ x: last[0], y: last[1] }, { x: lead.pts[0][0], y: lead.pts[0][1] }, free)) {
              passes.push({ ...lead, clearLink: true });
              last = lead.pts[lead.pts.length - 1];
              continue;
            }
          }
          const nearest = rotateToNearest(oriented, last ? { x: last[0], y: last[1] } : pos);
          const near = last && Math.sqrt(dist2({ x: last[0], y: last[1] }, nearest[0])) <= stepover * 1.5;
          const pass: Pass = near
            ? { pts: closeLoop(nearest, z), feeds: closeLoop(nearest, z).map(() => s.feed), link: 'direct' }
            : entry(oriented, nearest, prevZ, z);
          passes.push(pass);
          last = pass.pts[pass.pts.length - 1];
        }
      }
      if (last) pos = { x: last[0], y: last[1] };
      prevZ = z;
    }
    // With a wall allowance: one full-depth pass at the floor cuts the walls to size.
    if (allowance > 0 && rings.length) {
      let last: Vec3 = passes[passes.length - 1].pts.at(-1)!;
      for (const raw of free) {
        const oriented = s.climb ? raw : [...raw].reverse();
        const feed = s.feed * s.pocketFinishFeedFactor;
        const lead = wallPassWithLeads(oriented, { x: last[0], y: last[1] }, floorZ, feed, r, free);
        const pass: Pass =
          lead && segmentInside({ x: last[0], y: last[1] }, { x: lead.pts[0][0], y: lead.pts[0][1] }, free)
            ? { ...lead, clearLink: true }
            : { ...rampLoop(rotateToNearest(oriented, { x: last[0], y: last[1] }), floorZ, floorZ, s, tool), feeds: [] };
        if (!pass.feeds.length) pass.feeds = pass.pts.map((_, k) => (k === 0 ? s.plungeFeed : feed));
        passes.push(pass);
        last = pass.pts[pass.pts.length - 1];
      }
    }
  }
  return { name, kind: 'pocket', feature: 'pocket', tool, passes };
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

/** Raise the path to tabZ inside the given arc-length intervals (vertical steps at the borders). */
function applyTabs(pass: Pass, intervals: (readonly [number, number])[], tabZ: number): Pass {
  const inTab = (s: number) => intervals.some(([a, b]) => s > a && s < b);
  const pts: Vec3[] = [pass.pts[0]];
  const feeds: number[] = [pass.feeds[0]];
  let s = 0;
  for (let i = 1; i < pass.pts.length; i++) {
    const a = pass.pts[i - 1],
      b = pass.pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cuts = intervals
      .flat()
      .filter(c => c > s && c < s + len)
      .sort((x, y) => x - y);
    for (const c of cuts) {
      const t = (c - s) / len;
      const x = a[0] + t * (b[0] - a[0]),
        y = a[1] + t * (b[1] - a[1]);
      const zBase = a[2] + t * (b[2] - a[2]);
      const before = inTab(c - 1e-6),
        after = inTab(c + 1e-6);
      pts.push([x, y, before ? Math.max(zBase, tabZ) : zBase]);
      feeds.push(pass.feeds[i]);
      pts.push([x, y, after ? Math.max(zBase, tabZ) : zBase]);
      feeds.push(pass.feeds[i]);
    }
    s += len;
    pts.push([b[0], b[1], inTab(s) ? Math.max(b[2], tabZ) : b[2]]);
    feeds.push(pass.feeds[i]);
  }
  return { ...pass, pts, feeds };
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
 * Outline profile: roughing passes down to `profileRoughBottom` leaving `leaveStock`, then one final pass at full
 * size down to `finalZ` at reduced feed. `inside` = through hole (tool inside the loop).
 */
export function profileOperation(name: string, loopShape: PathD, topZ: number, tool: Tool, s: CamSettings, inside = false): Operation {
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
  const finalRaw = one(offset(shape, sign * r));
  const roughRaw = one(offset(shape, sign * (r + s.leaveStock)));
  const passes: Pass[] = [];
  if (!finalRaw || !roughRaw) return { name, kind: 'profile', feature: inside ? 'hole' : 'outline', tool, passes };
  const rough = rotateToLongestEdge(orient(roughRaw));
  const final = rotateToNearest(orient(finalRaw), rough[0]);

  const roughLevels = topZ - s.profileRoughBottom > 0.01 ? depthLevels(topZ, s.profileRoughBottom, s.profileStepdown) : [];
  roughLevels.forEach((z, i) => {
    const pts = closeLoop(rough, z);
    passes.push({ pts, feeds: pts.map((_, k) => (k === 0 ? s.plungeFeed : s.feed)), link: i === 0 ? 'retract' : 'direct' });
  });
  const fpts = closeLoop(final, s.finalZ);
  const ffeed = s.feed * s.finalFeedFactor;
  passes.push({ pts: fpts, feeds: fpts.map((_, k) => (k === 0 ? s.plungeFeed : ffeed)), link: passes.length ? 'direct' : 'retract' });

  if (s.tabs && !inside) {
    const centers = placeTabs(final, s.tabs, tool);
    const half = (s.tabs.width + tool.diameter) / 2;
    for (let i = 0; i < passes.length; i++) {
      const p = passes[i];
      if (p.pts[1][2] >= s.tabs.height) continue;
      passes[i] = applyTabs(p, tabIntervals(p.pts, centers, half), s.tabs.height);
    }
  }
  return { name, kind: 'profile', feature: inside ? 'hole' : 'outline', tool, passes };
}

/** Uncut area left in inside corners / narrow spots of a region for a tool of radius r. */
function uncutArea(region: PathsD, r: number) {
  return polyArea(difference(region, offset(offset(region, -r), r)));
}

/**
 * All operations for one flat board. Each feature uses the largest tool that fits; operations are ordered smallest
 * tool first, inner features (pockets high to low, then holes) before the outline.
 */
export function camPart(features: PartFeatures, settings: Partial<CamSettings> = {}): PartCam {
  const s: CamSettings = { ...DEFAULT_SETTINGS, ...settings };
  const top = Math.max(s.stockTop ?? 0, features.levels[0]?.z ?? features.thickness);
  const tools = [...s.tools].sort((a, b) => b.diameter - a.diameter);
  const warnings: string[] = [];
  const ops: Operation[] = [];
  const fits = (region: PathsD, inward: boolean) => (t: Tool) => offset(region, (inward ? -1 : 1) * (t.diameter / 2)).length > 0;

  // Pockets come top-down and each region contains the deeper ones, so a pocket starts at the previous floor --
  // unless that floor was cleared by another (bigger) bit that couldn't reach into this one.
  let pocketTop = top;
  let prevTool: Tool | undefined;
  features.pockets.forEach((p, i) => {
    // Open to the edge: run the bit 1mm past the edge into the waste, whatever its size. A bit only has to fit
    // that extended region (a 6mm bit cuts a 3.5mm rabbet).
    const openFor = (t: Tool) => openPocketRegion(features.outlines, p, t.diameter / 2 + 1);
    const tool = tools.find(t => fits(openFor(t), true)(t));
    if (!tool) return warnings.push(`pocket z=${p.floorZ}: no tool fits`);
    if (prevTool && prevTool !== tool) pocketTop = top;
    prevTool = tool;
    const region = openFor(tool);
    const uncut = uncutArea(region, tool.diameter / 2);
    if (uncut > 1) warnings.push(`pocket z=${p.floorZ}: ${uncut.toFixed(1)}mm² left in corners/narrow spots with D=${tool.diameter}`);
    ops.push(pocketOperation(`Pocket ${i + 1} z=${p.floorZ}`, region, pocketTop, p.floorZ, tool, s, features.outlines));
    pocketTop = p.floorZ;
  });
  if (s.cutThrough)
    features.throughHoles.forEach((h, i) => {
      const tool = tools.find(fits([h], true));
      if (!tool) return warnings.push(`through hole ${i + 1}: no tool fits`);
      ops.push(profileOperation(`Hole ${i + 1}`, h, top, tool, s, true));
    });
  if (s.cutThrough) features.outlines.forEach((o, i) => ops.push(profileOperation(`Outline ${i + 1}`, o, top, tools[0], s)));
  if (features.bottomFaces.length && s.cutThrough)
    warnings.push(`bottom-side features at z=${features.bottomFaces.map(b => b.z).join(', ')}: need a second (flipped) setup`);
  if (features.slopedArea > 1) warnings.push(`${features.slopedArea.toFixed(0)}mm² of sloped faces ignored (not 2.5D)`);

  // Stable sort: smallest tool first, keeps pockets -> holes -> outline within a tool.
  const operations = ops
    .map((op, i) => ({ op, i }))
    .sort((a, b) => a.op.tool.diameter - b.op.tool.diameter || a.i - b.i)
    .map(x => x.op);
  return { stockTop: top, operations, warnings };
}
