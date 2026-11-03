/**
 * Hold points: where the board is screwed or clamped to the bed. The app suggests them after nesting (in the waste,
 * clear of every cut), the user can move them, and the hold checks count a piece of stock as held when enough of them
 * are on it.
 */

type P2 = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export type HoldKind = 'screw' | 'clamp';

export interface HoldPoint {
  /** The footprint's centre. */
  x: number;
  y: number;
  kind: HoldKind;
  /**
   * A screw: its head's diameter, mm. A clamp: how far its toe reaches in from the board's edge, mm (it grips at the
   * edge). The bit stays clear of the footprint.
   */
  d: number;
  /** A clamp: its toe's width along the edge, mm. */
  w?: number;
  /** A clamp: the edge it grips, as the direction into the board (axis aligned). */
  dir?: P2;
  /** How far it stands above the stock's top, mm. Default `kHoldHeights`. */
  height?: number;
}

/** Starting sizes, until the user sets their own: a screw head; how far a small clamp's toe reaches in. */
export const kHoldDefaults: Record<HoldKind, number> = { screw: 10, clamp: 2 };
/** A clamp toe's starting width along the edge, mm. */
export const kClampWidth = 20;
/** Holds along an edge at most this far apart, mm. */
export const kHoldSpacing = 250;
/** No hold this close to the lower left corner, mm: the XY zero, where the probe or the camera finds the corner. */
export const kZeroClear = 40;
/** The bit's cut stays this far from a hold's footprint, mm. */
export const kHoldClearance = 1.5;
/** How far a hold stands above the stock's top until the user says otherwise, mm: a screw head; a clamp, well above safe Z. */
export const kHoldHeights: Record<HoldKind, number> = { screw: 3, clamp: 30 };
/** A hold no taller than this stays below the collet nut however deep the bit cuts, mm: only the bit can touch it. */
export const kLowHold = 5;
/**
 * Beside a taller hold the bit's path stays this far from the footprint, mm: the collet nut comes down next to it on
 * deep cuts. The radius of a ⌀24 nut (router collets, ER16) plus 1 mm: tools have no nut size or stickout to go by.
 */
export const kColletClearance = 13;
/** Moves pass at least this far above a hold's top, mm. */
export const kOverHold = 1;

/** How far it stands above the stock's top, mm. */
export const holdHeight = (h: Pick<HoldPoint, 'kind' | 'height'>) => h.height ?? kHoldHeights[h.kind];

/** How close the path of a bit of radius `r` may come to the hold's footprint: its edge, or the collet nut beside a tall hold. */
export const pathClearance = (h: Pick<HoldPoint, 'kind' | 'height'>, r: number) =>
  Math.max(r + kHoldClearance, holdHeight(h) > kLowHold ? kColletClearance : 0);

/**
 * Edge margin that leaves a frame of stock for holds around the parts: the hold, a little stock on its outer side, the
 * clearance and the outline cut (`bit`).
 */
export const frameMargin = (d: number, bit: number, kind: HoldKind = 'screw', height?: number) =>
  Math.ceil(d + (kind === 'clamp' ? 0 : 2) + pathClearance({ kind, height }, bit / 2) + bit / 2 + 1);

/** The edge nearest to p, as the direction into the board: where a clamp there grips. */
export function edgeDir(p: P2, board: { w: number; h: number }): P2 {
  const d = [p.y, board.w - p.x, board.h - p.y, p.x];
  const i = d.indexOf(Math.min(...d));
  return [
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 1, y: 0 },
  ][i];
}

/** A clamp pushed against its edge: the footprint's centre moved to d / 2 in from it. */
export function snapClamp(p: P2, d: number, board: { w: number; h: number }): P2 {
  const n = edgeDir(p, board);
  if (n.y === 1) return { x: p.x, y: d / 2 };
  if (n.y === -1) return { x: p.x, y: board.h - d / 2 };
  if (n.x === 1) return { x: d / 2, y: p.y };
  return { x: board.w - d / 2, y: p.y };
}

/** The hold's footprint as a box: a clamp's toe (w along its edge, d in), or the box around a screw head. */
export function holdBox(h: Pick<HoldPoint, 'x' | 'y' | 'kind' | 'd' | 'w' | 'dir'>): Rect {
  const [hx, hy] =
    h.kind === 'clamp' && h.w !== undefined ? (h.dir && h.dir.x !== 0 ? [h.d / 2, h.w / 2] : [h.w / 2, h.d / 2]) : [h.d / 2, h.d / 2];
  return { x: h.x - hx, y: h.y - hy, w: 2 * hx, h: 2 * hy };
}

/** How far p is from the hold's footprint (0 on it). */
export function holdDist(h: HoldPoint, p: P2): number {
  if (h.kind === 'clamp' && h.w !== undefined) return toRect(p, holdBox(h));
  return Math.max(0, Math.hypot(p.x - h.x, p.y - h.y) - h.d / 2);
}

const rectGap = (a: Rect, b: Rect) =>
  Math.hypot(Math.max(0, b.x - a.x - a.w, a.x - b.x - b.w), Math.max(0, b.y - a.y - a.h, a.y - b.y - b.h));

/** Distance from a point to a rectangle (0 inside). */
const toRect = (p: P2, r: Rect) => Math.hypot(Math.max(r.x - p.x, 0, p.x - r.x - r.w), Math.max(r.y - p.y, 0, p.y - r.y - r.h));

/**
 * Suggested hold spots for a board: the corners (the lower left one moved off the XY zero) and along every edge at
 * most `spacing` apart, each moved along
 * the edge (and a little inwards) to the nearest spot clear of the parts (`parts`: their rectangles; the outline cut
 * `bit` wide runs outside them). Spots with no room nearby are left out: the hold check then says which stock lacks
 * holds.
 */
export function suggestHoldPoints(
  board: { w: number; h: number },
  parts: Rect[],
  opts: { kind?: HoldKind; d?: number; w?: number; height?: number; bit: number; spacing?: number }
): HoldPoint[] {
  const kind = opts.kind ?? 'screw';
  const d = opts.d ?? kHoldDefaults[kind];
  const clamp = kind === 'clamp';
  const w = clamp ? (opts.w ?? kClampWidth) : d;
  const spacing = opts.spacing ?? kHoldSpacing;
  const keep = pathClearance({ kind, height: opts.height }, opts.bit / 2) + opts.bit / 2;
  const hold = (p: P2, dir: P2): HoldPoint => ({
    x: p.x,
    y: p.y,
    kind,
    d,
    ...(clamp && { w, dir }),
    ...(opts.height !== undefined && { height: opts.height }),
  });
  // A clamp grips at the edge, its toe reaching d in; a screw needs a little stock around it.
  const deep0 = d / 2 + (clamp ? 0 : 2);
  const side = clamp ? w / 2 : deep0;
  const free = (h: HoldPoint) => {
    const box = holdBox(h);
    return (
      box.x >= -1e-6 &&
      box.y >= -1e-6 &&
      box.x + box.w <= board.w + 1e-6 &&
      box.y + box.h <= board.h + 1e-6 &&
      Math.hypot(h.x, h.y) >= kZeroClear + Math.max(w, d) / 2 &&
      parts.every(r => (clamp ? rectGap(box, r) : toRect(h, r) - d / 2) >= keep)
    );
  };
  const out: HoldPoint[] = [];
  // Each edge: its line deep0 in, from `side` past its start to `side` before its end.
  const edges: { a: P2; b: P2; n: P2 }[] = [
    { a: { x: side, y: deep0 }, b: { x: board.w - side, y: deep0 }, n: { x: 0, y: 1 } },
    { a: { x: board.w - deep0, y: side }, b: { x: board.w - deep0, y: board.h - side }, n: { x: -1, y: 0 } },
    { a: { x: board.w - side, y: board.h - deep0 }, b: { x: side, y: board.h - deep0 }, n: { x: 0, y: -1 } },
    { a: { x: deep0, y: board.h - side }, b: { x: deep0, y: side }, n: { x: 1, y: 0 } },
  ];
  for (const { a, b, n } of edges) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const segs = Math.max(1, Math.ceil(len / spacing));
    // Each edge's own start corner and the spots along it; its end corner is the next edge's start.
    for (let k = 0; k < segs; k++) {
      const t = (k / segs) * len;
      const reach = Math.min(spacing / 3, len / segs / 2);
      // Nearest first: the first spot that is free is the one.
      let best: HoldPoint | undefined;
      // A clamp stays at the edge; a screw may move in a little.
      for (const [along, deep] of offsets(reach, clamp ? 0 : Math.min(30, spacing / 5))) {
        const at = Math.min(len, Math.max(0, t + along));
        const h = hold({ x: +(a.x + dir.x * at + n.x * deep).toFixed(1), y: +(a.y + dir.y * at + n.y * deep).toFixed(1) }, n);
        if (free(h)) {
          best = h;
          break;
        }
      }
      if (best && out.every(q => Math.hypot(q.x - best.x, q.y - best.y) >= Math.max(w + 4, spacing / 4))) out.push(best);
    }
  }
  return out;
}

/** Moves along an edge and inwards, cheapest first (inwards counts double). */
function offsets(reach: number, depth: number): [number, number][] {
  const key = `${reach}:${depth}`;
  const known = kOffsets.get(key);
  if (known) return known;
  const out: [number, number][] = [];
  for (let along = -reach; along <= reach + 1e-9; along += 2.5)
    for (let deep = 0; deep <= depth + 1e-9; deep += 2.5) out.push([along, deep]);
  out.sort((p, q) => Math.abs(p[0]) + 2 * p[1] - (Math.abs(q[0]) + 2 * q[1]));
  if (kOffsets.size > 64) kOffsets.clear();
  kOffsets.set(key, out);
  return out;
}
const kOffsets = new Map<string, [number, number][]>();

/**
 * Is a piece of stock (the hold points on it, its centre and its outline) held? At least 3 holds, not in a line, with
 * the piece's centre inside the polygon they span: it can neither pivot nor lift. A narrow strip makes do with 2 near
 * both ends: narrow across the line between them, and hardly any of it past them.
 */
export function heldByPoints(points: P2[], centre: P2, outline: P2[]): boolean {
  if (points.length >= 3) {
    const hull = convexHull(points);
    if (hull.length >= 3 && Math.abs(polygonArea(hull)) > 1e-3 && insideConvex(centre, hull)) return true;
  }
  if (points.length < 2) return false;
  // The farthest pair.
  let far = 0,
    a = points[0],
    b = points[1];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d > far) [far, a, b] = [d, points[i], points[j]];
    }
  if (far < 1e-6) return false;
  const along = { x: (b.x - a.x) / far, y: (b.y - a.y) / far };
  const spread = (f: (p: P2) => number) => {
    const v = outline.map(f);
    return Math.max(...v) - Math.min(...v);
  };
  const across = spread(p => (p.y - a.y) * along.x - (p.x - a.x) * along.y);
  const length = spread(p => (p.x - a.x) * along.x + (p.y - a.y) * along.y);
  return across < kStripShare * far && length < kStripOverhang * far;
}

/** A strip's width against the distance between its two holds. */
const kStripShare = 0.15;
/** A strip's length against the distance between its two holds. */
const kStripOverhang = 1.5;

/**
 * Holds something would hit: a path (cuts and rapids alike) passing within `pathClearance` of the footprint, lower than
 * `kOverHold` above the hold's top.
 */
export function holdClashes(points: HoldPoint[], cuts: { r: number; pts: [number, number, number][] }[], stockTop: number): HoldPoint[] {
  return points.filter(h => {
    const over = stockTop + holdHeight(h) + kOverHold;
    const box = h.kind === 'clamp' && h.w !== undefined ? holdBox(h) : undefined;
    return cuts.some(({ r, pts }) => {
      const keep = pathClearance(h, r) - 0.5;
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        if (Math.min(a[2], b[2]) >= over) continue;
        if ((box ? segRectDist(a, b, box) : segDist(h, a, b) - h.d / 2) < keep) return true;
      }
      return false;
    });
  });
}

function segDist(p: P2, a: [number, number, number], b: [number, number, number]) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a[0] + t * dx - p.x, a[1] + t * dy - p.y);
}

/** Distance from a segment to a box (0 when it crosses it). */
function segRectDist(a: [number, number, number], b: [number, number, number], r: Rect) {
  // Clipped to the box (Liang-Barsky): any part inside means it crosses.
  let t0 = 0,
    t1 = 1;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    return t0 <= t1;
  };
  if (clip(-dx, a[0] - r.x) && clip(dx, r.x + r.w - a[0]) && clip(-dy, a[1] - r.y) && clip(dy, r.y + r.h - a[1])) return 0;
  const corners: [number, number, number][] = [
    [r.x, r.y, 0],
    [r.x + r.w, r.y, 0],
    [r.x + r.w, r.y + r.h, 0],
    [r.x, r.y + r.h, 0],
  ];
  return Math.min(
    toRect({ x: a[0], y: a[1] }, r),
    toRect({ x: b[0], y: b[1] }, r),
    ...corners.map(c => segDist({ x: c[0], y: c[1] }, a, b))
  );
}

function polygonArea(poly: P2[]) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Inside a counterclockwise convex polygon (or on its edge). */
function insideConvex(p: P2, poly: P2[]) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < -1e-6) return false;
  }
  return true;
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
