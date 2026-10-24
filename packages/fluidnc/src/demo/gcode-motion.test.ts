import { describe, expect, it } from 'vitest';
import { compileGcode, MotionInterpreter } from './gcode-motion';

const zero = { x: 0, y: 0, z: 0 };
const total = (segments: { length: number }[]) => segments.reduce((sum, s) => sum + s.length, 0);

describe('MotionInterpreter', () => {
  it('moves in work coordinates and keeps feed and distance mode modal', () => {
    const interpreter = new MotionInterpreter({ x: 10, y: 10, z: 0 }, { x: 10, y: 10, z: 0 });
    expect(interpreter.line('G1 X5 F600')).toEqual([{ to: { x: 15, y: 10, z: 0 }, feed: 600, length: 5 }]);
    expect(interpreter.line('Y5')).toEqual([{ to: { x: 15, y: 15, z: 0 }, feed: 600, length: 5 }]);
    interpreter.line('G91');
    expect(interpreter.line('X1')[0]!.to).toEqual({ x: 16, y: 15, z: 0 });
  });

  it('treats G0 as a rapid and G53 as machine coordinates', () => {
    const interpreter = new MotionInterpreter({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 0 });
    expect(interpreter.line('G0 X1')[0]).toMatchObject({ to: { x: 101, y: 0, z: 0 }, feed: null });
    expect(interpreter.line('G53 G0 Z-5')[0]!.to.z).toBe(-5);
  });

  it('ignores comments, settings and lines without axes', () => {
    const interpreter = new MotionInterpreter(zero, zero);
    for (const line of ['', '(X10)', 'M3 S1000', 'G21 G90', 'G10 L20 P1 X0 Y0', '; G1 X5', 'G38.2 Z-10 F100']) {
      expect(interpreter.line(line)).toEqual([]);
    }
  });

  it('flattens arcs onto the circle and ends exactly at the target', () => {
    const interpreter = new MotionInterpreter({ x: 10, y: 0, z: 0 }, zero);
    const segments = interpreter.line('G3 X0 Y10 I-10 J0 F500');
    expect(segments.at(-1)!.to).toEqual({ x: 0, y: 10, z: 0 });
    for (const s of segments) expect(Math.hypot(s.to.x, s.to.y)).toBeCloseTo(10, 6);
    expect(total(segments)).toBeCloseTo((Math.PI * 20) / 4, 1);
  });

  it('goes the right way round for G2 and draws full circles', () => {
    const cw = new MotionInterpreter({ x: 10, y: 0, z: 0 }, zero).line('G2 X0 Y10 I-10 J0 F500');
    expect(total(cw)).toBeCloseTo((Math.PI * 20 * 3) / 4, 1);
    const full = new MotionInterpreter({ x: 10, y: 0, z: 0 }, zero).line('G3 X10 Y0 I-10 J0 F500');
    expect(total(full)).toBeCloseTo(Math.PI * 20, 0);
  });

  it('supports radius arcs', () => {
    const segments = new MotionInterpreter(zero, zero).line('G2 X10 Y0 R5 F500');
    expect(total(segments)).toBeCloseTo(Math.PI * 5, 0);
    expect(Math.max(...segments.map(s => s.to.y))).toBeCloseTo(5, 0);
  });
});

describe('compileGcode', () => {
  it('compiles a file relative to the start position', () => {
    const segments = compileGcode('G90\nG0 X0 Y0\nG1 X10 F1000\nG1 Y10', { x: 50, y: 50, z: 5 }, { x: 50, y: 50, z: 5 });
    expect(segments.map(s => s.to)).toEqual([
      { x: 50, y: 50, z: 5 },
      { x: 60, y: 50, z: 5 },
      { x: 60, y: 60, z: 5 },
    ]);
  });
});
