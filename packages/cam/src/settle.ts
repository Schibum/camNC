/**
 * Parts first, holds second: the parts are nested tight, the user puts clamps and screws where they'd go in the shop,
 * and only the parts in the way move aside. Pure geometry, no Clipper: fast enough to run while a clamp is dragged.
 *
 * Fixtures are checked against the parts' real outlines, so a screw can sit in a curve; parts avoid each other by
 * rectangle, as the nest does. It's an estimate: the job's own check on the G-code (`jobHoldClashes`) has the last word.
 */
import { kZeroClear } from './holdPoints';

type P2 = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export type BoardSide = 'left' | 'right' | 'bottom' | 'top';

/** A clamp grips an edge at `at` along it (x on the bottom and top edge, y on the others); a screw sits anywhere. */
export type Fixture = { kind: 'clamp'; side: BoardSide; at: number } | { kind: 'screw'; x: number; y: number };

export interface SettlePart {
  id: string;
  /** Size as it lies on the board. */
  w: number;
  h: number;
  /** Outlines and holes as it lies on the board, from its lower left corner. */
  outer: [number, number][][];
  holes: [number, number][][];
}

export interface SettleBoard {
  w: number;
  h: number;
  gap: number;
  margin: number;
  parts: SettlePart[];
  /** A clamp's reach in and width along the edge, a screw head's diameter, mm. */
  sizes: { clampReach: number; clampWidth: number; screwD: number };
  /** How far a part's outline stays from the footprint, mm (the bit's cut, its clearance, room for the collet nut). */
  keep: { clamp: number; screw: number };
}

export type Spots = Record<string, P2>;

/** The footprint as a box, and a screw's radius around it. */
export function fixtureBox(f: Fixture, b: Pick<SettleBoard, 'w' | 'h' | 'sizes'>): Rect & { r: number } {
  if (f.kind === 'screw') return { x: f.x, y: f.y, w: 0, h: 0, r: b.sizes.screwD / 2 };
  const { clampReach: d, clampWidth: cw } = b.sizes;
  if (f.side === 'left') return { x: 0, y: f.at - cw / 2, w: d, h: cw, r: 0 };
  if (f.side === 'right') return { x: b.w - d, y: f.at - cw / 2, w: d, h: cw, r: 0 };
  if (f.side === 'bottom') return { x: f.at - cw / 2, y: 0, w: cw, h: d, r: 0 };
  return { x: f.at - cw / 2, y: b.h - d, w: cw, h: d, r: 0 };
}

/** Ramer-Douglas-Peucker on one closed loop: about `eps` mm off it. Outlines of hundreds of points are cheap to check then. */
export function simplifyLoops(loops: [number, number][][], eps = 0.5): [number, number][][] {
  const line = (pts: [number, number][]): [number, number][] => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    let far = 0,
      at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = ptSeg(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]);
      if (d > far) [far, at] = [d, i];
    }
    return far <= eps ? [a, b] : [...line(pts.slice(0, at + 1)).slice(0, -1), ...line(pts.slice(at))];
  };
  return loops.map(loop => {
    if (loop.length < 8) return loop;
    const start = loop[0];
    const far = loop.reduce(
      (best, p, i) =>
        Math.hypot(p[0] - start[0], p[1] - start[1]) > Math.hypot(loop[best][0] - start[0], loop[best][1] - start[1]) ? i : best,
      0
    );
    return [...line(loop.slice(0, far + 1)).slice(0, -1), ...line([...loop.slice(far), start]).slice(0, -1)];
  });
}

const ptRect = (x: number, y: number, b: Rect) => Math.hypot(Math.max(b.x - x, 0, x - b.x - b.w), Math.max(b.y - y, 0, y - b.y - b.h));

function ptSeg(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}

/** Liang-Barsky: any of the segment inside the box. */
function segHitsRect(ax: number, ay: number, bx: number, by: number, b: Rect) {
  let t0 = 0,
    t1 = 1;
  const dx = bx - ax,
    dy = by - ay;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    return t0 <= t1;
  };
  return clip(-dx, ax - b.x) && clip(dx, b.x + b.w - ax) && clip(-dy, ay - b.y) && clip(dy, b.y + b.h - ay);
}

function inLoop(x: number, y: number, loop: [number, number][]) {
  let c = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i],
      b = loop[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Far enough from a part that its outline needn't be looked at, mm. */
const kFar = 60;

/** From a fixture's footprint to a part's outline at `at`, mm; negative when it's on the part. */
export function partDist(box: Rect & { r: number }, part: SettlePart, at: P2): number {
  const gap = Math.hypot(
    Math.max(at.x - box.x - box.w, 0, box.x - at.x - part.w),
    Math.max(at.y - box.y - box.h, 0, box.y - at.y - part.h)
  );
  if (gap > kFar) return gap - box.r;
  const cx = box.x + box.w / 2 - at.x,
    cy = box.y + box.h / 2 - at.y;
  if (part.outer.some(l => inLoop(cx, cy, l))) return -1;
  let best = Infinity;
  const corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ];
  for (const loops of [part.outer, part.holes])
    for (const loop of loops)
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i],
          b = loop[(i + 1) % loop.length];
        const ax = a[0] + at.x,
          ay = a[1] + at.y,
          bx = b[0] + at.x,
          by = b[1] + at.y;
        // Its bounding box is no closer than the best so far: nor is it.
        if (
          Math.hypot(
            Math.max(Math.min(ax, bx) - box.x - box.w, 0, box.x - Math.max(ax, bx)),
            Math.max(Math.min(ay, by) - box.y - box.h, 0, box.y - Math.max(ay, by))
          ) >= best
        )
          continue;
        if (segHitsRect(ax, ay, bx, by, box)) return -1;
        best = Math.min(best, ptRect(ax, ay, box), ptRect(bx, by, box));
        for (const c of corners) best = Math.min(best, ptSeg(c[0], c[1], ax, ay, bx, by));
      }
  return best - box.r;
}

const apart = (a: SettlePart, ap: P2, b: SettlePart, bp: P2, gap: number) =>
  ap.x + a.w + gap <= bp.x + 1e-6 || bp.x + b.w + gap <= ap.x + 1e-6 || ap.y + a.h + gap <= bp.y + 1e-6 || bp.y + b.h + gap <= ap.y + 1e-6;

/** Too narrow to be worth keeping, mm. */
const kOffcutSide = 60;
/** The saw's trim around an offcut, mm: clamps grip outside it. */
const kOffcutTrim = 7;

const inRect = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** The largest rectangle left over, at least 60 mm on its short side: around the parts and any screw. */
export function largestOffcut(b: SettleBoard, spots: Spots, fixtures: Fixture[]): Rect | null {
  const used: Rect[] = b.parts.flatMap(p =>
    spots[p.id] ? [{ x: spots[p.id].x - b.gap / 2, y: spots[p.id].y - b.gap / 2, w: p.w + b.gap, h: p.h + b.gap }] : []
  );
  for (const f of fixtures) if (f.kind === 'screw') used.push({ x: f.x - 8, y: f.y - 8, w: 16, h: 16 });
  let free: Rect[] = [{ x: kOffcutTrim, y: kOffcutTrim, w: b.w - 2 * kOffcutTrim, h: b.h - 2 * kOffcutTrim }];
  for (const u of used) {
    const out: Rect[] = [];
    for (const f of free) {
      if (u.x >= f.x + f.w || f.x >= u.x + u.w || u.y >= f.y + f.h || f.y >= u.y + u.h) {
        out.push(f);
        continue;
      }
      if (u.x > f.x) out.push({ x: f.x, y: f.y, w: u.x - f.x, h: f.h });
      if (u.x + u.w < f.x + f.w) out.push({ x: u.x + u.w, y: f.y, w: f.x + f.w - u.x - u.w, h: f.h });
      if (u.y > f.y) out.push({ x: f.x, y: f.y, w: f.w, h: u.y - f.y });
      if (u.y + u.h < f.y + f.h) out.push({ x: f.x, y: u.y + u.h, w: f.w, h: f.y + f.h - u.y - u.h });
    }
    // Too narrow already, or inside another: neither can be the answer, and they multiply with every part.
    const useful = out.filter(f => Math.min(f.w, f.h) >= kOffcutSide);
    free = useful.filter((f, i) => !useful.some((g, j) => i !== j && inRect(f, g) && (!inRect(g, f) || j < i)));
  }
  let best: Rect | null = null;
  for (const f of free) if (Math.min(f.w, f.h) >= kOffcutSide && (!best || f.w * f.h > best.w * best.h)) best = f;
  return best;
}

/** Kept clear for the probe: no fixture this close to the XY zero. And a fixture stays on the board. */
export function reserved(f: Fixture, b: Pick<SettleBoard, 'w' | 'h' | 'sizes'>) {
  const box = fixtureBox(f, b);
  if (Math.hypot(box.x + box.w / 2, box.y + box.h / 2) < kZeroClear) return true;
  return box.x - box.r < -1e-6 || box.y - box.r < -1e-6 || box.x + box.w + box.r > b.w + 1e-6 || box.y + box.h + box.r > b.h + 1e-6;
}

const keepOf = (b: Pick<SettleBoard, 'keep'>, f: Fixture) => b.keep[f.kind];

/** Is every part at its spot clear of this fixture? */
export function fixtureFree(b: SettleBoard, spots: Spots, f: Fixture) {
  const box = fixtureBox(f, b);
  return b.parts.every(p => !spots[p.id] || partDist(box, p, spots[p.id]) >= keepOf(b, f) - 1e-6);
}

export interface Settled {
  spots: Spots;
  w: number;
  h: number;
}

const kDirs = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
/** How much more clearance than needed a part is moved for, when there's room: a clamp needn't be placed to the mm. */
const kComfort = 10;
/** Of the offcut's area, what may go for more clearance or tidier rows. */
const kOffcutLoss = 0.15;

/**
 * Move only what's in the way of the fixtures, from `base`: a part that's too close slides along an axis, with the parts
 * lined up with it. Of the ways that work, a fixed order decides, with nothing to tune: don't grow the board, keep the
 * offcut (within 15 %), leave more clearance, keep parts lined up, move as few parts as possible, as little as possible.
 * Also makes parts fit a new size, margin or gap. `fit`: the board may grow up and to the right. `reach`: the longest
 * slide tried for a fixture, mm. Null: no way found.
 */
export function settle(b: SettleBoard, base: Spots, fixtures: Fixture[], fit: boolean, budget = 260, reach = 240): Settled | null {
  if (fixtures.some(f => reserved(f, b))) return null;
  const parts = b.parts.filter(p => base[p.id]);
  const byId = new Map(parts.map(p => [p.id, p]));
  type Node = Settled & { n: number; last: string[] };
  type Why =
    | { kind: 'fixture'; f: Fixture; p: SettlePart }
    | { kind: 'parts'; mover: SettlePart; other: SettlePart }
    | { kind: 'edge'; p: SettlePart };

  const violation = (nd: Node): Why | null => {
    for (const p of parts) {
      const at = nd.spots[p.id];
      if (at.x < b.margin - 1e-6 || at.y < b.margin - 1e-6 || at.x + p.w > nd.w - b.margin + 1e-6 || at.y + p.h > nd.h - b.margin + 1e-6)
        return { kind: 'edge', p };
    }
    for (const f of fixtures) {
      const box = fixtureBox(f, { ...b, w: nd.w, h: nd.h });
      for (const p of parts) if (partDist(box, p, nd.spots[p.id]) < keepOf(b, f) - 1e-6) return { kind: 'fixture', f, p };
    }
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        const [x, y] = [parts[i], parts[j]];
        if (!apart(x, nd.spots[x.id], y, nd.spots[y.id], b.gap))
          return nd.last.includes(x.id) ? { kind: 'parts', mover: y, other: x } : { kind: 'parts', mover: x, other: y };
      }
    return null;
  };
  const apply = (nd: Node, ids: string[], dx: number, dy: number): Node | null => {
    const spots = { ...nd.spots };
    let { w, h } = nd;
    for (const id of ids) {
      const p = byId.get(id)!,
        at = { x: spots[id].x + dx, y: spots[id].y + dy };
      if ((dx < 0 && at.x < b.margin - 1e-6) || (dy < 0 && at.y < b.margin - 1e-6)) return null;
      if (at.x + p.w > w - b.margin + 1e-6) {
        if (!fit) return null;
        w = Math.ceil(at.x + p.w + b.margin);
      }
      if (at.y + p.h > h - b.margin + 1e-6) {
        if (!fit) return null;
        h = Math.ceil(at.y + p.h + b.margin);
      }
      spots[id] = at;
    }
    return { spots, w, h, n: nd.n + 1, last: ids };
  };
  /** The parts lined up with p that can slide with it: not off the board, nor into a part that stays. */
  const stack = (nd: Node, p: SettlePart, dx: number, dy: number) => {
    const edge = dx ? 'x' : 'y';
    const at = nd.spots[p.id];
    const mates = parts.filter(q => Math.abs(nd.spots[q.id][edge] - at[edge]) < 1);
    const moved = mates
      .filter(q => {
        const n = { x: nd.spots[q.id].x + dx, y: nd.spots[q.id].y + dy };
        return (
          n.x >= b.margin &&
          n.y >= b.margin &&
          n.x + q.w <= nd.w - b.margin &&
          n.y + q.h <= nd.h - b.margin &&
          parts.every(o => mates.includes(o) || apart(q, n, o, nd.spots[o.id], b.gap))
        );
      })
      .map(q => q.id);
    return moved.includes(p.id) ? moved : [p.id];
  };
  const clearAfter = (nd: Node, p: SettlePart, f: Fixture, dir: readonly [number, number], need: number) => {
    const box = fixtureBox(f, { ...b, w: nd.w, h: nd.h }),
      at = nd.spots[p.id];
    for (let d = 2.5; d <= reach; d += 2.5) if (partDist(box, p, { x: at.x + dir[0] * d, y: at.y + dir[1] * d }) >= need) return d;
    return null;
  };
  const expand = (nd: Node, why: Why): Node[] => {
    const out: (Node | null)[] = [];
    if (why.kind === 'fixture') {
      const keep = keepOf(b, why.f);
      for (const dir of kDirs)
        for (const comfort of [kComfort, 0]) {
          const d = clearAfter(nd, why.p, why.f, dir, keep + comfort);
          if (d === null) continue;
          const [dx, dy] = [dir[0] * d, dir[1] * d];
          out.push(apply(nd, stack(nd, why.p, dx, dy), dx, dy), apply(nd, [why.p.id], dx, dy));
        }
      if (fit && why.f.kind === 'clamp' && (why.f.side === 'right' || why.f.side === 'top')) {
        const miss = Math.ceil(keep + 2 - partDist(fixtureBox(why.f, { ...b, w: nd.w, h: nd.h }), why.p, nd.spots[why.p.id]));
        const right = why.f.side === 'right';
        out.push({ spots: nd.spots, w: nd.w + (right ? miss : 0), h: nd.h + (right ? 0 : miss), n: nd.n + 1, last: [] });
      }
    } else if (why.kind === 'parts') {
      const [m, o] = [nd.spots[why.mover.id], nd.spots[why.other.id]];
      const needs: [number, number, number][] = [
        [1, 0, o.x + why.other.w + b.gap - m.x],
        [-1, 0, m.x + why.mover.w + b.gap - o.x],
        [0, 1, o.y + why.other.h + b.gap - m.y],
        [0, -1, m.y + why.mover.h + b.gap - o.y],
      ];
      for (const [dx, dy, d] of needs) if (d > 0) out.push(apply(nd, [why.mover.id], dx * d, dy * d));
    } else {
      const at = nd.spots[why.p.id];
      // A wider margin: everything along that edge at once.
      const along = (e: 'x' | 'y') => parts.filter(p => nd.spots[p.id][e] < b.margin - 1e-6).map(p => p.id);
      if (at.x < b.margin) out.push(apply(nd, along('x'), b.margin - at.x, 0));
      if (at.y < b.margin) out.push(apply(nd, along('y'), 0, b.margin - at.y));
      const [overX, overY] = [at.x + why.p.w + b.margin - nd.w, at.y + why.p.h + b.margin - nd.h];
      if (overX > 0) out.push(fit ? { ...nd, w: Math.ceil(nd.w + overX), n: nd.n + 1, last: [] } : apply(nd, [why.p.id], -overX, 0));
      if (overY > 0) out.push(fit ? { ...nd, h: Math.ceil(nd.h + overY), n: nd.n + 1, last: [] } : apply(nd, [why.p.id], 0, -overY));
    }
    return out.filter(x => x !== null);
  };

  const less = (x: number[], y: number[]) => {
    for (let i = 0; i < x.length; i++) {
      if (x[i] < y[i] - 1e-9) return true;
      if (x[i] > y[i] + 1e-9) return false;
    }
    return false;
  };

  const queue: Node[] = [{ spots: base, w: b.w, h: b.h, n: 0, last: [] }];
  const seen = new Set<string>();
  const done: Node[] = [];
  for (let nodes = 0; queue.length && nodes < budget; nodes++) {
    const nd = queue.shift()!;
    const why = violation(nd);
    if (!why) {
      done.push(nd);
      continue;
    }
    if (nd.n >= 7) continue;
    for (const c of expand(nd, why)) {
      const key = `${c.w}|${c.h}|` + parts.map(p => `${c.spots[p.id].x.toFixed(1)},${c.spots[p.id].y.toFixed(1)}`).join(';');
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(c);
      }
    }
  }
  if (!done.length) return null;
  /** Neighbours whose edges lined up before. */
  const lined = parts.flatMap((p, i) =>
    parts.slice(i + 1).flatMap(q => {
      const [a, c] = [base[p.id], base[q.id]];
      const stacked = Math.abs(a.y + p.h - c.y) <= b.gap + 1 || Math.abs(c.y + q.h - a.y) <= b.gap + 1;
      const row = Math.abs(a.x + p.w - c.x) <= b.gap + 1 || Math.abs(c.x + q.w - a.x) <= b.gap + 1;
      const edges: [string, string, 'x' | 'y', number, number][] = [];
      if (stacked && Math.abs(a.x - c.x) < 1) edges.push([p.id, q.id, 'x', 0, 0]);
      if (stacked && Math.abs(a.x + p.w - c.x - q.w) < 1) edges.push([p.id, q.id, 'x', p.w, q.w]);
      if (row && Math.abs(a.y - c.y) < 1) edges.push([p.id, q.id, 'y', 0, 0]);
      if (row && Math.abs(a.y + p.h - c.y - q.h) < 1) edges.push([p.id, q.id, 'y', p.h, q.h]);
      return edges;
    })
  );
  const crowded = fixtures.filter(f => !fixtureFree(b, base, f));
  const rank = (nd: Node) => {
    // Of the fixtures something had to move for: one that was fine as it was says nothing about the ways to make room.
    let clear = kComfort;
    for (const f of crowded)
      for (const p of parts) clear = Math.min(clear, partDist(fixtureBox(f, { ...b, w: nd.w, h: nd.h }), p, nd.spots[p.id]) - keepOf(b, f));
    let moved = 0,
      dist = 0;
    for (const p of parts) {
      const d = Math.hypot(nd.spots[p.id].x - base[p.id].x, nd.spots[p.id].y - base[p.id].y);
      if (d > 1e-6) moved++;
      dist += d;
    }
    return [
      -Math.floor(Math.max(0, clear) / 5),
      lined.filter(([p, q, e, sp, sq]) => Math.abs(nd.spots[p][e] + sp - nd.spots[q][e] - sq) > 1).length,
      moved,
      dist,
    ];
  };
  const smallest = Math.min(...done.map(nd => Math.round(nd.w * nd.h)));
  const small = done.filter(nd => Math.round(nd.w * nd.h) === smallest);
  const offcut = (nd: Node) => {
    const o = largestOffcut({ ...b, w: nd.w, h: nd.h }, nd.spots, fixtures);
    return o ? o.w * o.h : 0;
  };
  const most = Math.max(...small.map(offcut));
  let best: Node | null = null,
    bestRank: number[] | null = null;
  for (const nd of small) {
    if (offcut(nd) < most * (1 - kOffcutLoss)) continue;
    const r = rank(nd);
    if (!bestRank || less(r, bestRank)) [best, bestRank] = [nd, r];
  }
  return best && { spots: best.spots, w: best.w, h: best.h };
}

/** How much room a spot has: to the nearest cut or the board's edge, mm. */
function roomAt(b: SettleBoard, spots: Spots, x: number, y: number) {
  let d = Math.min(x, y, b.w - x, b.h - y);
  const box = { x, y, w: 0, h: 0, r: 0 };
  for (const p of b.parts) if (spots[p.id]) d = Math.min(d, partDist(box, p, spots[p.id]));
  return d;
}

/** How far off a screw at this spot can be when it's driven in, mm. 0: none, or it's on a part. */
export function screwPlay(b: SettleBoard, spots: Spots, f: Extract<Fixture, { kind: 'screw' }>) {
  return Math.max(0, roomAt(b, spots, f.x, f.y) - b.sizes.screwD / 2 - b.keep.screw);
}

const kSnapReach = 45;

/**
 * A screw being placed lands on the most forgiving spot nearby, the one farthest from any cut, within 45 mm: being a few
 * millimetres off then doesn't matter. In the middle of a curve, not low in it. On a part: where it is.
 */
export function snapScrew(b: SettleBoard, spots: Spots, x: number, y: number): P2 {
  let [bx, by] = [x, y];
  let room = roomAt(b, spots, x, y);
  if (room <= 0) return { x, y };
  const steps = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7],
  ];
  for (let step = 0; step < 18 && room < 40; step++) {
    let moved = false;
    for (const [dx, dy] of steps) {
      const [nx, ny] = [bx + dx * 2.5, by + dy * 2.5];
      const d = roomAt(b, spots, nx, ny);
      if (Math.hypot(nx - x, ny - y) <= kSnapReach && d > room + 1e-3) [bx, by, room, moved] = [nx, ny, d, true];
    }
    if (!moved) break;
  }
  return { x: +bx.toFixed(1), y: +by.toFixed(1) };
}

/** How far a clamp can slide along its edge and stay clear, each way, up to 60 mm. */
export function clampPlay(b: SettleBoard, spots: Spots, f: Extract<Fixture, { kind: 'clamp' }>) {
  const len = f.side === 'left' || f.side === 'right' ? b.h : b.w;
  const cw = b.sizes.clampWidth;
  const ok = (at: number) => {
    if (at < cw / 2 || at > len - cw / 2) return false;
    const g = { ...f, at };
    return !reserved(g, b) && fixtureFree(b, spots, g);
  };
  let [lo, hi] = [f.at, f.at];
  while (hi - f.at < 60 && ok(hi + 1)) hi++;
  while (f.at - lo < 60 && ok(lo - 1)) lo--;
  return { lo, hi };
}

/** A clamp at this spot along an edge: it fits as it is, parts have to move aside, or there's no room on this size. */
export type EdgeFit = 'free' | 'moves' | 'none';

/** Where clamps fit along the board's edges, every `step` mm: to show while placing one. `mayGrow`: a fitted board. */
export function edgeBands(b: SettleBoard, spots: Spots, fixtures: Fixture[], mayGrow = false, step = 20) {
  const out: { side: BoardSide; at: number; step: number; fit: EdgeFit }[] = [];
  const cw = b.sizes.clampWidth;
  for (const side of ['left', 'right', 'bottom', 'top'] as const) {
    const len = side === 'left' || side === 'right' ? b.h : b.w;
    for (let at = cw / 2 + 4; at <= len - cw / 2 - 4; at += step) {
      const f: Fixture = { kind: 'clamp', side, at };
      const fit: EdgeFit = reserved(f, b)
        ? 'none'
        : fixtureFree(b, spots, f)
          ? 'free'
          : settle(b, spots, [...fixtures, f], mayGrow, 40)
            ? 'moves'
            : 'none';
      out.push({ side, at, step, fit });
    }
  }
  return out;
}

const centreOf = (f: Fixture, b: Pick<SettleBoard, 'w' | 'h' | 'sizes'>) => {
  const box = fixtureBox(f, b);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
};

/** Do the points surround `c`, with no gap of half a turn or more? */
export function surrounds(points: P2[], c: P2) {
  if (points.length < 3) return false;
  const s = [...points].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  return s.every((a, i) => {
    const b = s[(i + 1) % s.length];
    return (a.x - c.x) * (b.y - c.y) - (a.y - c.y) * (b.x - c.x) > 0;
  });
}

/** Where the cutting is: the box around the placed parts, or the whole board without any. */
export function workBox(b: { w: number; h: number; parts: Pick<SettlePart, 'id' | 'w' | 'h'>[] }, spots: Spots): Rect {
  const placed = b.parts.filter(p => spots[p.id]);
  if (!placed.length) return { x: 0, y: 0, w: b.w, h: b.h };
  const x = Math.min(...placed.map(p => spots[p.id].x)),
    y = Math.min(...placed.map(p => spots[p.id].y));
  return { x, y, w: Math.max(...placed.map(p => spots[p.id].x + p.w)) - x, h: Math.max(...placed.map(p => spots[p.id].y + p.h)) - y };
}

const middleOf = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Do these fixtures stand around the middle of the work? */
export const fixturesAround = (b: Pick<SettleBoard, 'w' | 'h' | 'sizes'>, work: Rect, fixtures: Fixture[]) =>
  surrounds(
    fixtures.map(f => centreOf(f, b)),
    middleOf(work)
  );

/** Too fiddly to suggest: less slide along the edge than this, mm. */
const kSuggestPlay = 12;
/** A suggestion may nudge parts aside, not rearrange the layout: at most this far, mm. */
const kSuggestMove = 40;
/** Clamps closer together than this add little, mm. */
const kSuggestApart = 100;
/** An offcut narrower than this isn't worth holding parts back for, mm. */
const kKeptOffcut = 100;

type Clamp = Extract<Fixture, { kind: 'clamp' }>;
type Suggested = { spots: Spots; fixtures: Fixture[] };

const edgeLen = (b: Pick<SettleBoard, 'w' | 'h'>, side: BoardSide) => (side === 'left' || side === 'right' ? b.h : b.w);
const kOpposite: Record<BoardSide, BoardSide> = { left: 'right', right: 'left', bottom: 'top', top: 'bottom' };
const isClamp = (f: Fixture): f is Clamp => f.kind === 'clamp';
const meanAt = (clamps: Clamp[]) => clamps.reduce((m, f) => m + f.at, 0) / clamps.length;
const kSides = ['left', 'right', 'bottom', 'top'] as const;

const movedFar = (b: SettleBoard, from: Spots, to: Spots) =>
  b.parts.some(q => from[q.id] && Math.hypot(to[q.id].x - from[q.id].x, to[q.id].y - from[q.id].y) > kSuggestMove);

const offcutArea = (b: SettleBoard, spots: Spots, fixtures: Fixture[]) => {
  const o = largestOffcut(b, spots, fixtures);
  return o ? o.w * o.h : 0;
};
/** The offcut a suggestion has to leave: within 15 % of what's there. A strip too thin to use later isn't worth keeping parts tight for. */
const offcutFloor = (b: SettleBoard, spots: Spots, fixtures: Fixture[]) => {
  const o = largestOffcut(b, spots, fixtures);
  return o && Math.min(o.w, o.h) >= kKeptOffcut ? o.w * o.h * (1 - kOffcutLoss) : 0;
};

/** May parts move at all? `settle` keeps parts apart by rectangle, so one with interlocked or crowded parts would pull them apart. */
const canSlide = (b: SettleBoard, spots: Spots) => {
  const placed = b.parts.filter(p => spots[p.id]);
  return placed.every(
    (p, i) =>
      spots[p.id].x >= b.margin - 1e-6 &&
      spots[p.id].y >= b.margin - 1e-6 &&
      spots[p.id].x + p.w <= b.w - b.margin + 1e-6 &&
      spots[p.id].y + p.h <= b.h - b.margin + 1e-6 &&
      placed.slice(i + 1).every(q => apart(p, spots[p.id], q, spots[q.id], b.gap))
  );
};

/** A part list that doesn't depend on the order it came in, nor on parts without a spot. */
const ordered = (b: SettleBoard, spots: Spots): SettleBoard => ({
  ...b,
  parts: b.parts.filter(p => spots[p.id]).sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0)),
});

/** How many holds the work gets by default: 3 for something small, 4 up to half a square metre, then one per half. */
export const defaultHolds = (work: Pick<Rect, 'w' | 'h'>) => {
  const area = work.w * work.h;
  return area < 40_000 ? 3 : Math.max(4, Math.ceil(area / 500_000));
};

/** Whole clamp patterns: an edge and where along the work's extent, 0 to 1. A lone clamp comes last, to sit between the others. */
type Pattern = readonly (readonly [BoardSide, number])[];
const along = (sides: readonly BoardSide[], ts: number[]): Pattern => sides.flatMap(s => ts.map(t => [s, t] as const));
const kAcross = [
  ['left', 'right'],
  ['bottom', 'top'],
] as const;
const kPatterns: Pattern[] = [
  ...kAcross.map(s => along(s, [0.22, 0.78])),
  ...kAcross.map(s => along(s, [0.15, 0.5, 0.85])),
  along(kSides, [0.5]),
  ...kAcross.flatMap(([a, c]) => [
    [...along([a], [0.25, 0.75]), [c, 0.5] as const],
    [...along([c], [0.25, 0.75]), [a, 0.5] as const],
  ]),
  ...kAcross.flatMap(([a, c]) => {
    const [x, y] = a === 'left' ? (['bottom', 'top'] as const) : (['left', 'right'] as const);
    return [
      [...along([a, c], [0.22, 0.78]), [x, 0.5] as const],
      [...along([a, c], [0.22, 0.78]), [y, 0.5] as const],
    ];
  }),
];

/** Clearance counted up to this, mm: beyond it a clamp isn't any safer. */
const kRoomCap = 40;
/** Samples along an edge, mm. */
const kEdgeStep = 5;
/** Calls to `settle` one search may make: it's the slow part, and a count, unlike a clock, gives the same result every time. */
const kSettleCalls = 32;
/** The same when no pattern fits and clamps go one at a time. */
const kOneByOneCalls = 12;
/**
 * How much of that a board gets, 0 to 1: a layout `settle` looks at costs about the square of the parts on the board and
 * the points of their outlines, so above these calls go down with its square and layouts per call with it. A count again,
 * not a clock.
 */
const settleEffort = (parts: SettlePart[]) => {
  const n = Math.max(1, parts.length);
  const points = parts.reduce((m, p) => m + [...p.outer, ...p.holes].reduce((c, l) => c + l.length, 0), 0) / n;
  return Math.min(1, 40 / n) * Math.min(1, 100 / Math.max(1, points));
};

/** How far along an edge a slot's clamp may be from its target, of the edge's length. */
const kSlotReach = 0.15;

/** A complete pattern's score, higher is better. `room`: its new clamps' least distance to a cut, mm. */
function patternScore(b: SettleBoard, from: Spots, spots: Spots, fixtures: Fixture[], room: number) {
  const diag = Math.hypot(b.w, b.h);
  const pts = fixtures.map(f => centreOf(f, b));
  const work = workBox(b, spots);
  // The farthest part from a clamp: a clamp holds what's near it.
  let far = 0,
    moved = 0;
  for (const p of b.parts) {
    const at = spots[p.id];
    far = Math.max(far, Math.min(...pts.map(q => Math.hypot(q.x - at.x - p.w / 2, q.y - at.y - p.h / 2))));
    moved = Math.max(moved, Math.hypot(at.x - from[p.id].x, at.y - from[p.id].y));
  }
  // Clamps hold cutting forces, not empty stock.
  const away = pts.reduce((s, q) => s + ptRect(q.x, q.y, work), 0) / pts.length;
  // Opposition: how much of the work the clamps span, and clamps level across it, as a person would set them.
  const span = (e: 'x' | 'y', len: number) => {
    const v = pts.map(q => q[e]);
    return Math.min(1, (Math.max(...v) - Math.min(...v)) / Math.max(1, len));
  };
  const clamps = fixtures.filter(isClamp);
  const level = kAcross.flatMap(([s, o]) => {
    const [mine, theirs] = [clamps.filter(f => f.side === s), clamps.filter(f => f.side === o)];
    if (!mine.length || !theirs.length) return [];
    const off = (d: number) => Math.max(0, 1 - d / (0.25 * edgeLen(b, s)));
    return mine.length === theirs.length
      ? mine.map(f => off(Math.min(...theirs.map(g => Math.abs(g.at - f.at)))))
      : [off(Math.abs(meanAt(mine) - meanAt(theirs)))];
  });
  return (
    (0.25 * level.reduce((s, x) => s + x, 0)) / Math.max(1, level.length) +
    0.4 * Math.sqrt(span('x', work.w) * span('y', work.h)) -
    (1.2 * far) / diag -
    (2 * away) / diag +
    (0.4 * Math.min(room, kRoomCap)) / kRoomCap -
    (1.5 * moved) / diag
  );
}

/** Along long work, more than 60 % of its length with no clamp beside it. */
function hasLongGap(b: SettleBoard, work: Rect, fixtures: Fixture[]) {
  if (Math.max(work.w / work.h, work.h / work.w) < 2) return false;
  const [e, lo, len] = work.w >= work.h ? (['x', work.x, work.w] as const) : (['y', work.y, work.h] as const);
  const at = fixtures.map(f => Math.max(lo, Math.min(lo + len, centreOf(f, b)[e])));
  const v = [lo, ...at, lo + len].sort((m, n) => m - n);
  return v.slice(1).some((x, i) => x - v[i] > 0.6 * len);
}

/**
 * The clearance at every spot along the edges, for any layout: one distance per spot, kept per part and position, so a
 * layout that moved one part only looks at that part again. Spots are `at = clampWidth / 2 + i * kEdgeStep`.
 */
function edgeTable(b: SettleBoard) {
  const cw = b.sizes.clampWidth;
  const atOf = (i: number) => cw / 2 + i * kEdgeStep;
  const indexOf = (at: number) => Math.round((at - cw / 2) / kEdgeStep);
  const count = (side: BoardSide) => Math.max(0, Math.floor((edgeLen(b, side) - cw) / kEdgeStep) + 1);
  const ofPart = new Map<string, Float64Array>();
  const partRoom = (p: SettlePart, at: P2, side: BoardSide) => {
    const key = `${p.id}|${at.x}|${at.y}|${side}`;
    let r = ofPart.get(key);
    if (!r) {
      r = new Float64Array(count(side));
      for (let i = 0; i < r.length; i++) r[i] = partDist(fixtureBox({ kind: 'clamp', side, at: atOf(i) }, b), p, at);
      ofPart.set(key, r);
    }
    return r;
  };
  type Edge = {
    /** To the nearest cut, mm; -1 where a clamp may not go. */
    room: Float64Array;
    /** The stretch of clear spots this one is in, as positions along the edge. */
    lo: Float64Array;
    hi: Float64Array;
  };
  const toEdge = (p: SettlePart, at: P2, side: BoardSide) =>
    side === 'left' ? at.x : side === 'bottom' ? at.y : side === 'right' ? b.w - at.x - p.w : b.h - at.y - p.h;
  const ofLayout = new Map<Spots, Record<BoardSide, Edge>>();
  const edge = (spots: Spots, side: BoardSide): Edge => {
    const n = count(side);
    const room = new Float64Array(n).fill(Infinity);
    for (const p of b.parts) {
      // Too far in for any clamp on this edge to care, even at the most clearance that counts.
      if (toEdge(p, spots[p.id], side) > b.sizes.clampReach + Math.max(kRoomCap, b.keep.clamp)) continue;
      const r = partRoom(p, spots[p.id], side);
      for (let i = 0; i < n; i++) room[i] = Math.min(room[i], r[i]);
    }
    for (let i = 0; i < n; i++) if (reserved({ kind: 'clamp', side, at: atOf(i) }, b)) room[i] = -1;
    const [lo, hi] = [new Float64Array(n), new Float64Array(n)];
    const clear = (i: number) => room[i] >= b.keep.clamp - 1e-6;
    for (let i = 0; i < n; i++) {
      let j = i;
      while (clear(i) && j + 1 < n && clear(j + 1)) j++;
      lo.fill(atOf(i), i, j + 1);
      hi.fill(atOf(j), i, j + 1);
      i = j;
    }
    return { room, lo, hi };
  };
  const rooms = (spots: Spots) => {
    let r = ofLayout.get(spots);
    if (!r) {
      r = { left: edge(spots, 'left'), right: edge(spots, 'right'), bottom: edge(spots, 'bottom'), top: edge(spots, 'top') };
      ofLayout.set(spots, r);
    }
    return r;
  };
  return { atOf, indexOf, count, rooms };
}

/** Off what's there: a second clamp on an edge has to add coverage, side by side it holds no better than one. */
function spacedOff(b: SettleBoard, work: Rect, fixtures: Fixture[], f: Clamp) {
  const box = fixtureBox(f, b);
  const along = f.side === 'left' || f.side === 'right' ? work.h : work.w;
  return !fixtures.some(g =>
    g.kind === 'clamp'
      ? g.side === f.side && Math.abs(g.at - f.at) < Math.max(b.sizes.clampWidth + 10, 0.25 * along)
      : ptRect(g.x, g.y, box) < b.sizes.screwD / 2
  );
}

/**
 * The most useful clear spot for one more clamp, leaving the others be: one that gets the work surrounded first. `added`:
 * the clamps whose clearance counts, besides it. None: null.
 */
function bestExtra(
  b: SettleBoard,
  table: ReturnType<typeof edgeTable>,
  from: Spots,
  spots: Spots,
  work: Rect,
  fixtures: Fixture[],
  added: Clamp[]
) {
  const rooms = table.rooms(spots);
  const wasAround = fixturesAround(b, work, fixtures);
  let best: Clamp | null = null,
    bestScore = -Infinity;
  for (const side of kSides)
    for (let i = 0; i < table.count(side); i++) {
      const f: Clamp = { kind: 'clamp', side, at: table.atOf(i) };
      const e = rooms[side];
      if (e.room[i] < b.keep.clamp - 1e-6 || e.hi[i] - e.lo[i] < kSuggestPlay || !spacedOff(b, work, fixtures, f)) continue;
      const room = Math.min(kRoomCap, e.room[i], ...added.map(g => rooms[g.side].room[table.indexOf(g.at)]));
      const next = [...fixtures, f];
      const score = patternScore(b, from, spots, next, room) + (!wasAround && fixturesAround(b, work, next) ? 10 : 0);
      if (score > bestScore) [best, bestScore] = [f, score];
    }
  return best;
}

/**
 * Compare complete patterns: each fills its slots with a clear spot near the slot's target, moves parts only for a slot
 * with none, and the highest score wins. `count`: holds in all, as near as what fits allows. `mayMove`: false, and every
 * part stays where it is. Null: no pattern fits.
 */
function searchPatterns(b: SettleBoard, start: Spots, existing: Fixture[], count: number, mayMove = canSlide(b, start)): Suggested | null {
  const cw = b.sizes.clampWidth;
  const table = edgeTable(b);
  const startWork = workBox(b, start);
  const floor = offcutFloor(b, start, existing);
  const workLo = (side: BoardSide) => (side === 'left' || side === 'right' ? startWork.y : startWork.x);
  const workLen = (side: BoardSide) => (side === 'left' || side === 'right' ? startWork.h : startWork.w);
  const slotAt = (side: BoardSide, t: number) => workLo(side) + t * workLen(side);
  const added = (fixtures: Fixture[]) => fixtures.filter(isClamp).filter(f => !existing.includes(f));
  const clearOn = (spots: Spots, side: BoardSide, i: number) => {
    const e = table.rooms(spots)[side];
    return e.room[i] >= b.keep.clamp - 1e-6 && e.hi[i] - e.lo[i] >= kSuggestPlay;
  };
  const leastRoom = (spots: Spots, clamps: Clamp[]) =>
    Math.min(kRoomCap, ...clamps.map(f => table.rooms(spots)[f.side].room[table.indexOf(f.at)]));
  const spaced = (fixtures: Fixture[], f: Clamp) => spacedOff(b, startWork, fixtures, f);

  // Patterns share their first slots.
  const effort = settleEffort(b.parts);
  let calls = Math.ceil(kSettleCalls * effort ** 2);
  const settled = new Map<string, Spots | null>();
  const layoutIds = new Map<Spots, number>();
  const moveFor = (spots: Spots, fixtures: Fixture[], budget: number) => {
    if (!mayMove) return null;
    if (!layoutIds.has(spots)) layoutIds.set(spots, layoutIds.size);
    const key = `${layoutIds.get(spots)}|${fixtures.map(f => (isClamp(f) ? f.side + f.at : `${f.x},${f.y}`)).join()}`;
    if (settled.has(key)) return settled.get(key)!;
    if (calls <= 0) return null;
    calls--;
    const r = settle(b, spots, fixtures, false, Math.max(8, Math.floor(budget * effort)), kSuggestMove);
    const out = r && !movedFar(b, start, r.spots) && offcutArea(b, r.spots, existing) >= floor ? r.spots : null;
    settled.set(key, out);
    return out;
  };

  /** Near the target, the best clear spot: a little off it is worth some room to spare, up to what's comfortable. */
  const clearSpot = (spots: Spots, fixtures: Fixture[], side: BoardSide, target: number) => {
    const { room } = table.rooms(spots)[side];
    let best: Clamp | null = null,
      bestScore = -Infinity;
    for (let i = 0; i < room.length; i++) {
      const f: Clamp = { kind: 'clamp', side, at: table.atOf(i) };
      const off = Math.abs(f.at - target);
      if (off > kSlotReach * edgeLen(b, side) || !clearOn(spots, side, i) || !spaced(fixtures, f)) continue;
      const score = Math.min(room[i] - b.keep.clamp, kComfort) - 0.25 * off;
      if (score > bestScore) [best, bestScore] = [f, score];
    }
    return best;
  };
  /** No clear spot near the target: try a few along the edge, and keep the one that scores best once parts have moved. */
  const movedSpot = (spots: Spots, fixtures: Fixture[], side: BoardSide, target: number) => {
    let best: { f: Clamp; spots: Spots; score: number } | null = null;
    for (const d of [0, 0.1, -0.1, 0.2, -0.2]) {
      const i = Math.max(0, Math.min(table.count(side) - 1, table.indexOf(target + d * edgeLen(b, side))));
      const f: Clamp = { kind: 'clamp', side, at: table.atOf(i) };
      if (reserved(f, b) || !spaced(fixtures, f)) continue;
      const moved = moveFor(spots, [...fixtures, f], 40);
      if (!moved) continue;
      const score = patternScore(b, start, moved, [...fixtures, f], leastRoom(moved, [f]));
      if (!best || score > best.score) best = { f, spots: moved, score };
    }
    return best;
  };
  /** Holds that are there take the slots nearest them. What's left to place. */
  const openSlots = (pattern: Pattern) => {
    const open = [...pattern];
    for (const f of existing) {
      const off = ([side, t]: Pattern[number]) => {
        if (f.kind === 'clamp') return f.side === side ? Math.abs(f.at - slotAt(side, t)) : Infinity;
        const c = centreOf({ kind: 'clamp', side, at: slotAt(side, t) }, b);
        return Math.hypot(f.x - c.x, f.y - c.y);
      };
      const i = open.reduce((m, s, j) => (off(s) < off(open[m]) ? j : m), 0);
      if (open.length && off(open[i]) < Infinity) open.splice(i, 1);
    }
    return open;
  };
  /** Level with the opposite edge when that has as many, a lone clamp midway between the two opposite it. */
  const targetOf = (open: Pattern, fixtures: Fixture[], side: BoardSide, t: number) => {
    const plain = slotAt(side, t);
    const clamps = fixtures.filter(isClamp);
    const opposite = clamps.filter(f => f.side === kOpposite[side]);
    const here = open.filter(s => s[0] === side).length + existing.filter(isClamp).filter(f => f.side === side).length;
    if (here === 1 && opposite.length > 1) return meanAt(opposite);
    if (here !== opposite.length || !here) return plain;
    return opposite.reduce((m, f) => (Math.abs(f.at - plain) < Math.abs(m - plain) ? f.at : m), opposite[0].at);
  };
  const tryPattern = (open: Pattern) => {
    let spots = start;
    const placed = [...existing];
    for (const [side, t] of open) {
      const target = targetOf(open, placed, side, t);
      const clear = clearSpot(spots, placed, side, target);
      const moved = clear ? null : movedSpot(spots, placed, side, target);
      if (moved) spots = moved.spots;
      const f = clear ?? moved?.f;
      if (!f) return null;
      placed.push(f);
    }
    // More than the pattern has.
    while (placed.length < count) {
      const extra = bestExtra(b, table, start, spots, startWork, placed, added(placed));
      if (!extra) break;
      placed.push(extra);
    }
    // A clamp may have left the spot that made a part move: moves come from where the clamps ended up.
    if (spots !== start) {
      const redo = moveFor(start, placed, 60);
      const total = (s: Spots) => b.parts.reduce((m, q) => m + Math.hypot(s[q.id].x - start[q.id].x, s[q.id].y - start[q.id].y), 0);
      if (redo && total(redo) < total(spots)) spots = redo;
    }
    // Room to be a little off: 10 mm either way, where there is any.
    const fixtures = placed.map(f => {
      if (!isClamp(f) || existing.includes(f)) return f;
      const e = table.rooms(spots)[f.side];
      const i = table.indexOf(f.at);
      const mid = table.atOf(table.indexOf((e.lo[i] + e.hi[i]) / 2));
      return { ...f, at: e.hi[i] - e.lo[i] < 20 ? mid : Math.max(e.lo[i] + 10, Math.min(e.hi[i] - 10, f.at)) };
    });
    const work = workBox(b, spots);
    if (
      added(fixtures).some(
        f =>
          !spaced(
            fixtures.filter(g => g !== f),
            f
          )
      )
    )
      return null;
    if (!fixturesAround(b, work, fixtures) || hasLongGap(b, work, fixtures)) return null;
    return { spots, fixtures, score: patternScore(b, start, spots, fixtures, leastRoom(spots, added(fixtures))) };
  };

  // The biggest pattern that fits the count, then smaller ones, which extras fill up. Only with none of those, a bigger one.
  const options = kPatterns.map(openSlots);
  const totals = [...new Set(options.map(open => existing.length + open.length))];
  const order = [...totals.filter(n => n <= count).sort((m, n) => n - m), ...totals.filter(n => n > count).sort((m, n) => m - n)];
  for (const total of order) {
    let best: ReturnType<typeof tryPattern> = null;
    for (const open of options) {
      if (existing.length + open.length !== total) continue;
      const r = tryPattern(open);
      if (r && (!best || r.score > best.score)) best = r;
    }
    if (best) return { spots: best.spots, fixtures: best.fixtures };
  }
  return null;
}

/**
 * One clamp at a time when no pattern fits, each as far as possible from the holds so far, a spot where nothing moves
 * counting for more than one where parts have to move aside. Up to `want` holds, surrounding the work or not.
 */
function holdsOneByOne(b: SettleBoard, start: Spots, existing: Fixture[], want: number): Suggested {
  const table = edgeTable(b);
  const slide = canSlide(b, start);
  const centre = middleOf(workBox(b, start));
  const floor = offcutFloor(b, start, existing);
  const effort = settleEffort(b.parts);
  let calls = Math.ceil(kOneByOneCalls * effort ** 2);
  let spots = start;
  let fixtures = [...existing];
  while (fixtures.length < want) {
    const pts = fixtures.map(f => centreOf(f, b));
    const rooms = table.rooms(spots);
    const options: { f: Clamp; i: number; free: boolean; score: number }[] = [];
    for (const side of kSides)
      for (let i = 0; i < table.count(side); i += 4) {
        const f: Clamp = { kind: 'clamp', side, at: table.atOf(i) };
        if (reserved(f, b)) continue;
        const p = centreOf(f, b);
        const d = pts.length ? Math.min(...pts.map(q => Math.hypot(p.x - q.x, p.y - q.y))) : Math.hypot(p.x - centre.x, p.y - centre.y);
        if (pts.length && d < kSuggestApart) continue;
        const free = rooms[side].room[i] >= b.keep.clamp - 1e-6;
        if (!free && !slide) continue;
        options.push({ f, i, free, score: d * (free ? 1 : 0.7) });
      }
    options.sort((x, y) => y.score - x.score);
    let chosen: Suggested | null = null;
    let tries = 0;
    for (const { f, i, free } of options) {
      if (!free && (++tries > 6 || calls <= 0)) continue;
      if (!free) calls--;
      const r = free ? spots : settle(b, spots, [...fixtures, f], false, Math.max(8, Math.floor(40 * effort)), kSuggestMove)?.spots;
      if (!r || movedFar(b, spots, r)) continue;
      const e = table.rooms(r)[f.side];
      // As far as a clamp can slide from here, up to 60 mm each way.
      const [lo, hi] = [Math.max(e.lo[i], f.at - 60), Math.min(e.hi[i], f.at + 60)];
      if (hi - lo < kSuggestPlay) continue;
      if (!free && offcutArea(b, r, fixtures) < floor) continue;
      chosen = { spots: r, fixtures: [...fixtures, { ...f, at: table.atOf(table.indexOf((lo + hi) / 2)) }] };
      break;
    }
    if (!chosen) break;
    ({ spots, fixtures } = chosen);
  }
  return { spots, fixtures };
}

/**
 * Suggest clamps, on request, on top of what's there: those stay put and count, and no part moves onto them. Complete
 * patterns are compared, aimed at the work rather than the board; when none fits, clamps one at a time, no more than the
 * work calls for even if they don't surround it. The board never grows, the offcut stays within 15 %. The result is
 * ordinary fixtures to drag or remove. A part filling its whole board gets none: no edge has room. Suggesting again on
 * the result changes nothing. `count`: holds in all, in place of what the size of the work calls for; what fits if that
 * many don't, and no falling back on one at a time.
 */
export function suggestHolds(input: SettleBoard, start: Spots, existing: Fixture[], count?: number): Suggested {
  const b = ordered(input, start);
  const want = count ?? defaultHolds(workBox(b, start));
  let r: Suggested = { spots: start, fixtures: existing };
  // What clamps one at a time leave can fit a pattern that wouldn't fit before: go on until nothing changes.
  for (let round = 0; round < 3; round++) {
    if (r.fixtures.length >= want && fixturesAround(b, workBox(b, r.spots), r.fixtures)) break;
    const next = searchPatterns(b, r.spots, r.fixtures, want) ?? (count === undefined ? holdsOneByOne(b, r.spots, r.fixtures, want) : r);
    if (next.fixtures.length === r.fixtures.length || movedFar(b, start, next.spots)) break;
    r = next;
  }
  return r;
}

/** Exactly one clamp more, where it helps most, with every hold and part left where it is. No room: the fixtures as they are. */
export function moreHolds(input: SettleBoard, spots: Spots, fixtures: Fixture[]): Fixture[] {
  const b = ordered(input, spots);
  const f = bestExtra(b, edgeTable(b), spots, spots, workBox(b, spots), fixtures, []);
  return f ? [...fixtures, f] : fixtures;
}

/** Around the point with room to spare: no gap of more than 175°. Three clamps can surround a point by a hair and hold nothing. */
function wellAround(points: P2[], c: P2) {
  const turns = points.map(q => Math.atan2(q.y - c.y, q.x - c.x)).sort((m, n) => m - n);
  return turns.every((t, i) => (i + 1 < turns.length ? turns[i + 1] : turns[0] + 2 * Math.PI) - t <= (175 * Math.PI) / 180);
}

/**
 * Exactly one clamp less, the one the rest do best without, down to 3 holds; every other hold and part stays. Holds that
 * surround the work keep doing so, by more than a hair, or nothing goes: the fixtures as they are. So do screws.
 */
export function fewerHolds(input: SettleBoard, spots: Spots, fixtures: Fixture[]): Fixture[] {
  if (fixtures.length <= 3) return fixtures;
  const b = ordered(input, spots);
  const work = workBox(b, spots);
  const pointsOf = (l: Fixture[]) => l.map(f => centreOf(f, b));
  const wasAround = surrounds(pointsOf(fixtures), middleOf(work));
  let best = fixtures,
    bestScore = -Infinity;
  for (const f of fixtures.filter(isClamp)) {
    const rest = fixtures.filter(g => g !== f);
    if (wasAround && !(surrounds(pointsOf(rest), middleOf(work)) && wellAround(pointsOf(rest), middleOf(work)))) continue;
    const room = b.parts.flatMap(p => rest.filter(isClamp).map(g => partDist(fixtureBox(g, b), p, spots[p.id])));
    const score = patternScore(b, spots, spots, rest, Math.min(kRoomCap, ...room));
    if (score > bestScore) [best, bestScore] = [rest, score];
  }
  return best;
}

/** Does a board of this size fit on the machine, either way round? */
export const fitsMachine = (machine: { w: number; h: number }, w: number, h: number) =>
  (w <= machine.w + 1e-6 && h <= machine.h + 1e-6) || (h <= machine.w + 1e-6 && w <= machine.h + 1e-6);

/** Room to slide a clamp around, on top of what it needs, tried in turn when growing a board: mm. */
const kGrowComfort = [5, 10, 15];
/** A border isn't worth more board than this, times the area it had. */
const kGrowArea = 1.3;

/**
 * `suggestHolds` for a board cut to its parts. When that doesn't surround the work's middle, the smallest border all round that
 * does, within 30 % more board and the machine. The XY zero stays the lower left corner, so parts and screws shift up and
 * to the right by the border, clamps along their edge: all stay where they were relative to the work. No border helps:
 * what `suggestHolds` found at this size, `grew` 0.
 */
export function suggestHoldsGrowing(
  b: SettleBoard,
  start: Spots,
  existing: Fixture[],
  machine?: { w: number; h: number }
): { spots: Spots; fixtures: Fixture[]; w: number; h: number; grew: number } {
  const here = { ...suggestHolds(b, start, existing), w: b.w, h: b.h, grew: 0 };
  const placed = b.parts.filter(p => start[p.id]);
  if (!placed.length || fixturesAround(b, workBox(b, here.spots), here.fixtures)) return here;
  const least = Math.min(...placed.flatMap(p => [start[p.id].x, start[p.id].y, b.w - start[p.id].x - p.w, b.h - start[p.id].y - p.h]));
  for (const comfort of kGrowComfort) {
    const grew = Math.ceil(b.sizes.clampReach + b.keep.clamp + comfort - least - 1e-6);
    if (grew <= 0) continue;
    const [w, h] = [b.w + 2 * grew, b.h + 2 * grew];
    if (w * h > b.w * b.h * kGrowArea || (machine && !fitsMachine(machine, w, h))) break;
    const bigger = { ...b, w, h };
    const spots = Object.fromEntries(Object.entries(start).map(([id, at]) => [id, { x: at.x + grew, y: at.y + grew }]));
    const shifted = existing.map((f): Fixture => (f.kind === 'screw' ? { ...f, x: f.x + grew, y: f.y + grew } : { ...f, at: f.at + grew }));
    const r = suggestHolds(bigger, spots, shifted);
    // A border that only re-centres the holds there are adds nothing to hold the board.
    if (r.fixtures.length > existing.length && fixturesAround(bigger, workBox(bigger, r.spots), r.fixtures)) return { ...r, w, h, grew };
  }
  return here;
}
