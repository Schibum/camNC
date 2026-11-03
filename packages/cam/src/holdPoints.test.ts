import { describe, expect, it } from 'vitest';
import { camBoard, type BoardSpec } from './board';
import type { PartFeatures } from './features';
import { holdTimeline } from './hold';
import { frameMargin, heldByPoints, kZeroClear, holdClashes, suggestHoldPoints } from './holdPoints';
import { DEFAULT_TABS, freePartsProgram } from './index';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const plain = (w: number, h: number): PartFeatures => {
  const outline = rect(0, 0, w, h);
  return {
    thickness: 8,
    footprint: [outline],
    outlines: [outline],
    throughHoles: [],
    levels: [],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
};

const part = (id: string, w: number, h: number, x: number, y: number): BoardSpec['parts'][number] => ({
  id,
  name: id,
  features: plain(w, h),
  size: [w, h, 8],
  x,
  y,
  rotated: false,
});

describe('hold points', () => {
  it('3 holds around the centre hold a piece; 2 at opposite corners, or 3 in a line, do not', () => {
    const c = { x: 50, y: 50 };
    expect(
      heldByPoints(
        [
          { x: 5, y: 5 },
          { x: 95, y: 95 },
        ],
        c,
        100 * 100
      )
    ).toBe(false);
    expect(
      heldByPoints(
        [
          { x: 5, y: 5 },
          { x: 50, y: 50 },
          { x: 95, y: 95 },
        ],
        c,
        100 * 100
      )
    ).toBe(false);
    expect(
      heldByPoints(
        [
          { x: 5, y: 5 },
          { x: 95, y: 5 },
          { x: 50, y: 95 },
        ],
        c,
        100 * 100
      )
    ).toBe(true);
    expect(
      heldByPoints(
        [
          { x: 5, y: 5 },
          { x: 95, y: 5 },
          { x: 95, y: 30 },
        ],
        c,
        100 * 100
      )
    ).toBe(false);
    // A long narrow strip, held near both ends.
    expect(
      heldByPoints(
        [
          { x: 5, y: 5 },
          { x: 495, y: 5 },
        ],
        { x: 250, y: 5 },
        500 * 10
      )
    ).toBe(true);
  });

  it('suggested on a board with a frame: corners and along every edge, at most the spacing apart, clear of the parts', () => {
    const d = 10,
      bit = 6;
    const m = frameMargin(d, bit);
    const parts = [
      { x: m, y: m, w: 571 - 2 * m, h: 300 },
      { x: m, y: m + 310, w: 571 - 2 * m, h: 779 - 2 * m - 310 },
    ];
    const holds = suggestHoldPoints({ w: 571, h: 779 }, parts, { d, bit, spacing: 250 });
    // 4 corners, 2 more on each 571 edge... at least 3 per side in all.
    expect(holds.length).toBeGreaterThanOrEqual(10);
    // The lower left corner is the XY zero: kept clear for finding it.
    expect(holds.every(h => Math.hypot(h.x, h.y) >= kZeroClear)).toBe(true);
    for (const corner of [
      { x: 571, y: 0 },
      { x: 571, y: 779 },
      { x: 0, y: 779 },
    ])
      expect(holds.some(h => Math.hypot(h.x - corner.x, h.y - corner.y) < 15)).toBe(true);
    for (const h of holds)
      for (const r of parts) {
        const dx = Math.max(r.x - h.x, 0, h.x - r.x - r.w),
          dy = Math.max(r.y - h.y, 0, h.y - r.y - r.h);
        expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(d / 2 + bit);
      }
    // Neighbours along an edge no farther apart than the spacing (plus the room to dodge a part).
    const bottom = holds.filter(h => h.y < 20).sort((a, b) => a.x - b.x);
    for (let i = 1; i < bottom.length; i++) expect(bottom[i].x - bottom[i - 1].x).toBeLessThanOrEqual(250 + 1);
  });

  it('a hold in the way of a cut clashes', () => {
    const cuts = [
      {
        r: 3,
        pts: [
          [0, 20, 2],
          [100, 20, 2],
        ] as [number, number, number][],
      },
    ];
    const holds = [
      { x: 50, y: 25, kind: 'screw' as const, d: 10 },
      { x: 50, y: 60, kind: 'screw' as const, d: 10 },
    ];
    expect(holdClashes(holds, cuts, 8).map(h => h.y)).toEqual([25]);
  });
});

describe('does it stay put during the job?', () => {
  // Two parts the full width of the board: once both are cut, the stock below, between and above them are separate.
  const wide = (holdDown: BoardSpec['holdDown'], holdPoints: BoardSpec['holdPoints']): BoardSpec => ({
    id: 'a',
    name: 'A',
    w: 260,
    h: 260,
    thickness: 8,
    holdDown,
    tabs: DEFAULT_TABS,
    holdPoints,
    parts: [part('lower', 250, 60, 5, 60), part('upper', 250, 60, 5, 140)],
  });
  const screw = (x: number, y: number) => ({ x, y, kind: 'screw' as const, d: 8 });

  it('two corner clamps: after the cuts, the stock below and above pivot on one each, and the parts come loose', () => {
    const board = wide('none', [screw(10, 10), screw(250, 250)]);
    const cam = camBoard(board, { tools: [{ number: 1, diameter: 3.175, name: '1/8' }] });
    const events = holdTimeline(cam, board, { points: board.holdPoints });
    const pivots = events.filter(e => e.kind === 'pivot');
    expect(pivots.length).toBeGreaterThanOrEqual(2);
    expect(pivots.every(p => (p.holds ?? 0) <= 1)).toBe(true);
    expect(
      events
        .filter(e => e.kind === 'loose')
        .map(e => e.what)
        .sort()
    ).toEqual(['lower', 'upper']);
    // Reported at the cut that causes it, not at the end.
    expect(Math.min(...pivots.map(p => p.step))).toBeLessThan(cam.operations.length - 1);
  });

  it('three holds on each piece of stock, and parts on tabs: nothing comes loose', () => {
    const holds = [screw(10, 10), screw(130, 30), screw(250, 10), screw(10, 250), screw(130, 230), screw(250, 250)];
    const board = { ...wide('tabs', holds), parts: [part('lower', 230, 60, 15, 60), part('upper', 230, 60, 15, 140)] };
    const cam = camBoard(board, { tools: [{ number: 1, diameter: 3.175, name: '1/8' }] });
    const events = holdTimeline(cam, board, { points: holds });
    expect(events.filter(e => e.kind === 'loose')).toEqual([]);
    expect(events.filter(e => e.kind === 'pivot' && e.what === 'stock' && e.at.y < 60)).toEqual([]);
  });

  it('taped: every outline stops at the layer; the release cuts all of them at the end, smallest first, no pauses', () => {
    const board: BoardSpec = { ...wide('fixture-tape', undefined), parts: [part('big', 200, 100, 20, 20), part('small', 60, 40, 20, 150)] };
    const cam = camBoard(board, { tools: [{ number: 1, diameter: 3.175, name: '1/8' }] });
    const outlines = cam.operations.filter(o => o.feature === 'outline');
    expect(outlines.every(o => Math.min(...o.passes.flatMap(p => p.pts.map(q => q[2]))) >= 0.5 - 1e-6)).toBe(true);
    expect(holdTimeline(cam, board, { taped: true })).toEqual([]);
    const release = freePartsProgram(cam, { feed: 900, plungeFeed: 300, finalZ: -0.3, pause: false });
    expect(release.parts.map(p => p.name)).toEqual(['small', 'big']);
    expect(release.cam.operations.every(o => !o.pauseAfter)).toBe(true);
  });
});
