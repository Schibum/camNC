import { describe, expect, it } from 'vitest';
import { parseGCode } from './gcodeParsing';
import { getZHeightColors } from './toolpathColors';

describe('getZHeightColors', () => {
  it('returns one rgb triple per path point', () => {
    const toolpath = parseGCode('G0 X0 Y0 Z5\nG1 X10 Y0 Z-1\nG1 X10 Y10 Z-2');
    const colors = getZHeightColors(toolpath);
    expect(colors).toHaveLength(toolpath.pathPoints.length * 3);
    expect(colors.every(c => Number.isFinite(c))).toBe(true);
  });

  it('handles toolpaths without any Z changes', () => {
    const toolpath = parseGCode('G0 X0 Y0\nG1 X10 Y0\nG1 X10 Y10');
    const colors = getZHeightColors(toolpath);
    expect(colors).toHaveLength(toolpath.pathPoints.length * 3);
    expect(colors.every(c => Number.isFinite(c))).toBe(true);
  });
});

describe('getZHeightColors with a range', () => {
  it('clamps points outside the range to its end colors', () => {
    const toolpath = parseGCode('G0 X0 Y0 Z5\nG1 Z-1 F100\nG1 X10 Z-2\nG1 Z-3');
    const colors = getZHeightColors(toolpath, { min: -2, max: -1 });
    const color = (i: number) => colors.slice(i * 3, i * 3 + 3);
    const last = toolpath.pathPoints.length - 1;
    // Z 5 gets the top color like Z -1; Z -3 the deepest color like Z -2.
    expect(color(1)).toEqual(color(2));
    expect(color(last)).toEqual(color(last - 1));
    expect(color(1)).not.toEqual(color(last));
  });
});
