import { describe, expect, it } from 'vitest';
import boards from '../test/fixtures/settle-boards.json';
import {
  clampPlay,
  defaultHolds,
  edgeBands,
  fewerHolds,
  fixturesAround,
  fixtureFree,
  largestOffcut,
  moreHolds,
  reserved,
  settle,
  snapScrew,
  suggestHolds,
  suggestHoldsGrowing,
  surrounds,
  workBox,
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
const around = (b: SettleBoard, r: { spots: Spots; fixtures: Fixture[] }) => fixturesAround(b, workBox(b, r.spots), r.fixtures);
/** What no suggestion may break: clear of every cut, off the XY zero, parts a gap apart and on the board, around the work's middle. */
const expectHardRules = (b: SettleBoard, r: { spots: Spots; fixtures: Fixture[] }) => {
  for (const f of r.fixtures) {
    expect(fixtureFree(b, r.spots, f)).toBe(true);
    expect(reserved(f, b)).toBe(false);
  }
  b.parts.forEach((p, i) => {
    const at = r.spots[p.id];
    expect(at.x).toBeGreaterThanOrEqual(b.margin - 1e-6);
    expect(at.y).toBeGreaterThanOrEqual(b.margin - 1e-6);
    expect(at.x + p.w).toBeLessThanOrEqual(b.w - b.margin + 1e-6);
    expect(at.y + p.h).toBeLessThanOrEqual(b.h - b.margin + 1e-6);
    for (const q of b.parts.slice(i + 1)) {
      const o = r.spots[q.id];
      const g = b.gap - 1e-6;
      expect(at.x + p.w + g <= o.x || o.x + q.w + g <= at.x || at.y + p.h + g <= o.y || o.y + q.h + g <= at.y).toBe(true);
    }
  });
  expect(around(b, r)).toBe(true);
};
const square = (id: string, w: number, h: number): SettleBoard['parts'][number] => ({
  id,
  w,
  h,
  outer: [
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
  ],
  holes: [],
});
const open = (w: number, h: number, parts: SettleBoard['parts']): SettleBoard => ({
  w,
  h,
  gap: 10,
  margin: 7,
  parts,
  sizes: { clampReach: 3, clampWidth: 24, screwD: 10 },
  keep: { clamp: 7.5, screw: 7.5 },
});
/** A sheet filled edge to edge with rectangles: no clamp has room, whatever moves. */
const filledSheet = (n: number) => {
  const [w, h, gap, margin] = [2440, 1220, 10, 7];
  const cols = Math.round(Math.sqrt((n * w) / h));
  const rows = Math.ceil(n / cols);
  const [pw, ph] = [(w - 2 * margin - gap * (cols - 1)) / cols, (h - 2 * margin - gap * (rows - 1)) / rows];
  const parts = Array.from({ length: n }, (_, i) => square(`p${i}`, pw, ph));
  const spots: Spots = Object.fromEntries(
    parts.map((p, i) => [p.id, { x: margin + (i % cols) * (pw + gap), y: margin + Math.floor(i / cols) * (ph + gap) }])
  );
  return { b: { ...open(w, h, parts), gap, margin }, spots };
};
const clampsOn = (fixtures: Fixture[], side: string) => fixtures.filter(f => f.kind === 'clamp' && f.side === side) as { at: number }[];

/** About 3 reference runs per suggestion now, so roughly twice as much work fails. */
const kSuggestRatio = 6;

/** Fixed arithmetic, allocation and sorting work, independent of the suggestion implementation. */
function referenceWork() {
  let sum = 0;
  for (let k = 0; k < 400; k++) {
    const rects = Array.from({ length: 400 }, (_, i) => ({ x: (i * 7919 + k) % 1009, w: (i * 104729) % 613 }));
    rects.sort((a, b) => a.x - b.x || a.w - b.w);
    for (const r of rects) sum += Math.min(r.x + r.w, 1000);
  }
  return sum;
}

function expectSuggestionSpeed<T>(label: string, work: () => T): T {
  const timed = <R>(run: () => R) => {
    const t = performance.now();
    const out = run();
    return { out, ms: performance.now() - t };
  };
  work();
  referenceWork();
  // Pair nearby samples and alternate their order so changing runner load does not favor either piece of work.
  // The median ratio tolerates isolated pauses without combining minima from unrelated load conditions.
  const runs = Array.from({ length: 7 }, (_, i) => {
    const run =
      i % 2 ? { reference: timed(referenceWork), suggestion: timed(work) } : { suggestion: timed(work), reference: timed(referenceWork) };
    return { ...run, ratio: run.suggestion.ms / run.reference.ms };
  });
  const ratio = runs.map(r => r.ratio).sort((a, b) => a - b)[3];
  const samples = runs.map(
    (r, i) => `${i % 2 ? 'R first' : 'W first'}: W ${r.suggestion.ms.toFixed(1)}/R ${r.reference.ms.toFixed(1)} ms=${r.ratio.toFixed(2)}`
  );
  console.info(`${label}: median ratio ${ratio.toFixed(2)}, samples ${samples.join(', ')}`);
  expect(ratio).toBeLessThan(kSuggestRatio);
  return runs[0].suggestion.out;
}

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

describe('largestOffcut', () => {
  it('stays quick on a tray of many parts, and finds the same offcut', () => {
    const parts = Array.from({ length: 48 }, (_, i) => square(`p${i}`, 90, 90));
    const spots: Spots = Object.fromEntries(parts.map((p, i) => [p.id, { x: 8 + (i % 8) * 110, y: 8 + Math.floor(i / 8) * 110 }]));
    const b = open(1100, 900, parts);
    const t = performance.now();
    const o = largestOffcut(b, spots, [])!;
    expect(performance.now() - t).toBeLessThan(50);
    expect([o.x, o.y, o.w, o.h]).toEqual([7, 653, 1086, 240]);
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
    expectHardRules(b, r);
    const upper = ['Part 1', 'Part 2', 'Part 3'].map(id => r.spots[id].x);
    expect(new Set(upper).size).toBe(1);
  });

  it('keeps vert2 left on the cutlery box', () => {
    const { b, spots } = sample('besteckkasten');
    const r = suggestHolds(b, spots, []);
    expectHardRules(b, r);
    expect(r.spots['vert2'].x).toBeLessThan(40);
  });

  // The owner's own layouts, which every rule has to accept; and what's suggested there has to keep to the same rules.
  const approved: [keyof typeof boards, Fixture[]][] = [
    ['besteckkasten', [clamp('left', 210), clamp('right', 110), clamp('left', 365), clamp('right', 405)]],
    [
      'kinderregal-standing',
      [clamp('left', 77), clamp('right', 227), clamp('left', 380), clamp('right', 380), clamp('left', 650), clamp('right', 650)],
    ],
  ];
  it.each(approved)('accepts the approved layout on %s, and adds nothing to it', (key, fixtures) => {
    const { b, spots } = sample(key);
    const held = settle(b, spots, fixtures, false)!;
    expectHardRules(b, { spots: held.spots, fixtures });
    const r = suggestHolds(b, held.spots, fixtures);
    expect(r.fixtures).toEqual(fixtures);
    expect(r.spots).toEqual(held.spots);
  });
  it.each(approved)('holds both edges on %s, and no part goes far', key => {
    const { b, spots } = sample(key);
    const r = suggestHolds(b, spots, []);
    expectHardRules(b, r);
    expect(new Set(r.fixtures.map(f => f.kind === 'clamp' && f.side)).size).toBeGreaterThanOrEqual(2);
    for (const id of Object.keys(spots))
      expect(Math.hypot(r.spots[id].x - spots[id].x, r.spots[id].y - spots[id].y)).toBeLessThanOrEqual(40);
  });

  it('keeps what is there, and adds nothing once it is enough', () => {
    const { b, spots } = sample('kinderregal-standing');
    const first = suggestHolds(b, spots, []);
    const again = suggestHolds(b, first.spots, first.fixtures);
    expect(again.fixtures).toEqual(first.fixtures);
    expect(again.spots).toEqual(first.spots);
  });

  it('counts holds that are there toward the pattern, and leaves them put', () => {
    const { b, spots } = sample('besteckkasten');
    const existing = [clamp('left', 365), clamp('right', 300)];
    const r = suggestHolds(b, spots, existing);
    expect(r.fixtures.slice(0, 2)).toEqual(existing);
    expect(r.fixtures.length).toBe(defaultHolds(workBox(b, spots)));
    expectHardRules(b, r);

    const open800 = open(800, 800, [square('p', 500, 500)]);
    const held = suggestHolds(open800, { p: { x: 150, y: 150 } }, [{ kind: 'screw', x: 75, y: 400 }]);
    expect(held.fixtures[0]).toEqual({ kind: 'screw', x: 75, y: 400 });
    expect(held.fixtures.length).toBe(4);
    expect(clampsOn(held.fixtures, 'left').length).toBeLessThan(2);
  });

  it('moves no part onto a screw that is there', () => {
    const { b, spots } = sample('besteckkasten');
    // Just right of the left stack, which the left clamps would push that way.
    const screw: Fixture = { kind: 'screw', x: 395, y: 300 };
    expect(fixtureFree(b, spots, screw)).toBe(true);
    const r = suggestHolds(b, spots, [screw]);
    expect(r.fixtures[0]).toEqual(screw);
    for (const f of r.fixtures) expect(fixtureFree(b, r.spots, f)).toBe(true);
  });

  it('comes out the same on a rerun and with the parts in the other order', () => {
    for (const key of ['besteckkasten', 'kinderregal-standing'] as const) {
      const { b, spots } = sample(key);
      const r = suggestHolds(b, spots, []);
      expect(suggestHolds(b, spots, [])).toEqual(r);
      expect(suggestHolds({ ...b, parts: [...b.parts].reverse() }, spots, [])).toEqual(r);
    }
  });

  it('goes by the clearance it is given', () => {
    const { b, spots } = sample('besteckkasten');
    const wide = { ...b, keep: { clamp: 12, screw: 12 } };
    const r = suggestHolds(wide, spots, []);
    expect(r.fixtures.length).toBeGreaterThanOrEqual(3);
    for (const f of r.fixtures) expect(fixtureFree(wide, r.spots, f)).toBe(true);
  });

  it('[performance] suggests holds on real outlines within a fixed multiple of reference work', () => {
    for (const key of ['besteckkasten', 'kinderregal-standing'] as const) {
      const { b, spots } = sample(key);
      expectSuggestionSpeed(key, () => suggestHolds(b, spots, []));
    }
  });

  it.each([32, 72, 144, 288])('[performance] falls back on a full sheet of %i parts within a fixed multiple of reference work', n => {
    const { b, spots } = filledSheet(n);
    const r = expectSuggestionSpeed(`${n} parts`, () => suggestHolds(b, spots, []));
    expect(r.fixtures.length).toBeLessThanOrEqual(defaultHolds(workBox(b, spots)));
    expectSuggestionSpeed(`${n} parts, growing`, () => suggestHoldsGrowing(b, spots, [], { w: b.w, h: b.h }));
  });

  it('adds no more to a fallback that can’t surround the work, and suggesting again changes nothing', () => {
    for (const n of [32, 144]) {
      const { b, spots } = filledSheet(n);
      const first = suggestHolds(b, spots, []);
      expect(suggestHolds(b, first.spots, first.fixtures)).toEqual(first);
    }
  });

  it('leaves interlocked parts where they are: their rectangles overlap, which sliding them would undo', () => {
    // Two combs whose teeth go into each other: rectangles on top of each other, outlines apart.
    const comb = (id: string, up: boolean): SettleBoard['parts'][number] => {
      const teeth: [number, number][] = up
        ? [
            [0, 0],
            [400, 0],
            [400, 200],
            [300, 200],
            [300, 40],
            [100, 40],
            [100, 200],
            [0, 200],
          ]
        : [
            [0, 200],
            [0, 110],
            [120, 110],
            [120, 0],
            [280, 0],
            [280, 110],
            [400, 110],
            [400, 200],
          ];
      return { id, w: 400, h: 200, outer: [teeth], holes: [] };
    };
    const b = open(600, 400, [comb('a', true), comb('b', false)]);
    const start = { a: { x: 100, y: 50 }, b: { x: 100, y: 110 } };
    const r = suggestHolds(b, start, []);
    expect(r.spots).toEqual(start);
    expect(r.fixtures.length).toBeGreaterThanOrEqual(3);
    for (const f of r.fixtures) expect(fixtureFree(b, r.spots, f)).toBe(true);
    expect(around(b, r)).toBe(true);
  });

  it('aims at the work, not the board, with work bunched in a corner', () => {
    const b = open(1200, 900, [square('p', 300, 200)]);
    const r = suggestHolds(b, { p: { x: 7, y: 7 } }, []);
    expect(r.fixtures.length).toBe(4);
    expect(around(b, r)).toBe(true);
    // A clamp along an edge the work is beside stays in the work's stretch of it.
    for (const c of [...clampsOn(r.fixtures, 'left'), ...clampsOn(r.fixtures, 'right')]) expect(c.at).toBeLessThan(300);
    for (const c of [...clampsOn(r.fixtures, 'bottom'), ...clampsOn(r.fixtures, 'top')]) expect(c.at).toBeLessThan(400);
  });

  it('spaces a second clamp on an edge a quarter of the work from its neighbour', () => {
    const b = open(1000, 500, [square('p', 700, 300)]);
    const r = suggestHolds(b, { p: { x: 150, y: 100 } }, [], 6);
    for (const side of ['left', 'right', 'bottom', 'top']) {
      const at = clampsOn(r.fixtures, side).map(c => c.at);
      const len = side === 'left' || side === 'right' ? 300 : 700;
      for (let i = 0; i < at.length; i++)
        for (let j = i + 1; j < at.length; j++) expect(Math.abs(at[i] - at[j])).toBeGreaterThanOrEqual(0.25 * len);
    }
  });

  it('sets a lone clamp midway between the two opposite it', () => {
    const b = open(800, 800, [square('p', 500, 500)]);
    const r = suggestHolds(b, { p: { x: 150, y: 150 } }, [clamp('left', 250), clamp('left', 550)], 3);
    expect(r.fixtures.length).toBe(3);
    expect(clampsOn(r.fixtures, 'right')[0].at).toBeCloseTo(400, -1);
  });

  it('leaves no long stretch of long work without a clamp', () => {
    const b = open(2400, 200, [square('rail', 2300, 100)]);
    const r = suggestHolds(b, { rail: { x: 50, y: 50 } }, []);
    expect(r.fixtures.length).toBe(4);
    const xs = r.fixtures
      .map(f => (f.kind === 'clamp' ? (f.side === 'left' ? 0 : f.side === 'right' ? 2400 : f.at) : f.x))
      .sort((m, n) => m - n);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeLessThanOrEqual(0.6 * 2300);
  });

  it('falls back to one clamp at a time when no pattern fits, and doesn’t claim to surround what it can’t', () => {
    // Room below them only, and parts that can't slide: their rectangles overlap.
    const b = open(800, 414, [square('p', 786, 300), square('q', 400, 280)]);
    const start = { p: { x: 7, y: 107 }, q: { x: 7, y: 120 } };
    const r = suggestHolds(b, start, []);
    expect(r.spots).toEqual(start);
    expect(r.fixtures.length).toBeGreaterThan(0);
    expect(clampsOn(r.fixtures, 'top')).toEqual([]);
    expect(around(b, r)).toBe(false);
  });

  describe('the default count', () => {
    it('goes by the size of the work', () => {
      expect(defaultHolds({ w: 150, h: 150 })).toBe(3);
      expect(defaultHolds({ w: 600, h: 480 })).toBe(4);
      // Long and thin gets no extra for that: 4 and 8 scored the same on the rail, and 4 was picked.
      expect(defaultHolds({ w: 2400, h: 200 })).toBe(4);
      expect(defaultHolds({ w: 2440, h: 1220 })).toBe(6);
    });
  });

  describe('more and fewer', () => {
    it('adds one and leaves every other hold and part where it is', () => {
      for (const key of ['besteckkasten', 'kinderregal-standing'] as const) {
        const { b, spots } = sample(key);
        const first = suggestHolds(b, spots, []);
        const more = moreHolds(b, first.spots, first.fixtures);
        expect(more.slice(0, first.fixtures.length)).toEqual(first.fixtures);
        expect(more.length).toBe(first.fixtures.length + 1);
        expectHardRules(b, { spots: first.spots, fixtures: more });
      }
    });

    it('gives what fits when another won’t', () => {
      const b = open(414, 394, [square('back', 400, 380)]);
      const held: Fixture[] = [{ kind: 'screw', x: 200, y: 200 }];
      expect(moreHolds(b, { back: { x: 7, y: 7 } }, held)).toEqual(held);
      expect(suggestHolds(b, { back: { x: 7, y: 7 } }, [], 5).fixtures).toEqual([]);
    });

    it('takes one away and leaves the work surrounded, the parts where they are', () => {
      for (const key of ['besteckkasten', 'kinderregal-standing'] as const) {
        const { b, spots } = sample(key);
        const first = suggestHolds(b, spots, []);
        const fewer = fewerHolds(b, first.spots, first.fixtures);
        expect(fewer.length).toBe(first.fixtures.length - 1);
        expectHardRules(b, { spots: first.spots, fixtures: fewer });
      }
    });

    it('leaves a hand-placed cross alone: without one of them the rest would hardly surround the middle', () => {
      const b = open(800, 800, [square('p', 500, 500)]);
      const spots = { p: { x: 150, y: 150 } };
      const cross = [clamp('left', 400), clamp('right', 400), clamp('bottom', 400), clamp('top', 400)];
      expect(fewerHolds(b, spots, cross)).toEqual(cross);
    });

    it('takes exactly one and moves no other', () => {
      const b = open(800, 800, [square('p', 500, 500)]);
      const spots = { p: { x: 150, y: 150 } };
      const hand = [clamp('left', 250), clamp('left', 550), clamp('right', 250), clamp('right', 550), clamp('top', 400)];
      const fewer = fewerHolds(b, spots, hand);
      expect(fewer.length).toBe(4);
      for (const f of fewer) expect(hand).toContainEqual(f);
    });

    it('still takes one from holds that never surrounded the work', () => {
      const b = open(800, 800, [square('p', 500, 500)]);
      const oneSided = [clamp('left', 200), clamp('left', 400), clamp('left', 600), clamp('bottom', 400)];
      expect(fewerHolds(b, { p: { x: 150, y: 150 } }, oneSided).length).toBe(3);
    });

    it('adds exactly one to holds that don’t surround the work, on the side that fixes it', () => {
      const b = open(800, 800, [square('p', 500, 500)]);
      const spots = { p: { x: 150, y: 150 } };
      const one = moreHolds(b, spots, [clamp('left', 400)]);
      expect(one.length).toBe(2);
      expect(one[0]).toEqual(clamp('left', 400));
      const lopsided = [clamp('left', 250), clamp('left', 550), clamp('bottom', 400), clamp('top', 400)];
      const more = moreHolds(b, spots, lopsided);
      expect(more.length).toBe(5);
      expect(more.slice(0, 4)).toEqual(lopsided);
    });

    it('makes the most of the holds there: one more gets one-sided holds around the work', () => {
      const b = open(800, 800, [square('p', 500, 500)]);
      const spots = { p: { x: 150, y: 150 } };
      const oneSided = [clamp('left', 250), clamp('left', 550), clamp('bottom', 200)];
      const more = moreHolds(b, spots, oneSided);
      expect(fixturesAround(b, workBox(b, spots), oneSided)).toBe(false);
      expect(fixturesAround(b, workBox(b, spots), more)).toBe(true);
    });

    it('never goes below 3, nor takes a screw', () => {
      const { b, spots } = sample('besteckkasten');
      const three = [clamp('left', 210), clamp('right', 110), clamp('right', 405)];
      expect(fewerHolds(b, spots, three)).toEqual(three);
      const b2 = open(800, 800, [square('p', 500, 500)]);
      const screws: Fixture[] = [
        { kind: 'screw', x: 50, y: 50 },
        { kind: 'screw', x: 750, y: 50 },
        { kind: 'screw', x: 400, y: 750 },
        clamp('left', 400),
      ];
      expect(fewerHolds(b2, { p: { x: 150, y: 150 } }, screws)).toEqual(screws.slice(0, 3));
    });
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
    expect(around(bigger, r)).toBe(true);
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
