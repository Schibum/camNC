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

  it('keeps the rapid mode from a G53 block for a following move without a G word', () => {
    const toolpath = parseGCode('G0 X0 Y0 Z5\nG1 Z-1 F100\nG53 G0 Z0\nX20');
    expect(toolpath.modals.at(-1)!.motion).toBe('G0');
    expect(isRapidSegment(toolpath, toolpath.pathPoints.length - 1)).toBe(true);
    expect(toolpath.pathPoints.at(-1)!.toArray()).toEqual([20, 0, -1]);
    expect(toolpath.lines.at(-1)).toBe(4);
  });

  it('keeps feed mode and feed rate from a G53 block', () => {
    const toolpath = parseGCode('G0 X0 Y0 Z5\nG53 G1 Z-5 F250\nX20');
    expect(toolpath.modals.at(-1)!.motion).toBe('G1');
    expect(toolpath.feeds.at(-1)).toBe(250);
    expect(toolpath.pathPoints.at(-1)!.toArray()).toEqual([20, 0, 5]);
    expect(toolpath.pathPoints.some(p => p.z === -5)).toBe(false);
  });

  it('handles compact words and comments before the G53 word without changing comment-only G53 mentions', () => {
    const toolpath = parseGCode('G0X0Y0Z5\nG1Z-1F100\n(lift)g53g0z-5 ; Z-20\nX20\nG1X30 (G53)\nX40 ; G53');
    const atX20 = toolpath.pathPoints.findIndex(p => p.x === 20);
    expect(isRapidSegment(toolpath, atX20)).toBe(true);
    expect(toolpath.lines[atX20]).toBe(4);
    expect(toolpath.pathPoints.at(-1)!.toArray()).toEqual([40, 0, -1]);
    expect(toolpath.modals.at(-1)!.motion).toBe('G1');
    expect(toolpath.pathPoints.some(p => p.z === -5)).toBe(false);
  });
});
