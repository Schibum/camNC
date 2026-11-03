import { describe, expect, it } from 'vitest';
import { clampKeepOuts, nestRects, placedSize, type NestItem, type NestOptions, type NestResult, type Rect } from './nest';

const TOL = 1e-6;

/** Seeded PRNG (mulberry32): the property test is reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const placedRects = (items: NestItem[], res: NestResult) =>
  res.placements.map(p => {
    const item = items.find(i => i.id === p.id)!;
    return { id: p.id, rotated: p.rotated, item, x: p.x, y: p.y, ...placedSize(item, p.rotated) };
  });

/** Distance-aware overlap: true if a and b are closer than `gap` in both axes (i.e. their gap-grown boxes overlap). */
const tooClose = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap - TOL && b.x < a.x + a.w + gap - TOL && a.y < b.y + b.h + gap - TOL && b.y < a.y + a.h + gap - TOL;

/** Every rule a nest must keep. */
function checkNest(items: NestItem[], opts: NestOptions, res: NestResult) {
  const rects = placedRects(items, res);
  // Every item is placed or unplaced, exactly once.
  expect([...res.placements.map(p => p.id), ...res.unplaced].sort()).toEqual(items.map(i => i.id).sort());
  for (const r of rects) {
    expect(r.x, r.id).toBeGreaterThanOrEqual(opts.margin - TOL);
    expect(r.y, r.id).toBeGreaterThanOrEqual(opts.margin - TOL);
    expect(r.x + r.w, r.id).toBeLessThanOrEqual(res.board.w - opts.margin + TOL);
    expect(r.y + r.h, r.id).toBeLessThanOrEqual(res.board.h - opts.margin + TOL);
    if (r.rotated) expect(r.item.canRotate, r.id).toBe(true);
    for (const k of opts.keepOuts ?? []) expect(tooClose(r, k, opts.gap), `${r.id} vs keep-out`).toBe(false);
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      expect(tooClose(rects[i], rects[j], opts.gap), `${rects[i].id} vs ${rects[j].id}`).toBe(false);
  const used = rects.reduce((s, r) => s + r.w * r.h, 0);
  expect(res.yield).toBeCloseTo(used / (res.board.w * res.board.h), 9);
}

/** The first implementation (shelf packing, kept as the baseline the MaxRects nester must beat). */
function shelfBoard(items: NestItem[], gap: number, margin: number) {
  const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const width = Math.max(...items.map(i => i.w)) + 2 * margin;
  let x = margin,
    y = margin,
    rowH = 0;
  for (const item of order) {
    if (x > margin && x + item.w > width - margin) {
      x = margin;
      y += rowH + gap;
      rowH = 0;
    }
    x += item.w + gap;
    rowH = Math.max(rowH, item.h);
  }
  return { w: width, h: y + rowH + margin };
}

// Kinderregal eiche, the 8 mm parts (sides, top/bottom shelves, middle shelf), grain along the length: no rotation.
const KINDER: NestItem[] = [
  { id: 'left', w: 560, h: 140 },
  { id: 'right', w: 560, h: 140 },
  { id: 'Part 1', w: 400, h: 140 },
  { id: 'Part 3', w: 400, h: 140 },
  { id: 'Part 2', w: 400, h: 136.5 },
];

describe('nestRects', () => {
  it('fits the kinderregal 8 mm parts on a board no bigger than shelf packing', () => {
    const opts = { gap: 7, margin: 20 };
    const res = nestRects(KINDER, opts);
    checkNest(KINDER, opts, res);
    expect(res.unplaced).toEqual([]);
    const shelf = shelfBoard(KINDER, 7, 20);
    expect(shelf).toEqual({ w: 600, h: 764.5 });
    expect(res.board.w * res.board.h).toBeLessThanOrEqual(shelf.w * shelf.h + TOL);
    const partArea = KINDER.reduce((s, i) => s + i.w * i.h, 0);
    expect(res.yield).toBeCloseTo(partArea / (res.board.w * res.board.h), 9);
    expect(res.yield).toBeGreaterThanOrEqual(partArea / (shelf.w * shelf.h) - TOL);
    console.log(
      `kinderregal 8mm: fitted ${res.board.w} x ${res.board.h} (yield ${(res.yield * 100).toFixed(1)}%), ` +
        `shelf ${shelf.w} x ${shelf.h} (yield ${((partArea / (shelf.w * shelf.h)) * 100).toFixed(1)}%)`
    );
  });

  it('places side by side on a fixed board and lists what does not fit', () => {
    const opts = { gap: 7, margin: 20, board: { w: 1000, h: 400 } };
    const res = nestRects(KINDER, opts);
    checkNest(KINDER, opts, res);
    // 960 x 360 usable: two rows of 140 (+7). 560 + 7 + 400 = 967 is too wide, 400 + 7 + 400 fits: the best is two
    // 400s in one row and a 560 in the other (big parts first would place only the two 560s).
    expect(res.placements).toHaveLength(3);
    expect(res.unplaced).toHaveLength(2);
    expect(res.yield).toBeCloseTo((560 * 140 + 2 * 400 * 140) / (1000 * 400), 9);
    expect(nestRects(KINDER, { gap: 7, margin: 20, board: { w: 300, h: 300 } }).unplaced).toHaveLength(5);
  });

  it('keeps out of clamp zones (+ gap)', () => {
    const board = { w: 1000, h: 700 };
    const opts = { gap: 7, margin: 10, board, keepOuts: clampKeepOuts(board, { w: 80, h: 60 }) };
    const res = nestRects(KINDER, opts);
    checkNest(KINDER, opts, res);
    expect(res.unplaced).toEqual([]);
    // A keep-out in the middle of the board, in fit mode (lower left based coordinates are shared).
    const mid = { gap: 7, margin: 20, keepOuts: [{ x: 0, y: 0, w: 300, h: 100 }] };
    checkNest(KINDER, mid, nestRects(KINDER, mid));
  });

  it('turns parts only when allowed', () => {
    // A long, narrow board: 100 wide parts that are 300 long only fit turned.
    const items: NestItem[] = [
      { id: 'a', w: 300, h: 100, canRotate: true },
      { id: 'b', w: 300, h: 100, canRotate: false },
    ];
    const opts = { gap: 5, margin: 5, board: { w: 120, h: 400 } };
    const res = nestRects(items, opts);
    checkNest(items, opts, res);
    expect(res.placements).toEqual([{ id: 'a', x: 5, y: 5, rotated: true }]);
    expect(res.unplaced).toEqual(['b']);
    // Fit mode turns rotatable parts when that gives a smaller board.
    const fit = nestRects(
      [
        { id: 'a', w: 300, h: 100, canRotate: true },
        { id: 'b', w: 100, h: 300 },
      ],
      { gap: 5, margin: 5 }
    );
    expect(fit.placements.find(p => p.id === 'a')!.rotated).toBe(true);
    expect(fit.board).toEqual({ w: 215, h: 310 });
  });

  it('is deterministic and fast for 50 parts', () => {
    const r = rng(7);
    const items: NestItem[] = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      w: Math.round(30 + r() * 500),
      h: Math.round(20 + r() * 200),
      canRotate: r() < 0.5,
    }));
    for (const opts of [
      { gap: 7, margin: 20 },
      { gap: 7, margin: 20, board: { w: 2440, h: 1220 } },
      { gap: 7, margin: 20, board: { w: 1220, h: 800 } },
    ]) {
      const t0 = performance.now();
      const a = nestRects(items, opts);
      const t1 = performance.now();
      // Same input, same result (the second, warm run is the one timed).
      expect(nestRects(items, opts)).toEqual(a);
      const ms = Math.min(t1 - t0, performance.now() - t1);
      const what = opts.board ? `${opts.board.w} x ${opts.board.h}` : 'fit';
      console.log(`50 parts, ${what}: ${ms.toFixed(1)} ms, yield ${(a.yield * 100).toFixed(1)}%, ${a.unplaced.length} unplaced`);
      expect(ms, `${what} took ${ms.toFixed(1)} ms`).toBeLessThan(50);
      checkNest(items, opts, a);
    }
  });

  it('keeps every rule on 200 random cases', () => {
    const r = rng(42);
    const int = (lo: number, hi: number) => Math.floor(lo + r() * (hi - lo + 1));
    for (let c = 0; c < 200; c++) {
      const n = int(1, 15);
      const items: NestItem[] = Array.from({ length: n }, (_, i) => ({
        id: `c${c}-${i}`,
        w: int(5, 400) + (r() < 0.3 ? 0.5 : 0),
        h: int(5, 300),
        canRotate: r() < 0.4,
      }));
      const fixed = r() < 0.6;
      const board = { w: int(100, 1200), h: int(100, 900) };
      const opts: NestOptions = {
        gap: [0, 3.175, 7, 10][int(0, 3)],
        margin: int(0, 30),
        board: fixed ? board : undefined,
        keepOuts: r() < 0.5 ? (fixed ? clampKeepOuts(board) : [{ x: 0, y: 0, w: int(10, 200), h: int(10, 200) }]) : undefined,
      };
      const res = nestRects(items, opts);
      checkNest(items, opts, res);
      if (!fixed) expect(res.unplaced, `case ${c}`).toEqual([]);
      // A part that fits on an empty board (no keep-outs) is never left out when it is alone.
      if (fixed && n === 1 && !opts.keepOuts) {
        const it = items[0];
        const fits = (w: number, h: number) => w <= board.w - 2 * opts.margin && h <= board.h - 2 * opts.margin;
        expect(res.unplaced.length === 0, `case ${c}`).toBe(fits(it.w, it.h) || (!!it.canRotate && fits(it.h, it.w)));
      }
    }
  });
});
