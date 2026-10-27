import { describe, expect, it } from 'vitest';
import { parseSoftLimitMessage } from './alarm-context';
import { parseMessageLine } from './stream-parser';

describe('parseSoftLimitMessage', () => {
  it('reads axis and target from FluidNC 3.9.1 (recorded from a Jackpot2)', () => {
    const message = parseMessageLine('[MSG:INFO: Soft limit on X target:2.990]')!;
    expect(parseSoftLimitMessage(message)).toEqual({ axis: 'X', target: 2.99 });
  });

  it('reads axis, target and limits from FluidNC 4.x', () => {
    const message = parseMessageLine('[MSG:INFO: Soft limit exceeded on Z axis: target -305.5 mm, limit [-297, 3] mm]')!;
    expect(parseSoftLimitMessage(message)).toEqual({ axis: 'Z', target: -305.5, min: -297, max: 3 });
  });

  it('ignores other messages', () => {
    expect(parseSoftLimitMessage('INFO: ALARM: Soft Limit')).toBeNull();
    expect(parseSoftLimitMessage('ERR: Reset to continue')).toBeNull();
  });
});
