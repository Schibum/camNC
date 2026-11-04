import { describe, expect, it } from 'vitest';
import { offset, polyArea } from './geom';

const square = (s: number) => [
  [
    { x: 0, y: 0 },
    { x: s, y: 0 },
    { x: s, y: s },
    { x: 0, y: s },
  ],
];

describe('offset', () => {
  it('gives the same answer when asked again, and what it hands out can be changed without changing it', () => {
    const a = offset(square(10), 1);
    a[0][0].x = 999;
    a[0].pop();
    const b = offset(square(10), 1);
    expect(b[0][0].x).not.toBe(999);
    expect(polyArea(b)).toBeCloseTo(polyArea(offset(square(10), 1.0000001)), 2);
    // Another distance or shape: not mixed up with it.
    expect(polyArea(offset(square(10), 2))).toBeGreaterThan(polyArea(b));
    expect(polyArea(offset(square(11), 1))).toBeGreaterThan(polyArea(b));
  });
});
