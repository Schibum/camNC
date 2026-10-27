import { describe, expect, it } from 'vitest';
import { pauseHint } from './pauseHints';

const percentAfter = (gcode: string, text: string) => {
  const bytes = new TextEncoder().encode(gcode);
  const end = gcode.indexOf('\n', gcode.indexOf(text)) + 1;
  return Math.round(((100 * new TextEncoder().encode(gcode.slice(0, end)).length) / bytes.length) * 100) / 100;
};

// Shape of a Fusion "MPCNC" post as run on a Jackpot2, padded to a realistic size.
const fusion = [
  '(  T3 D=6 CR=0 - ZMIN=-9.5 - flat end mill )',
  'G21',
  'G90',
  ';M0 (MSG Attach probe)',
  '( >>> Spindle Speed: Manual)',
  'M0 (MSG Turn ON 30000RPM)',
  '( COMMAND_COOLANT_ON)',
  'G0 Z8 F1200',
  'X144.277 Y9.049 F9000',
  ...Array.from({ length: 2000 }, (_, i) => `G1 X${i % 100} Y${i % 50} F1800`),
].join('\n');

describe('pauseHint', () => {
  it('finds the M0 the job stopped at from the SD progress and shows its message', () => {
    const hint = pauseHint(fusion, percentAfter(fusion, 'Turn ON'));
    expect(hint).toEqual({
      reason: 'The job stopped at a program pause (M0) on line 6: “Turn ON 30000RPM”.',
      next: 'Resume continues with the next move.',
      line: 6,
    });
  });

  it('ignores commented-out pauses and returns null away from any pause (feed hold)', () => {
    expect(pauseHint(fusion, 60)).toBeNull();
  });

  it('explains a probe and a tool change that come next', () => {
    const probe = 'G21\nM0 (MSG Attach probe)\nG38.2 Z-50 F100\n' + 'G1 X1\n'.repeat(500);
    expect(pauseHint(probe, percentAfter(probe, 'Attach'))?.next).toBe(
      'Next it probes Z (G38). Attach the probe clip and put the plate under the bit, then Resume.'
    );
    const toolChange = '(T2 D=3.175 CR=0 - ZMIN=-2 - flat end mill)\nG21\nT2 M6\nG0 Z5\n' + 'G1 X1\n'.repeat(500);
    const hint = pauseHint(toolChange, percentAfter(toolChange, 'T2 M6'));
    expect(hint?.reason).toBe('The job stopped at a tool change (M6) on line 3.');
    expect(hint?.next).toBe(
      'Tool change to T2 (3.175 mm flat end mill): change the bit, then Resume. Re-zero Z if the program does not probe.'
    );
  });
});
