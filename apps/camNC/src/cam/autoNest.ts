/**
 * Global nesting of one thickness's parts onto the stock sheets: which sheets to use and which parts go on each.
 * Pure; how parts are laid out on one sheet is the caller's packer (so the boards show exactly what was planned).
 */
import type { Rect } from '@wbcnc/cam/nest';

export interface NestSheet {
  id: string;
  w: number;
  h: number;
  /** How many there are; undefined = as many as needed. */
  quantity?: number;
}

export interface SheetPack {
  /** The parts that fit. */
  placed: string[];
  /** Space each placed part takes on the sheet (gap included), for measuring the offcut. */
  used: Rect[];
}

export interface AutoNestBoard {
  sheet: NestSheet;
  /** In input order. */
  items: string[];
}

export interface AutoNestResult {
  boards: AutoNestBoard[];
  /** Parts that fit on no sheet, even alone. */
  tooBig: string[];
  /** Parts left over when the sheets ran out. */
  short: string[];
}

/** Lays out parts on one sheet; returns the ones that fit. */
export type SheetPacker = (items: string[], sheet: { w: number; h: number }) => SheetPack;

const EPS = 1e-6;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const contains = (a: Rect, b: Rect) => b.x >= a.x - EPS && b.y >= a.y - EPS && b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;

/** Area of the largest free rectangle on a `w` x `h` sheet around the `used` rectangles (MaxRects split). */
export function largestFreeRect(w: number, h: number, used: Rect[]): number {
  let free: Rect[] = [{ x: 0, y: 0, w, h }];
  for (const u of used) {
    const next: Rect[] = [];
    for (const f of free) {
      if (!overlaps(f, u)) {
        next.push(f);
        continue;
      }
      if (u.x > f.x + EPS) next.push({ x: f.x, y: f.y, w: u.x - f.x, h: f.h });
      if (u.x + u.w < f.x + f.w - EPS) next.push({ x: u.x + u.w, y: f.y, w: f.x + f.w - u.x - u.w, h: f.h });
      if (u.y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: u.y - f.y });
      if (u.y + u.h < f.y + f.h - EPS) next.push({ x: f.x, y: u.y + u.h, w: f.w, h: f.y + f.h - u.y - u.h });
    }
    free = next.filter((r, i) => !next.some((o, j) => j !== i && contains(o, r) && (j < i || !contains(r, o))));
  }
  return Math.max(0, ...free.map(f => f.w * f.h));
}

/** Small seeded PRNG (mulberry32): restarts are random but the result is the same every time. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Fill {
  sheet: number;
  items: number[];
  area: number;
  offcut: number;
}

interface Plan {
  boards: Fill[];
  short: number[];
  area: number;
  offcut: number;
}

type Policy = 'largest' | 'fill' | 'random';

/** What auto-fill optimizes first: the number of boards ("boards", the default) or the sheet area ("wood"). */
export type NestObjective = 'boards' | 'wood';

/** Fewer parts left over, then fewer boards and less sheet area (in the objective's order), then the bigger offcut. */
function better(a: Plan, b: Plan | undefined, objective: NestObjective): boolean {
  if (!b) return true;
  if (a.short.length !== b.short.length) return a.short.length < b.short.length;
  const byArea = Math.abs(a.area - b.area) > EPS ? a.area < b.area : undefined;
  const byCount = a.boards.length !== b.boards.length ? a.boards.length < b.boards.length : undefined;
  const [first, second] = objective === 'boards' ? [byCount, byArea] : [byArea, byCount];
  return first ?? second ?? a.offcut > b.offcut + EPS;
}

/**
 * Put the parts on as little stock as possible: fewest boards, then least sheet area (or the other way round with
 * `objective: 'wood'`), then one big offcut.
 *
 * The search: greedy rollouts (biggest sheet first; best-filled sheet first), a greedy with one step of lookahead
 * (each sheet choice is rated by finishing the plan with those rollouts), and a few randomized restarts (seeded,
 * so deterministic) that vary the sheet choice and which parts are offered to a sheet. Every rollout ends with the
 * smallest sheet that takes all remaining parts, and the best plan's boards are moved to smaller sheets where they
 * still fit. The plain "fill the biggest sheet over and over" plan is one of the candidates, so the result is never
 * worse than that.
 */
export function autoNest(
  items: { id: string; w: number; h: number }[],
  sheets: NestSheet[],
  pack: SheetPacker,
  opts: { seed?: number; restarts?: number; objective?: NestObjective } = {}
): AutoNestResult {
  const objective = opts.objective ?? 'boards';
  const sheetArea = sheets.map(s => s.w * s.h);
  const partArea = items.map(i => i.w * i.h);
  const memo = new Map<string, Fill>();
  // The parts that `pack` places when offered `offer`, re-packed until the placed set packs on its own (MaxRects
  // isn't monotonic: a subset can come out differently).
  const packOn = (sheet: number, offer: number[]): Fill => {
    const key = `${sheet}:${offer.join(',')}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const res = pack(
      offer.map(i => items[i].id),
      sheets[sheet]
    );
    const index = new Map(offer.map(i => [items[i].id, i]));
    const placed = res.placed.map(id => index.get(id)!).sort((a, b) => a - b);
    const fill =
      placed.length === offer.length || !placed.length
        ? {
            sheet,
            items: placed,
            area: placed.reduce((a, i) => a + partArea[i], 0),
            offcut: largestFreeRect(sheets[sheet].w, sheets[sheet].h, res.used),
          }
        : packOn(sheet, placed);
    memo.set(key, fill);
    return fill;
  };

  const all = items.map((_, i) => i);
  const tooBig = all.filter(i => sheets.every((_, s) => !packOn(s, [i]).items.length));
  const start = all.filter(i => !tooBig.includes(i));
  const quantity = sheets.map(s => s.quantity ?? Infinity);

  const makePlan = (boards: Fill[], short: number[]): Plan => ({
    boards,
    short,
    area: boards.reduce((a, b) => a + sheetArea[b.sheet], 0),
    offcut: Math.max(0, ...boards.map(b => b.offcut)),
  });

  /** One board from the parts left: the smallest sheet that takes them all, else one picked by `policy`. */
  const nextBoard = (left: number[], q: number[], policy: Policy, finish: boolean, rnd?: () => number): Fill | undefined => {
    const avail = sheets.map((_, s) => s).filter(s => q[s] > 0);
    const leftArea = left.reduce((a, i) => a + partArea[i], 0);
    if (finish) {
      const fits = avail
        .filter(s => sheetArea[s] >= leftArea)
        .sort((a, b) => sheetArea[a] - sheetArea[b])
        .find(s => packOn(s, left).items.length === left.length);
      if (fits !== undefined) return packOn(fits, left);
    }
    if (policy === 'random') {
      // Leave some parts out at random, so they can group differently on the next boards.
      const offer = left.filter(() => rnd!() > 0.2);
      const options = avail.map(s => packOn(s, offer.length ? offer : left)).filter(f => f.items.length);
      if (!options.length) return nextBoard(left, q, 'fill', false);
      // Well-filled sheets are more likely.
      const weights = options.map(f => (f.area / sheetArea[f.sheet]) ** 2);
      let r = rnd!() * weights.reduce((a, w) => a + w, 0);
      return options.find((_, k) => (r -= weights[k]) <= 0) ?? options[options.length - 1];
    }
    const options = avail.map(s => packOn(s, left)).filter(f => f.items.length);
    if (!options.length) return undefined;
    const rate = (f: Fill) => (policy === 'largest' ? sheetArea[f.sheet] : f.area / sheetArea[f.sheet]);
    return options.reduce((best, f) => (rate(f) > rate(best) + EPS ? f : best));
  };

  const rollout = (boards: Fill[], left: number[], q: number[], policy: Policy, finish = true, rnd?: () => number): Plan => {
    boards = [...boards];
    q = [...q];
    while (left.length) {
      const fill = nextBoard(left, q, policy, finish, rnd);
      if (!fill) break;
      boards.push(fill);
      q[fill.sheet]--;
      const used = new Set(fill.items);
      left = left.filter(i => !used.has(i));
    }
    return makePlan(boards, left);
  };

  let best: Plan | undefined;
  const consider = (plan: Plan) => {
    if (better(plan, best, objective)) best = plan;
    return plan;
  };

  // The plain greedy (biggest sheet, again and again) and the simple rollouts.
  consider(rollout([], start, quantity, 'largest', false));
  for (const policy of ['largest', 'fill'] as const) consider(rollout([], start, quantity, policy));

  // Greedy with lookahead: try every sheet for the next board, finish each with the rollouts, keep the best choice.
  {
    let boards: Fill[] = [];
    let left = start;
    const q = [...quantity];
    while (left.length) {
      let step: { fill: Fill; plan: Plan } | undefined;
      const options = sheets.map((_, s) => s).filter(s => q[s] > 0);
      for (const s of options) {
        const fill = packOn(s, left);
        if (!fill.items.length) continue;
        const used = new Set(fill.items);
        const rest = left.filter(i => !used.has(i));
        const nq = q.map((n, k) => (k === s ? n - 1 : n));
        for (const policy of ['largest', 'fill'] as const) {
          const plan = consider(rollout([...boards, fill], rest, nq, policy));
          if (!step || better(plan, step.plan, objective)) step = { fill, plan };
        }
      }
      if (!step) break;
      boards = [...boards, step.fill];
      q[step.fill.sheet]--;
      const used = new Set(step.fill.items);
      left = left.filter(i => !used.has(i));
    }
  }

  const rnd = mulberry32(opts.seed ?? 0x5eed);
  for (let r = 0; r < (opts.restarts ?? 8); r++) consider(rollout([], start, quantity, 'random', true, rnd));

  // Move each board to the smallest sheet that still takes all of its parts.
  const plan = best!;
  const q = [...quantity];
  for (const b of plan.boards) q[b.sheet]--;
  const boards = plan.boards.map(b => {
    const smaller = sheets
      .map((_, s) => s)
      .filter(s => q[s] > 0 && sheetArea[s] < sheetArea[b.sheet] - EPS && sheetArea[s] >= b.area)
      .sort((x, y) => sheetArea[x] - sheetArea[y])
      .find(s => packOn(s, b.items).items.length === b.items.length);
    if (smaller === undefined) return b;
    q[b.sheet]++;
    q[smaller]--;
    return packOn(smaller, b.items);
  });

  const ids = (xs: number[]) => xs.map(i => items[i].id);
  return {
    boards: boards.map(b => ({ sheet: sheets[b.sheet], items: ids(b.items) })),
    tooBig: ids(tooBig),
    short: ids(plan.short),
  };
}
