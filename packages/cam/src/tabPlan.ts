import { pointInPolygonD, PointInPolygonResult } from 'clipper2-ts';
import { partToBoard, type BoardPart, type BoardSpec } from './board';
import { holdState } from './hold';
import { DEFAULT_TABS, throughCuts, type CamSettings, type Operation, type PartCam, type TabSettings } from './toolpaths';

type P2 = { x: number; y: number };

/**
 * A part whose tabs can't reach stock that holds: a bottom skin (the outline stops above the board's bottom; freed at
 * the machine), tabs where they would go anyway (they may not hold), or none (you hold it down: tape, clamps).
 */
export type TabFallback = 'skin' | 'tabs' | 'self';

/** How a part on a board is held: tabs placed where they hold, or its fallback. */
export interface PartHolding {
  /** Board part id. */
  id: string;
  name: string;
  how: 'placed' | TabFallback;
  /** Tab spots facing stock that holds (before picking). */
  spots: number;
  /** Placed tabs, board coordinates. */
  tabs: P2[];
}

export const kDefaultSkin = 1;

/**
 * Where each part's tabs go: only on straight runs of its outer edges (no notch, curve or corner: room for the tab and
 * the bit, and a saw gets at it) whose far side is stock that holds (wide enough all the way to the board's edge, see
 * the hold check), a few on two opposite sides (`pickTabs`). A part that can't be held like that gets its fallback.
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
  const { held } = holdState({ stockTop, operations: [...cuts.values()].flat(), warnings: [] }, board, opts);
  const out = new Map<string, PartHolding>();
  for (const part of board.parts) {
    const outline = cuts.get(part.id)!.find(o => o.feature === 'outline');
    const final = outline?.passes.at(-1);
    const fallback = part.tabFallback ?? board.tabFallback ?? 'skin';
    if (!outline || !final) {
      out.set(part.id, { id: part.id, name: part.name, how: fallback, spots: 0, tabs: [] });
      continue;
    }
    const r = outline.tool.diameter / 2;
    const loop = final.pts.map(q => ({ x: q[0], y: q[1] }));
    const shape = part.features.outlines.map(l => l.map(q => partToBoard(part, [q.x, q.y, 0])).map(q => ({ x: q[0], y: q[1] })));
    const insidePart = (p: P2) => shape.some(l => pointInPolygonD(p, l) === PointInPolygonResult.IsInside);
    // Not where the pass starts and ends: a tab across that seam would be cut in two.
    const room = tabs.width + outline.tool.diameter;
    const seam = loop[0];
    // Only on the part's outer edges (its convex hull), where a saw or flush trim bit gets at the tab afterwards: not in
    // notches, slots or the inside of an L.
    const hull = convexHull(loop);
    const spots = candidates(loop, room, kCornerClear)
      .filter(c => Math.hypot(c.at.x - seam.x, c.at.y - seam.y) > room && onHull(c.at, hull))
      .map(c => ({ ...c, out: outward(c, r, insidePart) }))
      .filter(c => held(c.out.far));
    const picked = pickTabs(spots, loop, tabs.minCount, room);
    out.set(
      part.id,
      picked.length >= minTabs
        ? { id: part.id, name: part.name, how: 'placed', spots: spots.length, tabs: picked }
        : { id: part.id, name: part.name, how: fallback, spots: spots.length, tabs: [] }
    );
  }
  return out;
}

/** Tabs stay this far from a corner (along the edge): a tab right at a corner is hard to cut off cleanly. */
const kCornerClear = 10;
/** An edge this long gets two tabs, a shorter one one. */
const kTwoTabEdge = 400;

type Side = 'left' | 'right' | 'bottom' | 'top';
type Spot = { at: P2; dir: P2; out: { far: P2; side: Side } };

/** The point just past the cut on the side away from the part, and which side of the part that is. */
function outward(c: { at: P2; dir: P2 }, r: number, insidePart: (p: P2) => boolean): { far: P2; side: Side } {
  const l = Math.hypot(c.dir.x, c.dir.y) || 1;
  let n = { x: -c.dir.y / l, y: c.dir.x / l };
  if (insidePart({ x: c.at.x + n.x * (r + 0.1), y: c.at.y + n.y * (r + 0.1) })) n = { x: -n.x, y: -n.y };
  const side: Side = Math.abs(n.x) >= Math.abs(n.y) ? (n.x > 0 ? 'right' : 'left') : n.y > 0 ? 'top' : 'bottom';
  return { far: { x: c.at.x + n.x * (r + 0.6), y: c.at.y + n.y * (r + 0.6) }, side };
}

/**
 * A small, balanced set of tabs: on two opposite sides of the part (its long sides if both have spots that hold, else
 * its ends), one per side, two on sides of `kTwoTabEdge` mm or more, at least `minCount` in all; spread evenly along
 * each side. A part held on one side only pivots about it on the last pass: no opposite pair, no tabs (its fallback).
 */
export function pickTabs(spots: Spot[], loop: P2[], minCount: number, minApart: number): P2[] {
  const xs = loop.map(p => p.x),
    ys = loop.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs),
    h = Math.max(...ys) - Math.min(...ys);
  const pairs: { sides: [Side, Side]; len: number; along: 'x' | 'y' }[] = [
    { sides: ['bottom', 'top'], len: w, along: 'x' },
    { sides: ['left', 'right'], len: h, along: 'y' },
  ];
  pairs.sort((a, b) => b.len - a.len);
  const pair = pairs.find(p => p.sides.every(s => spots.some(c => c.out.side === s)));
  if (!pair) return [];
  const per = pair.len >= kTwoTabEdge ? 2 : 1;
  const total = Math.max(minCount, 2 * per);
  const out: P2[] = [];
  pair.sides.forEach((side, i) => {
    const mine = spots.filter(c => c.out.side === side).map(c => c.at);
    const n = i === 0 ? Math.ceil(total / 2) : Math.floor(total / 2);
    const key = (p: P2) => p[pair.along];
    const lo = Math.min(...mine.map(key)),
      hi = Math.max(...mine.map(key));
    for (let k = 0; k < n; k++) {
      // Evenly along the side's spots: the middle for one, the quarter points for two.
      const target = lo + ((k + 0.5) / n) * (hi - lo);
      const best = mine
        .filter(p => out.every(q => Math.hypot(p.x - q.x, p.y - q.y) >= minApart))
        .sort((a, b) => Math.abs(key(a) - target) - Math.abs(key(b) - target))[0];
      if (best) out.push(best);
    }
  });
  return out;
}

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

/** On the hull's boundary (within 0.5 mm). */
function onHull(p: P2, hull: P2[]): boolean {
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i],
      b = hull[(i + 1) % hull.length];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= 0.5) return true;
  }
  return false;
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
 * After cutting a board with bottom-skin parts: frees them one at a time. For each, the bit cuts the skin along the
 * outline at the final depth (and once more, light), goes up, stops the spindle and pauses: "Take out <part>". The
 * spindle starts again before the next part; nothing moves while paused.
 */
export function freePartsProgram(
  cam: PartCam,
  opts: { feed: number; plungeFeed: number; finalZ: number }
): { cam: PartCam; parts: { name: string; at: P2 }[] } {
  const ops: Operation[] = [];
  const parts: { name: string; at: P2 }[] = [];
  for (const op of cam.operations) {
    if (op.feature !== 'outline') continue;
    const final = op.passes.at(-1);
    if (!final || Math.min(...final.pts.map(q => q[2])) <= opts.finalZ + 1e-6) continue;
    const name = op.name.replace(/: [^:]*$/, '');
    const pts = final.pts.map(q => [q[0], q[1], opts.finalZ] as [number, number, number]);
    const feeds = pts.map((_, k) => (k === 0 ? opts.plungeFeed : opts.feed));
    ops.push({
      name: `${name}: Free from the skin`,
      kind: 'profile',
      feature: 'outline',
      tool: op.tool,
      passes: [
        { pts, feeds, link: 'retract' },
        // A light second lap at the same depth: clean through where the first left a whisker.
        { pts, feeds: pts.map(() => opts.feed), link: 'direct' },
      ],
      pauseAfter: `Take out ${name}, then continue`,
    });
    const xs = pts.map(q => q[0]),
      ys = pts.map(q => q[1]);
    parts.push({ name, at: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 } });
  }
  return { cam: { ...cam, operations: ops, warnings: [] }, parts };
}
