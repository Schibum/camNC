import { describe, expect, it } from 'vitest';
import { parseToolInfo } from './guess-tools';

describe('parseToolInfo', () => {
  it('returns an empty list without a tools table', () => {
    expect(parseToolInfo('G0 X0 Y0')).toEqual([]);
  });

  it('parses integer diameters', () => {
    const gcode = ['(Tools Table:)', '(T1 D=6 CR=0 - ZMIN=-4 - flat end mill)', 'G0 X0'].join('\n');
    expect(parseToolInfo(gcode)).toEqual([{ tool: 1, diameter: 6, name: 'flat end mill', isFlat: true }]);
  });

  it('parses fractional diameters, corner radius and zmin as written by Fusion 360', () => {
    const gcode = [
      '(Tools Table:)',
      '(T1 D=3.175 CR=0. - ZMIN=-4. - flat end mill)',
      '(T2 D=6.35 CR=0.5 TAPER=30deg - ZMIN=-1.5 - chamfer mill)',
    ].join('\n');
    expect(parseToolInfo(gcode)).toEqual([
      { tool: 1, diameter: 3.175, name: 'flat end mill', isFlat: true },
      { tool: 2, diameter: 6.35, taper: 30, name: 'chamfer mill', isFlat: false },
    ]);
  });
});
