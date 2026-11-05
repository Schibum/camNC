import { fixtureFree, type Fixture } from '@wbcnc/cam/settle';
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
  holdDownOf,
  holdPointOf,
  fixtureOf,
  layoutChange,
  nutAboveOf,
  respaceBoard,
  settleBoard,
  settleInputOf,
  suggestFixtures,
  withLayout,
  stockTopOf,
  type BoardV1,
  type PartInstance,
  type StockBoardV1,
  withinMachine,
  keepWithinMachine,
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

/** Stock used for the parts that fit: not the board the ones too big for every stock board are left on. */
const stockUsed = (res: ReturnType<typeof autoFillFromStock>) =>
  usage(res.boards.filter(b => !b.items.some(id => res.tooBig.includes(id))));

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
function expectAllPlaced(res: ReturnType<typeof autoFillFromStock>, instances: PartInstance[], bit: number, stock: StockBoardV1[]) {
  const on = res.boards.flatMap(b => b.items);
  expect([...on].sort()).toEqual(instances.map(i => i.id).sort());
  // No board bigger than the stock: every board is a stock size.
  for (const b of res.boards.filter(b => !b.pinned?.length && stock.some(s => s.thickness === b.thickness))) {
    const size = b.size;
    expect(!size.fit && stock.some(s => s.thickness === b.thickness && s.w === size.w && s.h === size.h)).toBe(true);
  }
  // All fit, but the ones too big for any stock board, which are on a board of their own.
  const tooBig = new Set(res.tooBig);
  for (const b of res.boards.filter(b => !b.items.some(id => tooBig.has(id)))) expect(nestBoard(b, instances, bit).unplaced).toEqual([]);
  for (const b of res.boards.filter(b => b.items.some(id => tooBig.has(id)))) {
    expect(b.items.every(id => tooBig.has(id))).toBe(true);
    expect(nestBoard(b, instances, bit).unplaced.sort()).toEqual([...b.items].sort());
  }
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
      expectAllPlaced(res, parts, bit, stock);
      expect(res.tooBig).toEqual(old.tooBig);
      console.info(
        `${objective} first, kinderregal, ${name}: greedy ${JSON.stringify(usage(old.boards))}, global ${JSON.stringify(usage(res.boards))}`
      );
      expect(notWorse(stockUsed(res), usage(old.boards), objective)).toBe(true);
    });

    it('fewest boards takes the full sheet where least wood takes offcuts', () => {
      // Offcuts the five 8 mm parts don't fit on together, even turned.
      const stock = [
        { id: 'f', thickness: 8, w: 2440, h: 1220 },
        { id: 'o', thickness: 8, w: 700, h: 500 },
        { id: 'p', thickness: 8, w: 600, h: 320 },
      ];
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
          expectAllPlaced(res, instances, bit, stock);
          // Greedy only tries the biggest sheet; a part may still fit a smaller one of another shape.
          for (const id of res.tooBig) expect(old.tooBig).toContain(id);
          if (res.tooBig.length < old.tooBig.length) continue;
          const [a, b] = [stockUsed(res), usage(old.boards)];
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
      expectAllPlaced(res, instances, bit, stock);
      expect(ms / reference).toBeLessThan(kNestRatio);
    });

    it('keeps parts moved by hand on their board and nests the rest', () => {
      const [a, b] = reconcileBoards(undefined, parts, 'oak');
      const pinnedBoard: BoardV1 = { ...newBoard([a, b], 8, 'oak', ['top']), pinned: ['top'] };
      const boards = [{ ...a, items: a.items.filter(id => id !== 'top') }, b, pinnedBoard];
      const stock = fixtures[1][1];
      const res = autoFillFromStock(boards, parts, stock, bit, 'oak');
      expectAllPlaced(res, parts, bit, stock);
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
      expectAllPlaced(res2, parts, bit, stock);
      const kept2 = res2.boards.find(x => x.id === pinnedBoard.id)!;
      expect(kept2.items[0]).toBe('top');
      expect(kept2.items.length).toBeGreaterThan(1);
      expect(nestBoard(kept2, parts, bit).unplaced).toEqual([]);
    });

    it('uses no more stock boards than there are; the rest goes on more boards of the stock size, to buy', () => {
      const stock = [{ id: 's', thickness: 8, w: 600, h: 400, quantity: 1 }];
      const res = autoFillFromStock(reconcileBoards(undefined, parts, 'oak'), parts, stock, bit, 'oak');
      expectAllPlaced(res, parts, bit, stock);
      expect(res.short.length).toBeGreaterThan(0);
      const on8 = res.boards.filter(b => b.thickness === 8);
      expect(on8.length).toBeGreaterThan(1);
      expect(
        on8
          .filter(b => b.items.some(id => res.short.includes(id)))
          .flatMap(b => b.items)
          .sort()
      ).toEqual([...res.short].sort());
    });

    it('never makes a board bigger than the stock: parts too big for it go on a stock-size board, reported', () => {
      // The eichenregal: long sides and shelves, oak 20.5 mm on 600 × 1200 boards.
      const shelf = [
        inst('top', 1250, 350, 20.5),
        inst('sockel', 1250, 60, 20.5),
        inst('left', 900, 350, 20.5),
        inst('right', 900, 350, 20.5),
        inst('boden', 615, 313, 20.5),
      ];
      const stock = [{ id: 's', thickness: 20.5, w: 600, h: 1200 }];
      const res = autoFillFromStock(reconcileBoards(undefined, shelf, 'oak'), shelf, stock, bit, 'oak');
      expect(res.tooBig.sort()).toEqual(['sockel', 'top']);
      expectAllPlaced(res, shelf, bit, stock);
      for (const b of res.boards) expect(b.size).toMatchObject({ fit: false, w: 600, h: 1200 });
      // The ones that fit turned 90° are on stock boards, turned.
      const left = res.boards.find(b => b.items.includes('left'))!;
      expect(nestBoard(left, shelf, bit).placements.find(p => p.id === 'left')!.rotated).toBe(true);
    });

    it('cuts stock bigger than the machine down to its work area', () => {
      const stock = [{ id: 'f', thickness: 8, w: 2440, h: 1220 }];
      const res = autoFillFromStock(reconcileBoards(undefined, parts, 'oak'), parts, stock, bit, 'oak', 'boards', { w: 600, h: 1200 });
      const on8 = res.boards.filter(b => b.thickness === 8);
      for (const b of on8) expect(b.size).toMatchObject({ fit: false, w: 600, h: 1200 });
      expect(res.tooBig).toEqual([]);
      expect(withinMachine({ w: 500, h: 1100 }, { w: 1200, h: 600 })).toEqual({ w: 500, h: 1100 });
    });

    it('reports parts bigger than every stock board', () => {
      const stock = [{ id: 's', thickness: 8, w: 500, h: 400 }];
      const res = autoFillFromStock(reconcileBoards(undefined, parts, 'oak'), parts, stock, bit, 'oak');
      expect(res.tooBig.sort()).toEqual(['left', 'right']);
      expectAllPlaced(res, parts, bit, stock);
    });
  });

  it('fitted boards keep a small edge margin (bit + 2) and gap (bit + 4), with tabs room for a strip that holds them; both editable', () => {
    const [tabs] = reconcileBoards(undefined, parts, 'oak');
    const withTabs = nestBoard(tabs, parts, 3.175);
    // 3.5 mm of stock left beside the cut at the edge, and between the cuts of two neighbours. No frame around them.
    expect([withTabs.margin, withTabs.gap]).toEqual([6.7, 10]);
    expect(withTabs.holds).toEqual([]);
    // Unset, the stick-out clears the deepest cut by 10 mm: the nut never starts out below the board.
    expect(nestBoard({ ...tabs, thickness: 20 }, parts, 3.175).stickout).toBe(31);
    expect(nestBoard({ ...tabs, thickness: 6 }, parts, 3.175).stickout).toBe(20);
    expect(nutAboveOf({ ...tabs, thickness: 20 })).toBeGreaterThan(9);
    expect(nutAboveOf(tabs, 45)).toBe(36.4);
    expect(nestBoard(tabs, parts, 3.175, { stickout: 45 })).toMatchObject({ stickout: 45, nutAbove: 36.4 });
    const a = { ...tabs, retention: 'skin' as const };
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
    const a = { ...reconcileBoards(undefined, parts, 'oak')[0], retention: 'skin' as const };
    for (const board of [a, { ...a, retention: 'none' as const }, { ...a, margin: 5.37, gap: 7.9 }]) {
      const nest = nestBoard(board, parts, 3.175);
      expect(Number.isInteger(nest.board.w) && Number.isInteger(nest.board.h)).toBe(true);
      expect(boardSizeLabel(board, nest)).toBe(`${nest.board.w} × ${nest.board.h}`);
    }
    // 570.4 × 738.9 before: 571 × 739.
    expect(nestBoard(a, parts, 3.175).board).toEqual({ w: 571, h: 739 });
    const empty = { ...a, items: [] };
    expect(boardSizeLabel(empty, nestBoard(empty, parts, 3.175))).toBe('–');
    // A fixed size stays as given, even empty.
    const sheet = { ...empty, size: { fit: false as const, w: 600.5, h: 300 } };
    expect(boardSizeLabel(sheet, nestBoard(sheet, parts, 3.175))).toBe('600.5 × 300');
  });

  describe('fitted boards on the machine', () => {
    const bit = 3.175;
    const a = { ...reconcileBoards(undefined, parts, 'oak')[0], retention: 'skin' as const };
    const fits = (b: { w: number; h: number }, m: { w: number; h: number }) => b.w <= m.w && b.h <= m.h;

    it('lie with the long side along the machine’s long axis', () => {
      // 571 × 739 on its own: fits a wide machine only turned, so it's nested lying along X; upright on a deep one.
      const wide = nestBoard(a, parts, bit, { machine: { w: 800, h: 600 } });
      expect(wide.board.w).toBeGreaterThan(wide.board.h);
      expect(fits(wide.board, { w: 800, h: 600 })).toBe(true);
      expect(wide.unplaced).toEqual([]);
      expect(nestBoard(a, parts, bit, { machine: { w: 600, h: 800 } }).board).toEqual({ w: 571, h: 739 });
      // The parts turned with it, nothing overlapping.
      expect(wide.placements.some(p => p.rotated)).toBe(true);
      expect(layoutRects(wide).every((r, i, all) => all.every((o, j) => i === j || apart(r, o)))).toBe(true);
    });

    it('never come out bigger than the machine: what doesn’t fit is left over', () => {
      const machine = { w: 600, h: 400 };
      const nest = nestBoard(a, parts, bit, { machine });
      expect(fits(nest.board, machine)).toBe(true);
      expect(nest.unplaced.length).toBeGreaterThan(0);
      expect(nest.placements.length + nest.unplaced.length).toBe(a.items.length);
      // A layout stored before the machine was known is nested again within it.
      const stored = withLayout(a, nestBoard(a, parts, bit));
      expect(fits(nestBoard(stored, parts, bit, { machine }).board, machine)).toBe(true);
      // Except where a part placed by hand sits, when that's on the machine.
      const top = stored.layout!.at.top;
      const pinned = {
        ...stored,
        pinned: ['top'],
        layout: { ...stored.layout!, at: { ...stored.layout!.at, top: { x: 100, y: 100, rotated: top.rotated } } },
      };
      const again = nestBoard(pinned, parts, bit, { machine });
      expect(again.placements.find(p => p.id === 'top')).toMatchObject({ x: 100, y: 100, rotated: top.rotated });
      expect(fits(again.board, machine)).toBe(true);
    });

    it('parts that don’t fit move onto another board, made as needed', () => {
      const machine = { w: 600, h: 400 };
      const boards = reconcileBoards(undefined, parts, 'oak').map(b => ({ ...b, retention: 'skin' as const }));
      const out = keepWithinMachine(boards, parts, bit, { machine });
      const eight = out.filter(b => b.thickness === 8);
      expect(eight.length).toBeGreaterThan(1);
      expect(eight.flatMap(b => b.items).sort()).toEqual(boards[0].items.sort());
      for (const b of eight) {
        const nest = nestBoard(b, parts, bit, { machine });
        expect(nest.unplaced).toEqual([]);
        expect(fits(nest.board, machine)).toBe(true);
        expect(b.retention).toBe('skin');
      }
      expect(new Set(out.map(b => b.name)).size).toBe(out.length);
      // The same boards every time (same ids), and nothing more to move once they fit.
      expect(keepWithinMachine(boards, parts, bit, { machine }).map(b => b.id)).toEqual(out.map(b => b.id));
      expect(keepWithinMachine(out, parts, bit, { machine })).toEqual(out);
    });

    it('a part too big for the machine on its own stays where it is', () => {
      const huge = [inst('huge', 900, 300, 8)];
      const boards = reconcileBoards(undefined, huge, 'oak');
      expect(keepWithinMachine(boards, huge, bit, { machine: { w: 600, h: 400 } })).toEqual(boards);
      expect(nestBoard(boards[0], huge, bit, { machine: { w: 600, h: 400 } }).unplaced).toEqual(['huge']);
    });

    it('cut and fixed-size boards are left alone; without a machine nothing changes', () => {
      const boards = reconcileBoards(undefined, parts, 'oak');
      const cut = boards.map(b => ({ ...withLayout(b, nestBoard(b, parts, bit)), cut: { at: 1, keys: ['x'] } }));
      expect(keepWithinMachine(cut, parts, bit, { machine: { w: 600, h: 400 } })).toEqual(cut);
      expect(keepWithinMachine(boards, parts, bit, {})).toEqual(boards);
    });

    function layoutRects(n: { placements: { id: string; x: number; y: number; rotated: boolean }[] }) {
      return n.placements.map(p => {
        const i = parts.find(x => x.id === p.id)!;
        const [w, h] = p.rotated ? [i.size[1], i.size[0]] : [i.size[0], i.size[1]];
        return { x: p.x, y: p.y, w, h };
      });
    }
    const apart = (r: { x: number; y: number; w: number; h: number }, o: typeof r) =>
      r.x + r.w <= o.x + 1e-6 || o.x + o.w <= r.x + 1e-6 || r.y + r.h <= o.y + 1e-6 || o.y + o.h <= r.y + 1e-6;
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

  describe('parts first, fixtures second', () => {
    const bit = 3.175;
    const clamp = (side: 'left' | 'right' | 'bottom' | 'top', at: number): Fixture => ({ kind: 'clamp', side, at });
    const stored = () => {
      const [a] = reconcileBoards(undefined, parts, 'oak');
      return withLayout(a, nestBoard(a, parts, bit));
    };

    it('a board has no fixtures until they are placed: the parts nest tight, and tape or nothing is fine', () => {
      const [a] = reconcileBoards(undefined, parts, 'oak');
      const nest = nestBoard(a, parts, bit);
      expect(nest.holds).toEqual([]);
      expect(boardRequest(a, nest, parts).holdPoints).toEqual([]);
      expect(boardRequest({ ...a, taped: true }, nest, parts)).toMatchObject({ taped: true, holdPoints: [], holdDown: 'tabs' });
    });

    it('a stored layout stays as it is: nothing moves on a reload, a new part only takes free room', () => {
      const board = stored();
      const nest = nestBoard(board, parts, bit);
      expect(withLayout(board, nest)).toEqual(board);
      const at = board.layout!.at;
      const without = {
        ...board,
        items: board.items.slice(0, -1),
        layout: { ...board.layout!, at: Object.fromEntries(Object.entries(at).slice(0, -1)) },
      };
      const back = nestBoard({ ...without, items: board.items }, parts, bit);
      for (const p of back.placements.slice(0, -1)) expect(p).toMatchObject(at[p.id]);
      expect(back.unplaced).toEqual([]);
    });

    it('placing a clamp moves only the parts in its way; the board stays, and the clamp stays where it was dropped', () => {
      const board = stored();
      const before = nestBoard(board, parts, bit);
      const top = before.placements.reduce((a, b) => (b.y > a.y ? b : a));
      const settled = settleBoard(board, parts, bit, [clamp('right', top.y + 50)])!;
      const after = nestBoard(settled, parts, bit);
      expect(after.holds).toHaveLength(1);
      expect(after.holds[0]).toMatchObject({ kind: 'clamp', y: top.y + 50 });
      expect(after.board.h).toBe(before.board.h);
      // Fixing it there doesn't change on the next read.
      expect(withLayout(settled, nestBoard(settled, parts, bit)).layout).toEqual(settled.layout);
    });

    it('a fixed board refuses what has no room; a fitted one grows', () => {
      const board = stored();
      const nest = nestBoard(board, parts, bit);
      const fixed = { ...board, size: { fit: false as const, ...nest.board } };
      const middle = clamp('bottom', Math.round(nest.board.w / 2));
      expect(settleBoard(fixed, parts, bit, [middle])).toBeNull();
      const grown = nestBoard(settleBoard(board, parts, bit, [middle])!, parts, bit);
      expect(grown.board.h).toBeGreaterThan(nest.board.h);
      expect(layoutChange(nest, grown, parts)).toMatch(/Board grows to/);
    });

    it('fixtures carry their hardware; clamps grip their edge, also after a board size change', () => {
      const hw = { clamp: { d: 2, w: 20, height: 30 }, screw: { d: 8, height: 4 } };
      expect(holdPointOf(clamp('right', 100), { w: 500, h: 300 }, hw, 9)).toMatchObject({
        kind: 'clamp',
        x: 499,
        y: 100,
        d: 2,
        w: 20,
        height: 30,
        dir: { x: -1, y: 0 },
        nutAbove: 9,
      });
      expect(holdPointOf(clamp('top', 100), { w: 500, h: 300 }, hw, 9)).toMatchObject({ x: 100, y: 299, dir: { x: 0, y: -1 } });
      expect(holdPointOf({ kind: 'screw', x: 3, y: 4 }, { w: 500, h: 300 }, hw, 9)).toMatchObject({
        kind: 'screw',
        x: 3,
        y: 4,
        d: 8,
        height: 4,
      });
      expect(fixtureOf(holdPointOf(clamp('left', 50), { w: 500, h: 300 }, hw, 9))).toEqual(clamp('left', 50));
      expect(fixtureOf(holdPointOf({ kind: 'screw', x: 3, y: 4 }, { w: 500, h: 300 }, hw, 9))).toEqual({ kind: 'screw', x: 3, y: 4 });
    });

    it('a taller clamp keeps the parts farther: room for the collet nut', () => {
      const board = stored();
      const nest = nestBoard(board, parts, bit);
      const top = nest.placements.reduce((a, b) => (b.y > a.y ? b : a));
      const low = settleBoard(board, parts, bit, [clamp('left', top.y + 50)])!;
      const tall = settleBoard(board, parts, bit, [clamp('left', top.y + 50)], {
        hardware: { clamp: { d: 3, w: 24, height: 30 }, screw: { d: 10, height: 3 } },
      })!;
      expect(tall.layout!.at[top.id].x).toBeGreaterThan(low.layout!.at[top.id].x);
    });

    it('suggested clamps surround the board without growing it, and can be moved like any other', () => {
      const board = stored();
      const nest = nestBoard(board, parts, bit);
      const next = suggestFixtures(board, parts, bit);
      expect(next.fixtures!.length).toBeGreaterThanOrEqual(3);
      expect(nestBoard(next, parts, bit).board).toEqual(nest.board);
    });

    describe('suggested clamps on a board with no room', () => {
      // The back alone: it fills its fitted board, margin all round.
      const back = () => {
        const b = { ...newBoard([], 3, 'oak', ['back']), retention: 'skin' as const };
        return withLayout(b, nestBoard(b, parts, bit));
      };
      const spot = (b: BoardV1) => b.layout!.at.back;

      it('a fitted board gets a border, with the parts shifted and the XY zero at its lower left', () => {
        const board = back();
        const next = suggestFixtures(board, parts, bit);
        const grew = next.layout!.w - board.layout!.w;
        expect(grew).toBeGreaterThan(0);
        expect(next.layout!.h - board.layout!.h).toBe(grew);
        expect(spot(next)).toEqual({ ...spot(board), x: spot(board).x + grew / 2, y: spot(board).y + grew / 2 });
        expect(next.fixtures!.length).toBeGreaterThanOrEqual(3);
        // As stored, so it's what the board is from now on, also for the program.
        const nest = nestBoard(next, parts, bit);
        expect(nest.board).toEqual({ w: next.layout!.w, h: next.layout!.h });
        expect(nest.placements[0]).toMatchObject({ x: spot(next).x, y: spot(next).y });
        expect(next.size).toEqual({ fit: true });
      });

      it('a fixed board stays its size', () => {
        const board = back();
        const fixed = { ...board, size: { fit: false as const, w: board.layout!.w, h: board.layout!.h } };
        const next = suggestFixtures(fixed, parts, bit);
        expect(next.layout).toEqual(fixed.layout);
        expect(next.fixtures).toEqual([]);
      });

      it('holds there already move with the part', () => {
        const board = back();
        const held = { ...board, fixtures: [clamp('right', 100), { kind: 'screw' as const, x: 200, y: 200 }] };
        const next = suggestFixtures(held, parts, bit);
        const d = spot(next).x - spot(board).x;
        expect(d).toBeGreaterThan(0);
        expect(next.fixtures!.slice(0, 2)).toEqual([clamp('right', 100 + d), { kind: 'screw', x: 200 + d, y: 200 + d }]);
      });

      it('stays inside the machine', () => {
        const board = back();
        const next = suggestFixtures(board, parts, bit, { machine: { w: board.layout!.w + 2, h: board.layout!.h + 2 } });
        expect(next.layout).toEqual(board.layout);
        expect(next.fixtures).toEqual([]);
      });

      it('Tighten layout after the border stays valid, the holds still on the board', () => {
        const next = suggestFixtures(back(), parts, bit);
        const again = relayoutBoard(next, parts, bit);
        expect(again.fixtures).toEqual(next.fixtures);
        const nest = nestBoard(again, parts, bit);
        expect(nest.unplaced).toEqual([]);
        const [p] = nest.placements;
        expect(p.x).toBeGreaterThanOrEqual(nest.margin - 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(nest.margin - 1e-6);
        expect(p.x + 400).toBeLessThanOrEqual(nest.board.w - nest.margin + 1e-6);
        expect(p.y + 380).toBeLessThanOrEqual(nest.board.h - nest.margin + 1e-6);
        const { input, spots } = settleInputOf(again, nest, parts, bit);
        for (const f of again.fixtures!) expect(fixtureFree(input, spots, f)).toBe(true);
        // Suggesting again finds it held: no second border.
        expect(suggestFixtures(again, parts, bit).layout).toEqual(again.layout);
      });
    });

    it('a wider margin moves only what it has to; back to "fit" lays it out again', () => {
      const board = stored();
      const wider = respaceBoard(board, { ...board, margin: 12 }, parts, bit);
      expect(Object.values(wider.layout!.at).every(p => p.x >= 12 && p.y >= 12)).toBe(true);
      const nest = nestBoard(board, parts, bit);
      const sheet = { ...board, size: { fit: false as const, w: nest.board.w + 200, h: nest.board.h } };
      expect(respaceBoard(board, sheet, parts, bit).layout).toMatchObject({ w: nest.board.w + 200, at: board.layout!.at });
      const back = respaceBoard(sheet, { ...sheet, size: { fit: true } }, parts, bit);
      expect(back.layout!.w).toBe(nest.board.w);
    });

    it('a board saved without a retention gets tabs, never parts cut loose', () => {
      const [a] = reconcileBoards(undefined, parts, 'oak');
      const old = { ...a, retention: undefined } as unknown as BoardV1;
      expect(reconcileBoards([old], parts, 'oak')[0].retention).toBe('tabs');
      expect(holdDownOf(old)).toBe('tabs');
      expect(holdDownOf({ retention: 'none' })).toBe('none');
      expect(holdDownOf({ retention: 'skin', taped: true })).toBe('fixture-tape');
      expect(holdDownOf({ retention: 'tabs', guidedTabs: true })).toBe('tabs-guided');
    });

    it('a cut board stays as cut: another bit moves nothing, and with no part left it stays cut', () => {
      const cut = { ...stored(), cut: { at: 1, keys: ['x'] } };
      const before = nestBoard(cut, parts, bit).placements;
      expect(nestBoard(cut, parts, 10).placements).toEqual(before);
      const empty = { ...cut, items: [] };
      const kept = withLayout(empty, nestBoard(empty, parts, bit));
      expect(reconcileBoards([kept], [], 'oak')[0].cut).toEqual(cut.cut);
    });

    it('tightening keeps fixtures on the board; a smaller fixed size slides clamps along and drops screws off it', () => {
      const board = stored();
      const far: BoardV1 = {
        ...board,
        layout: { ...board.layout!, w: 1000, h: 1000 },
        fixtures: [clamp('left', 900), clamp('bottom', 800), { kind: 'screw', x: 950, y: 950 }],
      };
      const tight = relayoutBoard(far, parts, bit);
      expect(tight.layout!.h).toBeGreaterThanOrEqual(912);
      expect(tight.layout!.w).toBeGreaterThanOrEqual(812);
      const smaller = { ...far, size: { fit: false as const, w: 700, h: 800 } };
      expect(respaceBoard(far, smaller, parts, bit).fixtures).toEqual([clamp('left', 788), clamp('bottom', 688)]);
    });

    it('a fitted board growing for a new part keeps it off a screw', () => {
      const [a] = reconcileBoards(undefined, parts, 'oak');
      const few = { ...a, items: a.items.slice(0, 1) };
      const placed = { ...withLayout(few, nestBoard(few, parts, bit)), items: a.items };
      const screw = { kind: 'screw' as const, x: 300, y: placed.layout!.h + 60 };
      const nest = nestBoard({ ...placed, fixtures: [screw] }, parts, bit);
      for (const p of nest.placements) {
        const [w, h] = parts.find(i => i.id === p.id)!.size;
        expect(screw.x > p.x && screw.x < p.x + w && screw.y > p.y && screw.y < p.y + h).toBe(false);
      }
    });

    it('re-lay out keeps fixtures, moving the parts only as far as they need', () => {
      const board = stored();
      const nest = nestBoard(board, parts, bit);
      const top = nest.placements.reduce((a, b) => (b.y > a.y ? b : a));
      const placed = settleBoard(board, parts, bit, [clamp('left', top.y + 50)])!;
      const again = relayoutBoard({ ...placed, pinned: ['left'] }, parts, bit);
      expect(again.fixtures).toEqual(placed.fixtures);
      expect(again.pinned).toBeUndefined();
      expect(nestBoard(again, parts, bit).unplaced).toEqual([]);
    });
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
      retention: 'skin',
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
      const edge: BoardV1 = { ...stock, margin: 2, gap: 8, retention: 'tabs', fixtures: [{ kind: 'clamp', side: 'right', at: 150 }] };
      const nest = nestBoard(edge, sides, 6);
      expect(nest.margin).toBe(2);
      expect(spacingProblem(edge, nest, 6)).toBeNull();
      // Screwed or clamped down: they must stay clear (the hold check blocks the job if the bit would hit one).
      expect(edgeNote(edge, nest, 6)).toBe(
        'Board A: the outline cuts run past the board edge (2 mm margin, ⌀6 bit). Keep screws and clamps clear of it: the job is blocked if the bit would hit one.'
      );
      expect(edgeNote({ ...edge, fixtures: [] }, nest, 6)).toBe(
        'Board A: the outline cuts run past the board edge (2 mm margin, ⌀6 bit). Fine if nothing is clamped or screwed there.'
      );
      expect(edgeNote(edge, nest, 2)).toBeNull();
    });
  });

  describe('placing parts by hand', () => {
    const bit = 3.175;

    it('re-lay out: the parts stay on the board, unpinned, nested like a fresh board', () => {
      const fresh = { ...newBoard([], 8, 'oak', ['left', 'right']), size: { fit: false as const, w: 1220, h: 610 } };
      const placed: BoardV1 = { ...fresh, pinned: ['left'], layout: { w: 1220, h: 610, at: { left: { x: 600, y: 300, rotated: false } } } };
      const again = relayoutBoard(placed, parts, bit);
      expect(again.items).toEqual(['left', 'right']);
      expect(again.pinned).toBeUndefined();
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
      const spots = (at: Record<string, { x: number; y: number; rotated: boolean }>) => ({ layout: { w: 1220, h: 610, at } });
      const board = { ...sheet(['left', 'right', 'top', 'bottom']), ...spots({ top: { x: 300, y: 200, rotated: false } }) };
      const nest = nestBoard(board, parts, bit);
      expect(nest.unplaced).toEqual([]);
      expect(nest.placements.map(p => p.id)).toEqual(['left', 'right', 'top', 'bottom']);
      expect(nest.placements.find(p => p.id === 'top')).toEqual({ id: 'top', x: 300, y: 200, rotated: false });
      expectClear(nest);
      // A spot off the board (it got smaller) is ignored: the part is nested like the others.
      const off = nestBoard({ ...board, ...spots({ top: { x: 1000, y: 200, rotated: false } }) }, parts, bit);
      expect(off.placements.find(p => p.id === 'top')!.x).not.toBe(1000);
      expectClear(off);
      // Two positioned parts on top of each other: the second one is nested.
      const clash = nestBoard(
        { ...board, ...spots({ left: { x: 100, y: 100, rotated: false }, right: { x: 120, y: 110, rotated: false } }) },
        parts,
        bit
      );
      expect(clash.placements.find(p => p.id === 'left')).toMatchObject({ x: 100, y: 100 });
      expectClear(clash);
    });

    it('a fitted board grows for a part with no room left, and keeps its other parts where they are', () => {
      const [a] = reconcileBoards(undefined, parts, 'oak');
      const small = { ...a, items: a.items.slice(0, 2) };
      const placed = withLayout(small, nestBoard(small, parts, bit));
      const nest = nestBoard({ ...placed, items: a.items }, parts, bit);
      for (const id of small.items) expect(nest.placements.find(p => p.id === id)).toMatchObject(placed.layout!.at[id]);
      expect(nest.unplaced).toEqual([]);
      expect(nest.board.h).toBeGreaterThanOrEqual(placed.layout!.h);
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
      expect(drop.board.layout!.at.top).toEqual(drop.at);
    });

    it('drops a part exactly where there is room, positioned and pinned', () => {
      const board = sheet(['left', 'right']);
      const drop = dropPart(board, parts, bit, 'top', { x: 700, y: 400, rotated: false }, 10);
      expect(drop).toMatchObject({ exact: true, at: { x: 700, y: 400, rotated: false } });
      expect(drop.board.layout!.at.top).toEqual({ x: 700, y: 400, rotated: false });
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
        expect(d.board.layout!.at.top).toEqual(d.at);
      }
    });

    it('moves a part on its own board to a free spot, and back into the nest', () => {
      const board = sheet(['left', 'right', 'top']);
      const drop = dropPart(board, parts, bit, 'top', { x: 650, y: 420, rotated: false }, 10);
      expect(drop.exact).toBe(true);
      expect(drop.board.items).toEqual(['left', 'right', 'top']);
      expect(drop.board.pinned).toEqual(['top']);
      expect(nestBoard(drop.board, parts, bit).placements.find(p => p.id === 'top')).toMatchObject({ x: 650, y: 420 });
    });

    it('turns a dropped part 90° when it only fits that way', () => {
      const wide = [...parts, inst('boden', 615, 313, 8)];
      const board = sheet([], 600, 1200);
      const drop = dropPart(board, wide, bit, 'boden', { x: 100, y: 100, rotated: false }, 10);
      expect(drop.at).toMatchObject({ rotated: true });
      expect(nestBoard(drop.board, wide, bit).unplaced).toEqual([]);
      // Parts that fit as they are keep their grain direction.
      const upright = dropPart(board, wide, bit, 'left', { x: 100, y: 100, rotated: false }, 10);
      expect(upright.at).toMatchObject({ rotated: false });
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
        layout: { w: 1220, h: 610, at: { top: { x: 600, y: 300, rotated: false } } },
      };
      const boards = [{ ...a, items: a.items.filter(id => id !== 'top') }, b, placed];
      const stock = [{ id: 's', thickness: 8, w: 1220, h: 610 }];
      const res = autoFillFromStock(boards, parts, stock, bit, 'oak');
      expectAllPlaced(res, parts, bit, stock);
      const kept = res.boards.find(x => x.id === placed.id)!;
      expect(kept.layout!.at.top).toEqual(placed.layout!.at.top);
      expect(kept.items[0]).toBe('top');
      expect(kept.items.length).toBeGreaterThan(1);
      const nest = nestBoard(kept, parts, bit);
      expect(nest.placements.find(p => p.id === 'top')).toEqual({ id: 'top', x: 600, y: 300, rotated: false });
      expect(nest.unplaced).toEqual([]);
      expectClear(nest);
      // A spot goes with its part when the part isn't milled any more.
      expect(
        reconcileBoards(
          boards,
          parts.filter(p => p.id !== 'top'),
          'oak'
        ).find(x => x.id === placed.id)!.layout!.at
      ).toEqual({});
    });
  });
});

describe('a cut board', () => {
  it('keeps its layout and holds; its name, spot on the bed and what’s cut may change', () => {
    const b = { ...newBoard([], 18, 'oak', ['a']), cut: { at: 1, keys: ['x:bit:0'] } };
    expect(changesCutBoard(b, { ...b, name: 'Z', bed: { a: { x: 1, y: 1 } } })).toBe(false);
    expect(changesCutBoard(b, { ...b, items: [] })).toBe(true);
    expect(changesCutBoard(b, { ...b, fixtures: [] })).toBe(true);
    expect(changesCutBoard(b, undefined)).toBe(true);
    expect(changesCutBoard({ ...b, cut: undefined }, { ...b, items: [] })).toBe(false);
  });
});
