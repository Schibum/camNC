import { describe, expect, it } from 'vitest';
import { rememberExecutionProgram } from './executionProgram';
import { runningJobTitle } from './jobs';

describe('runningJobTitle', () => {
  it('names a job camNC uploaded after the toolpath it was started from', () => {
    rememberExecutionProgram('camnc.gcode', 'G21');
    expect(runningJobTitle('/sd/camnc.gcode', 'regal Board A side B · ⌀6.gcode')).toBe('regal Board A side B · ⌀6');
    rememberExecutionProgram('camnc-resume.gcode', 'G21');
    expect(runningJobTitle('/sd/camnc-resume.gcode', 'part.nc (from line 12)')).toBe('part.nc (from line 12)');
  });

  it('falls back to the SD file name', () => {
    expect(runningJobTitle('/sd/camnc.gcode', null)).toBe('camnc');
    expect(runningJobTitle('/sd/other.gcode', 'regal Board A · ⌀6.gcode')).toBe('other');
    expect(runningJobTitle(undefined, 'x.gcode')).toBeUndefined();
  });
});
