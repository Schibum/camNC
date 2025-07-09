// fluidnc-parser.test.ts
import { describe, expect, it } from 'vitest';
import { parseFluidNCLine, parseFluidNCModalLine, parseFluidNCOffsetLine } from './fluidnc-stream-parser';

describe('parseFluidNCLine', () => {
  it('parses a simple <Run> frame with extra axes in MPos', () => {
    const line = '<Run|MPos:0.000,0.000,0.000,1.000,1.000|FS:0,0|Pn:P>';
    const parsed = parseFluidNCLine(line)!;

    expect(parsed.state).toBe('Run');
    expect(parsed.subState).toBeUndefined();
    expect(parsed.mpos).toEqual({
      x: 0,
      y: 0,
      z: 0,
      extra: [1, 1],
    });
    expect(parsed.wco).toBeUndefined();
    expect(parsed.wpos).toBeUndefined();
  });

  it('parses an <Idle> frame that also reports WCO', () => {
    const line = '<Idle|MPos:84.507,555.546,-89.070|FS:0,15000|Pn:P|WCO:24.282,492.352,-85.070>';
    const parsed = parseFluidNCLine(line)!;

    expect(parsed.state).toBe('Idle');
    expect(parsed.mpos!.x).toBeCloseTo(84.507);
    expect(parsed.mpos!.y).toBeCloseTo(555.546);
    expect(parsed.mpos!.z).toBeCloseTo(-89.07);

    expect(parsed.wco).toEqual({
      x: 24.282,
      y: 492.352,
      z: -85.07,
    });
  });

  it('parses a <Hold:0> frame and extracts the sub-state', () => {
    const line = '<Hold:0|MPos:24.401,491.469,-79.070|FS:0,15000|WCO:24.410,491.468,-85.070>';
    const parsed = parseFluidNCLine(line)!;

    expect(parsed.state).toBe('Hold');
    expect(parsed.subState).toBe(0);
    expect(parsed.mpos!.z).toBeCloseTo(-79.07);
    expect(parsed.wco!.z).toBeCloseTo(-85.07);
  });

  it('parses a <Jog> frame', () => {
    const line = '<Jog|MPos:104.322,404.090,-84.100|FS:900,15000|Pn:P>';
    const parsed = parseFluidNCLine(line)!;

    expect(parsed.state).toBe('Jog');
    expect(parsed.mpos!.y).toBeCloseTo(404.09);
  });

  it('parses a frame that reports WPos (work position)', () => {
    const line = '<Alarm|WPos:0.000,-80.000,-10.540|FS:0,0|WCO:0.000,80.000,10.540>';
    const parsed = parseFluidNCLine(line)!;

    expect(parsed.state).toBe('Alarm');
    expect(parsed.wpos).toEqual({
      x: 0,
      y: -80,
      z: -10.54,
    });
    expect(parsed.mpos).toBeUndefined(); // No MPos in this frame
  });

  it('returns null for non-status lines', () => {
    expect(parseFluidNCLine('ok')).toBeNull();
    expect(parseFluidNCLine('[MSG:Files changed]')).toBeNull();
    expect(parseFluidNCLine('~')).toBeNull();
  });
});

describe('parseFluidNCOffsetLine', () => {
  it('parses a G54 offset line', () => {
    const line = '[G54:351.331,148.328,-9.265]';
    const parsed = parseFluidNCOffsetLine(line)!;
    expect(parsed.code).toBe('G54');
    expect(parsed.position).toEqual({ x: 351.331, y: 148.328, z: -9.265 });
  });

  it('parsed another G54 line', () => {
    const line = '[G54:351.331,148.328,-9.265]\n';
    const parsed = parseFluidNCOffsetLine(line)!;
    expect(parsed.code).toBe('G54');
    expect(parsed.position).toEqual({ x: 351.331, y: 148.328, z: -9.265 });
  });

  it('ignores TLO offset line (single value)', () => {
    const line = '[TLO:0.000]';
    const parsed = parseFluidNCOffsetLine(line)!;
    expect(parsed).toBeNull();
  });

  it('returns null for unrelated lines', () => {
    expect(parseFluidNCOffsetLine('<Idle|MPos:0,0,0>')).toBeNull();
  });
});

describe('parseFluidNCModalLine', () => {
  it('parses a GC modal line with feed and spindle', () => {
    const line = '[GC:G0 G54 G17 G21 G90 G94 M0 M5 M9 T0 S0.0 F500.0]';
    const parsed = parseFluidNCModalLine(line)!;
    expect(parsed.words[0]).toBe('G0');
    expect(parsed.words).toContain('G54');
    expect(parsed.tool).toBe(0);
    expect(parsed.spindleSpeed).toBeCloseTo(0);
    expect(parsed.feedRate).toBeCloseTo(500);
  });

  it('parses a GC modal line without feed rate', () => {
    const line = '[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]';
    const parsed = parseFluidNCModalLine(line)!;
    expect(parsed.feedRate).toBeCloseTo(0);
    expect(parsed.spindleSpeed).toBeCloseTo(0);
  });

  it('returns null for unrelated lines', () => {
    expect(parseFluidNCModalLine('[G54:0,0,0]')).toBeNull();
  });
});
