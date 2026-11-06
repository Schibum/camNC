import { describe, expect, it } from 'vitest';
import { estimateProgramTime, LOWRIDER_V4_REFERENCE_PROFILE, type MachineTimingProfile } from './timing';

const initialWorkPosition: [number, number, number] = [0, 0, 0];
const estimate = (code: string, profile: MachineTimingProfile = LOWRIDER_V4_REFERENCE_PROFILE) =>
  estimateProgramTime(code, profile, { initialWorkPosition });

describe('machine-profile timing', () => {
  it('computes an analytic trapezoidal straight move and reports its ideal lower bound', () => {
    const result = estimate('G21 G90 G94\nG1 X100 F600');
    expect(result.complete).toBe(true);
    expect(result.motionLowerBoundSeconds).toBeCloseTo(10, 8);
    expect(result.motionEstimateSeconds).toBeCloseTo(10.05, 8);
    expect(result.fullStopMotionSeconds).toBeCloseTo(10.05, 8);
    expect(result.profileProvenance).toBe('reference');
  });

  it('includes acceleration on short moves and limits high programmed Z feeds by the axis profile', () => {
    const short = estimate('G1 X1 F6000');
    expect(short.motionEstimateSeconds).toBeCloseTo(2 * Math.sqrt(1 / 200), 8);
    expect(short.motionEstimateSeconds).toBeGreaterThan(short.motionLowerBoundSeconds);
    const z = estimate('G1 Z20 F9000');
    expect(z.motionLowerBoundSeconds).toBeCloseTo(1, 8);
    expect(z.motionEstimateSeconds).toBeCloseTo(1.25, 8);
  });

  it('slows corners according to junction deviation and benefits from collinear lookahead', () => {
    const straight = estimate('G1 X50 F1800\nX100');
    const corner = estimate('G1 X50 F1800\nY50');
    expect(straight.motionEstimateSeconds).toBeLessThan(corner.motionEstimateSeconds);
    expect(straight.motionEstimateSeconds).toBeLessThan(straight.fullStopMotionSeconds);
    const tighter = estimate('G1 X50 F1800\nY50', { ...LOWRIDER_V4_REFERENCE_PROFILE, junctionDeviationMm: 0.0001 });
    expect(tighter.motionEstimateSeconds).toBeGreaterThan(corner.motionEstimateSeconds);
  });

  it('bounds lookahead by planner size without claiming a precise controller simulation', () => {
    const code = `G1 F6000\n${Array.from({ length: 100 }, (_, i) => `X${(i + 1) / 10}`).join('\n')}`;
    const small = estimate(code, { ...LOWRIDER_V4_REFERENCE_PROFILE, plannerBlocks: 2 });
    const large = estimate(code, { ...LOWRIDER_V4_REFERENCE_PROFILE, plannerBlocks: 32 });
    expect(small.motionEstimateSeconds).toBeGreaterThan(large.motionEstimateSeconds);
    expect(large.motionEstimateSeconds).toBeGreaterThanOrEqual(large.motionLowerBoundSeconds);
    expect(small.motionEstimateSeconds).toBeLessThanOrEqual(small.fullStopMotionSeconds);
    expect(large.uncertainty.join(' ')).toMatch(/not measured machine time/);
  });

  it('accounts for dwell separately and counts manual stops without inventing their duration', () => {
    const result = estimate('G1 X10 F600\nM0\nG4 P3.5\nX20\nM6\nM1\nM30');
    expect(result.dwellSeconds).toBe(3.5);
    expect(result.manualPauseCount).toBe(2);
    expect(result.optionalPauseCount).toBe(1);
    expect(result.estimatedAutomaticSeconds).toBeCloseTo(result.motionEstimateSeconds + 3.5, 8);
    expect(result.motionEstimateSeconds).toBeCloseTo(result.fullStopMotionSeconds, 8);
  });

  it('handles metric/inch and absolute/incremental feed state', () => {
    const metric = estimate('G21 G90\nG1 X25.4 F1524\nG91\nX25.4');
    const inch = estimate('G20 G90\nG1 X1 F60\nG91\nX1');
    expect(inch.complete).toBe(true);
    expect(inch.motionEstimateSeconds).toBeCloseTo(metric.motionEstimateSeconds, 8);
  });

  it('models arcs and helical travel in all three planes', () => {
    for (const code of ['G17\nG3 X-10 Y10 I-10 J0 F600', 'G18\nG3 X10 Z-10 I0 K-10 F600', 'G19\nG3 Y-10 Z10 J-10 K0 F600']) {
      const result = estimate(code);
      expect(result.complete).toBe(true);
      expect(result.motionLowerBoundSeconds).toBeCloseTo(Math.PI / 2, 3);
    }
    const helix = estimate('G17\nG3 X-10 Y10 Z-5 I-10 J0 F600');
    expect(helix.complete).toBe(true);
    expect(helix.motionLowerBoundSeconds).toBeGreaterThan(Math.PI / 2);
  });

  it('leaves unknown initial and machine-coordinate moves explicitly unresolved', () => {
    const unknown = estimateProgramTime('G0 Z10\nG53 G0 Z-5');
    expect(unknown.complete).toBe(false);
    expect(unknown.skippedMotionCount).toBe(2);
    expect(unknown.estimatedAutomaticSeconds).toBe(0);
    const known = estimateProgramTime('G0 Z10\nG53 G0 Z-5', LOWRIDER_V4_REFERENCE_PROFILE, {
      initialWorkPosition,
      workOffset: [0, 0, -20],
    });
    expect(known.complete).toBe(true);
    expect(known.motionLowerBoundSeconds).toBeCloseTo(0.75, 8);
  });

  it('can time relative distances even if the absolute starting coordinate is unknown', () => {
    const result = estimateProgramTime('G91\nG1 X100 F600');
    expect(result.complete).toBe(true);
    expect(result.motionEstimateSeconds).toBeCloseTo(10.05, 8);
  });

  it('flags unsupported coordinates or feed modes and bounds interpolation work', () => {
    for (const code of ['G90.1\nG1 X10 F600', 'G93\nG1 X10 F1', 'G55\nG1 X10 F600', 'G1 XNaN F600', 'G1 A90 F600'])
      expect(estimate(code).complete).toBe(false);
    const limited = estimateProgramTime('G3 X-10 Y10 I-10 J0 F600', LOWRIDER_V4_REFERENCE_PROFILE, { initialWorkPosition, maxSegments: 2 });
    expect(limited.complete).toBe(false);
    expect(limited.timedMotionSegments).toBe(0);
    expect(limited.warnings.join(' ')).toMatch(/segment limit/);
  });

  it('rejects malformed machine profiles', () => {
    expect(() => estimate('G1 X1 F600', { ...LOWRIDER_V4_REFERENCE_PROFILE, maxRateMmPerMin: [9000, 9000, 0] })).toThrow(
      /positive axis limits/
    );
    expect(() => estimate('G1 X1 F600', { ...LOWRIDER_V4_REFERENCE_PROFILE, plannerBlocks: 1 })).toThrow(/planner blocks/);
  });
});
