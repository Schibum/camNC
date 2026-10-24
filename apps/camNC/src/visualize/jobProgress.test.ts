import { describe, expect, it } from 'vitest';
import { parseGCode } from './gcodeParsing';
import { motionLineEnds, progressPointIndex } from './jobProgress';

describe('job progress', () => {
  const gcode = 'G21\nG90\nG0 X0 Y0\nG1 X10 Y0 F100\nG1 X10 Y10\nG1 X0 Y10\nG1 X0 Y0\n';

  it('finds the end of every motion line', () => {
    expect(motionLineEnds(gcode)).toHaveLength(5);
    expect(motionLineEnds('G10 L20 P0 Z0\nG38.2 Z-5 F10\nG1 X1')).toHaveLength(1);
  });

  it('maps the SD percentage to a point index', () => {
    const toolpath = parseGCode(gcode);
    const ends = motionLineEnds(gcode);
    expect(progressPointIndex(toolpath, ends, 0)).toBe(0);
    expect(progressPointIndex(toolpath, ends, 100)).toBe(toolpath.pathPoints.length);
    const half = progressPointIndex(toolpath, ends, 60);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(toolpath.pathPoints.length);
  });
});
