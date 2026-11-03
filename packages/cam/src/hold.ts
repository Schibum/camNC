import { EndType, inflatePathsD, JoinType, pointInPolygonD, PointInPolygonResult, type PathsD } from 'clipper2-ts';
import { difference, offset, polyArea, PRECISION, union } from './geom';
import { heldByPoints } from './holdPoints';
import type { PartCam } from './toolpaths';

type P2 = { x: number; y: number };

export interface TabHold {
  /** Middle of the tab, on the bit's path. */
  at: P2;
  /** The stock on its far side is wide enough and reaches the board's edge: the tab holds the part. */
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
   * Where the board is screwed or clamped down (board coordinates): a piece of stock holds when enough of them are on
   * it (see `heldByPoints`), not because it reaches the board's edge.
   */
  points?: P2[];
  /** The board is taped or in a fixture: every piece of stock stays put. */
  taped?: boolean;
}

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
    const checked = tabs.map(({ at, dir }) => ({ at, anchored: held(beyond(at, dir, r, interior)) }));
    const count = checked.filter(t => t.anchored).length;
    return { part, tabs: checked, anchored: count, ok: count >= Math.min(minTabs, Math.max(1, tabs.length)) && tabs.length > 0 };
  });
}

/** Just past the cut beside a spot on the bit's path, on the side away from the part: what a tab there holds on to. */
export function beyond(at: P2, dir: P2, r: number, interior: PathsD): P2 {
  const l = Math.hypot(dir.x, dir.y) || 1;
  let n = { x: -dir.y / l, y: dir.x / l };
  if (inside({ x: at.x + n.x * (r + 0.1), y: at.y + n.y * (r + 0.1) }, interior)) n = { x: -n.x, y: -n.y };
  return { x: at.x + n.x * (r + 0.6), y: at.y + n.y * (r + 0.6) };
}

/**
 * The board after every through cut: each part's interior and tabs, and `held(p)`: whether p lies in stock that is at
 * least `minWeb` wide all the way to the board's edge (or an anchor).
 */
export function holdState(cam: PartCam, board: { w: number; h: number }, opts: HoldOptions = {}) {
  const minWeb = opts.minWeb ?? 3;
  const cuts: PathsD = [];
  // The tabs' own material: left out when judging the stock beyond them (it would widen a thin strip).
  const bridges: PathsD = [];
  const parts: { part: string; interior: PathsD; tabs: { at: P2; dir: P2 }[]; r: number }[] = [];
  for (const op of cam.operations) {
    if (op.kind !== 'profile') continue;
    const r = op.tool.diameter / 2;
    for (const pass of op.passes) {
      if (!pass.pts.some(q => through(q[2]))) continue;
      // The cut-through stretches, at the bit's width; the raised ones in between are tabs.
      const lines: PathsD = [];
      const tabs: { at: P2; dir: P2 }[] = [];
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
        tabs.push({ at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, dir: { x: q.x - p.x, y: q.y - p.y } });
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
    const held = opts.taped
      ? true
      : opts.points
        ? heldByPoints(on, centroid(piece), area)
        : polyArea(union(difference(piece, difference(piece, edge)), [])) > 1e-6;
    return { piece, area, centre: centroid(piece), holds: on.length, held };
  });
  const anchored = stock.filter(s => s.held).map(s => s.piece);
  // Many spots are asked about (every tab candidate): a bounding box per piece rules most of them out cheaply.
  const boxes = anchored.map(piece => {
    const pts = piece.flat();
    return {
      piece,
      x0: Math.min(...pts.map(q => q.x)),
      y0: Math.min(...pts.map(q => q.y)),
      x1: Math.max(...pts.map(q => q.x)),
      y1: Math.max(...pts.map(q => q.y)),
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
   * `pivot`: a piece of stock with too few holds (it can turn or lift). `loose`: a part cut through with nothing
   * holding it (no tabs into held stock).
   */
  kind: 'pivot' | 'loose';
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
            x: (Math.min(...pts.map(q => q.x)) + Math.max(...pts.map(q => q.x))) / 2,
            y: (Math.min(...pts.map(q => q.y)) + Math.max(...pts.map(q => q.y))) / 2,
          }
        : { x: 0, y: 0 };
      events.push({ step: i, after: op.name, kind: 'loose', what: p.part, at });
    }
  });
  return events;
}
