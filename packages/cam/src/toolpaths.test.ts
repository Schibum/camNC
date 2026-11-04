import { describe, expect, it } from 'vitest';
import { readGcode, metrics } from './analyze';
import type { PartFeatures } from './features';
import { fitArcs, kMaxGcodeLine, toGcode } from './gcode';
import { difference } from './geom';
import { checkGcodeSafety, kMaxFeed } from './safety';
import { splitByBit } from './board';
import { camPart, DEFAULT_TABS, type Pass, type Tool } from './toolpaths';

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

describe('stepdown', () => {
  const levels = (op: { passes: { pts: number[][] }[] }) => [...new Set(op.passes.map(p => +Math.min(...p.pts.map(q => q[2])).toFixed(3)))];

  it('a max stepdown limits pockets and outline roughing alike', () => {
    const [pocket, , outline] = camPart(board(), { maxStepdown: 4 }).operations;
    expect(levels(pocket)).toEqual([4]);
    expect(levels(outline)).toEqual([4.5, 1, -0.3]);
  });

  it('an outline-only stepdown (Fusion setups) leaves the pockets alone', () => {
    const [pocket, , outline] = camPart(board(), { profileStepdown: 4 }).operations;
    expect(levels(pocket)).toEqual([6.667, 5.333, 4]);
    expect(levels(outline)).toEqual([4.5, 1, -0.3]);
  });

  it('softer materials take deeper steps', () => {
    const [, , outline] = camPart(board(), { material: { name: 'mdf', stepdownFactor: 1 } }).operations;
    expect(levels(outline)).toEqual([5.667, 3.333, 1, -0.3]);
  });
});

describe('spike 3/4: toolpaths + gcode', () => {
  it('orders pocket, hole, outline and steps down as configured', () => {
    const cam = camPart(board());
    expect(cam.operations.map(o => o.name)).toEqual(['Pocket 1 z=4', 'Hole 1', 'Outline 1']);
    const [pocket, hole, outline] = cam.operations;
    // Oak: 0.5D = 1.59 mm stepdown. The pocket, 4 mm deep, takes 3 levels.
    const pocketLevels = [...new Set(pocket.passes.map(p => Math.min(...p.pts.map(q => q[2])).toFixed(3)))];
    expect(pocketLevels).toEqual(['6.667', '5.333', '4.000']);
    // Outline: roughing 8 -> 1 in <= 1.59 mm steps (5 levels), then the final pass at -0.3, half feed.
    expect(outline.passes.map(p => +p.pts[1][2].toFixed(3))).toEqual([6.6, 5.2, 3.8, 2.4, 1, -0.3]);
    expect(outline.passes.at(-1)!.feeds[1]).toBe(900);
    expect(hole.passes.at(-1)!.pts[1][2]).toBe(-0.3);
    // Climb: outline loop runs clockwise (negative signed area).
    const pts = outline.passes.at(-1)!.pts;
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

  it('uses a smaller bit for a slot the big one cannot enter, smallest first, one program per bit', () => {
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
    // FluidNC can't zero Z during a pause: no bit swap inside a program.
    expect(() => toGcode(cam)).toThrow(/One program per bit/);
    const programs = splitByBit(cam).map(p => toGcode(p));
    expect(programs).toHaveLength(2);
    expect(programs[0]).toMatch(/^\(  T3 D=3 /m);
    expect(programs[1]).toMatch(/^\(  T1 D=3.175 /m);
    // Each: the confirmation before the spindle starts, and the one when parked. No bit swap inside a program.
    for (const g of programs) expect(g.match(/^M0 \(MSG [A-Z][a-z]+/gm)).toEqual(['M0 (MSG Spindle', 'M0 (MSG Program']);
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
      expect(Math.min(...ys)).toBeCloseTo(-1, 1);
      // ...and still reaches the inner wall (y = 3.5) exactly, before the outline is cut.
      expect(Math.max(...ys)).toBeCloseTo(3.5 - d / 2, 2);
      expect(outline.kind).toBe('profile');
    });

    it('names the operation like the Model step names the feature', () => {
      expect(camPart(rabbetBoard(), {}).operations[0].title).toBe('edge groove 4.5 deep');
      expect(camPart(board(), {}).operations[0].title).toBe('1 pocket 4 deep');
    });

    it('cuts toward the wall in rows no wider than the stepover allows, then finishes the wall at full depth, climb', () => {
      const d = 3.175;
      const [pocket] = camPart(rabbetBoard(), { tools: [bit(d)] }).operations;
      // The rows of the first depth level.
      const level = pocket.passes[0].pts.at(-1)![2];
      const ys = pocket.passes
        .filter(p => p.pts.at(-1)![2] === level)
        // Each row's y: that of its longest segment (the run along the rabbet).
        .map(p => {
          let best = 1;
          for (let i = 2; i < p.pts.length; i++)
            if (Math.abs(p.pts[i][0] - p.pts[i - 1][0]) > Math.abs(p.pts[best][0] - p.pts[best - 1][0])) best = i;
          return p.pts[best][1];
        })
        .sort((a, b) => a - b);
      const gaps = ys.slice(1).map((y, i) => y - ys[i]);
      expect(gaps.length).toBeGreaterThan(1);
      for (const g of gaps) expect(g).toBeLessThanOrEqual(1.25 * 0.4 * d + 1e-6);
      // The last row stays 0.2 off the wall; the finishing pass at the floor takes it to size along y = 3.5 - r with
      // the wall on its right (climb): towards -x.
      expect(ys.at(-1)).toBeCloseTo(3.5 - d / 2 - 0.2, 2);
      const finish = pocket.passes.at(-1)!;
      expect(finish.pts.every(q => q[2] === 3.5)).toBe(true);
      const wall = finish.pts.filter(q => Math.abs(q[1] - (3.5 - d / 2)) < 1e-3);
      expect(wall.length).toBeGreaterThan(1);
      expect(wall.at(-1)![0]).toBeLessThan(wall[0][0]);
      expect(
        checkGcodeSafety(toGcode(camPart(rabbetBoard(), { tools: [bit(d)] })), {
          stockTop: 8,
          size: [200, 100],
          minZ: -0.3,
          toolRadius: d / 2,
        })
      ).toEqual([]);
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
    expect(gcode).toContain('(X0 Y0 = lower left corner of the stock, 200 x 100 mm. Z0 = stock bottom)');
    // Confirm, then the spindle starts and comes up to speed before the first move; off and end of program at the end.
    const lines = gcode.trim().split('\n');
    const m3 = lines.indexOf('M3 S15000');
    expect(lines[m3 - 1]).toMatch(/^M0 \(MSG Spindle starts at 15000 RPM next/);
    expect(lines[m3 + 1]).toBe('G4 P3');
    expect(lines.findIndex(l => /^G1 /.test(l))).toBeGreaterThan(m3);
    // Parked, a pause for whoever switches the spindle by hand (M5 did nothing there).
    expect(lines.slice(-5)).toEqual(['M5', 'X0 Y0', '(CAMNC PAUSE done)', 'M0 (MSG Program done. Manual spindle: off now)', 'M30']);
    expect(gcode).toMatch(/G[23] X/);
    const m = metrics(readGcode(gcode), 8);
    expect(m.zMin).toBeCloseTo(-0.3);
    expect(m.zLevels).toContain(4);
  });

  it('says in the header which board corner XY0 is', () => {
    const gcode = toGcode(camPart(board(), {}), { partName: 'Board B', board: 'B', stockSize: [600, 300, 8.3] });
    expect(gcode).toContain('(Board B)');
    expect(gcode).toContain('(X0 Y0 = lower left corner of board B, 600 x 300 mm. Z0 = stock bottom)');
    expect(gcode).not.toContain('of the part');
  });
});

describe('safety rules', () => {
  const limits = { stockTop: 8, size: [200, 100] as [number, number], minZ: -0.3, toolRadius: 3.175 / 2 };

  it('generated programs keep them, with and without tabs', () => {
    for (const tabs of [false, DEFAULT_TABS] as const) expect(checkGcodeSafety(toGcode(camPart(board(), { tabs })), limits)).toEqual([]);
  });

  it('flags rapids in the stock, moves off the board and cuts below the through depth', () => {
    const bad = ['G21 G90', 'M3 S15000', 'G0 Z13', 'G0 X10 Y10', 'G0 Z5', 'G1 X300 F1000', 'G1 X50 Z-1', 'G0 Z13'].join('\n');
    expect(checkGcodeSafety(bad, limits).map(i => i.rule)).toEqual(['rapid-in-stock', 'outside-board', 'too-deep']);
  });

  const stock = { ...limits, stockTop: 18, size: [300, 300] as [number, number] };

  it('flags cutting without a spindle and an absurd feed', () => {
    const bad = 'G0 Z23\nG0 X10 Y10\nG0 Z19\nG1 Z5 F480\nG1 X200 Y200 F99999\nG0 Z23\nM30\n';
    expect(checkGcodeSafety(bad, stock).map(i => i.rule)).toEqual(['spindle-off', 'bad-feed']);
  });

  it('flags cutting on after M5 until M3, once per stretch', () => {
    const start = 'G0 Z23\nM3 S15000\nG0 X10 Y10\nG1 Z5 F480\nG1 X20\n';
    expect(checkGcodeSafety(start, stock)).toEqual([]);
    const stopped = `${start}M5\nM0 (MSG hold it)\nG1 X30\nG1 X40\nM3 S15000\nG1 X50\nM5\nG1 X60\n`;
    expect(checkGcodeSafety(stopped, stock).map(i => i.rule)).toEqual(['spindle-off', 'spindle-off']);
    // M3 S0 turns nothing, and above the stock nothing is cut.
    expect(checkGcodeSafety('M3 S0\nG0 Z23\nG1 Z5 F480\n', stock).map(i => i.rule)).toEqual(['spindle-off']);
    expect(checkGcodeSafety('G0 Z30\nG1 Z23 F480\n', stock)).toEqual([]);
  });

  it('flags a cutting move with no feed, and lets a fast but sane one through', () => {
    expect(checkGcodeSafety('M3 S15000\nG0 Z23\nG1 Z5\n', stock).map(i => i.rule)).toEqual(['bad-feed']);
    expect(kMaxFeed).toBe(9000);
    expect(checkGcodeSafety(`M3 S15000\nG0 Z23\nG1 Z5 F${kMaxFeed}\n`, stock)).toEqual([]);
    expect(checkGcodeSafety(`M3 S15000\nG0 Z23\nG1 Z5 F${kMaxFeed + 1}\n`, stock).map(i => i.rule)).toEqual(['bad-feed']);
    expect(checkGcodeSafety('M3 S15000\nG0 Z23\nG1 Z5 F20000\n', { ...stock, maxFeed: 30000 })).toEqual([]);
  });

  it('flags a line FluidNC would refuse', () => {
    expect(checkGcodeSafety(`(${'x'.repeat(126)})\n`, stock).map(i => i.rule)).toEqual(['line-too-long']);
    expect(checkGcodeSafety(`(${'x'.repeat(125)})\n`, stock)).toEqual([]);
  });
});

describe('names in comments', () => {
  const op = { kind: 'profile', feature: 'outline', tool: { number: 1, diameter: 3.175, name: 'bit (flat); 2F' } } as const;
  const pass = {
    pts: [
      [0, 0, 7],
      [50, 0, 7],
    ],
    feeds: [480, 1800],
    link: 'retract',
  } as Pass;
  const named = (name: string) =>
    toGcode(
      {
        stockTop: 8,
        warnings: [`${name}: note`],
        operations: [
          {
            ...op,
            name: `${name}: Outline 1`,
            passes: [pass],
            pauseBefore: `Tab 1 of 2: spindle off until Resume. Hold away from bit: ${name}`,
          },
          { ...op, name: `${name}: Outline 2`, passes: [pass], pauseAfter: `Take out ${name}, then continue` },
          { ...op, name: `${name}: Outline 3`, passes: [pass] },
        ],
      },
      { partName: name, board: name }
    ).split('\n');
  /** What FluidNC does with a line: a comment ends at the first ")", what follows is G-code. */
  const afterComments = (l: string) => l.replace(/\([^()]*\)/g, '').trim();

  it('leaves no parenthesis or semicolon of a name in any comment, and the job view can still read the markers', () => {
    const lines = named('Seite (links);2');
    for (const l of lines) {
      expect(afterComments(l)).not.toMatch(/[()]/);
      if (l.includes('Seite')) {
        expect(l).toContain('Seite links2');
        expect(afterComments(l)).toMatch(/^(M0)?$/);
      }
    }
    expect(lines).toContain('(  T1 D=3.175 CR=0 - ZMIN=7 - bit flat 2F )');
    expect(lines).toContain('(OP 1/3 Seite links2: Outline 1 - T1 D=3.175)');
    expect(lines.filter(l => /^\(OP \d+\/\d+ .+ - T\d+ D=[\d.]+\)$/.test(l))).toHaveLength(3);
    expect(lines).toContain('M0 (MSG Take out Seite links2, then continue. Manual spindle: off now, on before Resume)');
  });

  it('keeps every line short enough for FluidNC, however long the name, and the prefixes the app looks for', () => {
    const lines = named('Länge'.repeat(60));
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(kMaxGcodeLine);
    expect(lines.filter(l => /^\(OP \d+\/\d+ .+ - T\d+ D=[\d.]+\)$/.test(l))).toHaveLength(3);
    expect(lines.some(l => l.startsWith('M0 (MSG Tab 1 of 2'))).toBe(true);
    expect(lines.some(l => l.startsWith('M0 (MSG Take out '))).toBe(true);
    for (const l of lines.filter(l => l.startsWith('M0 (MSG Take out ') || l.startsWith('M0 (MSG Tab ')))
      expect(l).toMatch(/\. Manual spindle: off now, on before Resume\)$/);
    expect(checkGcodeSafety(lines.join('\n'), { stockTop: 8, size: [200, 100], minZ: -0.3, toolRadius: 1.6 })).toEqual([]);
  });
});

describe('tab borders', () => {
  const tabs = { ...DEFAULT_TABS, minCount: 3 };

  it('steps down into uncut wood at the plunge feed, one feed per point, back to the cutting feed after', () => {
    const op = camPart(board(), { tabs }).operations.at(-1)!;
    const below = op.passes.filter(p => Math.min(...p.pts.map(q => q[2])) < tabs.height);
    expect(below.length).toBeGreaterThan(1);
    let steps = 0;
    for (const p of below) {
      expect(p.feeds).toHaveLength(p.pts.length);
      for (let i = 1; i < p.pts.length; i++) {
        const sideways = Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]);
        if (sideways > 1e-9) {
          expect(p.feeds[i]).toBeGreaterThan(480);
        } else if (p.pts[i][2] < p.pts[i - 1][2]) {
          expect(p.feeds[i]).toBe(480);
          steps++;
        }
      }
    }
    expect(steps).toBeGreaterThanOrEqual(3 * below.length);
  });

  it('comes out in the G-code: F480 on the way down, the feed again on the way along, arcs still fitted', () => {
    const gcode = toGcode(camPart(board(), { tabs }));
    const moves = readGcode(gcode);
    const down = moves.filter(
      m => !m.rapid && m.to[2] < m.from[2] && m.from[2] <= tabs.height && m.from[0] === m.to[0] && m.from[1] === m.to[1]
    );
    expect(down.length).toBeGreaterThan(3);
    for (const m of down) expect(m.feed).toBeLessThanOrEqual(480);
    expect(Math.max(...moves.filter(m => !m.rapid).map(m => m.feed))).toBe(1800);
    expect(gcode).toMatch(/^G[23] X/m);
    expect(checkGcodeSafety(gcode, { stockTop: 8, size: [200, 100], minZ: -0.3, toolRadius: 3.175 / 2 })).toEqual([]);
  });
});

describe('profile depth', () => {
  const circle = (d: number) =>
    Array.from({ length: 72 }, (_, i) => ({
      x: 50 + (d / 2) * Math.cos(-(i / 72) * 2 * Math.PI),
      y: 50 + (d / 2) * Math.sin(-(i / 72) * 2 * Math.PI),
    }));
  const pinBoard = (d: number): PartFeatures => ({
    ...board(),
    thickness: 18.3,
    levels: [],
    pockets: [],
    outlines: [],
    throughHoles: [circle(d)],
  });
  const levels = (op: { passes: { pts: number[][] }[] }) => op.passes.map(p => Math.min(...p.pts.map(q => q[2])));

  it('a hole far below the board steps down at the stepdown all the way', () => {
    const [op] = camPart(pinBoard(6), { tools: [{ number: 1, diameter: 3.175, stepdown: 1.6 }], finalZ: -6 }).operations;
    const z = [18.3, ...levels(op)];
    expect(z.at(-1)).toBeCloseTo(-6);
    for (let i = 1; i < z.length; i++) {
      expect(z[i - 1] - z[i]).toBeGreaterThan(0);
      expect(z[i - 1] - z[i]).toBeLessThanOrEqual(1.6);
    }
    // One pass at full depth, on the final path: what tab removal and freeing look for.
    expect(z.filter(v => Math.abs(v + 6) < 1e-6)).toHaveLength(1);
  });

  it('a normal through cut stays as it was: rough to 1 mm, then the final pass', () => {
    const [op] = camPart(pinBoard(10), { tools: [{ number: 1, diameter: 3.175, stepdown: 1.6 }] }).operations;
    expect(levels(op).slice(-2)).toEqual([1, -0.3]);
    expect(
      levels(camPart(pinBoard(10), { tools: [{ number: 1, diameter: 3.175, stepdown: 1.6 }], finalZ: -1 }).operations[0]).slice(-2)
    ).toEqual([1, -1]);
  });

  it('a hole hardly wider than the bit is still cut', () => {
    for (const d of [5.9, 5.8]) {
      const [op] = camPart(pinBoard(6), { tools: [{ number: 1, diameter: d }] }).operations;
      expect(op.passes.length).toBeGreaterThan(1);
      expect(levels(op).at(-1)).toBeCloseTo(-0.3);
    }
  });
});

describe('per-bit cutting data', () => {
  const main: Tool = { number: 1, diameter: 6, feed: 3000, plungeFeed: 900, rpm: 18000, stepover: 2.4, finalFeedFactor: 0.5 };
  const small: Tool = { number: 2, diameter: 2, feed: 500, plungeFeed: 150, rpm: 24000, stepover: 0.5, finalFeedFactor: 0.8 };
  /** A pocket only the small bit reaches, next to the board with its pocket for the main one. */
  function twoBits(): PartFeatures {
    const f = board();
    const slot = rect(100, 40, 104, 70);
    return {
      ...f,
      pockets: [...f.pockets, { floorZ: 6, region: [slot], strictRegion: [slot], above: [], area: 120 }],
      throughHoles: [],
    };
  }
  const allFeeds = (ops: { passes: { feeds: number[] }[] }[]) => new Set(ops.flatMap(o => o.passes.flatMap(p => p.feeds)));

  it('each bit cuts with its own feed, plunge feed, stepover, and its program starts the spindle at its speed', () => {
    const cam = camPart(twoBits(), { tools: [main, small], feed: main.feed, plungeFeed: main.plungeFeed, spindleRpm: main.rpm });
    const [ofSmall, ofMain] = [cam.operations.filter(o => o.tool === small), cam.operations.filter(o => o.tool === main)];
    expect(ofSmall.length).toBeGreaterThan(0);
    expect(ofMain.length).toBeGreaterThan(0);
    expect(allFeeds(ofSmall)).toEqual(new Set([500, 150]));
    expect([...allFeeds(ofMain)].every(f => f === 3000 || f === 900 || f === 1500)).toBe(true);
    const programs = splitByBit(cam).map(p => toGcode(p, { spindleRpm: main.rpm }));
    expect(programs).toHaveLength(2);
    expect(programs[0]).toMatch(/^M3 S24000$/m);
    expect(programs[0]).toContain('Spindle starts at 24000 RPM');
    expect(programs[0]).not.toMatch(/F3000|S18000/);
    expect(programs[1]).toMatch(/^M3 S18000$/m);
    expect(programs[1]).not.toMatch(/F500\b|S24000/);
  });

  it('uses the bit’s own stepover and final feed factor', () => {
    const rings = (tool: Tool) => camPart(board(), { tools: [{ ...tool, diameter: 3 }] }).operations[0].passes.length;
    expect(rings({ number: 1, diameter: 3, stepover: 0.6 })).toBeGreaterThan(rings({ number: 1, diameter: 3, stepover: 2 }));
    const outline = camPart(board(), { tools: [small] }).operations.at(-1)!;
    expect(outline.passes.at(-1)!.feeds[1]).toBeCloseTo(400);
  });

  it('a job with one bit comes out identical, the data on the bit or in the settings', () => {
    const data = { feed: 2400, plungeFeed: 360, stepoverFactor: 0.4, finalFeedFactor: 0.5 };
    const before = toGcode(camPart(board(), { tools: [{ number: 1, diameter: 3.175 }], ...data, tabs: DEFAULT_TABS }), {
      spindleRpm: 18000,
    });
    const onTool: Tool = {
      number: 1,
      diameter: 3.175,
      feed: 2400,
      plungeFeed: 360,
      rpm: 18000,
      stepover: 0.4 * 3.175,
      finalFeedFactor: 0.5,
    };
    expect(toGcode(camPart(board(), { tools: [onTool], ...data, tabs: DEFAULT_TABS }), { spindleRpm: 18000 })).toBe(before);
  });
});

describe('warnings', () => {
  const thick = (over: Partial<PartFeatures> = {}): PartFeatures => ({
    ...board(),
    thickness: 20.5,
    levels: [],
    pockets: [],
    throughHoles: [],
    ...over,
  });

  it('warns when a cut goes deeper than the flutes are long, and only then', () => {
    const lcf = (fluteLength?: number) => camPart(thick(), { tools: [{ number: 1, diameter: 6, fluteLength }] }).warnings;
    expect(lcf(12)).toEqual(['bit D=6 cuts 20.8 mm deep from the stock top, its flutes are 12 mm long']);
    expect(lcf(20.8)).toEqual([]);
    expect(lcf(25)).toEqual([]);
    expect(lcf(undefined)).toEqual([]);
    // From the stock top when the stock is thicker than the part.
    expect(camPart(thick(), { tools: [{ number: 1, diameter: 6, fluteLength: 21 }], stockTop: 21 }).warnings).toHaveLength(1);
    // Still cut: a warning, not a stop.
    expect(camPart(thick(), { tools: [{ number: 1, diameter: 6, fluteLength: 12 }] }).operations).toHaveLength(1);
  });

  const window = (w: number, h: number) => rect(50, 20, 50 + w, 20 + h).reverse();

  it('warns about the loose piece of a big through hole, not of a small one or a narrow slot', () => {
    const warn = (w: number, h: number, diameter = 3.175) =>
      camPart(thick({ throughHoles: [window(w, h)] }), { tools: [{ number: 1, diameter }] }).warnings;
    expect(warn(120, 60)[0]).toMatch(/^through hole 1: the 120 x 60 mm piece inside it comes loose on the last pass/);
    expect(warn(120, 60)[0]).toMatch(/Tape it down, or stop/);
    expect(warn(50, 50)).toEqual([]);
    expect(warn(30, 30)).toEqual([]);
    // Nothing left in the middle for the bit to catch: no piece.
    expect(warn(120, 22, 12)).toEqual([]);
    // Doesn't stop anything, and no through cuts on a second side: no piece.
    expect(camPart(thick({ throughHoles: [window(120, 60)] }), {}).operations.length).toBeGreaterThan(0);
    expect(camPart(thick({ throughHoles: [window(120, 60)] }), { cutThrough: false }).warnings).toEqual([]);
  });
});

describe('every generated program passes the rules', () => {
  it('with tabs, two bits, deep holes, warnings in the header', () => {
    const limits = { stockTop: 8, size: [200, 100] as [number, number], minZ: -0.3, toolRadius: 3 };
    const f = board();
    for (const tools of [
      [{ number: 1, diameter: 3.175 }],
      [
        { number: 1, diameter: 6, feed: 3000, rpm: 18000 },
        { number: 2, diameter: 2, feed: 500, rpm: 24000 },
      ],
    ])
      for (const tabs of [false, DEFAULT_TABS] as const)
        for (const p of splitByBit(camPart(f, { tools, tabs }))) expect(checkGcodeSafety(toGcode(p), limits)).toEqual([]);
  });
});

describe('pocket wall pass', () => {
  /** Closed pocket 9 x 21 like the kinderregal mortises, 4.2 deep in an 8 mm board. */
  function mortiseBoard(): PartFeatures {
    const f = board();
    const mortise = rect(100, 40, 121, 49);
    f.throughHoles = [];
    f.pockets = [
      { floorZ: 3.8, region: [mortise], strictRegion: [mortise], above: difference([rect(0, 0, 200, 100)], [mortise]), area: 189 },
    ];
    return f;
  }
  const r = 3.175 / 2;
  // Bit center limits: the wall ring is the rectangle x 101.59..119.41, y 41.59..47.41.
  const wall = { x0: 100 + r, x1: 121 - r, y0: 40 + r, y1: 49 - r };
  const distToWall = (q: number[]) => Math.min(q[0] - wall.x0, wall.x1 - q[0], q[1] - wall.y0, wall.y1 - q[1]);
  const angle = (a: number[], b: number[], c: number[]) => {
    const u = [b[0] - a[0], b[1] - a[1]],
      v = [c[0] - b[0], c[1] - b[1]];
    return (Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))) * 180) / Math.PI;
  };

  it('joins and leaves the wall on tangent arcs inside the pocket, never pushing into it', () => {
    const [pocket] = camPart(mortiseBoard(), { cutThrough: false }).operations;
    const walls = pocket.passes.filter(p => p.clearLink);
    // One wall pass per depth step (3 for 4.2mm at 0.5D in oak).
    expect(walls).toHaveLength(3);
    for (const pass of walls) {
      const pts = pass.pts;
      const lead = 6; // quarter arc samples before the wall, and after it
      const inP = pts[lead],
        outP = pts[pts.length - 1 - lead];
      expect(distToWall(inP)).toBeCloseTo(0, 3);
      expect(distToWall(outP)).toBeCloseTo(0, 3);
      // Tangent: the arc arrives along the wall direction and leaves along it (chord vs. wall < 15°).
      expect(angle(pts[lead - 1], inP, pts[lead + 1])).toBeLessThan(15);
      expect(angle(pts[pts.length - 2 - lead], outP, pts[pts.length - lead])).toBeLessThan(15);
      // Lead arcs stay inside the pocket, off the wall (radius r: up to 2r from the wall).
      for (const q of [...pts.slice(0, lead), ...pts.slice(pts.length - lead)]) {
        expect(distToWall(q)).toBeGreaterThan(0.01);
        expect(distToWall(q)).toBeLessThanOrEqual(2 * r + 1e-6);
      }
      // Entry in the middle of a long wall, away from the corners.
      expect(Math.abs(inP[0] - 110.5)).toBeLessThan(0.01);
    }
  });

  it('with a wall allowance: roughing stays off the walls, one full-depth pass cuts them to size', () => {
    const [pocket] = camPart(mortiseBoard(), { cutThrough: false, pocketWallAllowance: 0.2, pocketFinishFeedFactor: 0.5 }).operations;
    const finish = pocket.passes.at(-1)!;
    const rough = pocket.passes.slice(0, -1).flatMap(p => p.pts);
    expect(Math.min(...rough.map(distToWall))).toBeCloseTo(0.2, 3);
    expect(new Set(finish.pts.map(q => q[2]))).toEqual(new Set([3.8]));
    expect(Math.min(...finish.pts.map(distToWall))).toBeCloseTo(0, 3);
    expect(finish.feeds.slice(1).every(f => f === 900)).toBe(true);
  });
});
