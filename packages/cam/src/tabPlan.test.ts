import { describe, expect, it } from 'vitest';
import { camBoard, type BoardSpec } from './board';
import type { PartFeatures } from './features';
import { toGcode } from './gcode';
import { checkGcodeSafety } from './safety';
import { candidates, freePartsProgram, planTabs, spread } from './tabPlan';
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

  it('spreads the tabs: as far apart as the spots allow', () => {
    const pts = Array.from({ length: 101 }, (_, i) => ({ x: i, y: 0 }));
    expect(
      spread(pts, 3, 8)
        .map(p => p.x)
        .sort((a, b) => a - b)
    ).toEqual([0, 50, 100]);
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
