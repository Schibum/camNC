import { describe, expect, it } from 'vitest';
import { camBoard, holdOptionsOf, holdsOnParts, jobHoldClashes, splitByBit, type BoardSpec } from './board';
import type { PartFeatures } from './features';
import { postProgram, toGcode } from './gcode';
import { holdTimeline } from './hold';
import { checkProgramSafety } from './safety';
import { estimateProgramTime } from './timing';
import { camPart, DEFAULT_TOOL } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const circle = (cx: number, cy: number, d: number) =>
  Array.from({ length: 96 }, (_, i) => ({
    x: cx + (d / 2) * Math.cos((i / 96) * 2 * Math.PI),
    y: cy + (d / 2) * Math.sin((i / 96) * 2 * Math.PI),
  }));

const T = 18;
const part = (holes: ReturnType<typeof circle>[]): PartFeatures => ({
  thickness: T,
  footprint: [rect(0, 0, 300, 120), ...holes.map(h => [...h].reverse())],
  outlines: [rect(0, 0, 300, 120)],
  throughHoles: holes,
  levels: [{ z: T, region: [rect(0, 0, 300, 120)], area: 1 }],
  pockets: [],
  bottomFaces: [],
  slopedArea: 0,
});
const tool = (diameter: number) => ({ ...DEFAULT_TOOL, diameter });
const board = (features: PartFeatures, over: Partial<BoardSpec> = {}): BoardSpec => ({
  id: 'a',
  name: 'A',
  w: 320,
  h: 140,
  thickness: T,
  holdDown: 'none',
  clearHoles: true,
  parts: [{ id: 'p1', name: 'P', features, size: [300, 120, T], x: 10, y: 10, rotated: false }],
  ...over,
});
const middleOps = (cam: ReturnType<typeof camBoard>) => cam.operations.filter(o => o.name.includes('middle'));

describe('the middle of a through hole', () => {
  it('goes when that is quick, is left for the vacuum when small, and is fixed by hand when clearing takes long', () => {
    const cam = camBoard(board(part([circle(30, 60, 16), circle(80, 60, 36), circle(200, 60, 100)])), { tools: [tool(6)] });
    expect(cam.holeMiddles?.map(m => [m.hole, m.state, m.part])).toEqual([
      [0, 'vacuum', 'p1'],
      [1, 'cleared', 'p1'],
      [2, 'loose', 'p1'],
    ]);
    expect(middleOps(cam).map(o => o.name)).toEqual(['P: Hole 2 middle']);
    expect(cam.warnings.join()).toMatch(/through hole 3: .* comes loose .*clear it/);
    expect(cam.warnings.join()).not.toMatch(/through hole [12]:/);
  });

  it('a bigger bit clears a hole in less time, so more of them go by themselves', () => {
    const features = part([circle(150, 60, 36)]);
    const state = (diameter: number) => camBoard(board(features), { tools: [tool(diameter)] }).holeMiddles?.[0].state;
    expect(state(3.175)).toBe('loose');
    expect(state(6)).toBe('cleared');
  });

  it('no middle when the bit takes it all', () => {
    expect(camBoard(board(part([circle(150, 60, 6)])), { tools: [tool(3.175)] }).holeMiddles).toBeUndefined();
  });

  it('the user can overrule size and time', () => {
    const features = part([circle(60, 60, 40), circle(200, 60, 70)]);
    const b = board(features);
    b.parts[0].holes = { 0: 'leave', 1: 'clear' };
    const cam = camBoard(b, { tools: [tool(3.175)] });
    expect(cam.holeMiddles?.map(m => [m.state, m.choice])).toEqual([
      ['loose', 'leave'],
      ['cleared', 'clear'],
    ]);
    expect(middleOps(cam).map(o => o.name)).toEqual(['P: Hole 2 middle']);
  });

  it('a big hole to clear is more points than fit on the call stack, and the flutes are still checked over all of them', () => {
    const outline = rect(0, 0, 340, 340);
    const hole = circle(170, 170, 300);
    const features = { ...part([hole]), footprint: [outline, [...hole].reverse()], outlines: [outline] };
    const b = board(features, { w: 360, h: 360 });
    Object.assign(b.parts[0], { size: [340, 340, T], holes: { 0: 'clear' } });
    const cam = camBoard(b, { tools: [{ ...tool(3.175), fluteLength: 10 }] });
    const points = middleOps(cam)[0].passes.reduce((n, p) => n + p.pts.length, 0);
    expect(points).toBeGreaterThan(130_000);
    expect(cam.warnings.join()).toMatch(/flutes are 10 mm long/);
  });

  it('clearing cuts the same wall, and leaves no piece: stays in the hole, posts, and passes the safety checks', () => {
    const hole = circle(150, 60, 40);
    const without = camBoard(board(part([hole]), { clearHoles: false }), { tools: [tool(3.175)] });
    const b = board(part([hole]));
    b.parts[0].holes = { 0: 'clear' };
    const cam = camBoard(b, { tools: [tool(3.175)] });
    const wall = (c: typeof cam) => c.operations.find(o => o.name === 'P: Hole 1')!.passes.flatMap(p => p.pts);
    expect(wall(cam)).toEqual(wall(without));
    const clearing = middleOps(cam)[0];
    const pts = clearing.passes.flatMap(p => p.pts);
    const r = Math.max(...pts.map(q => Math.hypot(q[0] - 160, q[1] - 70)));
    // Half the bit short of the wall, the bit's own radius further in; the contour's path sweeps the rest.
    expect(r).toBeLessThanOrEqual(20 - 3.175 + 0.05);
    expect(r).toBeGreaterThan(20 - 1.5 * 3.175);
    expect(Math.min(...pts.map(q => q[2]))).toBeCloseTo(-0.3);
    // Before the wall, so the contour has a free side.
    expect(cam.operations.findIndex(o => o === clearing)).toBeLessThan(cam.operations.findIndex(o => o.name === 'P: Hole 1'));
    for (const program of splitByBit(cam)) {
      const { gcode } = postProgram(program);
      expect(checkProgramSafety(program, gcode, { stockTop: cam.stockTop, size: [320, 140], minZ: -0.3, toolRadius: 3.175 / 2 })).toEqual(
        []
      );
    }
  });

  it('a screw on the middle keeps it: never cleared, not on the part, and not in the way of a big enough hole', () => {
    const features = part([circle(150, 60, 70)]);
    const screw = (x: number, y: number) => ({ x, y, kind: 'screw' as const, d: 10 });
    const b = board(features, {
      w: 380,
      h: 200,
      holdPoints: [screw(190, 100), screw(8, 8), screw(372, 8), screw(372, 192), screw(8, 192)],
    });
    Object.assign(b.parts[0], { x: 40, y: 40 });
    b.parts[0].holes = { 0: 'clear' };
    const cam = camBoard(b, { tools: [tool(3.175)] });
    expect(cam.holeMiddles?.[0].state).toBe('screwed');
    expect(middleOps(cam)).toEqual([]);
    expect(cam.warnings.join()).not.toMatch(/through hole/);
    expect(holdsOnParts(b)).toEqual([]);
    const programs = splitByBit(cam).map(p => ({ ...p, gcode: postProgram(p).gcode, diameter: 3.175 }));
    expect(jobHoldClashes(b, cam.stockTop, programs)).toEqual([]);
    expect(holdTimeline(cam, b, holdOptionsOf(b, { tools: [tool(3.175)] })).filter(e => e.kind === 'pivot')).toEqual([]);
  });

  it('a hold in a hole is not on a part of several outlines, a hold on any of them is', () => {
    const two = {
      ...part([circle(50, 60, 40)]),
      outlines: [rect(0, 0, 100, 120), rect(150, 0, 300, 120)],
    };
    const on = (x: number, y: number) => holdsOnParts(board(two, { holdPoints: [{ x, y, kind: 'screw', d: 10 }] }));
    expect(on(60, 70)).toEqual([]);
    expect(on(20, 20)).toHaveLength(1);
    expect(on(200, 70)).toHaveLength(1);
  });

  it('a hold on the part beside the hole still counts as on the part', () => {
    const b = board(part([circle(150, 60, 70)]), { holdPoints: [{ x: 50, y: 50, kind: 'screw', d: 10 }] });
    expect(holdsOnParts(b)).toHaveLength(1);
  });

  it('its estimate is close to what the program takes', () => {
    for (const d of [24, 40, 70]) {
      const hole = circle(150, 60, d);
      const b = board(part([hole]));
      b.parts[0].holes = { 0: 'clear' };
      const cam = camBoard(b, { tools: [tool(3.175)] });
      const planned = estimateProgramTime(toGcode({ ...cam, operations: middleOps(cam) })).estimatedAutomaticSeconds / 60;
      const shown = cam.holeMiddles![0].addMinutes;
      expect(shown).toBeCloseTo(planned, 1);
    }
  });

  it('copies of a part and planning it again reuse the clearing, so many holes stay quick', () => {
    const features = part(Array.from({ length: 6 }, (_, i) => circle(30 + i * 45, 60, 30)));
    const timed = () => {
      const started = performance.now();
      camBoard(board(features), { tools: [tool(3.175)] });
      return performance.now() - started;
    };
    const first = timed();
    expect(timed()).toBeLessThan(first);
  });

  it('a part planned on its own, or a board without `clearHoles`, keeps every hole a contour', () => {
    const features = part([circle(150, 60, 30)]);
    expect(camPart(features, { tools: [tool(3.175)] }).operations.map(o => o.name)).toEqual(['Hole 1', 'Outline 1']);
    expect(camPart(features, { tools: [tool(3.175)] }).holeMiddles).toBeUndefined();
    expect(middleOps(camBoard(board(features, { clearHoles: false }), { tools: [tool(3.175)] }))).toEqual([]);
  });
});
