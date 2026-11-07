import { holdOptionsOf, partToBoard, type BoardPart, type BoardSpec } from './board';
import type { TurnedOver } from './flip';
import { maxOf, minOf } from './geom';
import { holdState, layerAcross, tabWhole } from './hold';
import { releaseMetadata } from './releaseMetadata';
import {
  DEFAULT_TABS,
  throughCuts,
  type CamSettings,
  type Operation,
  type PartCam,
  type Pass,
  type TabSettings,
  type Tool,
} from './toolpaths';

type P2 = { x: number; y: number };

/** How a part on a board is held: tabs placed where they hold, a bottom skin, or (`unheld`) nothing. */
export interface PartHolding {
  /** Board part id. */
  id: string;
  name: string;
  /** `unheld`: no edge where tabs would hold: cut without tabs, and the job is blocked until it's moved or on a skin. */
  how: 'placed' | 'skin' | 'unheld';
  /** Placed tabs, board coordinates. */
  tabs: P2[];
  /** Placed: how many it should have had (Min #, or more on long sides), when fewer fit. */
  wanted?: number;
  /** Placed where the user put them (see `BoardPart.tabsAt`), not picked. */
  moved?: boolean;
}

export const kDefaultSkin = 1;

/**
 * Where each part's tabs go: only on straight runs of its outer edges (no notch, curve or corner: room for the tab and
 * the bit, and a saw gets at it) whose far side is stock that holds (wide enough all the way to the board's edge, see
 * the hold check), a few on two opposite sides (`pickTabs`). A part that can't be held like that is `unheld`.
 */
export function planTabs(
  board: BoardSpec,
  settings: Partial<CamSettings>,
  opts: { minWeb?: number; minTabs?: number } = {}
): Map<string, PartHolding> {
  const tabs: TabSettings = { ...DEFAULT_TABS, ...board.tabs };
  const minTabs = opts.minTabs ?? 2;
  const stockTop = board.stockTop ?? board.thickness;
  // Every outline and hole cut through, no tabs: what stock is left to hold on to. Only the through cuts matter, so
  // this is far cheaper than the board's program.
  const cuts = new Map(
    board.parts.map(part => [
      part.id,
      throughCuts(part.features, { ...settings, stockTop }).map(op => ({
        ...op,
        name: `${part.name}: ${op.name}`,
        passes: op.passes.map(p => ({ ...p, pts: p.pts.map(q => partToBoard(part, q)) })),
      })),
    ])
  );
  const options = { ...holdOptionsOf(board, settings), ...opts };
  const { held } = holdState({ stockTop, operations: [...cuts.values()].flat(), warnings: [] }, board, options);
  const { layer } = options;
  const out = new Map<string, PartHolding>();
  for (const part of board.parts) {
    const outline = cuts.get(part.id)!.find(o => o.feature === 'outline');
    const final = outline?.passes.at(-1);
    if (!outline || !final) {
      out.set(part.id, { id: part.id, name: part.name, how: 'unheld', tabs: [] });
      continue;
    }
    const r = outline.tool.diameter / 2;
    const loop = final.pts.map(q => ({ x: q[0], y: q[1] }));
    // The bit's path goes round the part: the part is on its left if it runs counterclockwise.
    const ccw = loop.reduce((s, p, i) => (i ? s + loop[i - 1].x * p.y - p.x * loop[i - 1].y : s), 0) > 0;
    // Not where the pass starts and ends: a tab across that seam would be cut in two.
    const room = tabs.width + outline.tool.diameter;
    const seam = loop[0];
    // Where the user put them: on the bit's path, nearest to each. The hold check then says whether they hold.
    if (part.tabsAt?.length) {
      const tabsOn = part.tabsAt.map(q => {
        const [x, y] = partToBoard(part, [q.x, q.y, 0]);
        const at = nearestOnLoop(loop, { x, y });
        // Off the seam, where the pass starts and ends: a tab across it would be cut in two.
        if (Math.hypot(at.x - loop[0].x, at.y - loop[0].y) > room) return at;
        const [fwd, back] = [alongLoop(loop, room), alongLoop([...loop].reverse(), room)];
        return Math.hypot(fwd.x - at.x, fwd.y - at.y) <= Math.hypot(back.x - at.x, back.y - at.y) ? fwd : back;
      });
      out.set(part.id, { id: part.id, name: part.name, how: 'placed', tabs: tabsOn, moved: true });
      continue;
    }
    // Only where a saw, chisel or flush trim bit gets at the tab afterwards (`reachable`): not in notches, slots or the
    // inside of a hook, but a long free edge set back from the part's hull is fine.
    const hull = convexHull(loop);
    // Nor where a pocket of either side eats into the tab: side B's would cut the part free with the bit at depth.
    const spots = candidates(loop, room, kCornerClear)
      .filter(c => Math.hypot(c.at.x - seam.x, c.at.y - seam.y) > room)
      .filter(c => !layer || tabWhole(layerAcross(layer, c.at, c.dir, r, tabs.width), tabs.height))
      .map(c => ({ ...c, out: outward(c, r, ccw) }))
      .filter(c => reachable(c, loop, hull));
    // Not on a thin finger (a hook, a tongue) when the part has sturdier spots: it flexes, and the part pivots about it.
    const thick = new Map(spots.map(c => [c, widthBehind(c, loop, r)]));
    const thickest = Math.max(0, ...thick.values());
    const sturdy = spots.filter(c => thick.get(c)! >= Math.min(kThinFinger, thickest / 2));
    // Asked only of the spots tried (a part has a thousand), once each.
    const holds = new Map<Spot, boolean>();
    const hf = (s: Spot) => holds.get(s) ?? holds.set(s, held(s.out.far)).get(s)!;
    const centre = centroid(loop);
    let { tabs: picked, wanted } = pickTabs(sturdy, hf, loop, tabs.minCount, room, centre);
    if (picked.length < minTabs) ({ tabs: picked, wanted } = pickTabs(spots, hf, loop, tabs.minCount, room, centre));
    out.set(
      part.id,
      picked.length >= minTabs
        ? { id: part.id, name: part.name, how: 'placed', tabs: picked, ...(picked.length < wanted && { wanted }) }
        : { id: part.id, name: part.name, how: 'unheld', tabs: [] }
    );
  }
  return out;
}

/** The point of a closed path nearest to `q`. */
export function nearestOnLoop(loop: P2[], q: P2): P2 {
  let best = loop[0],
    d = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(1, Math.max(0, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
    const p = { x: a.x + t * dx, y: a.y + t * dy };
    const e = Math.hypot(p.x - q.x, p.y - q.y);
    if (e < d) [best, d] = [p, e];
  }
  return best;
}

/** The point `dist` along a path from its start (its end if it's shorter). */
function alongLoop(loop: P2[], dist: number): P2 {
  for (let i = 1; i < loop.length; i++) {
    const [a, b] = [loop[i - 1], loop[i]];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= dist) return { x: a.x + ((b.x - a.x) * dist) / (l || 1), y: a.y + ((b.y - a.y) * dist) / (l || 1) };
    dist -= l;
  }
  return loop[loop.length - 1];
}

/** Tabs stay this far from a corner (along the edge): a tab right at a corner is hard to cut off cleanly. */
const kCornerClear = 10;
/** An edge this long gets two tabs, a shorter one one. */
const kTwoTabEdge = 400;
/** Less part than this behind a tab (mm, across it) is a thin finger, if the part is at least twice as wide elsewhere. */
const kThinFinger = 40;
/** A tool gets at a tab from this far either side of square to the edge, degrees. */
const kReachFan = [0, -20, 20, -40, 40].map(d => (d * Math.PI) / 180);

type Side = 'left' | 'right' | 'bottom' | 'top';
type Spot = { at: P2; dir: P2; out: { far: P2; side: Side } };

/** The point just past the cut on the side away from the part, and which side of the part that is. */
function outward(c: { at: P2; dir: P2 }, r: number, ccw: boolean): { far: P2; side: Side } {
  const l = Math.hypot(c.dir.x, c.dir.y) || 1;
  // Away from the part: to the right of a counterclockwise path, the left of a clockwise one.
  const n = ccw ? { x: c.dir.y / l, y: -c.dir.x / l } : { x: -c.dir.y / l, y: c.dir.x / l };
  const side: Side = Math.abs(n.x) >= Math.abs(n.y) ? (n.x > 0 ? 'right' : 'left') : n.y > 0 ? 'top' : 'bottom';
  return { far: { x: c.at.x + n.x * (r + 0.6), y: c.at.y + n.y * (r + 0.6) }, side };
}

/**
 * A small, balanced set of tabs: on two opposite sides of the part (its long sides if both have spots that hold, else
 * its ends), one per side, two on sides of `kTwoTabEdge` mm or more, at least `minCount` in all; spread evenly along
 * each side, each the spot that holds nearest its place. The ends instead when the part's centre of mass would be
 * outside the tabs on the long sides. A part held on one side only pivots about it on the last pass: no opposite pair,
 * no tabs (it is unheld).
 */
function pickTabs(
  spots: Spot[],
  holds: (s: Spot) => boolean,
  loop: P2[],
  minCount: number,
  minApart: number,
  centre: P2
): { tabs: P2[]; wanted: number } {
  const xs = loop.map(p => p.x),
    ys = loop.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs),
    h = Math.max(...ys) - Math.min(...ys);
  const pairs: Pair[] = [
    { sides: ['bottom', 'top'], len: w, along: 'x' },
    { sides: ['left', 'right'], len: h, along: 'y' },
  ];
  pairs.sort((a, b) => b.len - a.len);
  const usable = pairs.filter(p => p.sides.every(s => spots.some(c => c.out.side === s && holds(c))));
  if (!usable.length) return { tabs: [], wanted: minCount };
  // The long sides, unless the part's centre of mass ends up outside its tabs there (it tips about them) and the ends
  // hold it better.
  const tries = usable.map(pair => tabsOnPair(pair, spots, holds, minCount, minApart));
  return tries.find(t => surrounds(t.tabs, centre)) ?? tries[0];
}

type Pair = { sides: [Side, Side]; len: number; along: 'x' | 'y' };

function tabsOnPair(
  pair: Pair,
  spots: Spot[],
  holds: (s: Spot) => boolean,
  minCount: number,
  minApart: number
): { tabs: P2[]; wanted: number } {
  const per = pair.len >= kTwoTabEdge ? 2 : 1;
  const total = Math.max(minCount, 2 * per);
  const key = (p: P2) => p[pair.along];
  const out: P2[] = [];
  pair.sides.forEach((side, i) => {
    const mine = spots.filter(c => c.out.side === side);
    const n = i === 0 ? Math.ceil(total / 2) : Math.floor(total / 2);
    const lo = Math.min(...mine.map(c => key(c.at))),
      hi = Math.max(...mine.map(c => key(c.at)));
    for (let k = 0; k < n; k++) {
      // Evenly along the side: the middle for one, the quarter points for two.
      const target = lo + ((k + 0.5) / n) * (hi - lo);
      const best = mine
        .filter(c => out.every(q => Math.hypot(c.at.x - q.x, c.at.y - q.y) >= minApart))
        .sort((a, b) => Math.abs(key(a.at) - target) - Math.abs(key(b.at) - target))
        .find(holds);
      if (best) out.push(best.at);
    }
  });
  // Short of the count (short edges, few spots that hold): more wherever there's room, each as far from the others as
  // can be (the other two sides too).
  while (out.length < total) {
    const apart = (c: Spot) => Math.min(...out.map(q => Math.hypot(c.at.x - q.x, c.at.y - q.y)));
    const next = spots
      .map(c => ({ c, d: apart(c) }))
      .filter(x => x.d >= minApart)
      .sort((a, b) => b.d - a.d)
      .find(x => holds(x.c));
    if (!next) break;
    out.push(next.c.at);
  }
  return { tabs: out, wanted: total };
}

/** The centre is inside the tabs' polygon (two tabs: a line, can't tell, so yes). */
function surrounds(tabs: P2[], centre: P2): boolean {
  if (tabs.length < 3) return true;
  const hull = convexHull(tabs);
  return hull.length >= 3 && inside(centre, hull);
}

/** Area centroid of a closed loop. */
function centroid(loop: P2[]): P2 {
  let a = 0,
    x = 0,
    y = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i],
      q = loop[(i + 1) % loop.length];
    const c = p.x * q.y - q.x * p.y;
    a += c;
    x += (p.x + q.x) * c;
    y += (p.y + q.y) * c;
  }
  return Math.abs(a) < 1e-9 ? loop[0] : { x: x / (3 * a), y: y / (3 * a) };
}

/** Point in polygon, by crossing parity. */
function inside(p: P2, poly: P2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** How far along p + t·d (t > 0.5 mm, below max) the ray first crosses the loop; Infinity if it doesn't. */
function rayHit(p: P2, d: P2, loop: P2[], max: number): number {
  let best = Infinity;
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1],
      b = loop[i];
    const ex = b.x - a.x,
      ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
    const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / den;
    if (t > 0.5 && t < Math.min(max, best) && u >= 0 && u <= 1) best = t;
  }
  return best;
}

/** Unit normal away from the part, from the spot's far point. */
const awayFrom = (c: Spot): P2 => {
  const n = { x: c.out.far.x - c.at.x, y: c.out.far.y - c.at.y };
  const l = Math.hypot(n.x, n.y) || 1;
  return { x: n.x / l, y: n.y / l };
};

/**
 * A tool gets at the tab: lines from it, square to the edge and up to 40° either way, leave the part's hull without
 * crossing the part again. A notch's floor or a slot between a hook and the body fails; a free edge that is set back
 * passes.
 */
function reachable(c: Spot, loop: P2[], hull: P2[]): boolean {
  const n = awayFrom(c);
  return kReachFan.every(a => {
    const d = { x: n.x * Math.cos(a) - n.y * Math.sin(a), y: n.x * Math.sin(a) + n.y * Math.cos(a) };
    // How far until the line is out of the hull.
    let far = 2;
    while (far < 1000 && inside({ x: c.at.x + d.x * far, y: c.at.y + d.y * far }, hull)) far += 2;
    return rayHit(c.at, d, loop, far) === Infinity;
  });
}

/**
 * The part's width behind the tab, mm: straight across to its other side, path to path less the bit both sides; the
 * least of the tab's middle and `kWidthBand` mm either side along the edge, so a tab by the root of a finger counts
 * as on it.
 */
function widthBehind(c: Spot, loop: P2[], r: number): number {
  const n = awayFrom(c);
  const l = Math.hypot(c.dir.x, c.dir.y) || 1;
  return Math.min(
    ...[-kWidthBand, 0, kWidthBand].map(
      o => rayHit({ x: c.at.x + (c.dir.x / l) * o, y: c.at.y + (c.dir.y / l) * o }, { x: -n.x, y: -n.y }, loop, 1e5) - 2 * r
    )
  );
}
const kWidthBand = 15;

/** Convex hull, counterclockwise (monotone chain). */
function convexHull(points: P2[]): P2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: P2[]) => {
    const h: P2[] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/**
 * Tab spots on a closed path: every 3 mm along its straight runs (segments within 2° of the run's first), at least `room`/2
 * + 1 mm (and `clear`) from a run's ends, so the tab and the bit's turn stay off notches, curves and corners.
 */
export function candidates(loop: P2[], room: number, clear = 0): { at: P2; dir: P2 }[] {
  const segs: { a: P2; b: P2; len: number; ang: number }[] = [];
  for (let i = 1; i < loop.length; i++) {
    const [a, b] = [loop[i - 1], loop[i]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 1e-6) segs.push({ a, b, len, ang: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  const runs: (typeof segs)[] = [];
  for (const s of segs) {
    const run = runs.at(-1);
    // Against the run's first segment, not the previous one: a finely tessellated curve turns little per step.
    const first = run?.[0];
    const turn = first ? Math.abs(Math.atan2(Math.sin(s.ang - first.ang), Math.cos(s.ang - first.ang))) : Infinity;
    if (run && turn < (2 * Math.PI) / 180) run.push(s);
    else runs.push([s]);
  }
  const out: { at: P2; dir: P2 }[] = [];
  for (const run of runs) {
    const length = run.reduce((t, s) => t + s.len, 0);
    // The tab and the bit's width beside it, plus 1 mm, all on the straight.
    const margin = Math.max(room / 2 + 1, clear);
    if (length < 2 * margin) continue;
    const a = run[0].a,
      b = run.at(-1)!.b;
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    for (let d = margin; d <= length - margin + 1e-6; d += 3) out.push({ at: { x: a.x + dir.x * d, y: a.y + dir.y * d }, dir });
  }
  return out;
}

/** Board coordinates -> the part's own (inverse of partToBoard). */
export function boardToPart(p: Pick<BoardPart, 'x' | 'y' | 'rotated' | 'size'>, q: P2): P2 {
  return p.rotated ? { x: q.y - p.y, y: p.x + p.size[1] - q.x } : { x: q.x - p.x, y: q.y - p.y };
}

/**
 * After cutting a board with bottom-skin parts: frees them one at a time (`pause` false, for a taped board: all of
 * them in one go, smallest first, no pauses). For each, the bit cuts the skin along the
 * outline at the final depth, goes up, stops the spindle and pauses: "Take out <part>". The spindle starts again before
 * the next part; nothing moves while paused. A skin deeper than the bit's `stepdown` is cut in several laps.
 */
export function freePartsProgram(
  cam: PartCam,
  opts: { feed: number; plungeFeed: number; finalZ: number; turned?: TurnedOver; pause?: boolean; stepdown?: (tool: Tool) => number }
): { cam: PartCam; parts: { name: string; at: P2 }[] } {
  const turned = opts.turned;
  const pause = opts.pause ?? true;
  const ops: Operation[] = [];
  const parts: { name: string; at: P2 }[] = [];
  // Without pauses (taped down, nothing taken out in between): the smallest parts first, while the most tape still
  // holds around them.
  const footprint = (op: Operation) => {
    const pts = op.passes.at(-1)?.pts ?? [];
    const xs = pts.map(q => q[0]),
      ys = pts.map(q => q[1]);
    return pts.length ? (maxOf(xs) - minOf(xs)) * (maxOf(ys) - minOf(ys)) : 0;
  };
  const outlines = pause ? cam.operations : [...cam.operations].sort((a, b) => footprint(a) - footprint(b));
  for (const op of outlines) {
    if (op.feature !== 'outline') continue;
    const final = op.passes.at(-1);
    if (!final || minOf(final.pts.map(q => q[2])) <= opts.finalZ + 1e-6) continue;
    const name = op.name.replace(/: [^:]*$/, '');
    // Turned over after side B, the skin is on top now: from the new top through it, as far past it as finalZ goes below
    // the bottom. Mirrored, the path runs the other way round: reversed, the bit cuts the same way as before.
    const skin = minOf(final.pts.map(q => q[2]));
    const bottom = turned ? cam.stockTop - skin + opts.finalZ : opts.finalZ;
    const depth = skin - opts.finalZ;
    const laps = Math.max(1, Math.ceil(depth / (opts.stepdown?.(op.tool) ?? depth) - 1e-6));
    const passes: Pass[] = Array.from({ length: laps }, (_, lap) => {
      const z = bottom + (depth * (laps - 1 - lap)) / laps;
      const pts = turned
        ? [...final.pts].reverse().map(q => [q[0], turned.h - q[1], z] as [number, number, number])
        : final.pts.map(q => [q[0], q[1], z] as [number, number, number]);
      return { pts, feeds: pts.map((_, k) => (k === 0 ? opts.plungeFeed : opts.feed)), link: lap ? 'direct' : 'retract' };
    });
    const pts = passes[0].pts;
    ops.push({
      name: `${name}: Cut free`,
      kind: 'profile',
      feature: 'outline',
      tool: op.tool,
      // Through the skin once: finalZ already goes past the bottom, a second lap at the same depth cuts nothing.
      passes,
      ...(pause && { pauseAfter: `Take out ${name}, then continue`, part: name }),
    });
    const xs = pts.map(q => q[0]),
      ys = pts.map(q => q[1]);
    parts.push({ name, at: { x: (minOf(xs) + maxOf(xs)) / 2, y: (minOf(ys) + maxOf(ys)) / 2 } });
  }
  return { cam: { ...cam, ...releaseMetadata(cam, turned), operations: ops, warnings: [] }, parts };
}
