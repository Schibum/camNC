import { describe, expect, it } from 'vitest';
import boards from '../test/fixtures/settle-boards.json';
import {
  clampPlay,
  edgeBands,
  fixturesAround,
  fixtureFree,
  largestOffcut,
  settle,
  snapScrew,
  suggestHolds,
  suggestHoldsGrowing,
  surrounds,
  type Fixture,
  type SettleBoard,
  type Spots,
} from './settle';

type Sample = {
  w: number;
  h: number;
  gap: number;
  parts: { id: string; name: string; x: number; y: number; w: number; h: number; loops: [number, number][][] }[];
};

const sample = (key: keyof typeof boards) => {
  const s = boards[key] as unknown as Sample;
  const b: SettleBoard = {
    w: s.w,
    h: s.h,
    gap: s.gap,
    margin: 7,
    parts: s.parts.map(p => ({ id: p.name, w: p.w, h: p.h, outer: p.loops.slice(0, 1), holes: p.loops.slice(1) })),
    sizes: { clampReach: 3, clampWidth: 24, screwD: 10 },
    keep: { clamp: 7.5, screw: 7.5 },
  };
  const spots: Spots = Object.fromEntries(s.parts.map(p => [p.name, { x: p.x, y: p.y }]));
  return { b, spots };
};
const clamp = (side: 'left' | 'right' | 'bottom' | 'top', at: number): Fixture => ({ kind: 'clamp', side, at });
const moved = (from: Spots, to: Spots) => Object.keys(from).filter(id => Math.hypot(from[id].x - to[id].x, from[id].y - to[id].y) > 0.5);

// Both boards from the sample models the user corrected the search on, with their real outlines.
describe('settle', () => {
  it('slides the shelf’s upper stack right together, at no cost in board size', () => {
    const { b, spots } = sample('kinderregal-standing');
    const r = settle(b, spots, [clamp('left', 380)], false)!;
    expect(moved(spots, r.spots).sort()).toEqual(['Part 1', 'Part 2', 'Part 3']);
    for (const id of ['Part 1', 'Part 2', 'Part 3']) expect(r.spots[id].x - spots[id].x).toBe(15);
    expect([r.w, r.h]).toEqual([574, 751]);
  });

  it('moves nothing when the clamp clears the real outline, in a part’s bounding box', () => {
    const { b, spots } = sample('kinderregal-standing');
    // Into the cut-outs of the two long parts: inside their rectangles, clear of their outlines.
    const r = settle(b, spots, [clamp('right', 227), clamp('left', 77)], false)!;
    expect(moved(spots, r.spots)).toEqual([]);
  });

  it('keeps vert2 with the left cluster and the offcut in one piece, and leaves Part 7 beside Part 9', () => {
    const { b, spots } = sample('besteckkasten');
    const before = largestOffcut(b, spots, [])!;
    const r = settle(b, spots, [clamp('left', 210), clamp('left', 365), clamp('right', 110), clamp('right', 405)], false)!;
    expect(moved(spots, r.spots).sort()).toEqual(['Part 5', 'Part 6', 'top split 1', 'vert2']);
    expect(r.spots['vert2'].x - spots['vert2'].x).toBe(15);
    const after = largestOffcut(b, r.spots, [])!;
    expect(after.w * after.h).toBeGreaterThanOrEqual(0.85 * before.w * before.h);
  });

  it('refuses a clamp with no room on a fixed board, and grows a fitted one', () => {
    const { b, spots } = sample('kinderregal-standing');
    expect(settle(b, spots, [clamp('bottom', 287)], false)).toBeNull();
    const grown = settle(b, spots, [clamp('bottom', 287)], true)!;
    expect(grown.w).toBe(574);
    expect(grown.h).toBeGreaterThan(751);
    expect(grown.h).toBeLessThan(770);
  });

  it('keeps the XY zero’s corner clear, and fixtures on the board', () => {
    const { b, spots } = sample('kinderregal-standing');
    expect(settle(b, spots, [clamp('left', 15)], true)).toBeNull();
    expect(settle(b, spots, [{ kind: 'screw', x: -20, y: 300 }], true)).toBeNull();
    expect(settle(b, spots, [{ kind: 'screw', x: 2, y: 300 }], true)).toBeNull();
  });

  it('makes parts fit a wider gap and margin, moving as little as it can', () => {
    const { b, spots } = sample('besteckkasten');
    const r = settle({ ...b, margin: 9 }, spots, [], true)!;
    expect(Object.values(r.spots).every(p => p.x >= 9 && p.y >= 9)).toBe(true);
    expect(r.w).toBeGreaterThanOrEqual(604);
  });

  it('runs fast enough for a pointer on real outlines', () => {
    const { b, spots } = sample('kinderregal-standing');
    const t = performance.now();
    for (let at = 40; at < 700; at += 60) settle(b, spots, [clamp('left', at), clamp('right', 700 - at)], false, 80);
    expect((performance.now() - t) / 11).toBeLessThan(120);
  });
});

describe('forgiving placement', () => {
  it('lands a screw in the middle of the curve', () => {
    const { b, spots } = sample('kinderregal-standing');
    const s = snapScrew(b, spots, 30, 52);
    expect(s.y).toBeGreaterThan(65);
    expect(s.y).toBeLessThan(85);
    expect(s.x).toBeGreaterThan(30);
    expect(fixtureFree(b, spots, { kind: 'screw', ...s })).toBe(true);
  });

  it('leaves a screw on a part where it is', () => {
    const { b, spots } = sample('kinderregal-standing');
    expect(snapScrew(b, spots, 300, 80)).toEqual({ x: 300, y: 80 });
  });

  it('says how far a clamp can slide', () => {
    const { b, spots } = sample('kinderregal-standing');
    const { lo, hi } = clampPlay(b, spots, { kind: 'clamp', side: 'right', at: 500 });
    expect([lo, hi]).toEqual([440, 560]);
  });

  it('shows where clamps fit along the edges', () => {
    const { b, spots } = sample('kinderregal-standing');
    const bands = edgeBands(b, spots, []);
    expect(bands.find(x => x.side === 'right' && Math.abs(x.at - 500) < 20)?.fit).toBe('free');
    expect(bands.find(x => x.side === 'left' && Math.abs(x.at - 380) < 20)?.fit).toBe('moves');
    expect(bands.find(x => x.side === 'bottom' && Math.abs(x.at - 287) < 20)?.fit).toBe('none');
  });
});

describe('suggestHolds', () => {
  it('surrounds the shelf’s middle, at the same board size, with its stack still lined up', () => {
    const { b, spots } = sample('kinderregal-standing');
    const r = suggestHolds(b, spots, []);
    expect(r.fixtures.length).toBeGreaterThanOrEqual(3);
    expect(fixturesAround(b, r.fixtures)).toBe(true);
    for (const f of r.fixtures) expect(fixtureFree(b, r.spots, f)).toBe(true);
    const upper = ['Part 1', 'Part 2', 'Part 3'].map(id => r.spots[id].x);
    expect(new Set(upper).size).toBe(1);
  });

  it('keeps vert2 left on the cutlery box', () => {
    const { b, spots } = sample('besteckkasten');
    const r = suggestHolds(b, spots, []);
    expect(fixturesAround(b, r.fixtures)).toBe(true);
    expect(r.spots['vert2'].x).toBeLessThan(40);
  });

  it('keeps what is there, and adds nothing once it is enough', () => {
    const { b, spots } = sample('kinderregal-standing');
    const first = suggestHolds(b, spots, []);
    const again = suggestHolds(b, first.spots, first.fixtures);
    expect(again.fixtures).toEqual(first.fixtures);
  });

  it('suggests nothing for a part filling its whole board', () => {
    const b: SettleBoard = {
      w: 414,
      h: 394,
      gap: 10,
      margin: 7,
      parts: [
        {
          id: 'back',
          w: 400,
          h: 380,
          outer: [
            [
              [0, 0],
              [400, 0],
              [400, 380],
              [0, 380],
            ],
          ],
          holes: [],
        },
      ],
      sizes: { clampReach: 3, clampWidth: 24, screwD: 10 },
      keep: { clamp: 7.5, screw: 7.5 },
    };
    expect(suggestHolds(b, { back: { x: 7, y: 7 } }, []).fixtures).toEqual([]);
  });
});

describe('suggestHoldsGrowing', () => {
  const tight: SettleBoard = {
    w: 414,
    h: 394,
    gap: 10,
    margin: 7,
    parts: [
      {
        id: 'back',
        w: 400,
        h: 380,
        outer: [
          [
            [0, 0],
            [400, 0],
            [400, 380],
            [0, 380],
          ],
        ],
        holes: [],
      },
    ],
    sizes: { clampReach: 3, clampWidth: 24, screwD: 10 },
    keep: { clamp: 7.5, screw: 7.5 },
  };
  const start: Spots = { back: { x: 7, y: 7 } };

  it('gives a tight board the smallest border that gets clamps around it', () => {
    const r = suggestHoldsGrowing(tight, start, []);
    // 3 reach + 7.5 keep + 5 comfort, less the 7 margin there is: 8.5, in whole mm.
    expect(r.grew).toBe(9);
    expect([r.w, r.h]).toEqual([432, 412]);
    expect(r.spots.back).toEqual({ x: 16, y: 16 });
    const bigger = { ...tight, w: r.w, h: r.h };
    expect(r.fixtures.length).toBeGreaterThanOrEqual(3);
    expect(fixturesAround(bigger, r.fixtures)).toBe(true);
    for (const f of r.fixtures) expect(fixtureFree(bigger, r.spots, f)).toBe(true);
  });

  it('goes by the clearance of the real hardware', () => {
    expect(suggestHoldsGrowing({ ...tight, keep: { clamp: 12, screw: 12 } }, start, []).grew).toBe(13);
  });

  it('comes out the same every time', () => {
    expect(suggestHoldsGrowing(tight, start, [])).toEqual(suggestHoldsGrowing(tight, start, []));
  });

  it('leaves a board alone when clamps fit at its size', () => {
    const { b, spots } = sample('kinderregal-standing');
    const r = suggestHoldsGrowing(b, spots, []);
    expect(r).toEqual({ ...suggestHolds(b, spots, []), w: b.w, h: b.h, grew: 0 });
    expect(suggestHoldsGrowing(b, r.spots, r.fixtures).fixtures).toEqual(r.fixtures);
  });

  it('keeps the holds there are where they were relative to the work', () => {
    const existing: Fixture[] = [clamp('right', 200), { kind: 'screw', x: 300, y: 200 }];
    const r = suggestHoldsGrowing(tight, start, existing);
    expect(r.grew).toBeGreaterThan(0);
    expect(r.fixtures.slice(0, 2)).toEqual([clamp('right', 200 + r.grew), { kind: 'screw', x: 300 + r.grew, y: 200 + r.grew }]);
    expect(r.fixtures.length).toBeGreaterThan(2);
    expect(r.spots.back.x - 300 - r.grew).toBe(start.back.x - 300);
  });

  it('stays inside the machine, either way round, and within 30 % more board', () => {
    const none = suggestHoldsGrowing(tight, start, [], { w: 420, h: 420 });
    expect([none.grew, none.w, none.h, none.fixtures]).toEqual([0, 414, 394, []]);
    expect(suggestHoldsGrowing(tight, start, [], { w: 412, h: 432 }).grew).toBe(9);
    expect(suggestHoldsGrowing(tight, start, [], { w: 432, h: 412 }).grew).toBe(9);
    const small: SettleBoard = {
      ...tight,
      w: 74,
      h: 74,
      parts: [
        {
          ...tight.parts[0],
          w: 60,
          h: 60,
          outer: [
            [
              [0, 0],
              [60, 0],
              [60, 60],
              [0, 60],
            ],
          ],
        },
      ],
    };
    expect(suggestHoldsGrowing(small, start, []).grew).toBe(0);
  });
});

describe('surrounds', () => {
  it('needs points on every side', () => {
    const c = { x: 0, y: 0 };
    expect(
      surrounds(
        [
          { x: 1, y: 1 },
          { x: -1, y: 1 },
          { x: 0, y: -1 },
        ],
        c
      )
    ).toBe(true);
    expect(
      surrounds(
        [
          { x: 1, y: 1 },
          { x: 2, y: 1 },
          { x: 1, y: 2 },
        ],
        c
      )
    ).toBe(false);
    expect(
      surrounds(
        [
          { x: 1, y: 1 },
          { x: -1, y: -1 },
        ],
        c
      )
    ).toBe(false);
  });
});
