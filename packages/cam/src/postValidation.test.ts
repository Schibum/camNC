import { describe, expect, it } from 'vitest';
import { readGcode } from './analyze';
import { fitArcs, FLUIDNC_POST_PROFILE, toGcode, validateFluidNCOutput, type GcodeOptions } from './gcode';
import { parsedPostNumber, quantizedArcIsSafe } from './postValidation';
import type { PartCam, Tool } from './toolpaths';
import type { Vec3 } from './geom';
import { planAccuracy } from './accuracy';

const tool: Tool = { number: 1, diameter: 3.175, guid: 'endmill-a', fluteLength: 20, flutes: 2 };
const program = (
  pts: Vec3[] = [
    [10, 10, 4],
    [20, 10, 4],
  ],
  bit = tool
): PartCam => ({
  stockTop: 5,
  warnings: [],
  operations: [
    { name: 'Pocket', kind: 'pocket', feature: 'pocket', tool: bit, passes: [{ pts, feeds: pts.map(() => 600), link: 'retract' }] },
  ],
});

describe('post input validation', () => {
  it('requires custom plan budgets to reserve the actual controller precision', () => {
    for (const field of ['outputRounding', 'controllerRounding'] as const) {
      const cam = program();
      cam.accuracy = planAccuracy();
      cam.accuracy.budget[field] = 0;
      expect(() => toGcode(cam, { arcs: false })).toThrow(/coordinate precision/);
    }
    const cam = program();
    cam.accuracy = planAccuracy();
    expect(() => toGcode(cam, { arcTolerance: cam.accuracy!.budget.fitting * 2 })).toThrow(/fitting budget/);
  });
  it.each([NaN, Infinity, -Infinity, 1e22])('rejects an unrepresentable coordinate (%s)', value => {
    expect(() =>
      toGcode(
        program([
          [10, 10, 4],
          [value, 10, 4],
        ])
      )
    ).toThrow(/finite decimal/);
  });

  it.each([NaN, Infinity, 0, -10, 0.0001])('rejects an invalid or rounded-zero feed (%s)', value => {
    const cam = program();
    cam.operations[0].passes[0].feeds[1] = value;
    expect(() => toGcode(cam)).toThrow(/feed.*(finite|positive)/);
  });

  it('requires a nonempty pass and one feed for every vertex', () => {
    const cam = program();
    cam.operations[0].passes[0].feeds.pop();
    expect(() => toGcode(cam)).toThrow(/every point must have a feed/);
    cam.operations[0].passes[0] = { pts: [], feeds: [], link: 'retract' };
    expect(() => toGcode(cam)).toThrow(/no points/);
    cam.operations[0].passes = [];
    expect(() => toGcode(cam)).toThrow(/no passes/);
  });

  it.each([
    { safeZ: 4 },
    { retractZ: 5.499 },
    { safeZ: NaN },
    { safeZ: 6, retractZ: 7 },
    { spindleDwell: -1 },
    { spindleRpm: Infinity },
    { arcTolerance: 0 },
    { arcTolerance: 0.0001 },
    { plungeFeed: 0 },
    { plungeFeed: NaN },
  ] satisfies GcodeOptions[])('rejects invalid post settings (%j)', options => {
    expect(() => toGcode(program(), options)).toThrow();
  });

  it('checks clearance after output rounding and accepts the minimum boundary', () => {
    const cam = { ...program(), stockTop: 5.0004 };
    expect(() => toGcode(cam, { safeZ: 5.5004, retractZ: 5.5004 })).toThrow(/clear stock top/);
    expect(() => toGcode(program(), { safeZ: 5.5, retractZ: 5.5 })).not.toThrow();
  });

  it('uses an explicit fallback plunge feed when a custom plan has no cutting-data provenance', () => {
    const cam = program();
    cam.operations[0].passes.push({
      pts: [
        [30, 10, 4],
        [40, 10, 4],
      ],
      feeds: [1000, 1000],
      link: 'direct',
      clearLink: true,
    });
    const approach = readGcode(toGcode(cam, { plungeFeed: 120 })).find(
      move => !move.rapid && move.to[0] === 30 && move.to[1] === 10 && move.to[2] === 4
    );
    expect(approach?.feed).toBe(120);
  });

  it('rejects equal diameters belonging to different physical tools', () => {
    for (const change of [{ number: 2 }, { guid: 'endmill-b' }, { fluteLength: 12 }, { flutes: 1 }, { stickout: 30 }]) {
      const cam = program();
      cam.operations.push(program(undefined, { ...tool, ...change }).operations[0]);
      expect(() => toGcode(cam)).toThrow(/One program per bit/);
    }
  });

  it('allows labels and cutting feeds to differ while enforcing a single resolved RPM', () => {
    const cam = program(undefined, { ...tool, rpm: 18000 });
    cam.operations.push(program(undefined, { ...tool, name: 'renamed', feed: 1200 }).operations[0]);
    expect(() => toGcode(cam, { spindleRpm: 18000 })).not.toThrow();
    expect(() => toGcode(cam, { spindleRpm: 15000 })).toThrow(/One spindle speed/);
  });

  it.each([{ diameter: 0 }, { number: -1 }, { number: 0.5 }, { number: NaN }, { diameter: NaN }, { fluteLength: Infinity }, { rpm: 0 }])(
    'rejects malformed tools (%j)',
    change => {
      expect(() => toGcode(program(undefined, { ...tool, ...change }))).toThrow();
    }
  );
});

describe('the controller output contract', () => {
  it('bounds absolute coordinates and models the decimal parser float32 conversion', () => {
    expect(parsedPostNumber(3844.837)).toBe(3844.836669921875);
    expect(parsedPostNumber(-3844.837)).toBe(-3844.836669921875);
    expect(parsedPostNumber(3844.837)).not.toBe(Math.fround(3844.837));
    expect(() =>
      toGcode(
        program([
          [1e6, 10, 4],
          [1e6 + 1, 10, 4],
        ])
      )
    ).toThrow(/coordinate window/);
    expect(() => validateFluidNCOutput('G0 X1000000\n')).toThrow(/coordinate window/);
    expect(() => parsedPostNumber(Infinity)).toThrow(/finite decimals/);
  });

  it('accepts normal travel coordinates and negative rotated placements within the supported window', () => {
    for (const center of [
      [2434, 1200],
      [-1200, -2434],
    ]) {
      const points: Vec3[] = Array.from({ length: 91 }, (_, i) => [
        center[0] + 5 * Math.cos((i * Math.PI) / 180),
        center[1] + 5 * Math.sin((i * Math.PI) / 180),
        4,
      ]);
      const output = toGcode(program(points));
      expect(output).toMatch(/^G3 /m);
      expect(() => validateFluidNCOutput(output)).not.toThrow();
    }
  });

  it('selects metric absolute motion and cancels stale compensation without changing the established work offset', () => {
    const output = toGcode(program(), { postProfile: 'fluidnc' });
    expect(output).toContain('G21 G90 G94 G17\nG40 G49 G80\n');
    expect(output).not.toMatch(/\bG(?:54|55|56|57|58|59|92|10)\b/);
    expect(output).toContain('G53 G0 Z-5');
    expect(FLUIDNC_POST_PROFILE.arcCenterMode).toBe('incremental');
    expect(() => validateFluidNCOutput(output)).not.toThrow();
  });

  it('rejects unsupported commands, nonnumeric output and overlong lines', () => {
    for (const output of ['G90.1\n', 'G41 X2\n', 'G1 XNaN\n', 'G1 X1e+22\n', 'G1 X1 F0\n', `(${'é'.repeat(64)})\n`])
      expect(() => validateFluidNCOutput(output)).toThrow();
    expect(() => toGcode(program(), { postProfile: 'other' } as unknown as GcodeOptions)).toThrow(/Unsupported post profile/);
  });
});

describe('bounded arc output', () => {
  const circular = (angles: number[], z: (index: number) => number = () => 4, radius = 10): Vec3[] =>
    angles.map((angle, index) => [20 + radius * Math.cos(angle), 20 + radius * Math.sin(angle), z(index)]);

  it('emits an in-tolerance helix and preserves every fitted endpoint depth', () => {
    const points = circular(
      Array.from({ length: 91 }, (_, i) => (i * Math.PI) / 180),
      i => 4 - i / 90
    );
    const output = toGcode(program(points));
    expect(output).toMatch(/^G3 .*Z3 /m);
    const cuts = readGcode(output).filter(move => !move.rapid);
    expect(cuts.at(-1)?.to).toEqual([20, 30, 3]);
    expect(Math.min(...cuts.flatMap(move => [move.from[2], move.to[2]]))).toBe(3);
  });

  it('retains source chords when the fitted circle would exceed the allowed deviation', () => {
    const points = circular([0, Math.PI / 6, Math.PI / 3, Math.PI / 2]);
    const output = toGcode(program(points));
    expect(output).not.toMatch(/^G[23] /m);
    const cuts = readGcode(output).filter(move => !move.rapid);
    for (const point of points) expect(cuts.some(move => move.to.every((value, axis) => value === +point[axis].toFixed(3)))).toBe(true);
  });

  it('does not turn an arc whose rounded endpoints coincide into an accidental full circle', () => {
    const points: Vec3[] = [0, Math.PI / 6, Math.PI / 3, Math.PI / 2].map(angle => [0.0004 * Math.cos(angle), 0.0004 * Math.sin(angle), 4]);
    expect(fitArcs(points.map(([x, y]) => ({ x, y }))).some(prim => prim.type === 'arc')).toBe(true);
    const output = toGcode(program(points));
    expect(output).not.toMatch(/^G[23] /m);
    expect(output).not.toMatch(/NaN|Infinity/);
  });

  it('checks radius mismatch using the rounded controller center and rejects nonlinear Z interpolation', () => {
    const arc = { c: { x: 0, y: 0 }, cw: false };
    const start = { x: 1, y: 0, z: 1 };
    const vertices = Array.from({ length: 19 }, (_, i) => ({
      x: Math.cos((i * Math.PI) / 36),
      y: Math.sin((i * Math.PI) / 36),
      z: 1 - i / 18,
    }));
    expect(quantizedArcIsSafe(start, vertices, arc, 0.01)).toBe(true);
    expect(quantizedArcIsSafe({ ...start, x: NaN }, vertices, arc, 0.01)).toBe(false);
    expect(quantizedArcIsSafe(start, [...vertices.slice(0, -1), { x: 0, y: 1.02, z: 0 }], arc, 0.01)).toBe(false);
    vertices[9].z += 0.1;
    expect(quantizedArcIsSafe(start, vertices, arc, 0.01)).toBe(false);
  });
});
