import { describe, expect, it } from 'vitest';
import { readGcode } from './analyze';
import { camBoard, splitByBit, type BoardSpec } from './board';
import type { PartFeatures } from './features';
import { toGcode } from './gcode';
import { checkGcodeSafety } from './safety';
import { tabRemovalProgram } from './tabRemoval';
import { DEFAULT_TABS } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** 300 x 100 x 8 part with a pocket 4 deep. */
function features(): PartFeatures {
  const outline = rect(0, 0, 300, 100);
  const pocket = rect(50, 30, 250, 70);
  return {
    thickness: 8,
    footprint: [outline],
    outlines: [outline],
    throughHoles: [],
    levels: [],
    pockets: [{ floorZ: 4, region: [pocket], strictRegion: [pocket], above: [], area: 8000 }],
    bottomFaces: [],
    slopedArea: 0,
  };
}

const board = (over: Partial<BoardSpec> = {}): BoardSpec => ({
  id: 'a',
  name: 'A',
  w: 340,
  h: 140,
  thickness: 8,
  holdDown: 'tabs-guided',
  parts: [{ id: 'p', name: 'side', features: features(), size: [300, 100, 8], x: 20, y: 20, rotated: false }],
  ...over,
});

const cuts = (gcode: string) => readGcode(gcode).filter(m => !m.rapid);

describe('at the machine', () => {
  it('cuts from a thicker stock top (allowance or measured), floors and through depth unchanged', () => {
    const cam = camBoard(board({ stockTop: 8.3 }), {});
    expect(cam.stockTop).toBe(8.3);
    const zs = cuts(toGcode(cam)).map(m => m.to[2]);
    expect(Math.max(...zs)).toBeCloseTo(8.3, 3);
    expect(zs).toContain(4);
    expect(Math.min(...zs)).toBeCloseTo(-0.3, 3);
  });

  it('turns the whole program about the XY zero for a board lying askew', () => {
    const pts = (cam: ReturnType<typeof camBoard>) => cam.operations.flatMap(o => o.passes.flatMap(p => p.pts));
    const straight = pts(camBoard(board(), {}));
    const turned = pts(camBoard(board({ rotationDeg: 2 }), {}));
    const a = (2 * Math.PI) / 180;
    // Same toolpath, every point turned by 2° about (0, 0).
    expect(turned).toHaveLength(straight.length);
    straight.forEach((q, i) => {
      expect(turned[i][0]).toBeCloseTo(q[0] * Math.cos(a) - q[1] * Math.sin(a), 6);
      expect(turned[i][1]).toBeCloseTo(q[0] * Math.sin(a) + q[1] * Math.cos(a), 6);
      expect(turned[i][2]).toBe(q[2]);
    });
  });

  it('one program per bit, each without a bit-swap pause', () => {
    const f = features();
    // A 3.1 mm slot only the 3 mm bit fits; the rest is cut with the 6 mm bit.
    const slot = rect(60, 80, 240, 83.1);
    f.pockets.push({ floorZ: 2, region: [slot], strictRegion: [slot], above: [], area: 180 * 3.1 });
    const cam = camBoard(board({ holdDown: 'fixture-tape', parts: [{ ...board().parts[0], features: f }] }), {
      tools: [
        { number: 1, diameter: 6, name: 'flat end mill' },
        { number: 2, diameter: 3, name: 'flat end mill' },
      ],
    });
    const programs = splitByBit(cam);
    expect(programs.map(p => p.operations.map(o => o.tool.diameter))).toEqual([[3], [6, 6]]);
    expect(programs.flatMap(p => p.operations)).toEqual(cam.operations);
    for (const p of programs) {
      const gcode = toGcode(p);
      expect(gcode).not.toContain('Change to');
      expect(gcode).toContain('M3 S15000');
      expect(checkGcodeSafety(gcode, { stockTop: 8, size: [340, 140], minZ: -0.3, toolRadius: 3 })).toEqual([]);
    }
  });

  it('guided tab removal: one pause per tab, then a cut through it at the final depth', () => {
    const cam = camBoard(board(), { tabs: DEFAULT_TABS });
    const { cam: removal, tabs } = tabRemovalProgram(cam, { feed: 600, plungeFeed: 300 });
    // 300 x 100 outline: perimeter ~ 800 mm, 250 mm spacing -> at least 3 tabs.
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    const gcode = toGcode(removal);
    const pauses = gcode.split('\n').filter(l => /^M0 \(MSG Tab \d+ of \d+/.test(l));
    expect(pauses).toHaveLength(tabs.length);
    expect(pauses[0]).toBe(
      `M0 (MSG Tab 1 of ${tabs.length}: spindle off until Resume. Hold away from bit: side. Manual spindle: off now, on before Resume)`
    );
    // Bit up, spindle off before each; started again and up to speed before any cut. A program that begins with a pause
    // has no spindle start before it.
    const lines = gcode.trim().split('\n');
    // One per tab, and the one when parked.
    expect(lines.filter(l => l.startsWith('M0 '))).toHaveLength(tabs.length + 1);
    expect(lines.indexOf('M3 S15000')).toBeGreaterThan(lines.indexOf(pauses[0]));
    for (const pause of pauses) {
      const i = lines.indexOf(pause);
      expect(lines[i - 2]).toMatch(/Z13$/);
      expect(lines[i - 1]).toBe('M5');
      expect(lines.slice(i + 1, i + 3)).toEqual(['M3 S15000', 'G4 P3']);
    }
    for (const t of tabs) {
      // Tab length along the path = tab width + bit.
      expect(t.length).toBeCloseTo(DEFAULT_TABS.width + 3.175, 1);
      // Hold spot on the part (20..320 x 20..120), at least 30 mm from the tab.
      expect(t.hold.x).toBeGreaterThan(20);
      expect(t.hold.x).toBeLessThan(320);
      expect(Math.hypot(t.hold.x - t.at.x, t.hold.y - t.at.y)).toBeGreaterThan(30);
    }
    // Cuts only through tabs, at the final depth, and nothing else.
    const moves = cuts(gcode).filter(m => m.to[2] < 8);
    expect(Math.min(...moves.map(m => m.to[2]))).toBeCloseTo(-0.3, 3);
    expect(checkGcodeSafety(gcode, { stockTop: 8, size: [340, 140], minZ: -0.3, toolRadius: 3.175 / 2 })).toEqual([]);
  });

  it('guided tab removal, one pause per part: its tabs in a row, the last slower, then bit up, spindle off, take it out', () => {
    const cam = camBoard(board(), { tabs: DEFAULT_TABS });
    const perTab = tabRemovalProgram(cam, { feed: 600, plungeFeed: 300 });
    const { cam: removal, tabs } = tabRemovalProgram(cam, { feed: 600, fullFeed: 1800, plungeFeed: 300, perPart: true });
    // The same tabs, cut the same way, only the pauses differ.
    expect(tabs).toEqual(perTab.tabs);
    const parts = new Set(tabs.map(t => t.part));
    const gcode = toGcode(removal);
    const lines = gcode.trim().split('\n');
    expect(lines.filter(l => /^M0 \(MSG Tab /.test(l))).toEqual([]);
    const pauses = lines.flatMap((l, i) => (l.startsWith('M0 (MSG Take out ') ? [i] : []));
    expect(pauses).toHaveLength(parts.size);
    // The last pause only leaves the parking move: a hand-switched spindle stays off.
    expect(lines[pauses[0]]).toBe('M0 (MSG Take out side, then continue. Manual spindle: off now)');
    for (const i of pauses) {
      // Bit up (stock top 8 + 5), spindle off.
      expect(lines[i - 1]).toBe('M5');
      expect(lines[i - 2]).toMatch(/Z13$/);
    }
    // Per part: every tab at the full feed but the last one, which frees the part.
    const feeds = removal.operations.map(o => o.passes.map(p => p.feeds[1]));
    for (const f of feeds) expect(f).toEqual([...f.slice(0, -1).map(() => 1800), 600]);
    expect(Math.min(...cuts(gcode).map(m => m.to[2]))).toBeCloseTo(-0.3, 3);
    expect(checkGcodeSafety(gcode, { stockTop: 8, size: [340, 140], minZ: -0.3, toolRadius: 3.175 / 2 })).toEqual([]);
  });
});
