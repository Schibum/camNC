import { describe, expect, it } from 'vitest';
import { camBoard, type BoardSpec } from './board';
import type { PartFeatures } from './features';
import { toGcode } from './gcode';
import { checkGcodeSafety } from './safety';
import { candidates, freePartsProgram, planTabs } from './tabPlan';
import { DEFAULT_TABS } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const plain = (): PartFeatures => {
  const outline = rect(0, 0, 200, 100);
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
/** Two parts 8 mm apart and 5.2 mm from the edge: after the cuts, nothing beyond them is wide enough to hold a tab. */
const tight = (over: Partial<BoardSpec> = {}): BoardSpec => ({
  id: 'a',
  name: 'A',
  w: 210.4,
  h: 218.4,
  thickness: 8,
  holdDown: 'tabs',
  tabs: DEFAULT_TABS,
  parts: [
    { id: 'a', name: 'a', features: plain(), size: [200, 100, 8], x: 5.2, y: 5.2, rotated: false },
    { id: 'b', name: 'b', features: plain(), size: [200, 100, 8], x: 5.2, y: 113.2, rotated: false },
  ],
  ...over,
});

/** Room all around: every edge faces stock that holds. */
const roomy = (parts: BoardSpec['parts'], w = 240, h = 140): BoardSpec => ({
  id: 'r',
  name: 'R',
  w,
  h,
  thickness: 8,
  holdDown: 'tabs',
  tabs: DEFAULT_TABS,
  parts,
});

describe('tab placement', () => {
  it('only straight runs, off their ends: none on a curve', () => {
    const arc = Array.from({ length: 60 }, (_, i) => ({ x: 50 * Math.cos(i / 20), y: 50 * Math.sin(i / 20) }));
    expect(candidates(arc, 8)).toEqual([]);
    const line = candidates(
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
      ],
      8
    );
    expect(line.length).toBeGreaterThan(3);
    for (const c of line) expect(c.at.x >= 5 && c.at.x <= 25).toBe(true);
  });

  it('a few tabs on two opposite sides, spread along them, off the corners: none in a notch', () => {
    // A U: a 40 mm notch in the middle of the top edge, its floor facing the free area too.
    const u = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 120, y: 100 },
      { x: 120, y: 60 },
      { x: 80, y: 60 },
      { x: 80, y: 100 },
      { x: 0, y: 100 },
    ];
    const f = { ...plain(), footprint: [u], outlines: [u] };
    const plan = planTabs(roomy([{ id: 'u', name: 'u', features: f, size: [200, 100, 8], x: 20, y: 20, rotated: false }]), {});
    const h = plan.get('u')!;
    expect(h.how).toBe('placed');
    // Min # 3: two below, one above; only on the bit's path along the part's outer edges.
    const below = h.tabs.filter(t => t.y < 20),
      above = h.tabs.filter(t => t.y > 120);
    expect([below.length, above.length]).toEqual([2, 1]);
    expect(h.tabs.every(t => t.x >= 20 + 10 && t.x <= 220 - 10)).toBe(true);
    expect(h.tabs.some(t => t.x > 100 && t.x < 140 && t.y < 125)).toBe(false);
  });

  it("tabs the user placed: used instead of picked ones, on the bit's path, in the part frame however it is turned", () => {
    const part = { id: 'p', name: 'p', features: plain(), size: [200, 100, 8] as [number, number, number], x: 20, y: 20, rotated: false };
    // Part frame: one a little inside the bottom edge, one a little outside the right one.
    const tabsAt = [
      { x: 60, y: 3 },
      { x: 205, y: 50 },
    ];
    const h = planTabs(roomy([{ ...part, tabsAt }]), {}).get('p')!;
    expect(h).toMatchObject({ how: 'placed', moved: true });
    expect(h.tabs).toHaveLength(2);
    // On the path, a bit radius outside the outline.
    expect(h.tabs[0].x).toBeCloseTo(80, 0);
    expect(h.tabs[0].y).toBeLessThan(20);
    expect(h.tabs[0].y).toBeGreaterThan(17);
    expect(h.tabs[1].y).toBeCloseTo(70, 0);
    expect(h.tabs[1].x).toBeGreaterThan(220);
    // Turned 90°: the same spots on the part, wherever that is on the board.
    const turned = planTabs(roomy([{ ...part, tabsAt, rotated: true }], 240, 260), {}).get('p')!;
    expect(turned.tabs[0].y).toBeCloseTo(80, 0);
    expect(turned.tabs[0].x).toBeGreaterThan(20 + 100);
    // And the program has them.
    const cam = camBoard(roomy([{ ...part, tabsAt }]), {});
    expect(cam.holding?.find(x => x.id === 'p')).toMatchObject({ how: 'placed', moved: true });
  });

  it('a long strip: two tabs on each long side, not at its tips', () => {
    const strip = rect(0, 0, 1200, 50);
    const f = { ...plain(), footprint: [strip], outlines: [strip] };
    const h = planTabs(roomy([{ id: 's', name: 's', features: f, size: [1200, 50, 8], x: 20, y: 20, rotated: false }], 1240, 90), {}).get(
      's'
    )!;
    expect(h.tabs).toHaveLength(4);
    expect(h.tabs.filter(t => t.y < 20)).toHaveLength(2);
    // Spread out: the quarter points, far from the ends.
    const xs = h.tabs.map(t => Math.round(t.x - 20)).sort((a, b) => a - b);
    for (const x of xs) expect(x > 200 && x < 1000).toBe(true);
  });

  it('a hooked part: tabs on its long free edge, not the hook, and its centre of mass inside them', () => {
    // A side panel with a hook (the kinderregal 20 mm sides): body 500 x 100 on top, a 30 mm finger along the bottom
    // right, a 50 mm slot between them. The long free edge (y 80, x 0..280) is set back from the hull: the finger sticks
    // out past it.
    const hook = [
      { x: 0, y: 80 },
      { x: 280, y: 80 },
      { x: 280, y: 80 },
      { x: 440, y: 80 },
      { x: 440, y: 30 },
      { x: 280, y: 30 },
      { x: 280, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 180 },
      { x: 0, y: 180 },
    ].filter((p, i, a) => !i || p.x !== a[i - 1].x || p.y !== a[i - 1].y);
    const f = { ...plain(), footprint: [hook], outlines: [hook] };
    const part = { id: 'h', name: 'h', features: f, size: [500, 180, 8] as [number, number, number], x: 40, y: 40, rotated: false };
    const held = planTabs(roomy([part], 580, 260), {}).get('h')!;
    expect(held.how).toBe('placed');
    const tabs = held.tabs.map(t => ({ x: t.x - 40, y: t.y - 40 }));
    expect(tabs).toHaveLength(4);
    // Two on top, two below: none on the thin finger (x 280..440 along its bottom, or by its root) or in the slot.
    expect(tabs.filter(t => t.y > 170)).toHaveLength(2);
    for (const t of tabs.filter(t => t.y < 170)) {
      expect(t.x < 280 || t.x > 450).toBe(true);
      expect(t.y < 30 || t.y > 75).toBe(true);
    }
    // The part's centre of mass (about x 230, y 110) lies inside the tabs, with at least one on the free edge.
    expect(tabs.some(t => Math.abs(t.y - 80) < 5 && t.x < 280)).toBe(true);
  });

  it('Min # is a target: short edges take what fits, the other sides the rest; fewer than asked is said, not dropped', () => {
    const small = rect(0, 0, 30, 20);
    const f = { ...plain(), footprint: [small], outlines: [small] };
    const part = { id: 's', name: 's', features: f, size: [30, 20, 8] as [number, number, number], x: 30, y: 30, rotated: false };
    const at = (minCount: number) => planTabs({ ...roomy([part], 90, 80), tabs: { ...DEFAULT_TABS, minCount } }, {}).get('s')!;
    const counts = [2, 3, 4, 5, 6, 8].map(n => at(n).tabs.length);
    // Never fewer for a higher Min #, never none.
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(2);
    const many = at(8);
    expect(many.how).toBe('placed');
    // Beyond what the long sides take: the ends get some too.
    expect(many.tabs.some(t => t.x < 30 || t.x > 60)).toBe(true);
    expect(many.tabs.length).toBeLessThan(8);
    expect(many.wanted).toBe(8);
    expect(at(2).wanted).toBeUndefined();
  });

  it('held on one side only is not held: the part gets its fallback', () => {
    // Against the lower left corner (5.2 mm margins hold nothing), free stock only to the right and above.
    const b = roomy([{ id: 'a', name: 'a', features: plain(), size: [200, 100, 8], x: 5.2, y: 5.2, rotated: false }], 400, 300);
    expect(planTabs(b, {}).get('a')!.how).toBe('unheld');
  });

  it('a part with no spot that holds gets the fallback chosen: a bottom skin, tabs anyway, or none; unheld if none is', () => {
    // Not chosen: nothing switched behind the user's back. Cut without tabs; the job blocks until one is chosen.
    expect([...planTabs(tight(), {}).values()].map(h => h.how)).toEqual(['unheld', 'unheld']);
    const bare = camBoard(tight(), {});
    // No tab bumps: the last pass is at one depth all the way round.
    for (const o of bare.operations.filter(o => o.feature === 'outline')) {
      const zs = o.passes.at(-1)!.pts.map(q => q[2]);
      expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(1e-6);
    }
    expect([...planTabs(tight({ tabFallback: 'skin' }), {}).values()].map(h => h.how)).toEqual(['skin', 'skin']);
    const cam = camBoard(tight({ skin: 1.2, tabFallback: 'skin' }), {});
    const finals = cam.operations.filter(o => o.feature === 'outline').map(o => Math.min(...o.passes.at(-1)!.pts.map(q => q[2])));
    expect(finals).toEqual([1.2, 1.2]);
    expect([...planTabs(tight({ tabFallback: 'self' }), {}).values()].map(h => h.how)).toEqual(['self', 'self']);
    const own = tight();
    own.parts[0] = { ...own.parts[0], tabFallback: 'tabs' };
    expect([...planTabs(own, {}).values()].map(h => h.how)).toEqual(['tabs', 'unheld']);
  });

  it('the bottom skin hold-down: every part keeps a skin, no tabs, freed at the machine', () => {
    const cam = camBoard(
      {
        ...roomy([{ id: 'a', name: 'a', features: plain(), size: [200, 100, 8], x: 20, y: 20, rotated: false }]),
        holdDown: 'skin',
        skin: 0.8,
      },
      {}
    );
    expect(cam.holding?.map(h => h.how)).toEqual(['skin']);
    const outline = cam.operations.find(o => o.feature === 'outline')!;
    // No tab: the last pass stays at the skin all the way round.
    expect(outline.passes.at(-1)!.pts.every(q => Math.abs(q[2] - 0.8) < 1e-6)).toBe(true);
    expect(freePartsProgram(cam, { feed: 900, plungeFeed: 480, finalZ: -0.3 }).parts.map(p => p.name)).toEqual(['a']);
  });

  it('frees skin parts one at a time: cut through, bit up, spindle off, pause; spindle on again before the next', () => {
    const cam = camBoard(tight({ tabFallback: 'skin' }), {});
    const free = freePartsProgram(cam, { feed: 900, plungeFeed: 480, finalZ: -0.3 });
    expect(free.parts.map(p => p.name)).toEqual(['a', 'b']);
    // One lap round each part, once through the skin.
    expect(free.cam.operations.map(o => o.passes.length)).toEqual([1, 1]);
    const gcode = toGcode(free.cam);
    const lines = gcode.trim().split('\n');
    const pauses = lines.flatMap((l, i) => (l.startsWith('M0 (MSG Take out') ? [i] : []));
    expect(pauses).toHaveLength(2);
    for (const i of pauses) {
      // Spindle off right before the marker, the bit at safe height (Z13 = stock top 8 + 5).
      expect(lines[i - 2]).toBe('M5');
      expect(lines[i - 3]).toMatch(/Z13$/);
    }
    // Each pause names the part to take out and the one freed after Resume: that's the one to hold down.
    expect(pauses.map(i => lines[i - 1])).toEqual([
      '(CAMNC PAUSE take-out; n=1/2; part=a; next=b)',
      '(CAMNC PAUSE take-out; n=2/2; part=b)',
    ]);
    // Between the pause and the next cut: spindle on and a dwell first, no XY move while paused.
    const after = lines.slice(pauses[0] + 1, pauses[0] + 3);
    expect(after).toEqual(['M3 S15000', 'G4 P3']);
    expect(lines.slice(pauses[0] + 1, pauses[0] + 3).some(l => /[XY]-?\d/.test(l))).toBe(false);
    expect(checkGcodeSafety(gcode, { stockTop: 8, size: [210.4, 218.4], minZ: -0.3, toolRadius: 3.175 / 2 })).toEqual([]);
  });
});
