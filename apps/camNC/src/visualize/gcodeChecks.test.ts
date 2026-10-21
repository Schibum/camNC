import { describe, expect, it } from 'vitest';
import { hasProbeOrZeroCommand } from './gcodeChecks';

describe('hasProbeOrZeroCommand', () => {
  it('detects probing moves', () => {
    expect(hasProbeOrZeroCommand('G21\nG38.2 Z-20 F100\nG0 Z5')).toBe(true);
  });

  it('detects setting a work offset', () => {
    expect(hasProbeOrZeroCommand('G10 L20 P0 Z0')).toBe(true);
    expect(hasProbeOrZeroCommand('g10 l2 p1 z0')).toBe(true);
  });

  it('returns false for plain toolpaths', () => {
    expect(hasProbeOrZeroCommand('G21\nG0 X0 Y0\nG1 Z-1 F100\nG100')).toBe(false);
  });
});
