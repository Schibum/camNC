import { EndType, inflatePathsD, JoinType, pointInPolygonD, PointInPolygonResult, type PathsD } from 'clipper2-ts';
import { difference, maxOf, minOf, offset, polyArea, PRECISION, union } from './geom';
import { heldByPoints } from './holdPoints';
import type { PartCam } from './toolpaths';

type P2 = { x: number; y: number };

export interface TabHold {
  /** Middle of the tab, on the bit's path. */
  at: P2;
  /**
   * The stock on its far side is wide enough and reaches the board's edge, and no pocket of either side eats into the
   * tab: it holds the part.
   */
  anchored: boolean;
}

export interface PartHold {
  part: string;
  tabs: TabHold[];
  anchored: number;
  /** Enough anchored tabs to hold the part once its outline is cut through. */
  ok: boolean;
}

export interface HoldOptions {
  /** Narrowest stock strip, mm, that still holds a tab (after both cuts beside it). Default 3. */
  minWeb?: number;
  /** Anchored tabs a part needs. Default 2. */
  minTabs?: number;
  /**
   * Where the board is screwed or clamped down (board coordinates): a piece of stock can't turn or lift when enough of
   * them are on it (see `heldByPoints`). Tabs hold on to stock that reaches the board's edge whatever is on it; a piece
   * cut off from the edge needs enough of these.
   */
  points?: P2[];
  /** The board is taped or in a fixture: every piece of stock stays put. */
  taped?: boolean;
  /** What the pockets of both sides leave of the bottom layer, where tabs and skins are. Default: all of it. */
  layer?: BottomLayer;
}

/**
 * What's left at a spot (board coordinates, side A) of the board's bottom once the pockets of both sides are cut, as
 * heights above the stock's bottom: side B's pockets take everything below `from`, side A's everything above `to`.
 */
export type BottomLayer = (p: P2) => { from: number; to: number };

/** What's left of the bottom anywhere under a tab: its middle and ends, across the bit's path. */
export function layerAcross(layer: BottomLayer, at: P2, dir: P2, r: number, width: number) {
  const l = Math.hypot(dir.x, dir.y) || 1;
  const [ux, uy] = [dir.x / l, dir.y / l];
  let from = 0,
    to = Infinity;
  for (const along of [-width / 2, 0, width / 2])
    for (const off of [-r, 0, r]) {
      const here = layer({ x: at.x + ux * along - uy * off, y: at.y + uy * along + ux * off });
      from = Math.max(from, here.from);
      to = Math.min(to, here.to);
    }
  return { from, to };
}

/** No pocket eats into a tab of this height: it's as thick as assumed. */
export const tabWhole = (left: { from: number; to: number }, height: number) => left.from <= 1e-3 && left.to >= height - 1e-3;

const through = (z: number) => z <= 1e-3;

/** Inside a region given as loops (outer loops + holes), by crossing parity. */
function inside(p: P2, region: PathsD) {
  let n = 0;
  for (const loop of region) if (pointInPolygonD(p, loop) === PointInPolygonResult.IsInside) n++;
  return n % 2 === 1;
}

/** Split a region into its pieces: each outer loop with the holes inside it. */
function pieces(region: PathsD): PathsD[] {
  const outers = region.filter(l => polyArea([l]) > 0);
  const holes = region.filter(l => polyArea([l]) < 0);
  const out = outers.map(o => [o]);
  for (const h of holes) out.find(c => pointInPolygonD(h[0], c[0]) !== PointInPolygonResult.IsOutside)?.push(h);
  return out;
}

/**
 * Do the tabs hold? After every through cut (the outline final passes and through holes, at their full width), the
 * board's remaining stock outside the parts is what a tab can hold on to. A tab counts when the stock on its far side
 * is at least `minWeb` wide all the way to the board's edge (or an anchor): a tab into the 1 mm sliver left between
 * two neighbouring cuts holds nothing.
 */
export function holdCheck(cam: PartCam, board: { w: number; h: number }, opts: HoldOptions = {}): PartHold[] {
  const minTabs = opts.minTabs ?? 2;
  const { parts, held } = holdState(cam, board, opts);
  return parts.map(({ part, interior, tabs, r }) => {
    const checked = tabs.map(tab => ({
      at: tab.at,
      anchored: held(beyond(tab.at, tab.dir, r, interior)) && tabWhole(tabLeft(opts.layer, tab, r), tab.height),
    }));
    const count = checked.filter(t => t.anchored).length;
    return { part, tabs: checked, anchored: count, ok: count >= Math.min(minTabs, Math.max(1, tabs.length)) && tabs.length > 0 };
  });
}

type Tab = { at: P2; dir: P2; height: number };

/** What the pockets leave under a tab of the program. Its `dir` runs its whole length: the tab and the bit's width. */
function tabLeft(layer: BottomLayer | undefined, tab: Tab, r: number) {
  return layer ? layerAcross(layer, tab.at, tab.dir, r, Math.max(1, Math.hypot(tab.dir.x, tab.dir.y) - 2 * r)) : { from: 0, to: Infinity };
}

/** Just past the cut beside a spot on the bit's path, on the side away from the part: what a tab there holds on to. */
export function beyond(at: P2, dir: P2, r: number, interior: PathsD): P2 {
  const l = Math.hypot(dir.x, dir.y) || 1;
  let n = { x: -dir.y / l, y: dir.x / l };
  if (inside({ x: at.x + n.x * (r + 0.1), y: at.y + n.y * (r + 0.1) }, interior)) n = { x: -n.x, y: -n.y };
  return { x: at.x + n.x * (r + 0.6), y: at.y + n.y * (r + 0.6) };
}

/**
 * The board after every through cut: each part's interior and tabs, the stock's pieces, and `held(p)`: whether p lies in
 * stock that takes tabs: at least `minWeb` wide all the way to the board's edge, or held by enough hold points.
 */
export function holdState(cam: PartCam, board: { w: number; h: number }, opts: HoldOptions = {}) {
  const minWeb = opts.minWeb ?? 3;
  const cuts: PathsD = [];
  // The tabs' own material: left out when judging the stock beyond them (it would widen a thin strip).
  const bridges: PathsD = [];
  const parts: { part: string; interior: PathsD; tabs: Tab[]; r: number }[] = [];
  for (const op of cam.operations) {
    if (op.kind !== 'profile') continue;
    const r = op.tool.diameter / 2;
    for (const pass of op.passes) {
      // The separate complete contour lap already includes every through-cut made by its entry ramp.
      if (pass.entry === 'ramp' || pass.auxiliary) continue;
      if (!pass.pts.some(q => through(q[2]))) continue;
      // The cut-through stretches, at the bit's width; the raised ones in between are tabs.
      const lines: PathsD = [];
      const tabs: Tab[] = [];
      const height = maxOf(pass.pts.slice(1).map(q => q[2]));
      const tabLines: PathsD = [];
      let run: P2[] = [];
      let tab: P2[] = [];
      const flush = () => {
        if (run.length > 1) lines.push(run);
        run = [];
      };
      for (let i = 1; i < pass.pts.length; i++) {
        const [a, b] = [pass.pts[i - 1], pass.pts[i]];
        if (through(a[2]) && through(b[2])) {
          if (tab.length > 1) {
            const mid = tab[Math.floor(tab.length / 2)];
            const [p, q] = [tab[0], tab[tab.length - 1]];
            tabs.push({
              at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
              dir: { x: q.x - p.x || mid.x - p.x, y: q.y - p.y || mid.y - p.y },
              height,
            });
            tabLines.push(tab);
          }
          tab = [];
          if (!run.length) run.push({ x: a[0], y: a[1] });
          run.push({ x: b[0], y: b[1] });
        } else {
          flush();
          if (!through(a[2]) && !through(b[2])) {
            if (!tab.length) tab.push({ x: a[0], y: a[1] });
            tab.push({ x: b[0], y: b[1] });
          }
        }
      }
      flush();
      // A tab right at the end of the pass.
      if (tab.length > 1) {
        const [p, q] = [tab[0], tab[tab.length - 1]];
        tabs.push({ at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, dir: { x: q.x - p.x, y: q.y - p.y }, height });
        tabLines.push(tab);
      }
      cuts.push(...inflatePathsD(lines, r, JoinType.Round, EndType.Round, 2, PRECISION));
      bridges.push(...inflatePathsD(tabLines, r, JoinType.Round, EndType.Butt, 2, PRECISION));
      if (op.feature === 'outline') {
        const loop = pass.pts.map(q => ({ x: q[0], y: q[1] }));
        parts.push({ part: op.name.replace(/: [^:]*$/, ''), interior: offset(union([loop]), -r), tabs, r });
      }
    }
  }
  const rect = [
    [
      { x: 0, y: 0 },
      { x: board.w, y: 0 },
      { x: board.w, y: board.h },
      { x: 0, y: board.h },
    ],
  ];
  const waste = difference(rect, union(cuts, [...parts.flatMap(p => p.interior), ...bridges]));
  // Strips narrower than minWeb hold nothing: drop them, keep the rest's shape.
  const sturdy = offset(offset(waste, -minWeb / 2), minWeb / 2);
  const edge = difference(rect, offset(rect, -0.5));
  const stock = pieces(sturdy).map(piece => {
    const area = polyArea(piece);
    const on = (opts.points ?? []).filter(p => inside(p, piece));
    const fixed = heldByPoints(on, centroid(piece), piece.flat());
    const atEdge = polyArea(union(difference(piece, difference(piece, edge)), [])) > 1e-6;
    return {
      piece,
      area,
      centre: centroid(piece),
      holds: on.length,
      // Can't turn or lift.
      held: !!opts.taped || (opts.points ? fixed : atEdge),
      // Takes tabs.
      anchors: !!opts.taped || fixed || atEdge,
    };
  });
  const anchored = stock.filter(s => s.anchors).map(s => s.piece);
  // Many spots are asked about (every tab candidate): a bounding box per piece rules most of them out cheaply.
  const boxes = anchored.map(piece => {
    const pts = piece.flat();
    return {
      piece,
      x0: minOf(pts.map(q => q.x)),
      y0: minOf(pts.map(q => q.y)),
      x1: maxOf(pts.map(q => q.x)),
      y1: maxOf(pts.map(q => q.y)),
    };
  });
  const held = (p: P2) => boxes.some(b => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && inside(p, b.piece));
  return { parts, held, stock };
}

/** Area-weighted centre of a region (outer loops and holes). */
function centroid(region: PathsD): P2 {
  let a = 0,
    cx = 0,
    cy = 0;
  for (const loop of region)
    for (let i = 0; i < loop.length; i++) {
      const p = loop[i],
        q = loop[(i + 1) % loop.length];
      const c = p.x * q.y - q.x * p.y;
      a += c;
      cx += (p.x + q.x) * c;
      cy += (p.y + q.y) * c;
    }
  return Math.abs(a) < 1e-9 ? (region[0]?.[0] ?? { x: 0, y: 0 }) : { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Something that comes loose during the job, at the step where it happens. */
export interface HoldEvent {
  /** Index of the operation after which it happens. */
  step: number;
  /** That operation's name ("right: Outline 1"). */
  after: string;
  /**
   * `board`: the whole board, before the first cut, has too few holds. `pivot`: a piece of stock with too few holds (it
   * can turn or lift). `loose`: a part cut through with nothing holding it (no tabs into held stock). `pocket`: a pocket
   * of either side cuts away the tabs or the skin that hold a part (`cut`).
   */
  kind: 'board' | 'pivot' | 'loose' | 'pocket';
  /** `pocket`: what it cuts away. */
  cut?: 'tabs' | 'skin';
  /** The part's name, or "stock". */
  what: string;
  /** Where to point at, board coordinates. */
  at: P2;
  /** Hold points on that piece of stock. */
  holds?: number;
}

/**
 * Does it stay put all through the job? After each outline cut through, in program order: the stock left is split
 * into pieces, each held by enough hold points (or the edge / tape), and each part cut through so far needs tabs into
 * held stock. Each problem is reported once, at the step it first happens. Pieces smaller than `minArea` mm² (offcuts
 * that may fall free) are left out.
 */
export function holdTimeline(cam: PartCam, board: { w: number; h: number }, opts: HoldOptions & { minArea?: number } = {}): HoldEvent[] {
  const minTabs = opts.minTabs ?? 2;
  const minArea = opts.minArea ?? 2500;
  const events: HoldEvent[] = [];
  const seenStock: { x: number; y: number }[] = [];
  const seenPieces: PathsD[] = [];
  const seenParts = new Set<string>();
  // Not held before anything is cut: nothing below can hold it either (parts on a skin never split it at all).
  if (opts.points && !opts.taped) {
    const outline = [
      { x: 0, y: 0 },
      { x: board.w, y: 0 },
      { x: board.w, y: board.h },
      { x: 0, y: board.h },
    ];
    const at = { x: board.w / 2, y: board.h / 2 };
    const on = opts.points.filter(p => inside(p, [outline]));
    if (!heldByPoints(on, at, outline)) events.push({ step: -1, after: '', kind: 'board', what: 'stock', at, holds: on.length });
  }
  cam.operations.forEach((op, i) => {
    if (op.kind !== 'profile' || op.feature !== 'outline' || !op.passes.some(p => p.pts.some(q => through(q[2])))) return;
    const { parts, held, stock } = holdState({ ...cam, operations: cam.operations.slice(0, i + 1) }, board, opts);
    for (const s of stock) {
      if (s.held || s.area < minArea) continue;
      // The same piece at a later step (cut down a little more) is not news.
      // A piece of stock that is already reported, or a piece of it (later cuts only split it), is not news.
      if (seenStock.some(c => Math.hypot(c.x - s.centre.x, c.y - s.centre.y) < 20) || seenPieces.some(r => inside(s.centre, r))) continue;
      seenStock.push(s.centre);
      seenPieces.push(s.piece);
      events.push({ step: i, after: op.name, kind: 'pivot', what: 'stock', at: s.centre, holds: s.holds });
    }
    for (const p of parts) {
      if (seenParts.has(p.part)) continue;
      const anchored = p.tabs.filter(({ at, dir }) => held(beyond(at, dir, p.r, p.interior))).length;
      if (p.tabs.length && anchored >= Math.min(minTabs, p.tabs.length)) continue;
      seenParts.add(p.part);
      const pts = p.interior.flat();
      const at = pts.length
        ? {
            x: (minOf(pts.map(q => q.x)) + maxOf(pts.map(q => q.x))) / 2,
            y: (minOf(pts.map(q => q.y)) + maxOf(pts.map(q => q.y))) / 2,
          }
        : { x: 0, y: 0 };
      events.push({ step: i, after: op.name, kind: 'loose', what: p.part, at });
    }
  });
  if (opts.layer) events.push(...pocketEvents(cam, board, { ...opts, layer: opts.layer }, minTabs));
  return events;
}

/** With less left than this, mm, or half of what it should be, a tab or a skin is gone. */
const kThinnest = 0.5;
const gone = (left: number, whole: number) => left < Math.min(kThinnest, whole / 2);

/**
 * Parts whose tabs or bottom skin a pocket cuts away. Mostly side B's, which the board's program doesn't contain, so
 * reported at its end. Tabs: too few left to hold the part. Skin: what's left along the outline no longer surrounds the
 * part's centre (like holds around a piece of stock: left on two opposite edges, it can't pivot).
 */
function pocketEvents(
  cam: PartCam,
  board: { w: number; h: number },
  opts: HoldOptions & { layer: BottomLayer },
  minTabs: number
): HoldEvent[] {
  const step = cam.operations.length - 1;
  const after = cam.operations.at(-1)?.name ?? '';
  const middle = (pts: P2[]) => ({
    x: (minOf(pts.map(q => q.x)) + maxOf(pts.map(q => q.x))) / 2,
    y: (minOf(pts.map(q => q.y)) + maxOf(pts.map(q => q.y))) / 2,
  });
  const events: HoldEvent[] = [];
  for (const { part, tabs, r, interior } of holdState(cam, board, opts).parts) {
    const left = tabs.filter(tab => {
      const l = tabLeft(opts.layer, tab, r);
      return !gone(Math.min(l.to, tab.height) - l.from, tab.height);
    }).length;
    if (tabs.length && left < Math.min(minTabs, tabs.length))
      events.push({ step, after, kind: 'pocket', cut: 'tabs', what: part, at: middle(interior.flat()) });
  }
  for (const op of cam.operations) {
    if (op.feature !== 'outline') continue;
    const final = op.passes.at(-1);
    const skin = final && minOf(final.pts.map(q => q[2]));
    if (!final || skin === undefined || through(skin)) continue;
    const loop = final.pts.map(q => ({ x: q[0], y: q[1] }));
    const kept = alongLoop(loop, 3).filter(p => {
      const l = opts.layer(p);
      return !gone(Math.min(l.to, skin) - l.from, skin);
    });
    if (!heldByPoints(kept, centroid([loop]), loop))
      events.push({ step, after, kind: 'pocket', cut: 'skin', what: op.name.replace(/: [^:]*$/, ''), at: middle(loop) });
  }
  return events;
}

/** Points along a path, about `step` apart. */
function alongLoop(loop: P2[], step: number): P2[] {
  const out: P2[] = [];
  for (let i = 1; i < loop.length; i++) {
    const [a, b] = [loop[i - 1], loop[i]];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}
