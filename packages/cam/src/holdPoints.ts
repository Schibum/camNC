/**
 * Hold points: where the board is screwed or clamped to the bed. The app suggests them after nesting (in the waste,
 * clear of every cut), the user can move them, and the hold checks count a piece of stock as held when enough of them
 * are on it.
 */

type P2 = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export type HoldKind = 'screw' | 'clamp';

export interface HoldPoint {
  x: number;
  y: number;
  kind: HoldKind;
  /** Footprint diameter, mm: the screw head or the clamp's toe. The bit stays clear of it. */
  d: number;
}

/** Starting sizes, until the user sets their own: a screw head, a small clamp toe. */
export const kHoldDefaults: Record<HoldKind, number> = { screw: 10, clamp: 25 };
/** Holds along an edge at most this far apart, mm. */
export const kHoldSpacing = 250;
/** No hold this close to the lower left corner, mm: the XY zero, where the probe or the camera finds the corner. */
export const kZeroClear = 40;
/** The bit's cut stays this far from a hold's footprint, mm. */
export const kHoldClearance = 1.5;

/**
 * Edge margin that leaves a frame of stock for holds around the parts: the hold, a little stock on its outer side, the
 * clearance and the outline cut (`bit`).
 */
export const frameMargin = (d: number, bit: number) => Math.ceil(d + 2 + kHoldClearance + bit + 1);

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
  opts: { kind?: HoldKind; d?: number; bit: number; spacing?: number }
): HoldPoint[] {
  const kind = opts.kind ?? 'screw';
  const d = opts.d ?? kHoldDefaults[kind];
  const spacing = opts.spacing ?? kHoldSpacing;
  const keep = d / 2 + kHoldClearance + opts.bit;
  // A clamp grips at the edge; a screw needs a little stock around it.
  const inset = d / 2 + (kind === 'clamp' ? 0 : 2);
  const free = (p: P2) =>
    p.x >= inset - 1e-6 &&
    p.y >= inset - 1e-6 &&
    p.x <= board.w - inset + 1e-6 &&
    p.y <= board.h - inset + 1e-6 &&
    Math.hypot(p.x, p.y) >= kZeroClear + d / 2 &&
    parts.every(r => toRect(p, r) >= keep);
  const out: HoldPoint[] = [];
  const edges: { a: P2; b: P2; n: P2 }[] = [
    { a: { x: inset, y: inset }, b: { x: board.w - inset, y: inset }, n: { x: 0, y: 1 } },
    { a: { x: board.w - inset, y: inset }, b: { x: board.w - inset, y: board.h - inset }, n: { x: -1, y: 0 } },
    { a: { x: board.w - inset, y: board.h - inset }, b: { x: inset, y: board.h - inset }, n: { x: 0, y: -1 } },
    { a: { x: inset, y: board.h - inset }, b: { x: inset, y: inset }, n: { x: 1, y: 0 } },
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
      let best: P2 | undefined;
      for (const [along, deep] of offsets(reach, Math.min(30, spacing / 5))) {
        const at = Math.min(len, Math.max(0, t + along));
        const p = { x: a.x + dir.x * at + n.x * deep, y: a.y + dir.y * at + n.y * deep };
        if (free(p)) {
          best = p;
          break;
        }
      }
      if (best && out.every(q => Math.hypot(q.x - best.x, q.y - best.y) >= Math.max(d + 4, spacing / 4)))
        out.push({ x: +best.x.toFixed(1), y: +best.y.toFixed(1), kind, d });
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
 * Is a piece of stock (its area and the hold points on it) held? At least 3 holds, not in a line, with the piece's
 * centre inside the polygon they span: it can neither pivot nor lift. A narrow strip may make do with 2, far apart.
 */
export function heldByPoints(points: P2[], centre: P2, area: number): boolean {
  if (points.length >= 3) {
    const hull = convexHull(points);
    if (hull.length >= 3 && Math.abs(polygonArea(hull)) > 1e-3 && insideConvex(centre, hull)) return true;
  }
  if (points.length >= 2) {
    // The farthest pair: a strip much longer than wide that is held near both ends.
    let far = 0;
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) far = Math.max(far, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    if (far > 0 && area < 0.15 * far * far) return true;
  }
  return false;
}

/** Holds the bit would hit: closer to a cut than the clearance (the tool's path, its radius and the footprint). */
export function holdClashes(points: HoldPoint[], cuts: { r: number; pts: [number, number, number][] }[], stockTop: number): HoldPoint[] {
  return points.filter(h =>
    cuts.some(({ r, pts }) => {
      const keep = h.d / 2 + r + kHoldClearance - 0.5;
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        if (Math.min(a[2], b[2]) >= stockTop - 1e-3) continue;
        if (segDist(h, a, b) < keep) return true;
      }
      return false;
    })
  );
}

function segDist(p: P2, a: [number, number, number], b: [number, number, number]) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a[0] + t * dx - p.x, a[1] + t * dy - p.y);
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
