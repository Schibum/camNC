import { describe, expect, it } from 'vitest';
import { readGcode } from './analyze';
import { camBoard, holdOptionsOf, jobHoldClashes, rotateAboutOrigin, splitByBit, type BoardSpec } from './board';
import type { PartFeatures } from './features';
import { sideBSpec } from './flip';
import { toGcode } from './gcode';
import { holdCheck, holdTimeline } from './hold';
import { frameMargin, heldByPoints, holdClashes, kColletClearance, suggestHoldPoints, type HoldPoint } from './holdPoints';
import { freePartsProgram, planTabs } from './tabPlan';
import { tabRemovalProgram } from './tabRemoval';
import { DEFAULT_TABS } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const plain = (w: number, h: number, thickness = 18): PartFeatures => ({
  thickness,
  footprint: [rect(0, 0, w, h)],
  outlines: [rect(0, 0, w, h)],
  throughHoles: [],
  levels: [],
  pockets: [],
  bottomFaces: [],
  slopedArea: 0,
});

/** The same part with open pockets (rabbets) in `regions`, all with their floor at `floorZ`. */
const rabbeted = (w: number, h: number, floorZ: number, regions: ReturnType<typeof rect>[], thickness = 18): PartFeatures => ({
  ...plain(w, h, thickness),
  pockets: [{ floorZ, region: regions, strictRegion: regions, above: [], area: 1 }],
});

const clamp = (x: number, y: number, over: Partial<HoldPoint> = {}): HoldPoint => ({ x, y, kind: 'clamp', d: 25, ...over });
const screw = (x: number, y: number): HoldPoint => ({ x, y, kind: 'screw', d: 10 });

describe('rapids and links over holds', () => {
  // Two parts with a clamp in the waste between them, screws at the corners.
  const board = (holds: HoldPoint[]): BoardSpec => ({
    id: 'a',
    name: 'A',
    w: 500,
    h: 300,
    thickness: 18,
    stockTop: 18.3,
    holdDown: 'tabs',
    tabs: DEFAULT_TABS,
    holdPoints: holds,
    parts: [
      { id: 'l', name: 'l', features: plain(180, 200), size: [180, 200, 18], x: 30, y: 30, rotated: false },
      { id: 'r', name: 'r', features: plain(180, 200), size: [180, 200, 18], x: 290, y: 30, rotated: false },
    ],
  });
  const corners = [screw(60, 15), screw(485, 15), screw(485, 285), screw(15, 285)];
  const sideways = (gcode: string) => readGcode(gcode).filter(m => m.rapid && Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]) > 1e-6);

  it('every rapid, the program end included, goes above the tallest hold (clamp in the waste: 30 mm above the stock)', () => {
    const b = board([clamp(250, 117), ...corners]);
    const cam = camBoard(b, {});
    expect(cam.safeZ).toBeCloseTo(18.3 + 30 + 5, 6);
    expect(cam.retractZ).toBeCloseTo(18.3 + 30 + 2, 6);
    const gcode = toGcode(cam);
    const moves = sideways(gcode);
    expect(moves.length).toBeGreaterThan(2);
    for (const m of moves) expect(m.to[2]).toBeGreaterThan(18.3 + 30);
    expect(moves.at(-1)!.to.slice(0, 2)).toEqual([0, 0]);
    expect(jobHoldClashes(b, 18.3, [{ gcode, diameter: 3.175 }])).toEqual([]);
  });

  it('the check sees rapids: a program at the old heights runs into the clamp, however low the cuts stay from it', () => {
    const b = board([clamp(250, 117), ...corners]);
    const cam = camBoard(b, {});
    const low = toGcode({ ...cam, safeZ: undefined, retractZ: undefined });
    expect(jobHoldClashes(b, 18.3, [{ gcode: low, diameter: 3.175 }]).map(h => h.x)).toContain(250);
    // Not for the cuts: they keep their distance.
    const cuts = cam.operations.flatMap(op => op.passes.map(p => ({ r: op.tool.diameter / 2, pts: p.pts })));
    expect(holdClashes(b.holdPoints!, cuts, cam.stockTop)).toEqual([]);
  });

  it('the way back to X0 Y0 alone counts: only that move crosses this hold', () => {
    const hold = clamp(40, 30, { d: 20 });
    const gcode = [
      'G21 G90',
      'G0 Z23.3',
      'G0 X300 Y180', // Clear of the clamp.
      'G1 Z10 F300',
      'G0 Z23.3',
      'G0 X0 Y0',
      'M30',
    ].join('\n');
    expect(jobHoldClashes({ h: 300, holdPoints: [hold] }, 18.3, [{ gcode, diameter: 6 }])).toEqual([hold]);
  });

  it('screws sit low: rapids and retract links just above their heads, not at a clamp height', () => {
    const cam = camBoard(board(corners), {});
    expect(cam.safeZ).toBeCloseTo(18.3 + 3 + 5, 6);
    expect(cam.retractZ).toBeCloseTo(18.3 + 3 + 2, 6);
    // Directly over a screw at that height: fine. At the old retract height, 2 mm above the stock: under its head's top.
    const over = (z: number) => holdClashes([screw(100, 15)], [{ r: 3, pts: [[50, 15, z], [150, 15, z]] }], 18.3); // prettier-ignore
    expect(over(cam.retractZ!)).toEqual([]);
    expect(over(18.3 + 2)).toHaveLength(1);
    // Without holds: the plain heights.
    const none = camBoard({ ...board([]), holdPoints: undefined }, {});
    expect([none.safeZ, none.retractZ]).toEqual([undefined, undefined]);
  });

  it('every program of the board keeps the heights: per bit, freeing, tab removal', () => {
    const b = board([clamp(250, 117), ...corners]);
    const cam = camBoard(b, {});
    expect(splitByBit(cam)[0]).toMatchObject({ safeZ: cam.safeZ, retractZ: cam.retractZ });
    const free = freePartsProgram(camBoard({ ...b, holdDown: 'skin' }, {}), { feed: 900, plungeFeed: 300, finalZ: -0.3 });
    const tabs = tabRemovalProgram(cam, { feed: 900, plungeFeed: 300 });
    for (const program of [free.cam, tabs.cam]) {
      expect(program.operations.length).toBeGreaterThan(0);
      for (const m of sideways(toGcode(program))) expect(m.to[2]).toBeGreaterThan(18.3 + 30);
    }
  });

  it('the clamp toe: rapids over it clash, its shape counts, not a circle; the collet nut keeps away from a tall one', () => {
    const toe: HoldPoint = { x: 250, y: 1, kind: 'clamp', d: 2, w: 20, dir: { x: 0, y: 1 } };
    const line = (x0: number, y0: number, x1: number, y1: number, z: number) => [
      {
        r: 3,
        pts: [
          [x0, y0, z],
          [x1, y1, z],
        ] as [number, number, number][],
      },
    ];
    // A rapid along the edge, above the stock but below the clamp.
    expect(holdClashes([toe], line(100, 1, 400, 1, 23.3), 18)).toHaveLength(1);
    // Above it: nothing.
    expect(holdClashes([toe], line(100, 1, 400, 1, 18 + 30 + 2), 18)).toEqual([]);
    // Off the toe's end along the edge: 10 mm from its centre the toe ends, so 13 further is the collet's limit.
    expect(holdClashes([toe], line(250 + 10 + kColletClearance + 0.1, -5, 250 + 10 + kColletClearance + 0.1, 100, 2), 18)).toEqual([]);
    expect(holdClashes([toe], line(250 + 10 + kColletClearance - 1, -5, 250 + 10 + kColletClearance - 1, 100, 2), 18)).toHaveLength(1);
    // A cut beside it: the bit alone would pass at 4.5 mm; the nut doesn't, unless the clamp is low.
    const beside = line(0, 2 + 6, 500, 2 + 6, 2);
    expect(holdClashes([toe], beside, 18)).toHaveLength(1);
    expect(holdClashes([{ ...toe, height: 5 }], beside, 18)).toEqual([]);
    // The frame and the suggestions leave that room.
    const m = frameMargin(2, 6, 'clamp');
    const parts = [{ x: m, y: m, w: 500 - 2 * m, h: 300 - 2 * m }];
    expect(suggestHoldPoints({ w: 500, h: 300 }, parts, { kind: 'clamp', d: 2, w: 20, bit: 6 }).length).toBeGreaterThanOrEqual(4);
    expect(suggestHoldPoints({ w: 500, h: 300 }, [{ x: 8, y: 8, w: 484, h: 284 }], { kind: 'clamp', d: 2, w: 20, bit: 6 })).toEqual([]);
  });

  it('a board askew on the bed: the program is turned back to the holds before checking', () => {
    const hold = screw(100, 100);
    const turn = rotateAboutOrigin(10);
    const [ax, ay] = turn([50, 100, 5]);
    const [bx, by] = turn([150, 100, 5]);
    const gcode = `G0 Z30\nG0 X${ax} Y${ay}\nG1 Z5 F300\nG1 X${bx} Y${by}\n`;
    expect(jobHoldClashes({ h: 300, rotationDeg: 10, holdPoints: [hold] }, 18, [{ gcode, diameter: 6 }])).toEqual([hold]);
    expect(jobHoldClashes({ h: 300, holdPoints: [hold] }, 18, [{ gcode, diameter: 6 }])).toEqual([]);
  });

  it('programs for the turned board meet the holds in the same spots on the wood: at x, H - y', () => {
    const hold: HoldPoint = { x: 100, y: 3, kind: 'clamp', d: 6, w: 20, dir: { x: 0, y: 1 }, height: 5 };
    // On the bed, the lower edge of the board as it now lies: the upper edge when side A was cut.
    const nearBottom = `G0 Z30\nG0 X50 Y3\nG1 Z5 F300\nG1 X150 Y3\n`;
    const nearTop = `G0 Z30\nG0 X50 Y297\nG1 Z5 F300\nG1 X150 Y297\n`;
    const on = (gcode: string, turned: boolean) => jobHoldClashes({ h: 300, holdPoints: [hold] }, 18, [{ gcode, diameter: 6, turned }]);
    expect(on(nearBottom, false)).toEqual([hold]);
    expect(on(nearTop, false)).toEqual([]);
    expect(on(nearTop, true)).toEqual([hold]);
    expect(on(nearBottom, true)).toEqual([]);
  });
});
