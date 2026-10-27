import { describe, expect, it } from 'vitest';
import { AlarmRecord, explainAlarm } from './alarms';

const alarm = (code: number, messages: string[], extra: Partial<AlarmRecord> = {}): AlarmRecord => ({
  code,
  at: 0,
  messages,
  mpos: { x: 2.99, y: 120, z: -10 },
  job: { file: '/sd/camnc.gcode', percent: 42.5 },
  ...extra,
});

describe('explainAlarm', () => {
  it('explains a 3.9.1 soft limit with the travel camNC knows (recorded on a Jackpot2)', () => {
    const help = explainAlarm(alarm(2, ['INFO: Soft limit on X target:2.990', 'INFO: ALARM: Soft Limit']), {
      X: { min: 3, max: 1223 },
    });
    expect(help.title).toBe('ALARM:2 Soft limit: the move would exceed machine travel');
    expect(help.cause).toBe(
      'The job in camnc.gcode at 42.5 % moved X to 2.99 (machine coordinates), outside the X travel 3 to 1223. The toolpath reaches past the X minimum, or the work zero is too close to it.'
    );
    expect(help.fix).toBe(
      'Move the X zero at least 0.02 mm away from the minimum, or shrink the job. Then Unlock: the position is still correct.'
    );
  });

  it('uses the limits FluidNC 4.x reports itself', () => {
    const help = explainAlarm(alarm(2, ['INFO: Soft limit exceeded on Z axis: target -305.5 mm, limit [-297, 3] mm'], { job: null }));
    expect(help.cause).toContain('moved Z to -305.5 (machine coordinates), outside the Z travel -297 to 3');
    expect(help.fix).toContain('Move the Z zero at least 8.51 mm away from the minimum');
  });

  it('still helps with a soft limit without details', () => {
    expect(explainAlarm(alarm(2, [], { job: null })).cause).toBe("A move would leave the machine's travel.");
  });

  it('tells a reset while moving from other alarms', () => {
    expect(explainAlarm(alarm(3, [])).cause).toContain('position is no longer trusted');
    expect(explainAlarm(alarm(5, [])).fix).toContain('increase the probe travel');
    expect(explainAlarm(alarm(9, ['INFO: Homing fail on Y'])).cause).toBe('Homing on Y did not find the limit switch.');
  });
});
