import { describe, expect, it } from 'vitest';
import {
  autoFillFromStock,
  freezeSpacing,
  nestBoard,
  newBoard,
  reconcileBoards,
  spacingProblem,
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
      const board = { ...newBoard(out, t, 'oak', left), size: { fit: false as const, w: sheets[0].w, h: sheets[0].h } };
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

describe('boards', () => {
  it('starts with one fitted board per thickness, thickest first', () => {
    const boards = reconcileBoards(undefined, parts, 'oak');
    expect(boards.map(b => [b.name, b.thickness, b.items.length])).toEqual([
      ['A', 8, 5],
      ['B', 3, 1],
    ]);
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

    it('takes well under 200 ms for 30 parts', () => {
      const rnd = random(7);
      const instances = Array.from({ length: 30 }, (_, i) => inst(`p${i}`, Math.round(60 + rnd() * 500), Math.round(40 + rnd() * 300), 18));
      const stock = [
        { id: 'a', thickness: 18, w: 1220, h: 610 },
        { id: 'b', thickness: 18, w: 800, h: 600 },
        { id: 'c', thickness: 18, w: 600, h: 400 },
      ];
      const boards = reconcileBoards(undefined, instances, 'oak');
      autoFillFromStock(boards, instances, stock, bit, 'oak');
      const t0 = performance.now();
      const res = autoFillFromStock(boards, instances, stock, bit, 'oak');
      const ms = performance.now() - t0;
      console.info(`30 parts, 3 sheet sizes: ${ms.toFixed(0)} ms, ${res.boards.length} boards`);
      expectAllPlaced(res, instances, bit);
      expect(ms).toBeLessThan(200);
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

  it('fitted boards keep a small edge margin (bit + 2) and gap (bit + 4), both editable', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
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

  it('stock top: parts thickness + 0.3 unless measured', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
    expect(stockTopOf(a)).toBe(8.3);
    expect(stockTopOf({ ...a, measuredThickness: 8.12 })).toBe(8.12);
  });

  it('clamps only: parts stay clear of the clamp corners', () => {
    const [a] = reconcileBoards(undefined, parts, 'oak');
    const nest = nestBoard({ ...a, holdDown: 'clamps' }, parts, 3.175);
    expect(nest.unplaced).toEqual([]);
    expect(nest.keepOuts).toHaveLength(2);
    const size = new Map(parts.map(p => [p.id, p.size]));
    for (const p of nest.placements)
      for (const k of nest.keepOuts) {
        const [w, h] = size.get(p.id)!;
        const apart = p.x + w <= k.x || k.x + k.w <= p.x || p.y + h <= k.y || k.y + k.h <= p.y;
        expect(apart).toBe(true);
      }
  });

  describe('changing the bit', () => {
    // Two 560 x 140 sides on a 600 x 300 stock board: they fit with the 1/8" bit's spacing, not with the 6 mm one's.
    const sides = parts.slice(0, 2);
    const stock: BoardV1 = { ...reconcileBoards(undefined, sides, 'oak')[0], size: { fit: false, w: 600, h: 300 } };
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
  });
});
