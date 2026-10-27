import { describe, expect, it } from 'vitest';
import { gridLines } from './machineBedGrid';

describe('gridLines', () => {
  it('lines up with multiples of the step, not with the bed edge', () => {
    expect(gridLines(3, 621, 100)).toEqual([100, 200, 300, 400, 500, 600]);
  });

  it('includes lines on the edges and handles negative machine coordinates', () => {
    expect(gridLines(-300, 0, 100)).toEqual([-300, -200, -100, 0]);
  });

  it('does not drift on fractional steps', () => {
    const lines = gridLines(0, 10, 0.1);
    expect(lines).toHaveLength(101);
    expect(lines.at(-1)).toBeCloseTo(10, 9);
  });
});
