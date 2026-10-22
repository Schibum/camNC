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
