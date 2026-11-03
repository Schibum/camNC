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

  it('held on one side only is not held: the part gets its fallback', () => {
    // Against the lower left corner (5.2 mm margins hold nothing), free stock only to the right and above.
    const b = roomy([{ id: 'a', name: 'a', features: plain(), size: [200, 100, 8], x: 5.2, y: 5.2, rotated: false }], 400, 300);
    expect(planTabs(b, {}).get('a')!.how).toBe('skin');
  });

  it('a part with no spot that holds gets its fallback: a bottom skin by default, or tabs anyway, or none', () => {
    expect([...planTabs(tight(), {}).values()].map(h => h.how)).toEqual(['skin', 'skin']);
    const cam = camBoard(tight({ skin: 1.2 }), {});
    const finals = cam.operations.filter(o => o.feature === 'outline').map(o => Math.min(...o.passes.at(-1)!.pts.map(q => q[2])));
    expect(finals).toEqual([1.2, 1.2]);
    expect([...planTabs(tight({ tabFallback: 'self' }), {}).values()].map(h => h.how)).toEqual(['self', 'self']);
    const own = tight();
    own.parts[0] = { ...own.parts[0], tabFallback: 'tabs' };
    expect([...planTabs(own, {}).values()].map(h => h.how)).toEqual(['tabs', 'skin']);
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
    const cam = camBoard(tight(), {});
    const free = freePartsProgram(cam, { feed: 900, plungeFeed: 480, finalZ: -0.3 });
    expect(free.parts.map(p => p.name)).toEqual(['a', 'b']);
    const gcode = toGcode(free.cam);
    const lines = gcode.trim().split('\n');
    const pauses = lines.flatMap((l, i) => (l.startsWith('M0 (MSG Take out') ? [i] : []));
    expect(pauses).toHaveLength(2);
    for (const i of pauses) {
      // Spindle off right before, the bit at safe height (Z13 = stock top 8 + 5).
      expect(lines[i - 1]).toBe('M5');
      expect(lines[i - 2]).toMatch(/Z13$/);
    }
    // Between the pause and the next cut: spindle on and a dwell first, no XY move while paused.
    const after = lines.slice(pauses[0] + 1, pauses[0] + 3);
    expect(after).toEqual(['M3 S15000', 'G4 P3']);
    expect(lines.slice(pauses[0] + 1, pauses[0] + 3).some(l => /[XY]-?\d/.test(l))).toBe(false);
    expect(checkGcodeSafety(gcode, { stockTop: 8, size: [210.4, 218.4], minZ: -0.3, toolRadius: 3.175 / 2 })).toEqual([]);
  });
});
