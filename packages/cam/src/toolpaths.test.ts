import { describe, expect, it } from 'vitest';
import { readGcode, metrics } from './analyze';
import type { PartFeatures } from './features';
import { fitArcs, toGcode } from './gcode';
import { difference } from './geom';
import { camPart, DEFAULT_TABS, type Tool } from './toolpaths';

function segDist(a: number[], b: number[], x: number, y: number) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
  return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
}

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** 200x100x8 board with a 40x20 pocket 4mm deep and a 10mm round through hole. */
function board(): PartFeatures {
  const outline = rect(0, 0, 200, 100);
  const hole = Array.from({ length: 90 }, (_, i) => ({
    x: 150 + 5 * Math.cos((i / 90) * 2 * Math.PI),
    y: 50 + 5 * Math.sin((i / 90) * 2 * Math.PI),
  }));
  const pocket = rect(30, 40, 70, 60);
  return {
    thickness: 8,
    footprint: [outline, [...hole].reverse()],
    outlines: [outline],
    throughHoles: [hole],
    levels: [
      { z: 8, region: [outline], area: 20000 },
      { z: 4, region: [pocket], area: 800 },
    ],
    pockets: [{ floorZ: 4, region: [pocket], strictRegion: [pocket], above: difference([outline], [pocket]), area: 800 }],
    bottomFaces: [],
    slopedArea: 0,
  };
}

describe('spike 3/4: toolpaths + gcode', () => {
  it('orders pocket, hole, outline and steps down as configured', () => {
    const cam = camPart(board());
    expect(cam.operations.map(o => o.name)).toEqual(['Pocket 1 z=4', 'Hole 1', 'Outline 1']);
    const [pocket, hole, outline] = cam.operations;
    // 4mm deep at 0.75D = 2.38mm stepdown -> 2 levels
    expect(new Set(pocket.passes.flatMap(p => p.pts.map(q => q[2].toFixed(3))))).toContain('4.000');
    // Outline: roughing 8 -> 1 in <= 4mm steps (4.5, 1), then the final pass at -0.3, half feed.
    expect(outline.passes.map(p => p.pts[1][2])).toEqual([4.5, 1, -0.3]);
    expect(outline.passes[2].feeds[1]).toBe(900);
    expect(hole.passes.at(-1)!.pts[1][2]).toBe(-0.3);
    // Climb: outline loop runs clockwise (negative signed area).
    const pts = outline.passes[2].pts;
    let a = 0;
    for (let i = 1; i < pts.length; i++) a += pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1];
    expect(a).toBeLessThan(0);
  });

  it('adds tabs to passes below the tab height', () => {
    const cam = camPart(board(), { tabs: DEFAULT_TABS });
    const outline = cam.operations.at(-1)!;
    const final = outline.passes.at(-1)!;
    const raised = final.pts.filter(p => p[2] === DEFAULT_TABS.height).length;
    // >= 3 tabs, each entered and left with a vertical step (2 points per side)
    expect(raised).toBeGreaterThanOrEqual(3 * 2);
  });

  it('uses a smaller bit for a slot the big one cannot enter, smallest first with an M0 bit swap', () => {
    const f = board();
    const slot = rect(100, 20, 180, 23.1); // 3.1mm wide knife slot
    f.levels.push({ z: 2, region: [slot], area: 80 * 3.1 });
    f.pockets.push({ floorZ: 2, region: [slot], strictRegion: [slot], above: difference([rect(0, 0, 200, 100)], [slot]), area: 80 * 3.1 });
    expect(camPart(f).warnings).toContain('pocket z=2: no tool fits');
    const cam = camPart(f, {
      tools: [
        { number: 1, diameter: 3.175, name: 'flat end mill' },
        { number: 3, diameter: 3, name: 'flat end mill' },
      ],
    });
    expect(cam.operations.map(o => `${o.name} T${o.tool.number}`)).toEqual([
      'Pocket 2 z=2 T3',
      'Pocket 1 z=4 T1',
      'Hole 1 T1',
      'Outline 1 T1',
    ]);
    const gcode = toGcode(cam);
    expect(gcode).toContain('M0 (MSG Insert T3 D=3, turn ON spindle 15000RPM)');
    expect(gcode).toMatch(/M0 \(MSG Spindle OFF. Change to T1 D=3.175/);
  });

  it('leaves no strip in the middle of a pocket with a stepover above half the bit', () => {
    // Stepover 0.6D: after the first ring a 3.5mm strip remains, wider than the bit but narrower than two stepovers.
    const f = board();
    const mortise = rect(100, 40, 106.675, 61);
    f.pockets = [
      { floorZ: 4, region: [mortise], strictRegion: [mortise], above: difference([rect(0, 0, 200, 100)], [mortise]), area: 140 },
    ];
    const [pocket] = camPart(f, { cutThrough: false, stepoverFactor: 0.6 }).operations;
    const xs = pocket.passes
      .flatMap(p => p.pts)
      .filter(q => q[2] === 4 && Math.abs(q[1] - 50) < 8)
      .map(q => q[0]);
    const r = 3.175 / 2;
    const covered = (x: number) =>
      xs.some(cx => Math.abs(cx - x) <= r) ||
      pocket.passes.some(p => p.pts.some((q, i) => i > 0 && q[2] === 4 && segDist(p.pts[i - 1], q, x, 50) <= r));
    for (let x = 100.05; x < 106.65; x += 0.05) expect(covered(x), `x=${x.toFixed(2)}`).toBe(true);
  });

  describe('pocket open to the edge (rabbet / edge groove)', () => {
    /** 200x100x8 board, rabbet 3.5 wide along the bottom edge, x 40..160, 4.5 deep (like the kinderregal sides). */
    function rabbetBoard(): PartFeatures {
      const outline = rect(0, 0, 200, 100);
      const strip = rect(40, 0, 160, 3.5);
      return {
        thickness: 8,
        footprint: [outline],
        outlines: [outline],
        throughHoles: [],
        levels: [
          { z: 8, region: difference([outline], [strip]), area: 0 },
          { z: 3.5, region: [strip], area: 420 },
        ],
        pockets: [{ floorZ: 3.5, region: [strip], strictRegion: [strip], above: difference([outline], [strip]), area: 420 }],
        bottomFaces: [],
        slopedArea: 0,
      };
    }
    const bit = (diameter: number): Tool => ({ number: 1, diameter, name: 'flat end mill' });

    it.each([3.175, 6])('ramps in from the waste outside the part, never on the finished wall (D=%s)', d => {
      const [pocket] = camPart(rabbetBoard(), { tools: [bit(d)] }).operations;
      const entries = pocket.passes.filter(p => p.link === 'retract');
      expect(entries.length).toBeGreaterThan(0);
      for (const pass of entries) {
        const floor = Math.min(...pass.pts.map(q => q[2]));
        // Every point until the ramp reaches its depth lies outside the board (y < 0).
        const ramp = pass.pts.slice(0, pass.pts.findIndex(q => q[2] === floor) + 1);
        for (const q of ramp) expect(q[1]).toBeLessThan(0);
      }
    });

    it.each([3.175, 6])('runs the bit 1mm past the edge so no sliver is left at the edge (D=%s)', d => {
      const [pocket, outline] = camPart(rabbetBoard(), { tools: [bit(d)] }).operations;
      const ys = pocket.passes.flatMap(p => p.pts.map(q => q[1]));
      expect(Math.min(...ys)).toBeCloseTo(-1, 2);
      // ...and still reaches the inner wall (y = 3.5) exactly, before the outline is cut.
      expect(Math.max(...ys)).toBeCloseTo(3.5 - d / 2, 2);
      expect(outline.kind).toBe('profile');
    });
  });

  it('fits arcs to tessellated circles', () => {
    const circle = Array.from({ length: 73 }, (_, i) => ({
      x: 10 * Math.cos((i / 72) * 2 * Math.PI),
      y: 10 * Math.sin((i / 72) * 2 * Math.PI),
    }));
    const prims = fitArcs(circle);
    expect(prims.length).toBeLessThanOrEqual(3);
    // One arc for (almost) the full circle; a closing chord may stay a line.
    expect(prims[0].type).toBe('arc');
  });

  it('emits FluidNC gcode that reads back to the same depths', () => {
    const cam = camPart(board(), { tabs: DEFAULT_TABS });
    const gcode = toGcode(cam, { partName: 'test board', stockSize: [200, 100, 8] });
    expect(gcode).toMatch(/^\(  T1 D=3\.175 CR=0 - ZMIN=-0\.3 - flat end mill \)$/m);
    expect(gcode).toContain('M0 (MSG Turn ON spindle 15000RPM)');
    expect(gcode).toMatch(/G[23] X/);
    const m = metrics(readGcode(gcode), 8);
    expect(m.zMin).toBeCloseTo(-0.3);
    expect(m.zLevels).toContain(4);
  });
});
