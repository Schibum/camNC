import { describe, expect, it } from 'vitest';
import { resolveToolShape, shapeFromToolInfo, sweptToolDepth, ToolShape } from './toolShapes';

const flat: ToolShape = { kind: 'flat', radius: 3 };
const ball: ToolShape = { kind: 'ball', radius: 3 };
const vbit: ToolShape = { kind: 'vbit', radius: 3, halfAngle: 45 };

describe('tool shapes', () => {
  it('guesses shapes from the tool table', () => {
    expect(shapeFromToolInfo({ tool: 1, diameter: 6, name: 'flat end mill', isFlat: true })).toEqual({ kind: 'flat', radius: 3 });
    expect(shapeFromToolInfo({ tool: 2, diameter: 6, name: 'ball end mill', isFlat: false })).toEqual({ kind: 'ball', radius: 3 });
    expect(shapeFromToolInfo({ tool: 3, diameter: 6, taper: 30, name: 'engrave', isFlat: false })).toEqual({
      kind: 'vbit',
      radius: 3,
      halfAngle: 30,
    });
  });

  it('uses the tool table diameter, the setting otherwise, and the chosen shape', () => {
    const tools = [{ tool: 2, diameter: 4, name: 'flat', isFlat: true }];
    expect(resolveToolShape(2, tools, 6, 'auto')).toEqual({ kind: 'flat', radius: 2 });
    expect(resolveToolShape(5, [], 6, 'auto')).toEqual({ kind: 'flat', radius: 3 });
    expect(resolveToolShape(5, [], 6, 'vbit60')).toEqual({ kind: 'vbit', radius: 3, halfAngle: 30 });
  });
});

describe('swept tool depth', () => {
  const a = { x: 0, y: 0, z: -2 };
  const b = { x: 10, y: 0, z: -2 };

  it('cuts a flat bottomed slot as wide as the tool', () => {
    expect(sweptToolDepth(flat, a, b, 5, 2.9)).toBeCloseTo(-2);
    expect(sweptToolDepth(flat, a, b, 5, 3.1)).toBe(Infinity);
    // Round end beyond the segment.
    expect(sweptToolDepth(flat, a, b, 12.5, 0)).toBeCloseTo(-2);
    expect(sweptToolDepth(flat, a, b, 12.5, 2)).toBe(Infinity);
  });

  it('cuts a round bottomed slot with a ball end', () => {
    expect(sweptToolDepth(ball, a, b, 5, 0)).toBeCloseTo(-2);
    expect(sweptToolDepth(ball, a, b, 5, 3)).toBeCloseTo(1);
    expect(sweptToolDepth(ball, a, b, 5, 1.5)).toBeCloseTo(-2 + 3 - Math.sqrt(9 - 2.25));
  });

  it('cuts a V groove with a V-bit', () => {
    expect(sweptToolDepth(vbit, a, b, 5, 0)).toBeCloseTo(-2);
    expect(sweptToolDepth(vbit, a, b, 5, 1)).toBeCloseTo(-1);
  });

  it('takes the deepest point of a ramp', () => {
    const ramp = { x: 10, y: 0, z: -4 };
    expect(sweptToolDepth(flat, a, ramp, 5, 0)).toBeCloseTo(-3.6);
    expect(sweptToolDepth(ball, a, ramp, 10, 0)).toBeCloseTo(-4, 1);
  });

  it('cuts a round hole when plunging', () => {
    const top = { x: 0, y: 0, z: 1 };
    const bottom = { x: 0, y: 0, z: -5 };
    expect(sweptToolDepth(flat, top, bottom, 2, 2)).toBeCloseTo(-5);
    expect(sweptToolDepth(flat, top, bottom, 3, 3)).toBe(Infinity);
  });
});
