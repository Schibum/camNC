import { frameMargin } from '@wbcnc/cam/holdPoints';
import { describe, expect, it } from 'vitest';
import {
  changesCutBoard,
  autoFillFromStock,
  boardRequest,
  boardSizeLabel,
  dropPart,
  flipOf,
  freezeSpacing,
  nestBoard,
  newBoard,
  reconcileBoards,
  relayoutBoard,
  spacingProblem,
  edgeNote,
  holdsOf,
  nutAboveOf,
  stockTopOf,
  type BoardV1,
  type PartInstance,
  type StockBoardV1,
} from './boards';
import { missingParts } from './useJobBoards';
import type { NestObjective } from './autoNest';

const inst = (id: string, w: number, h: number, t: number): PartInstance => ({ id, partId: id, name: id, size: [w, h, t], thickness: t });
// The kinderregal bodies.
const parts = [
  inst('left', 560, 140, 8),
  inst('right', 560, 140, 8),
  inst('top', 400, 140, 8),
  inst('bottom', 400, 140, 8),
  inst('middle', 400, 136.5, 8),
  inst('back', 400, 380, 3),
];

/** The auto-fill before global nesting, to compare with: fill the biggest stock board, again and again. */
function greedyFillFromStock(boards: BoardV1[], instances: PartInstance[], stock: StockBoardV1[], bit: number) {
  const out: BoardV1[] = [];
  const tooBig: string[] = [];
  const key = (t: number) => +t.toFixed(1);
  for (const t of [...new Set(instances.map(i => key(i.thickness)))].sort((a, b) => b - a)) {
    const sheets = stock.filter(s => key(s.thickness) === t).sort((a, b) => b.w * b.h - a.w * a.h);
    const old = boards.filter(b => b.thickness === t);
    let left = instances.filter(i => key(i.thickness) === t).map(i => i.id);
    if (!sheets.length) {
      out.push(...(old.length ? old : [newBoard(out, t, 'oak', left)]));
      continue;
    }
    while (left.length) {
      const board = { ...newBoard(out, t, 'oak', left), frame: false, size: { fit: false as const, w: sheets[0].w, h: sheets[0].h } };
      const placed = nestBoard(board, instances, bit).placements.map(p => p.id);
      if (!placed.length) {
        tooBig.push(...left);
        break;
      }
      out.push({ ...board, items: placed });
      left = left.filter(id => !placed.includes(id));
    }
  }
  return { boards: out, tooBig };
}

/** Stock used: the area of the stock boards, and how many. */
const usage = (boards: BoardV1[]) => {
  const stock = boards.flatMap(b => (b.size.fit ? [] : [b.size]));
  return { area: stock.reduce((a, s) => a + s.w * s.h, 0), boards: stock.length };
};

/** Not worse: no more stock area, and with the same area no more boards. */
/** Not worse in the objective's order: fewest boards then area, or area then boards ("wood"). */
const notWorse = (a: ReturnType<typeof usage>, b: ReturnType<typeof usage>, objective: NestObjective) =>
  objective === 'wood'
    ? a.area < b.area - 1e-6 || (a.area <= b.area + 1e-6 && a.boards <= b.boards)
    : a.boards < b.boards || (a.boards === b.boards && a.area <= b.area + 1e-6);

/** Seeded random numbers (mulberry32). */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every body is on exactly one board; on stock boards all of them fit; the rest is reported. */
function expectAllPlaced(res: ReturnType<typeof autoFillFromStock>, instances: PartInstance[], bit: number) {
  const on = res.boards.flatMap(b => b.items);
  expect([...on].sort()).toEqual(instances.map(i => i.id).sort());
  for (const b of res.boards.filter(b => !b.size.fit)) expect(nestBoard(b, instances, bit).unplaced).toEqual([]);
  const reported = new Set([...res.tooBig, ...res.short]);
  for (const b of res.boards.filter(b => b.size.fit && b.items.some(id => reported.has(id))))
    expect(b.items.every(id => reported.has(id))).toBe(true);
}

/** The most the 30-part nest may take, as a multiple of `referenceWork`: about 2.5 in this file now, so twice as slow fails. */
const kNestRatio = 5;

/** A fixed piece of work like nesting's: small objects, sorting, arithmetic. */
function referenceWork() {
  let sum = 0;
  for (let k = 0; k < 400; k++) {
    const rects = Array.from({ length: 400 }, (_, i) => ({ x: (i * 7919 + k) % 1009, w: (i * 104729) % 613 }));
    rects.sort((a, b) => a.x - b.x || a.w - b.w);
    for (const r of rects) sum += Math.min(r.x + r.w, 1000);
  }
  return sum;
}

describe('boards', () => {
  it('starts with one fitted board per thickness, thickest first', () => {
    const boards = reconcileBoards(undefined, parts, 'oak');
    expect(boards.map(b => [b.name, b.thickness, b.items.length])).toEqual([
      ['A', 8, 5],
      ['B', 3, 1],
    ]);
    // The 3 mm back defaults to plywood, the 8 mm boards to the job's material.
    expect(boards.map(b => b.material)).toEqual(['oak', 'plywood']);
  });

  it('auto-fills stock boards, overflowing onto more boards, with unique names', () => {
    const boards = reconcileBoards(undefined, parts, 'oak');
    const res = autoFillFromStock(boards, parts, [{ id: 's', thickness: 8, w: 600, h: 400 }], 3.175, 'oak');
    expect(res.tooBig).toEqual([]);
    expect(res.boards.map(b => b.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(
      res.boards
        .filter(b => b.thickness === 8)
        .flatMap(b => b.items)
        .sort()
    ).toEqual(['bottom', 'left', 'middle', 'right', 'top']);
    for (const b of res.boards.filter(b => b.thickness === 8)) expect(nestBoard(b, parts, 3.175).unplaced).toEqual([]);
  });

  describe('global nesting', () => {
    const bit = 3.175;
    const fixtures: [string, StockBoardV1[]][] = [
      ['600 x 400', [{ id: 's', thickness: 8, w: 600, h: 400 }]],
      [
        'big and small sheets',
        [
          { id: 'l', thickness: 8, w: 1220, h: 610 },
          { id: 's', thickness: 8, w: 600, h: 400 },
          { id: 'b', thickness: 3, w: 1220, h: 610 },
          { id: 'c', thickness: 3, w: 420, h: 400 },
        ],
      ],
      [
        'full sheet and offcuts',
        [
          { id: 'f', thickness: 8, w: 2440, h: 1220 },
          { id: 'o', thickness: 8, w: 800, h: 600 },
          { id: 'p', thickness: 8, w: 600, h: 320 },
        ],
      ],
    ];

    const cases = (['boards', 'wood'] as const).flatMap(o => fixtures.map(([name, stock]) => [o, name, stock] as const));
    it.each(cases)('%s first, kinderregal on %s: never worse than filling the biggest board', (objective, name, stock) => {
      const boards = reconcileBoards(undefined, parts, 'oak');
      const res = autoFillFromStock(boards, parts, stock, bit, 'oak', objective);
      const old = greedyFillFromStock(boards, parts, stock, bit);
      expectAllPlaced(res, parts, bit);
      expect(res.tooBig).toEqual(old.tooBig);
      console.info(
        `${objective} first, kinderregal, ${name}: greedy ${JSON.stringify(usage(old.boards))}, global ${JSON.stringify(usage(res.boards))}`
      );
      expect(notWorse(usage(res.boards), usage(old.boards), objective)).toBe(true);
    });

    it('fewest boards takes the full sheet where least wood takes offcuts', () => {
      const stock = fixtures[2][1];
      const boards = reconcileBoards(undefined, parts, 'oak');
      // Greedy takes a whole 2440 x 1220 sheet for five small parts.
      expect(usage(greedyFillFromStock(boards, parts, stock, bit).boards).area).toBe(2440 * 1220);
      const fewest = usage(autoFillFromStock(boards, parts, stock, bit, 'oak', 'boards').boards);
      const least = usage(autoFillFromStock(boards, parts, stock, bit, 'oak', 'wood').boards);
      expect(fewest.boards).toBe(1);
      expect(least.area).toBeLessThan(fewest.area);
      expect(least.boards).toBeGreaterThan(1);
      // The default is fewest boards.
      expect(usage(autoFillFromStock(boards, parts, stock, bit, 'oak').boards)).toEqual(fewest);
    });

    it.each(['boards', 'wood'] as const)(
      '%s first, on 200 random jobs: never worse than filling the biggest board',
      { timeout: 120_000 },
      objective => {
        const rnd = random(42);
        const sizes = [
          [2440, 1220],
          [1220, 610],
          [1000, 500],
          [800, 600],
          [600, 400],
          [600, 300],
        ];
        const total = { greedy: { area: 0, boards: 0 }, global: { area: 0, boards: 0 } };
        let better = 0;
        let slowest = 0;
        for (let c = 0; c < 200; c++) {
          const thicknesses = rnd() < 0.3 ? [8, 18] : [18];
          const n = 2 + Math.floor(rnd() * 28);
          const instances = Array.from({ length: n }, (_, i) =>
            inst(`p${i}`, Math.round(40 + rnd() * 700), Math.round(30 + rnd() * 420), thicknesses[i % thicknesses.length])
          );
          const stock = thicknesses.flatMap(t =>
            Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, k) => {
              const [w, h] = sizes[Math.floor(rnd() * sizes.length)];
              return { id: `${t}-${k}`, thickness: t, w, h };
            })
          );
          const boards = reconcileBoards(undefined, instances, 'oak');
          const old = greedyFillFromStock(boards, instances, stock, bit);
          const t0 = performance.now();
          const res = autoFillFromStock(boards, instances, stock, bit, 'oak', objective);
          slowest = Math.max(slowest, performance.now() - t0);
          expectAllPlaced(res, instances, bit);
          // Greedy only tries the biggest sheet; a part may still fit a smaller one of another shape.
          for (const id of res.tooBig) expect(old.tooBig).toContain(id);
          if (res.tooBig.length < old.tooBig.length) continue;
          const [a, b] = [usage(res.boards), usage(old.boards)];
          expect(notWorse(a, b, objective), `case ${c}`).toBe(true);
          if (a.area < b.area - 1e-6 || a.boards < b.boards) better++;
          total.global.area += a.area;
          total.global.boards += a.boards;
          total.greedy.area += b.area;
          total.greedy.boards += b.boards;
        }
        console.info(`${objective} first, random jobs: ${JSON.stringify(total)}, better in ${better}, slowest ${slowest.toFixed(0)} ms`);
      }
    );

    it('nests 30 parts fast: within a set multiple of a fixed piece of work timed alongside', () => {
      const rnd = random(7);
      const instances = Array.from({ length: 30 }, (_, i) => inst(`p${i}`, Math.round(60 + rnd() * 500), Math.round(40 + rnd() * 300), 18));
      const stock = [
        { id: 'a', thickness: 18, w: 1220, h: 610 },
        { id: 'b', thickness: 18, w: 800, h: 600 },
        { id: 'c', thickness: 18, w: 600, h: 400 },
      ];
      const boards = reconcileBoards(undefined, instances, 'oak');
      autoFillFromStock(boards, instances, stock, bit, 'oak');
      // Against a fixed piece of work timed in turn with it, so both see the same load: a slow CI runner slows both, a
      // slower nest only the one. The fastest of a few runs each, as a busy machine only ever adds time.
      const timed = <T>(work: () => T) => {
        const t0 = performance.now();
        const out = work();
        return { out, ms: performance.now() - t0 };
      };
      const runs = Array.from({ length: 7 }, () => ({
        nest: timed(() => autoFillFromStock(boards, instances, stock, bit, 'oak')),
        reference: timed(referenceWork),
      }));
      const res = runs[0].nest.out;
      const ms = Math.min(...runs.map(r => r.nest.ms));
      const reference = Math.min(...runs.map(r => r.reference.ms));
      console.info(
        `30 parts, 3 sheet sizes: ${ms.toFixed(0)} ms, reference ${reference.toFixed(1)} ms, ratio ${(ms / reference).toFixed(2)}, ${res.boards.length} boards`
      );
      expectAllPlaced(res, instances, bit);
      expect(ms / reference).toBeLessThan(kNestRatio);
    });

    it('keeps parts moved by hand on their board and nests the rest', () => {
      const [a, b] = reconcileBoards(undefined, parts, 'oak');
      const pinnedBoard: BoardV1 = { ...newBoard([a, b], 8, 'oak', ['top']), pinned: ['top'] };
      const boards = [{ ...a, items: a.items.filter(id => id !== 'top') }, b, pinnedBoard];
      const stock = fixtures[1][1];
      const res = autoFillFromStock(boards, parts, stock, bit, 'oak');
      expectAllPlaced(res, parts, bit);
      const kept = res.boards.find(x => x.id === pinnedBoard.id)!;
      expect(kept.name).toBe(pinnedBoard.name);
      expect(kept.items).toEqual(['top']);
      expect(kept.pinned).toEqual(['top']);
      expect(new Set(res.boards.map(x => x.name)).size).toBe(res.boards.length);
      // A pin goes with its part when the part isn't milled any more.
      const reconciled = reconcileBoards(
        boards,
        parts.filter(p => p.id !== 'top'),
        'oak'
      );
      expect(reconciled.find(x => x.id === pinnedBoard.id)!.pinned).toEqual([]);

      // On a stock-size board, free parts fill the room left; the pinned one stays.
      const sized = { ...pinnedBoard, size: { fit: false as const, w: 1220, h: 610 } };
      const res2 = autoFillFromStock([boards[0], b, sized], parts, stock, bit, 'oak');
      expectAllPlaced(res2, parts, bit);
      const kept2 = res2.boards.find(x => x.id === pinnedBoard.id)!;
      expect(kept2.items[0]).toBe('top');
      expect(kept2.items.length).toBeGreaterThan(1);
      expect(nestBoard(kept2, parts, bit).unplaced).toEqual([]);
    });

    it('uses no more stock boards than there are; the rest goes on a fitted board', () => {
      const stock = [{ id: 's', thickness: 8, w: 600, h: 400, quantity: 1 }];
      const res = autoFillFromStock(reconcileBoards(undefined, parts, 'oak'), parts, stock, bit, 'oak');
      expectAllPlaced(res, parts, bit);
      expect(res.boards.filter(b => b.thickness === 8 && !b.size.fit)).toHaveLength(1);
      expect(res.short).toHaveLength(3);
      expect(res.boards.find(b => b.size.fit && b.thickness === 8)!.items.sort()).toEqual([...res.short].sort());
    });

    it('reports parts bigger than every stock board', () => {
      const stock = [{ id: 's', thickness: 8, w: 500, h: 400 }];
      const res = autoFillFromStock(reconcileBoards(undefined, parts, 'oak'), parts, stock, bit, 'oak');
      expect(res.tooBig.sort()).toEqual(['left', 'right']);
      expectAllPlaced(res, parts, bit);
    });
  });

  it('fitted boards keep a small edge margin (bit + 2) and gap (bit + 4), with tabs room for a strip that holds them; both editable', () => {
    const [tabs] = reconcileBoards(undefined, parts, 'oak');
    const withTabs = nestBoard({ ...tabs, frame: false }, parts, 3.175);
    // 3.5 mm of stock left beside the cut at the edge, and between the cuts of two neighbours.
    expect([withTabs.margin, withTabs.gap]).toEqual([6.7, 10]);
    // Held by screws, by default with a frame of stock for them: a wider margin.
    expect(nestBoard(tabs, parts, 3.175).margin).toBe(frameMargin(10, 3.175));
    // Clamps grip at the edge: the frame is their reach in (2 mm) plus the cut, not a round toe's size. Their toes
    // lie against an edge, 20 mm along it, and stay clear of the parts.
    const clamped = nestBoard({ ...tabs, holds: { kind: 'clamp', d: 2, w: 20, height: 5 } }, parts, 3.175);
    expect(clamped.margin).toBe(frameMargin(2, 3.175, 'clamp', 5));
    expect(clamped.margin).toBe(8);
    // By default the low M6 edge clamp (2.5 mm above the stock): below the collet nut, no room kept for it.
    expect(nestBoard({ ...tabs, holds: { kind: 'clamp', d: 2, w: 20 } }, parts, 3.175).margin).toBe(8);
    // A taller clamp: room for the collet nut beside it too.
    expect(nestBoard({ ...tabs, holds: { kind: 'clamp', d: 2, w: 20, height: 30 } }, parts, 3.175).margin).toBe(18);
    expect(clamped.holds.length).toBeGreaterThanOrEqual(4);
    for (const h of clamped.holds) {
      expect(h).toMatchObject({ kind: 'clamp', d: 2, w: 20 });
      expect(Math.min(h.x, h.y, clamped.board.w - h.x, clamped.board.h - h.y)).toBeCloseTo(1, 5);
    }
    // A clamp saved before clamps had a width (sized as a round toe) starts afresh: the edge clamp's 3 mm lip.
    expect(nestBoard({ ...tabs, holds: { kind: 'clamp', d: 25 } }, parts, 3.175).margin).toBe(9);
    // The collet nut needs room beside a 30 mm clamp only while it gets that low: with the bit 45 mm out of the nut,
    // it stays above the clamp on the deepest cut (8.3 + 0.3) and only the bit's own clearance is left.
    // Unset, the stick-out clears the deepest cut by 10 mm: the nut never starts out below the board.
    expect(holdsOf({ ...tabs, thickness: 20 }).stickout).toBe(31);
    expect(holdsOf({ ...tabs, thickness: 6 }).stickout).toBe(20);
    expect(nutAboveOf({ ...tabs, thickness: 20 })).toBeGreaterThan(9);
    expect(nutAboveOf({ ...tabs, holds: { kind: 'clamp', d: 2, w: 20, height: 30, stickout: 45 } })).toBe(36.4);
    const long = nestBoard({ ...tabs, holds: { kind: 'clamp', d: 2, w: 20, height: 30, stickout: 45 } }, parts, 3.175);
    expect(long.margin).toBe(Math.ceil(2 + 1.5875 + 1.5 + 1.5875 + 1));
    expect(long.holds.every(h => h.nutAbove === 36.4)).toBe(true);
    // 20 mm out: the nut comes down to 11.4 mm, beside the clamp.
    expect(nestBoard({ ...tabs, holds: { kind: 'clamp', d: 2, w: 20, height: 30, stickout: 20 } }, parts, 3.175).margin).toBe(18);
    const a = { ...tabs, holdDown: 'fixture-tape' as const };
    const nest = nestBoard(a, parts, 3.175);
    expect(nest.margin).toBe(5.2);
    expect(nest.gap).toBe(8);
    const inside = (n: ReturnType<typeof nestBoard>, m: number) =>
      n.placements.every(p => {
        const [w, h] = parts.find(i => i.id === p.id)!.size;
        return p.x >= m - 1e-6 && p.y >= m - 1e-6 && p.x + w <= n.board.w - m + 1e-6 && p.y + h <= n.board.h - m + 1e-6;
      });
    expect(inside(nest, 5.2)).toBe(true);
    const wider = nestBoard({ ...a, margin: 15, gap: 12 }, parts, 3.175);
    expect(wider.margin).toBe(15);
    expect(inside(wider, 15)).toBe(true);
    // Not a strip: fitted boards stay within 2.5:1.
    for (const n of [nest, wider]) expect(Math.max(n.board.w, n.board.h) / Math.min(n.board.w, n.board.h)).toBeLessThanOrEqual(2.5);
  });

  it('fitted boards are whole mm, rounded up; an empty one shows no size', () => {
    const a = { ...reconcileBoards(undefined, parts, 'oak')[0], holdDown: 'fixture-tape' as const };
    for (const board of [a, { ...a, holdDown: 'clamps' as const }, { ...a, margin: 5.37, gap: 7.9 }]) {
      const nest = nestBoard(board, parts, 3.175);
      expect(Number.isInteger(nest.board.w) && Number.isInteger(nest.board.h)).toBe(true);
      expect(boardSizeLabel(board, nest)).toBe(`${nest.board.w} × ${nest.board.h}`);
      // The holds are on the board as rounded.
      for (const h of nest.holds) expect(h.x > 0 && h.y > 0 && h.x < nest.board.w && h.y < nest.board.h).toBe(true);
    }
    // 570.4 × 738.9 before: 571 × 739.
    expect(nestBoard(a, parts, 3.175).board).toEqual({ w: 571, h: 739 });
    const empty = { ...a, items: [] };
    expect(boardSizeLabel(empty, nestBoard(empty, parts, 3.175))).toBe('–');
    // A fixed size stays as given, even empty.
    const sheet = { ...empty, size: { fit: false as const, w: 600.5, h: 300 } };
    expect(boardSizeLabel(sheet, nestBoard(sheet, parts, 3.175))).toBe('600.5 × 300');
  });

  it('boards made for a job that has none yet keep their ids: the same boards each time, not new ones', () => {
    const a = reconcileBoards(undefined, parts, 'oak');
    const b = reconcileBoards(undefined, parts, 'oak');
    expect(a.map(x => x.id)).toEqual(b.map(x => x.id));
    expect(new Set(a.map(x => x.id)).size).toBe(a.length);
  });

  it('stock top: parts thickness + 0.3 unless measured', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
    expect(stockTopOf(a)).toBe(8.3);
    expect(stockTopOf({ ...a, measuredThickness: 8.12 })).toBe(8.12);
  });

  it('screws or clamps: suggested in the frame around the parts, clear of them, none on the XY zero; moved ones keep parts away', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
    for (const board of [a, { ...a, holdDown: 'clamps' as const }, { ...a, holds: { kind: 'clamp' as const, d: 20 } }]) {
      const nest = nestBoard(board, parts, 3.175);
      expect(nest.unplaced).toEqual([]);
      expect(nest.frame).toBe('kept');
      expect(nest.holds.length).toBeGreaterThanOrEqual(8);
      // The lower left corner is the XY zero, where the probe goes: no hold there.
      expect(nest.holds.every(h => Math.hypot(h.x, h.y) >= 40)).toBe(true);
      const size = new Map(parts.map(p => [p.id, p.size]));
      for (const p of nest.placements)
        for (const h of nest.holds) {
          const [w, hh] = size.get(p.id)!;
          const pw = p.rotated ? hh : w,
            ph = p.rotated ? w : hh;
          const dx = Math.max(p.x - h.x, 0, h.x - p.x - pw),
            dy = Math.max(p.y - h.y, 0, h.y - p.y - ph);
          expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(h.d / 2 + 3.175);
        }
    }
    // Taped: no holds, no frame.
    const taped = nestBoard({ ...a, boardHold: 'tape', holdDown: 'fixture-tape' }, parts, 3.175);
    expect([taped.holds, taped.frame]).toEqual([[], 'off']);
    // A hold moved into the middle of the board: used as is, and the parts nest around it.
    const middle = { x: 280, y: 370 };
    const moved = nestBoard({ ...a, holdPoints: [middle] }, parts, 3.175);
    expect(moved.holdsMoved).toBe(true);
    expect(moved.holds.map(h => ({ x: h.x, y: h.y }))).toEqual([middle]);
    expect(moved.keepOuts).toHaveLength(1);
    expect(moved.unplaced).toEqual([]);
    // All of them removed by hand: none, and the suggested ones don't come back.
    const removed = nestBoard({ ...a, holdPoints: [], holdPointsOn: a.size.fit ? undefined : a.size }, parts, 3.175);
    expect([removed.holds, removed.holdsMoved]).toEqual([[], true]);
  });

  it('a board held by points always says so, with none on it too; taped, it has none to say', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
    const none = { ...nestBoard(a, parts, 3.175), holds: [] };
    expect(boardRequest(a, none, parts).holdPoints).toEqual([]);
    const taped = { ...a, boardHold: 'tape' as const, holdDown: 'fixture-tape' as const };
    expect('holdPoints' in boardRequest(taped, nestBoard(taped, parts, 3.175), parts)).toBe(false);
  });

  it('holds carry their height; a moved clamp stays against its edge when its reach changes', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
    expect(nestBoard(a, parts, 3.175).holds[0].height).toBe(3);
    const clamps = { ...a, holds: { kind: 'clamp' as const, d: 2, w: 20 } };
    const on = nestBoard(clamps, parts, 3.175);
    expect(on.holds[0].height).toBe(2.5);
    // A fixed size, or the larger frame would lay it out afresh, and suggest them afresh.
    const size = { fit: false as const, w: on.board.w, h: on.board.h };
    const moved = { ...clamps, size, frame: false, holdPoints: [{ x: 100, y: 1 }], holdPointsOn: on.board };
    const reach = (d: number) => nestBoard({ ...moved, holds: { ...moved.holds, d } }, parts, 3.175).holds[0];
    // Reaches 2 in: centre 1 in. Reaches 30 in: centre 15 in, the toe from the edge to 30, not off the board.
    expect(reach(2)).toMatchObject({ x: 100, y: 1 });
    expect(reach(30)).toMatchObject({ x: 100, y: 15 });
  });

  it('second side: on by default (camera) when a part has features underneath, as chosen otherwise', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
    expect(flipOf(a, parts)).toBe('off');
    const under = parts.map(p => (p.id === 'left' ? { ...p, needsFlip: true } : p));
    expect(flipOf(a, under)).toBe('camera');
    expect(flipOf({ ...a, flip: 'off' }, under)).toBe('off');
    expect(flipOf({ ...a, flip: 'dowels' }, under)).toBe('dowels');
  });

  describe('changing the bit', () => {
    // Two 560 x 140 sides on a 600 x 300 stock board: they fit with the 1/8" bit's spacing, not with the 6 mm one's.
    const sides = parts.slice(0, 2);
    const stock: BoardV1 = {
      ...reconcileBoards(undefined, sides, 'oak')[0],
      holdDown: 'fixture-tape',
      size: { fit: false, w: 600, h: 300 },
    };
    const job = (board: BoardV1, bit: number) => {
      const nest = nestBoard(board, sides, bit);
      return [{ board, nest, request: {} as never }];
    };

    it('names the parts that no longer fit', () => {
      expect(missingParts(job(stock, 3.175), sides)).toEqual([]);
      expect(missingParts(job(stock, 6), sides)).toEqual([{ id: 'right', name: 'right', board: 'A' }]);
    });

    it('keeps the nest when the spacing is frozen at the old bit, and says when it gets too tight', () => {
      const [frozen] = freezeSpacing([stock], 3.175);
      expect([frozen.margin, frozen.gap]).toEqual([5.2, 8]);
      expect(missingParts(job(frozen, 6), sides)).toEqual([]);
      expect(spacingProblem(frozen, nestBoard(frozen, sides, 6), 6)).toBeNull();
      expect(spacingProblem(frozen, nestBoard(frozen, sides, 8), 8)).toMatch(/8 mm gap between parts is too narrow for the ⌀8 bit/);
      // Values the user set stay.
      expect(freezeSpacing([{ ...stock, gap: 12 }], 3.175)[0].gap).toBe(12);
    });

    it('an edge margin narrower than the bit is a note, not a problem: the cut runs past the edge, into air', () => {
      const edge: BoardV1 = { ...stock, margin: 2, gap: 8, frame: false, boardHold: 'points', holdDown: 'tabs' };
      const nest = nestBoard(edge, sides, 6);
      expect(nest.margin).toBe(2);
      expect(spacingProblem(edge, nest, 6)).toBeNull();
      // Screwed or clamped down: they must stay clear (the hold check blocks the job if the bit would hit one).
      expect(edgeNote(edge, nest, 6)).toBe(
        'Board A: the outline cuts run past the board edge (2 mm margin, ⌀6 bit). Keep screws and clamps clear of it: the job is blocked if the bit would hit one.'
      );
      expect(edgeNote({ ...edge, boardHold: 'tape' }, nest, 6)).toBe(
        'Board A: the outline cuts run past the board edge (2 mm margin, ⌀6 bit). Fine if nothing is clamped or screwed there.'
      );
      expect(edgeNote(edge, nest, 2)).toBeNull();
      // The frame (the default) would leave no room for both sides on this 600 x 300 board: it's left off, and said so.
      expect(nestBoard({ ...edge, frame: undefined }, sides, 6)).toMatchObject({ frame: 'no-room', margin: 2 });
    });
  });

  describe('placing parts by hand', () => {
    const bit = 3.175;

    it('re-lay out: the parts stay on the board, unpinned, nested like a fresh board', () => {
      const fresh = { ...newBoard([], 8, 'oak', ['left', 'right']), size: { fit: false as const, w: 1220, h: 610 } };
      const placed: BoardV1 = { ...fresh, pinned: ['left'], positions: { left: { x: 600, y: 300, rotated: false } } };
      const again = relayoutBoard(placed);
      expect(again.items).toEqual(['left', 'right']);
      expect(again.pinned).toBeUndefined();
      expect(again.positions).toBeUndefined();
      expect(nestBoard(again, parts, bit).placements).toEqual(nestBoard(fresh, parts, bit).placements);
      expect(nestBoard(placed, parts, bit).placements).not.toEqual(nestBoard(fresh, parts, bit).placements);
    });
    const sheet = (items: string[], w = 1220, h = 610): BoardV1 => ({
      ...newBoard([], 8, 'oak', items),
      size: { fit: false, w, h },
    });
    const rectOf = (n: ReturnType<typeof nestBoard>, id: string) => {
      const p = n.placements.find(x => x.id === id)!;
      const [w, h] = parts.find(i => i.id === id)!.size;
      return { x: p.x, y: p.y, w: p.rotated ? h : w, h: p.rotated ? w : h };
    };
    /** No two parts closer than the gap, all inside the margin. */
    const expectClear = (n: ReturnType<typeof nestBoard>) => {
      const rects = n.placements.map(p => rectOf(n, p.id));
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(n.margin - 1e-6);
        expect(r.y).toBeGreaterThanOrEqual(n.margin - 1e-6);
        expect(r.x + r.w).toBeLessThanOrEqual(n.board.w - n.margin + 1e-6);
        expect(r.y + r.h).toBeLessThanOrEqual(n.board.h - n.margin + 1e-6);
        for (const o of rects)
          if (o !== r)
            expect(
              r.x + r.w + n.gap <= o.x + 1e-6 ||
                o.x + o.w + n.gap <= r.x + 1e-6 ||
                r.y + r.h + n.gap <= o.y + 1e-6 ||
                o.y + o.h + n.gap <= r.y + 1e-6
            ).toBe(true);
      }
    };

    it('nests positioned parts first, at their spot, and the rest around them', () => {
      const board = { ...sheet(['left', 'right', 'top', 'bottom']), positions: { top: { x: 300, y: 200, rotated: false } } };
      const nest = nestBoard(board, parts, bit);
      expect(nest.unplaced).toEqual([]);
      expect(nest.placements.map(p => p.id)).toEqual(['left', 'right', 'top', 'bottom']);
      expect(nest.placements.find(p => p.id === 'top')).toEqual({ id: 'top', x: 300, y: 200, rotated: false });
      expectClear(nest);
      // A spot off the board (it got smaller) is ignored: the part is nested like the others.
      const off = nestBoard({ ...board, positions: { top: { x: 1000, y: 200, rotated: false } } }, parts, bit);
      expect(off.placements.find(p => p.id === 'top')!.x).not.toBe(1000);
      expectClear(off);
      // Two positioned parts on top of each other: the second one is nested.
      const clash = nestBoard(
        { ...board, positions: { left: { x: 100, y: 100, rotated: false }, right: { x: 120, y: 110, rotated: false } } },
        parts,
        bit
      );
      expect(clash.placements.find(p => p.id === 'left')).toMatchObject({ x: 100, y: 100 });
      expectClear(clash);
    });

    it('a fitted board grows to take in a positioned part', () => {
      const [a] = reconcileBoards(undefined, parts, 'oak');
      const nest = nestBoard({ ...a, positions: { left: { x: 700, y: 400, rotated: false } } }, parts, bit);
      expect(nest.placements.find(p => p.id === 'left')).toMatchObject({ x: 700, y: 400 });
      expect(nest.board.w).toBeGreaterThanOrEqual(700 + 560 + nest.margin);
      expect(nest.board.h).toBeGreaterThanOrEqual(400 + 140 + nest.margin);
      expect(nest.unplaced).toEqual([]);
      expectClear(nest);
    });

    it('snaps a dropped part to where the nest puts it', () => {
      const board = sheet(['left', 'right']);
      const spot = nestBoard({ ...board, items: ['left', 'right', 'top'] }, parts, bit).placements.find(p => p.id === 'top')!;
      const drop = dropPart(board, parts, bit, 'top', { x: spot.x + 3, y: spot.y - 2, rotated: false }, 10);
      expect(drop.exact).toBe(false);
      expect(drop.at).toEqual({ x: spot.x, y: spot.y, rotated: false });
      expect(drop.board.items).toEqual(['left', 'right', 'top']);
      expect(drop.board.pinned).toEqual(['top']);
      expect(drop.board.positions?.top).toBeUndefined();
    });

    it('drops a part exactly where there is room, positioned and pinned', () => {
      const board = sheet(['left', 'right']);
      const drop = dropPart(board, parts, bit, 'top', { x: 700, y: 400, rotated: false }, 10);
      expect(drop).toMatchObject({ exact: true, at: { x: 700, y: 400, rotated: false } });
      expect(drop.board.positions).toEqual({ top: { x: 700, y: 400, rotated: false } });
      expect(drop.board.pinned).toEqual(['top']);
      const nest = nestBoard(drop.board, parts, bit);
      expect(nest.placements.find(p => p.id === 'top')).toMatchObject({ x: 700, y: 400 });
      expectClear(nest);

      // On another part, or past the margin: not there, it goes where the nest puts it.
      const left = nestBoard(board, parts, bit).placements.find(p => p.id === 'left')!;
      for (const at of [
        { x: left.x + 50, y: left.y + 20, rotated: false },
        { x: 1220 - 400 - 2, y: 300, rotated: false },
      ]) {
        const d = dropPart(board, parts, bit, 'top', at, 10);
        expect(d.exact).toBe(false);
        expect(d.at).not.toBeNull();
        expect(d.board.positions?.top).toBeUndefined();
      }
    });

    it('moves a part on its own board to a free spot, and back into the nest', () => {
      const board = sheet(['left', 'right', 'top']);
      const drop = dropPart(board, parts, bit, 'top', { x: 650, y: 420, rotated: false }, 10);
      expect(drop.exact).toBe(true);
      expect(drop.board.items).toEqual(['left', 'right', 'top']);
      expect(drop.board.pinned).toEqual(['top']);
      // Dropped close to the nest's spot again: the position goes.
      const spot = nestBoard(board, parts, bit).placements.find(p => p.id === 'top')!;
      const back = dropPart(drop.board, parts, bit, 'top', { x: spot.x + 1, y: spot.y + 1, rotated: false }, 10);
      expect(back.exact).toBe(false);
      expect(back.board.positions).toEqual({});
    });

    it('rejects a part that fits nowhere on the board', () => {
      // Two sides fill a 600 × 400 board: no room for the top shelf anywhere.
      const board = sheet(['left', 'right'], 600, 400);
      expect(nestBoard(board, parts, bit).unplaced).toEqual([]);
      for (const at of [
        { x: 100, y: 100, rotated: false },
        { x: 5.2, y: 250, rotated: false },
      ]) {
        const drop = dropPart(board, parts, bit, 'top', at, 10);
        expect(drop.at).toBeNull();
        expect(drop.board).toBe(board);
      }
    });

    it('auto-fill keeps the parts placed by hand at their spot and fills the room around them', () => {
      const [a, b] = reconcileBoards(undefined, parts, 'oak');
      const placed: BoardV1 = {
        ...sheet(['top']),
        name: 'C',
        pinned: ['top'],
        positions: { top: { x: 600, y: 300, rotated: false } },
      };
      const boards = [{ ...a, items: a.items.filter(id => id !== 'top') }, b, placed];
      const stock = [{ id: 's', thickness: 8, w: 1220, h: 610 }];
      const res = autoFillFromStock(boards, parts, stock, bit, 'oak');
      expectAllPlaced(res, parts, bit);
      const kept = res.boards.find(x => x.id === placed.id)!;
      expect(kept.positions).toEqual(placed.positions);
      expect(kept.items[0]).toBe('top');
      expect(kept.items.length).toBeGreaterThan(1);
      const nest = nestBoard(kept, parts, bit);
      expect(nest.placements.find(p => p.id === 'top')).toEqual({ id: 'top', x: 600, y: 300, rotated: false });
      expect(nest.unplaced).toEqual([]);
      expectClear(nest);
      // A position goes with its part when the part isn't milled any more.
      expect(
        reconcileBoards(
          boards,
          parts.filter(p => p.id !== 'top'),
          'oak'
        ).find(x => x.id === placed.id)!.positions
      ).toEqual({});
    });
  });
});

describe('a cut board', () => {
  it('keeps its layout and holds; its name, spot on the bed and what’s cut may change', () => {
    const b = { ...newBoard([], 18, 'oak', ['a']), cut: { at: 1, keys: ['x:bit:0'] } };
    expect(changesCutBoard(b, { ...b, name: 'Z', bed: { a: { x: 1, y: 1 } } })).toBe(false);
    expect(changesCutBoard(b, { ...b, items: [] })).toBe(true);
    expect(changesCutBoard(b, { ...b, holdPoints: [] })).toBe(true);
    expect(changesCutBoard(b, undefined)).toBe(true);
    expect(changesCutBoard({ ...b, cut: undefined }, { ...b, items: [] })).toBe(false);
  });
});
