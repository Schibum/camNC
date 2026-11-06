/** Rectangle nesting of parts on boards (true-shape nesting comes later). Pure geometry, no Clipper or occt. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NestItem {
  id: string;
  /** Size of the part's bounding box, laid flat. */
  w: number;
  h: number;
  /** May turn 90°; off by default: wood grain usually runs along the part. */
  canRotate?: boolean;
}

export interface NestOptions {
  /** Free space between parts: bit diameter + margin, so the outline cuts never touch. */
  gap: number;
  /** Free border inside the board edge (clamps, uneven edges). */
  margin: number;
  /**
   * Areas parts must stay out of (and `gap` away from), e.g. clamps (board coordinates, X0 Y0 lower left). A fitted
   * board shares the lower left corner, so keep-outs there work in fit mode too; ones that depend on the board size
   * need a second nest on the fixed board.
   */
  keepOuts?: Rect[];
  /** Fixed board size; omitted = fit the board to the parts. */
  board?: { w: number; h: number };
  /** Fixed board: don't retry with the big parts moved last when some don't fit (faster, may place less). */
  quick?: boolean;
}

export interface Placement {
  id: string;
  /** Lower left corner of the (possibly turned) part on the board. */
  x: number;
  y: number;
  /** Turned 90° counterclockwise. */
  rotated: boolean;
}

export interface NestResult {
  board: { w: number; h: number };
  /** In the order of the input items. */
  placements: Placement[];
  /** Items that didn't fit on a fixed board. */
  unplaced: string[];
  /** Part area / board area. */
  yield: number;
}

/** Item size as placed. */
export const placedSize = (item: NestItem, rotated: boolean) => (rotated ? { w: item.h, h: item.w } : { w: item.w, h: item.h });

const EPS = 1e-7;

type Heuristic = 'bl' | 'bssf' | 'baf';

interface Packed {
  placements: Placement[];
  unplaced: string[];
  /** Upper right corner of the placed parts (margin not included). */
  maxX: number;
  maxY: number;
  /** Placed part area. */
  area: number;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const contains = (a: Rect, b: Rect) => b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;

/** MaxRects: cut `used` out of every free rectangle it overlaps and keep the maximal leftovers. */
function splitFree(free: Rect[], used: Rect): Rect[] {
  const out: Rect[] = [];
  for (const f of free) {
    if (!overlaps(f, used)) {
      out.push(f);
      continue;
    }
    if (used.x > f.x + EPS) out.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
    if (used.x + used.w < f.x + f.w - EPS) out.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - used.x - used.w, h: f.h });
    if (used.y > f.y + EPS) out.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
    if (used.y + used.h < f.y + f.h - EPS) out.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - used.y - used.h });
  }
  // Drop rectangles inside others (of two equal ones keep the first).
  const maximal: Rect[] = [];
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    let contained = false;
    for (let j = 0; j < out.length; j++)
      if (j !== i && contains(out[j], r) && (j < i || !contains(r, out[j]))) {
        contained = true;
        break;
      }
    if (!contained) maximal.push(r);
  }
  return maximal;
}

/** The board and its obstacles are identical for every order and placement-rule trial. */
function initialFree(bin: Rect, gap: number, keepOuts: Rect[]): Rect[] {
  let free: Rect[] = bin.w > 0 && bin.h > 0 ? [bin] : [];
  for (const k of keepOuts) free = splitFree(free, { x: k.x, y: k.y, w: k.w + gap, h: k.h + gap });
  return free;
}

/**
 * One MaxRects run. Parts are grown by `gap` to the right and top, and the free area reaches `gap` past the right
 * and top margin, so grown parts that don't overlap keep `gap` between them and `margin` from the board edge.
 * Keep-outs are grown by `gap` the same way (to the right and top; parts grow towards them from the left and bottom).
 */
function pack(
  items: NestItem[],
  initial: Rect[],
  gap: number,
  heuristic: Heuristic,
  /** Fit mode: give up once the board (parts + `margin`) exceeds this area. */
  abort?: { area: number; margin: number }
): Packed | undefined {
  // splitFree returns a new array and never changes these shared rectangles.
  let free = initial;
  const placements: Placement[] = [];
  const unplaced: string[] = [];
  let maxX = 0,
    maxY = 0,
    area = 0;
  for (const item of items) {
    let best: Rect | undefined;
    let bestRotated = false,
      bestWidth = 0,
      bestHeight = 0,
      bestScore1 = Infinity,
      bestScore2 = Infinity;
    const orientations = item.canRotate && item.w !== item.h ? 2 : 1;
    for (let orientation = 0; orientation < orientations; orientation++) {
      const rotated = orientation === 1;
      const gw = (rotated ? item.h : item.w) + gap,
        gh = (rotated ? item.w : item.h) + gap;
      for (const f of free) {
        if (gw > f.w + EPS || gh > f.h + EPS) continue;
        const lw = f.w - gw,
          lh = f.h - gh;
        // Lower scores win; full ties go to the lower, then the more left position.
        let s1: number, s2: number;
        if (heuristic === 'bssf') {
          s1 = Math.min(lw, lh);
          s2 = Math.max(lw, lh);
        } else if (heuristic === 'baf') {
          s1 = f.w * f.h - gw * gh;
          s2 = Math.min(lw, lh);
        } else {
          s1 = f.y + gh;
          s2 = f.x;
        }
        const better =
          !best ||
          s1 < bestScore1 - EPS ||
          (s1 < bestScore1 + EPS &&
            (s2 < bestScore2 - EPS || (s2 < bestScore2 + EPS && (f.y < best.y - EPS || (f.y < best.y + EPS && f.x < best.x - EPS)))));
        if (better) {
          best = f;
          bestRotated = rotated;
          bestWidth = gw;
          bestHeight = gh;
          bestScore1 = s1;
          bestScore2 = s2;
        }
      }
    }
    if (!best) {
      unplaced.push(item.id);
      continue;
    }
    const used = { x: best.x, y: best.y, w: bestWidth, h: bestHeight };
    free = splitFree(free, used);
    placements.push({ id: item.id, x: used.x, y: used.y, rotated: bestRotated });
    maxX = Math.max(maxX, used.x + used.w - gap);
    maxY = Math.max(maxY, used.y + used.h - gap);
    area += item.w * item.h;
    if (abort && (maxX + abort.margin) * (maxY + abort.margin) > abort.area * (1 + 1e-9)) return undefined;
  }
  return { placements, unplaced, maxX, maxY, area };
}

const ORDERS: ((a: NestItem, b: NestItem) => number)[] = [
  (a, b) => b.w * b.h - a.w * a.h,
  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  (a, b) => b.h - a.h || b.w - a.w,
  (a, b) => b.w - a.w || b.h - a.h,
];
const HEURISTICS: Heuristic[] = ['bl', 'bssf', 'baf'];

/** Every run that is tried: sort order x placement rule. Sorts are stable, so ties keep the input order. */
const runs = (orders: NestItem[][], postpone = 0) =>
  orders.flatMap(order => {
    const sorted = postpone ? [...order.slice(postpone), ...order.slice(0, postpone)] : order;
    return HEURISTICS.map(h => ({ sorted, h }));
  });

/**
 * Strip widths at which a packing can change: sums of part widths plus gaps, between `minW` and `maxW`, thinned
 * evenly to at most `limit` (+ `minW` itself).
 */
function candidateWidths(items: NestItem[], gap: number, minW: number, maxW: number, limit: number): number[] {
  let sums = new Set<number>([0]);
  for (const it of items) {
    const next = new Set(sums);
    for (const s of sums)
      for (const d of it.canRotate ? [it.w, it.h] : [it.w]) {
        const v = +(s + d + gap).toFixed(3);
        if (v <= maxW + gap + 1e-3) next.add(v);
      }
    sums = next;
    if (sums.size > 8 * limit) {
      const all = [...sums].sort((a, b) => a - b);
      const k = Math.ceil(all.length / (4 * limit));
      sums = new Set(all.filter((_, i) => i % k === 0 || i === all.length - 1));
    }
  }
  const ws = [...sums]
    .map(s => s - gap)
    .filter(w => w > minW + 1e-3 && w <= maxW + 1e-3)
    .sort((a, b) => a - b);
  if (ws.length <= limit) return [minW, ...ws];
  const step = (ws.length - 1) / (limit - 1);
  return [minW, ...new Set(Array.from({ length: limit }, (_, i) => ws[Math.round(i * step)]))];
}

const elongation = (b: { w: number; h: number }) => Math.max(b.w, b.h) / Math.min(b.w, b.h);

/**
 * Rectangle nesting with MaxRects: every combination of a few sort orders (area, longest side, height, width) and
 * placement rules (bottom-left, best short side fit, best area fit) is packed and the best result wins. Parts keep
 * `gap` between each other and to keep-outs, and `margin` from the board edge; `canRotate` parts are tried both ways.
 *
 * Fixed board: places as much part area as fits, the rest is `unplaced`. Fitted board (no `board`): packs into strips
 * of candidate widths (widest part .. all parts side by side) with unbounded height and keeps the smallest board
 * (area, then the less elongated one). Keep-outs are board coordinates from the lower left corner, which a fitted
 * board shares; keep-outs that depend on the board size need a second nest on the fixed board once its size is known.
 *
 * Deterministic; about 20 ms for 50 parts fitted, a few ms on a fixed board.
 */
export function nestRects(items: NestItem[], opts: NestOptions): NestResult {
  const { gap, margin } = opts;
  const keepOuts = opts.keepOuts ?? [];
  const orders = ORDERS.map(order => [...items].sort(order));
  const index = new Map(items.map((it, i) => [it.id, i]));
  const byInput = <T>(xs: T[], id: (x: T) => string) => [...xs].sort((a, b) => index.get(id(a))! - index.get(id(b))!);
  const finish = (board: { w: number; h: number }, p: Packed): NestResult => ({
    board,
    placements: byInput(p.placements, pl => pl.id),
    unplaced: byInput(p.unplaced, id => id),
    yield: board.w * board.h > 0 ? p.area / (board.w * board.h) : 0,
  });

  if (opts.board) {
    const bin = { x: margin, y: margin, w: opts.board.w - 2 * margin + gap, h: opts.board.h - 2 * margin + gap };
    const initial = initialFree(bin, gap, keepOuts);
    let best: Packed | undefined;
    // When not everything fits, big parts first can block several smaller ones that would fill the board better:
    // also try with the first 1..6 parts of each order moved to the end.
    for (let postpone = 0; postpone <= (opts.quick ? 0 : Math.min(6, items.length - 1)) && (!postpone || best!.unplaced.length); postpone++)
      for (const { sorted, h } of runs(orders, postpone)) {
        const p = pack(sorted, initial, gap, h)!;
        // Most part area placed, then the most compact layout (leaves the biggest offcut).
        if (!best || p.area > best.area + EPS || (p.area > best.area - EPS && p.maxX * p.maxY < best.maxX * best.maxY - EPS)) best = p;
      }
    return finish(opts.board, best ?? { placements: [], unplaced: [], maxX: 0, maxY: 0, area: 0 });
  }

  if (!items.length) return { board: { w: 2 * margin, h: 2 * margin }, placements: [], unplaced: [], yield: 0 };
  const minSide = (it: NestItem) => (it.canRotate ? Math.min(it.w, it.h) : it.w);
  const minW = Math.max(...items.map(minSide));
  const maxW = Math.max(minW, items.reduce((s, it) => s + minSide(it), 0) + gap * (items.length - 1));
  // Unbounded strip: tall enough for all parts stacked, above any keep-out.
  const height = items.reduce((s, it) => s + Math.max(it.w, it.h) + gap, 0) + Math.max(0, ...keepOuts.map(k => k.y + k.h + gap));
  let best: { board: { w: number; h: number }; p: Packed } | undefined;
  for (const w of candidateWidths(items, gap, minW, maxW, items.length > 20 ? 12 : 40)) {
    const bin = { x: margin, y: margin, w: w + gap, h: height + gap };
    const initial = initialFree(bin, gap, keepOuts);
    for (const { sorted, h } of runs(orders)) {
      const p = pack(sorted, initial, gap, h, best && { area: best.board.w * best.board.h, margin });
      if (!p || p.unplaced.length) continue;
      const board = { w: p.maxX + margin, h: p.maxY + margin };
      const a = board.w * board.h,
        ba = best ? best.board.w * best.board.h : Infinity;
      if (a < ba * (1 - 1e-9) || (a <= ba * (1 + 1e-9) && elongation(board) < elongation(best!.board) - 1e-9)) best = { board, p };
    }
  }
  if (!best) throw new Error('nestRects: no board fits the parts');
  return finish(best.board, best.p);
}
