import { describe, expect, it } from 'vitest';
import { camBoard, type BoardSpec } from './board';
import type { PartFeatures } from './features';
import { toGcode } from './gcode';
import { checkGcodeSafety } from './safety';
import { freePartsProgram } from './tabPlan';
import { DEFAULT_SETTINGS, type Tool } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const features = (w: number, h: number): PartFeatures => ({
  thickness: 12,
  footprint: [rect(0, 0, w, h)],
  outlines: [rect(0, 0, w, h)],
  throughHoles: [],
  levels: [{ z: 12, region: [rect(0, 0, w, h)], area: w * h }],
  pockets: [],
  bottomFaces: [],
  slopedArea: 0,
});
const tool: Tool = { number: 1, diameter: 6, name: 'flat', stepdown: 6, feed: 1800, plungeFeed: 330, stepover: 2.4, rpm: 30000 };
const settings = { tools: [tool], feed: 1800, plungeFeed: 330 };
const board = (over: Partial<BoardSpec> = {}): BoardSpec => ({
  id: 'b',
  name: 'b',
  w: 300,
  h: 200,
  thickness: 12,
  holdDown: 'skin',
  skin: 1,
  finishWallsAtRelease: true,
  parts: [{ id: 'p', name: 'p', features: features(100, 60), size: [100, 60, 12], x: 50, y: 50, rotated: false }],
  ...over,
});
const free = (cam: ReturnType<typeof camBoard>) =>
  freePartsProgram(cam, { feed: 900, plungeFeed: 300, finalZ: -0.3, stepdown: () => 6 }).cam;
const xs = (pts: number[][]) => pts.map(q => q[0]);

describe('finishing a skin part’s walls as it is cut free', () => {
  it('the main program stops on the roughing path, the cut-free lap is on the finished one', () => {
    const cam = camBoard(board(), settings);
    const outline = cam.operations.find(o => o.feature === 'outline')!;
    const main = outline.passes.flatMap(p => p.pts);
    // Part right edge at x=150, bit radius 3, 0.1 of stock.
    expect(Math.max(...xs(main))).toBeCloseTo(153.1, 2);
    expect(Math.min(...main.map(q => q[2]))).toBeCloseTo(1, 6);
    expect(outline.passes.some(p => p.phase === 'finish')).toBe(false);

    const [lap, ...rest] = free(cam).operations[0].passes;
    expect(rest).toEqual([]);
    const body = lap.pts.slice(1, -1);
    expect(Math.max(...xs(body))).toBeCloseTo(153, 2);
    expect(Math.min(...xs(body))).toBeCloseTo(47, 2);
    expect(new Set(lap.pts.map(q => q[2]))).toEqual(new Set([-0.3]));
    expect(lap.feeds[0]).toBe(300);
    expect(lap.feeds.slice(1).every(f => f === 900)).toBe(true);
  });

  it('enters and leaves through the cleared kerf, not against the finished wall', () => {
    const cam = camBoard(board(), settings);
    const { loop, approach } = cam.operations.find(o => o.feature === 'outline')!.finishAtRelease!;
    const { pts } = free(cam).operations[0].passes[0];
    expect(pts[0].slice(0, 2)).toEqual(approach.slice(0, 2));
    expect(pts.at(-1)!.slice(0, 2)).toEqual(approach.slice(0, 2));
    const off = Math.hypot(approach[0] - loop[0][0], approach[1] - loop[0][1]);
    expect(off).toBeGreaterThan(0.05);
    expect(off).toBeLessThan(0.2);
    expect(pts[1].slice(0, 2)).toEqual(loop[0].slice(0, 2));
  });

  it('a skin deeper than the stepdown: enters on the first lap, leaves on the last', () => {
    const cam = camBoard(board({ skin: 8 }), settings);
    const passes = free(cam).operations[0].passes;
    expect(passes).toHaveLength(2);
    const { approach } = cam.operations.find(o => o.feature === 'outline')!.finishAtRelease!;
    expect(passes[0].pts[0].slice(0, 2)).toEqual(approach.slice(0, 2));
    expect(passes[0].pts.at(-1)!.slice(0, 2)).not.toEqual(approach.slice(0, 2));
    expect(passes[1].pts[0].slice(0, 2)).not.toEqual(approach.slice(0, 2));
    expect(passes[1].pts.at(-1)!.slice(0, 2)).toEqual(approach.slice(0, 2));
  });

  it('a skin below the roughing floor: roughing still reaches it, so the lap only cuts the skin', () => {
    const cam = camBoard(board({ skin: 0.5 }), settings);
    const outline = cam.operations.find(o => o.feature === 'outline')!;
    expect(Math.min(...outline.passes.flatMap(p => p.pts.map(q => q[2])))).toBeCloseTo(0.5, 6);
  });

  it('follows the part when it lies turned on the board or the board is askew', () => {
    const part = { ...board().parts[0], rotated: true };
    const turned = camBoard(board({ parts: [part] }), settings).operations.find(o => o.feature === 'outline')!;
    // Lying turned, the part spans x 50..110: the finished lap is 3 outside it, roughing 3.1.
    expect(Math.max(...xs(turned.finishAtRelease!.loop))).toBeCloseTo(113, 2);
    expect(Math.max(...xs(turned.passes.flatMap(p => p.pts)))).toBeCloseTo(113.1, 2);
    const askew = camBoard(board({ parts: [part], rotationDeg: 30 }), settings).operations.find(o => o.feature === 'outline')!;
    const { loop, approach } = askew.finishAtRelease!;
    expect(Math.hypot(approach[0] - loop[0][0], approach[1] - loop[0][1])).toBeLessThan(0.2);
  });

  it('the program passes the safety checks', () => {
    const released = free(camBoard(board(), settings));
    expect(checkGcodeSafety(toGcode(released), { stockTop: 12, size: [300, 200], minZ: -0.3, toolRadius: 3 })).toEqual([]);
  });

  it.each([
    ['not asked for', { finishWallsAtRelease: false }, {}],
    ['too much stock for one lap', {}, { leaveStock: 1, profileFinishStepdown: 6 }],
  ])('keeps the final lap in the main program: %s', (_, spec, cutting) => {
    const cam = camBoard(board(spec), { ...settings, ...cutting });
    const outline = cam.operations.find(o => o.feature === 'outline')!;
    expect(outline.finishAtRelease).toBeUndefined();
    expect(outline.passes.at(-1)!.phase).toBe('finish');
    expect(Math.max(...xs(outline.passes.at(-1)!.pts))).toBeCloseTo(153, 2);
    // And the cut-free lap still follows the finished path, with no approach added.
    const { pts } = free(cam).operations[0].passes[0];
    expect(Math.max(...xs(pts))).toBeCloseTo(153, 2);
  });

  it('with zero wall stock, cuts to the skin once and still frees the part on the finished path', () => {
    const cam = camBoard(board(), { ...settings, leaveStock: 0 });
    const outline = cam.operations.find(o => o.feature === 'outline')!;
    expect(outline.finishAtRelease).toBeUndefined();
    expect(outline.passes.every(pass => pass.phase === 'rough')).toBe(true);
    const last = outline.passes.at(-1)!;
    expect(last.pts.every(point => point[2] === 1)).toBe(true);
    expect(Math.max(...xs(last.pts))).toBeCloseTo(153, 2);
    const released = free(cam);
    expect(Math.max(...xs(released.operations[0].passes[0].pts))).toBeCloseTo(153, 2);
    expect(checkGcodeSafety(toGcode(released), { stockTop: 12, size: [300, 200], minZ: -0.3, toolRadius: 3 })).toEqual([]);
  });

  it('tabs are not affected', () => {
    const cam = camBoard(board({ holdDown: 'tabs', finishWallsAtRelease: true }), settings);
    const outline = cam.operations.find(o => o.feature === 'outline')!;
    expect(outline.finishAtRelease).toBeUndefined();
    expect(outline.passes.at(-1)!.phase).toBe('finish');
  });
});

describe('a larger outline allowance on a tight board', () => {
  const two = (gap: number) =>
    board({
      parts: [
        { id: 'a', name: 'a', features: features(100, 60), size: [100, 60, 12], x: 20, y: 50, rotated: false },
        { id: 'b', name: 'b', features: features(100, 60), size: [100, 60, 12], x: 120 + gap, y: 50, rotated: false },
      ],
    });

  it('refuses an outline cut that reaches the neighboring part', () => {
    expect(() => camBoard(two(7), { ...settings, leaveStock: 1.5, profileFinishStepdown: 6 })).toThrow(/reaches a neighboring part/);
  });

  it('allows it with room to spare, and never checks the usual allowance', () => {
    expect(() => camBoard(two(9), { ...settings, leaveStock: 1.5, profileFinishStepdown: 6 })).not.toThrow();
    expect(() => camBoard(two(7), settings)).not.toThrow();
    expect(DEFAULT_SETTINGS.leaveStock).toBe(0.1);
  });
});
