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
    free = out;
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
 * Also makes parts fit a new size, margin or gap. `fit`: the board may grow up and to the right. Null: no way found.
 */
export function settle(b: SettleBoard, base: Spots, fixtures: Fixture[], fit: boolean, budget = 260): Settled | null {
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
    for (let d = 2.5; d <= 240; d += 2.5) if (partDist(box, p, { x: at.x + dir[0] * d, y: at.y + dir[1] * d }) >= need) return d;
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

/** Do these fixtures hold the whole board, around its middle? */
export const fixturesAround = (b: Pick<SettleBoard, 'w' | 'h' | 'sizes'>, fixtures: Fixture[]) =>
  surrounds(
    fixtures.map(f => centreOf(f, b)),
    { x: b.w / 2, y: b.h / 2 }
  );

/** Too fiddly to suggest: less slide along the edge than this, mm. */
const kSuggestPlay = 12;
/** A suggestion may nudge parts aside, not rearrange the layout: at most this far, mm. */
const kSuggestMove = 40;
/** Clamps closer together than this add little, mm. */
const kSuggestApart = 100;

/**
 * Suggest clamps, on request: one at a time, each as far as possible from the holds so far, a spot where nothing moves
 * counting for more than one where parts have to move aside. The board never grows, the offcut stays within 15 %. Stops
 * once enough holds surround the board's middle (about one per 600 mm of its edge, 3 to 8). The result is ordinary
 * fixtures to drag or remove. A part filling its whole board gets none: no edge has room.
 */
export function suggestHolds(b: SettleBoard, start: Spots, existing: Fixture[]): { spots: Spots; fixtures: Fixture[] } {
  const target = Math.max(3, Math.min(8, Math.ceil((2 * (b.w + b.h)) / 600)));
  const centre = { x: b.w / 2, y: b.h / 2 };
  const area = (spots: Spots, fixtures: Fixture[]) => {
    const o = largestOffcut(b, spots, fixtures);
    return o ? o.w * o.h : 0;
  };
  const floor = area(start, existing) * (1 - kOffcutLoss);
  let spots = start;
  let fixtures = [...existing];
  while (fixtures.length < target + 2) {
    const pts = fixtures.map(f => centreOf(f, b));
    if (pts.length >= target && surrounds(pts, centre)) break;
    const options: { f: Extract<Fixture, { kind: 'clamp' }>; free: boolean; score: number }[] = [];
    for (const side of ['left', 'right', 'bottom', 'top'] as const) {
      const len = side === 'left' || side === 'right' ? b.h : b.w;
      for (let at = b.sizes.clampWidth / 2; at <= len - b.sizes.clampWidth / 2; at += 20) {
        const f = { kind: 'clamp' as const, side, at };
        if (reserved(f, b)) continue;
        const p = centreOf(f, b);
        const d = pts.length ? Math.min(...pts.map(q => Math.hypot(p.x - q.x, p.y - q.y))) : Math.hypot(p.x - centre.x, p.y - centre.y);
        if (pts.length && d < kSuggestApart) continue;
        const free = fixtureFree(b, spots, f);
        options.push({ f, free, score: d * (free ? 1 : 0.7) });
      }
    }
    options.sort((x, y) => y.score - x.score);
    let chosen: { spots: Spots; fixtures: Fixture[] } | null = null;
    let tries = 0;
    for (const { f, free } of options) {
      if (!free && ++tries > 25) continue;
      const r = free ? { spots, w: b.w, h: b.h } : settle(b, spots, [...fixtures, f], false, 60);
      if (!r || r.w !== b.w || r.h !== b.h) continue;
      if (b.parts.some(q => spots[q.id] && Math.hypot(r.spots[q.id].x - spots[q.id].x, r.spots[q.id].y - spots[q.id].y) > kSuggestMove))
        continue;
      const play = clampPlay(b, r.spots, f);
      if (play.hi - play.lo < kSuggestPlay) continue;
      const next: Fixture[] = [...fixtures, { ...f, at: Math.round((play.lo + play.hi) / 2) }];
      if (area(r.spots, next) < floor) continue;
      chosen = { spots: r.spots, fixtures: next };
      break;
    }
    if (!chosen) break;
    ({ spots, fixtures } = chosen);
  }
  return { spots, fixtures };
}
