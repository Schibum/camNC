import { describe, expect, it } from 'vitest';
import { readGcode } from './analyze';
import { camBoard, holdOptionsOf, jobHoldClashes, rotateAboutOrigin, splitByBit, type BoardSpec } from './board';
import type { PartFeatures } from './features';
import { sideBSpec } from './flip';
import { toGcode } from './gcode';
import { holdCheck, holdTimeline } from './hold';
import { heldByPoints, holdClashes, kColletClearance, type HoldPoint } from './holdPoints';
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

/** A tall clamp (a toggle or strap clamp, 30 mm above the stock), not the low edge clamp the defaults describe. */
const clamp = (x: number, y: number, over: Partial<HoldPoint> = {}): HoldPoint => ({ x, y, kind: 'clamp', d: 25, height: 30, ...over });
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
    expect(moves.length).toBeGreaterThanOrEqual(2);
    for (const m of moves) expect(m.to[2]).toBeGreaterThan(18.3 + 30);
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
    const toe: HoldPoint = { x: 250, y: 1, kind: 'clamp', d: 2, w: 20, dir: { x: 0, y: 1 }, height: 30 };
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

  it('side B lies at its own angle: its programs are turned back by that one', () => {
    const hold = screw(100, 100);
    const turn = rotateAboutOrigin(10);
    const [ax, ay] = turn([50, 200, 5]);
    const [bx, by] = turn([150, 200, 5]);
    const gcode = `G0 Z30\nG0 X${ax} Y${ay}\nG1 Z5 F300\nG1 X${bx} Y${by}\n`;
    const on = (rotationDeg: number, sideBRotationDeg?: number) =>
      jobHoldClashes({ h: 300, rotationDeg, sideBRotationDeg, holdPoints: [hold] }, 18, [{ gcode, diameter: 6, turned: true }]);
    expect(on(10)).toEqual([hold]);
    expect(on(0, 10)).toEqual([hold]);
    expect(on(10, 0)).toEqual([]);
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

describe('pockets and what holds the parts', () => {
  const R = (r: number, w: number, h: number) => ({ size: [w, h, 18] as [number, number, number], rotated: !!r });
  const longRabbets = [rect(0, 0, 400, 15), rect(0, 85, 400, 100)];
  /** The finding: 400 x 100 x 18 on 500 x 180, stock 18.3, a 5 mm deep underside rabbet along both long edges. */
  const board = (over: Partial<BoardSpec['parts'][number]> = {}, spec: Partial<BoardSpec> = {}): BoardSpec => ({
    id: 'a',
    name: 'A',
    w: 500,
    h: 180,
    thickness: 18,
    stockTop: 18.3,
    holdDown: 'tabs',
    tabs: DEFAULT_TABS,
    parts: [
      {
        id: 'p',
        name: 'p',
        features: plain(400, 100),
        underside: rabbeted(400, 100, 13.3, longRabbets, 18.3),
        ...R(0, 400, 100),
        x: 50,
        y: 40,
        ...over,
      },
    ],
    ...spec,
  });

  it("side B's rabbets: tabs on the short edges, none on the long ones it cuts away", () => {
    const b = board();
    const h = planTabs(b, {}).get('p')!;
    expect(h.how).toBe('placed');
    expect(h.tabs.length).toBeGreaterThanOrEqual(2);
    for (const t of h.tabs) expect(t.x < 50 || t.x > 450).toBe(true);
    // And the plan comes through the checks: no pocket event, all anchored.
    const cam = camBoard(b, {});
    const opts = holdOptionsOf(b);
    expect(holdCheck(cam, b, opts).every(p => p.ok && p.anchored === p.tabs.length)).toBe(true);
    expect(holdTimeline(cam, b, opts)).toEqual([]);
  });

  it('without the side B pockets it was the long edges, so the rabbets do move them', () => {
    const h = planTabs(board({ underside: undefined }), {}).get('p')!;
    expect(h.tabs.filter(t => t.x > 50 && t.x < 450)).toHaveLength(h.tabs.length);
  });

  it('tabs put under a pocket by hand are reported: not anchored, and blocking', () => {
    // Rabbets all round: no edge left for the planner; put there by hand, they land in the rabbet.
    const all = [rect(0, 0, 400, 15), rect(0, 85, 400, 100), rect(0, 0, 15, 100), rect(385, 0, 400, 100)];
    const tabsAt = [100, 300].flatMap(x => [
      { x, y: 0 },
      { x, y: 100 },
    ]);
    const b = board({ underside: rabbeted(400, 100, 13.3, all, 18.3), tabsAt });
    expect(planTabs(b, {}).get('p')!.how).toBe('placed');
    const cam = camBoard(b, {});
    const opts = holdOptionsOf(b);
    const [hold] = holdCheck(cam, b, opts);
    expect(hold.tabs.length).toBeGreaterThan(0);
    expect(hold.anchored).toBe(0);
    expect(holdTimeline(cam, b, opts).filter(e => e.kind === 'pocket')).toMatchObject([{ what: 'p', cut: 'tabs' }]);
  });

  it('rabbets all round: no tab spots; a skin thinner than the rabbet is cut away too, and that is reported', () => {
    const all = [rect(0, 0, 400, 15), rect(0, 85, 400, 100), rect(0, 0, 15, 100), rect(385, 0, 400, 100)];
    const b: BoardSpec = { ...board({ underside: rabbeted(400, 100, 13.3, all, 18.3) }), holdDown: 'skin' };
    expect(planTabs({ ...b, holdDown: 'tabs' }, {}).get('p')!.how).toBe('unheld');
    const events = holdTimeline(camBoard(b, {}), b, holdOptionsOf(b));
    expect(events).toMatchObject([{ kind: 'pocket', what: 'p', cut: 'skin' }]);
    // A skin thicker than the rabbet is deep (5 mm from the part's bottom, 18.3 - 13.3): it stays.
    const thick = { ...b, skin: 6 };
    expect(holdTimeline(camBoard(thick, {}), thick, holdOptionsOf(thick))).toEqual([]);
  });

  it('a skin kept on two opposite edges still surrounds the part; on one edge it does not', () => {
    const skin = { holdDown: 'skin' as const };
    // Rabbets on the long edges: the skin stays along both short ones, far more than tabs would hold.
    const two = board({}, skin);
    expect(holdTimeline(camBoard(two, {}), two, holdOptionsOf(two))).toEqual([]);
    // Three edges gone: it hangs on the fourth, and pivots about it.
    const three = board({ underside: rabbeted(400, 100, 13.3, [...longRabbets, rect(0, 0, 15, 100)], 18.3) }, skin);
    expect(holdTimeline(camBoard(three, {}), three, holdOptionsOf(three))).toMatchObject([{ kind: 'pocket', cut: 'skin' }]);
  });

  it('a side A rabbet with its floor below the tab height: no tabs there; above it: fine', () => {
    const low = board({ features: rabbeted(400, 100, 1, longRabbets), underside: undefined });
    for (const t of planTabs(low, {}).get('p')!.tabs) expect(t.x < 50 || t.x > 450).toBe(true);
    const high = board({ features: rabbeted(400, 100, 3, longRabbets), underside: undefined });
    expect(
      planTabs(high, {})
        .get('p')!
        .tabs.some(t => t.x > 50 && t.x < 450)
    ).toBe(true);
    // Forced there, the tab is thinner than assumed: not anchored.
    const forced = board({ features: rabbeted(400, 100, 1, [...longRabbets, rect(0, 0, 15, 100), rect(385, 0, 400, 100)]), underside: undefined, tabsAt: [100, 300].flatMap(x => [{ x, y: 0 }, { x, y: 100 }]) }); // prettier-ignore
    const [hold] = holdCheck(camBoard(forced, {}), forced, holdOptionsOf(forced));
    expect(hold.anchored).toBe(0);
  });

  it.each([
    [false, 400, 100, 50, 40, 500, 180],
    [true, 400, 100, 40, 50, 180, 500],
  ])('the turned frame is the one side B really cuts in (rotated %s)', (rotated, w, h, x, y, bw, bh) => {
    // One rabbet, on one long edge only, as side B sees the part.
    const under = rabbeted(w, h, 13.3, [rect(0, 85, w, h)], 18.3);
    const b: BoardSpec = {
      ...board({ underside: under, x, y, rotated }),
      w: bw,
      h: bh,
    };
    const tabs = planTabs(b, {}).get('p')!;
    expect(tabs.how).toBe('placed');
    const sideB = camBoard(
      sideBSpec(b, p => p.underside!),
      { cutThrough: false }
    );
    const cut = sideB.operations.flatMap(op => op.passes.flatMap(p => p.pts)).map(q => ({ x: q[0], y: bh - q[1] }));
    expect(cut.length).toBeGreaterThan(0);
    // The layer the plan went by agrees with the real path: it's where side B cuts.
    const layer = holdOptionsOf(b).layer!;
    for (const q of cut) expect(layer(q).from).toBeCloseTo(5, 6);
    // And no tab lands on that path.
    for (const t of tabs.tabs) expect(Math.min(...cut.map(q => Math.hypot(q.x - t.x, q.y - t.y)))).toBeGreaterThan(5);
  });

  it("side B's spec doesn't carry the underside on: it is its own top now", () => {
    const b = board();
    expect(sideBSpec(b, p => p.underside!).parts[0].underside).toBeUndefined();
  });
});

describe('held by points', () => {
  const plate = (w: number, h: number, x: number, y: number, thickness = 8): BoardSpec['parts'][number] => ({
    id: 'p',
    name: 'p',
    features: plain(w, h, thickness),
    size: [w, h, thickness],
    x,
    y,
    rotated: false,
  });

  it('a board with no screws on it: nothing fastens it, which is said, but its tabs hold on to stock at its edge', () => {
    const b: BoardSpec = {
      id: 'a',
      name: 'A',
      w: 400,
      h: 200,
      thickness: 8,
      holdDown: 'tabs',
      tabs: DEFAULT_TABS,
      holdPoints: [],
      parts: [plate(376, 176, 12, 12)],
    };
    const opts = holdOptionsOf(b);
    expect(opts.points).toEqual([]);
    expect(planTabs(b, {}).get('p')!.how).toBe('placed');
    const cam = camBoard(b, {});
    expect(holdCheck(cam, b, opts).every(p => p.ok)).toBe(true);
    const events = holdTimeline(cam, b, opts);
    expect(events[0]).toMatchObject({ kind: 'board', holds: 0, step: -1 });
    expect(events.some(e => e.kind === 'loose')).toBe(false);
    // Not given at all: held some other way (its edges), as before.
    const edges = { ...b, holdPoints: undefined };
    expect(holdTimeline(camBoard(edges, {}), edges, {})).toEqual([]);
    // Taped: nothing to say.
    expect(holdTimeline(cam, b, { taped: true })).toEqual([]);
    const taped = { ...b, taped: true };
    expect(holdTimeline(camBoard(taped, {}), taped, holdOptionsOf(taped))).toEqual([]);
  });

  it('two screws on one rail of a frame: the frame can turn, which is said; screws around it stop that', () => {
    const b: BoardSpec = {
      id: 'b',
      name: 'B',
      w: 1000,
      h: 500,
      thickness: 8,
      holdDown: 'tabs',
      tabs: DEFAULT_TABS,
      holdPoints: [screw(60, 15), screw(985, 15)],
      parts: [plate(920, 420, 40, 40)],
    };
    const opts = holdOptionsOf(b);
    const events = holdTimeline(camBoard(b, {}), b, opts);
    expect(events[0]).toMatchObject({ kind: 'board', holds: 2 });
    expect(events.some(e => e.kind === 'loose')).toBe(false);
    const around = { ...b, holdPoints: [screw(60, 15), screw(985, 15), screw(985, 485), screw(15, 485)] };
    expect(holdTimeline(camBoard(around, {}), around, holdOptionsOf(around))).toEqual([]);
    expect(holdCheck(camBoard(around, {}), around, holdOptionsOf(around)).every(p => p.ok)).toBe(true);
  });

  it('a piece cut off from the edge takes tabs only with enough holds on it', () => {
    // Four bars around a small part, their cuts meeting at the corners: the stock inside reaches no edge.
    const bar = (id: string, w: number, h: number, x: number, y: number): BoardSpec['parts'][number] => ({
      ...plate(w, h, x, y),
      id,
      name: id,
    });
    const parts = [
      bar('bottom', 300, 40, 30, 30),
      bar('top', 300, 40, 30, 230),
      bar('left', 40, 158, 30, 71),
      bar('right', 40, 158, 290, 71),
      bar('inner', 60, 40, 150, 130),
    ];
    const b = (holdPoints: HoldPoint[]): BoardSpec => ({
      id: 'b',
      name: 'B',
      w: 360,
      h: 300,
      thickness: 8,
      holdDown: 'tabs',
      tabs: DEFAULT_TABS,
      holdPoints,
      parts,
    });
    expect(planTabs(b([]), {}).get('inner')!.how).toBe('unheld');
    expect(planTabs(b([screw(100, 100), screw(260, 100), screw(180, 200)]), {}).get('inner')!.how).toBe('placed');
  });

  it('the 2-point rule is for strips only: narrow across the line between the holds, and held near both ends', () => {
    const pair = [
      { x: 5, y: 5 },
      { x: 495, y: 5 },
    ];
    const c = { x: 250, y: 5 };
    expect(heldByPoints(pair, c, rect(0, 0, 500, 10))).toBe(true);
    // The frame ring of a big part: small area, wide across.
    expect(heldByPoints(pair, { x: 250, y: 150 }, rect(0, 0, 500, 300))).toBe(false);
    // An L: its long leg is a strip, its other leg isn't.
    const l = [...rect(0, 0, 500, 10).slice(0, 2), { x: 500, y: 200 }, { x: 490, y: 200 }, { x: 490, y: 10 }, { x: 0, y: 10 }];
    expect(heldByPoints(pair, c, l)).toBe(false);
    // A strip with its holds close together in the middle: its ends flap.
    expect(
      heldByPoints(
        [
          { x: 240, y: 5 },
          { x: 260, y: 5 },
        ],
        c,
        rect(0, 0, 500, 10)
      )
    ).toBe(false);
    // One hold, or two on the same spot.
    expect(heldByPoints([pair[0]], c, rect(0, 0, 500, 10))).toBe(false);
    expect(heldByPoints([pair[0], pair[0]], c, rect(0, 0, 500, 10))).toBe(false);
  });
});

describe('freeing a skin', () => {
  const board = (skin: number): BoardSpec => ({
    id: 'b',
    name: 'B',
    w: 300,
    h: 200,
    thickness: 18,
    holdDown: 'skin',
    skin,
    parts: [{ id: 'p', name: 'p', features: plain(200, 100), size: [200, 100, 18], x: 40, y: 40, rotated: false }],
  });
  const stepdown = () => 1.6;

  it('a skin deeper than the bit may cut goes in laps, not one', () => {
    const cam = camBoard(board(5), {});
    const free = freePartsProgram(cam, { feed: 900, plungeFeed: 300, finalZ: -0.3, stepdown });
    const zs = free.cam.operations[0].passes.map(p => p.pts[0][2]);
    expect(zs).toHaveLength(4);
    expect(zs.at(-1)).toBeCloseTo(-0.3, 6);
    const steps = [5, ...zs].slice(1).map((z, i) => [5, ...zs][i] - z);
    for (const s of steps) expect(s).toBeLessThanOrEqual(1.6 + 1e-6);
    expect(free.cam.operations[0].passes.slice(1).every(p => p.link === 'direct')).toBe(true);
    // The usual skin: one lap.
    expect(freePartsProgram(camBoard(board(1), {}), { feed: 900, plungeFeed: 300, finalZ: -0.3, stepdown }).cam.operations[0].passes).toHaveLength(1); // prettier-ignore
  });

  it('turned over, the laps go down from the new top to just past the skin', () => {
    const cam = camBoard(board(5), {});
    const free = freePartsProgram(cam, { feed: 900, plungeFeed: 300, finalZ: -0.3, stepdown, turned: { h: 200 } });
    const zs = free.cam.operations[0].passes.map(p => p.pts[0][2]);
    expect(zs).toHaveLength(4);
    expect(zs.at(-1)).toBeCloseTo(18 - 5 - 0.3, 6);
    expect(18 - zs[0]).toBeLessThanOrEqual(1.6 + 1e-6);
  });
});
