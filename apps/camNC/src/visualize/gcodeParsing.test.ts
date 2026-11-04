import { describe, expect, it } from 'vitest';
import { isRapidSegment } from './depthInspection';
import { parseGCode } from './gcodeParsing';

describe('parseGCode with moves in machine coordinates', () => {
  const program = `G0 X10 Y10 Z5
G1 Z-1 F100
G1 X20
G0 Z5
M5
G53 G0 Z-5
(CAMNC PAUSE done)
M0 (MSG Program done)
G0 X30
M30
`;

  it('the lift is no part of the path: no point at Z-5, bounds and cuts unchanged, the G-code kept as written', () => {
    const toolpath = parseGCode(program);
    expect(toolpath.pathPoints.some(p => p.z === -5)).toBe(false);
    expect(toolpath.getBounds().min.z).toBe(-1);
    expect(toolpath.gcode).toBe(program);
    const cuts = toolpath.pathPoints.map((_, i) => i).filter(i => i > 0 && !isRapidSegment(toolpath, i));
    expect(cuts.map(i => toolpath.pathPoints[i].z)).toEqual([-1, -1]);
  });

  it('moves after it keep their line numbers and the motion they were programmed with', () => {
    const toolpath = parseGCode(program);
    expect(toolpath.lines.at(-1)).toBe(9);
    expect(toolpath.pathPoints.at(-1)!.toArray()).toEqual([30, 10, 5]);
    expect(isRapidSegment(toolpath, toolpath.pathPoints.length - 1)).toBe(true);
  });

  it('a line with its own comment, and lower case: the same', () => {
    const toolpath = parseGCode('G0 Z5\ng53 g0 z-5 (lift)\nG0 X1');
    expect(toolpath.pathPoints.some(p => p.z === -5)).toBe(false);
    expect(toolpath.lines.at(-1)).toBe(3);
  });
});
