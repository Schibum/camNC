import { describe, expect, it } from 'vitest';
import { buildResumeProgram, findRestartLine, parseProgram, programBounds, resumeWarnings } from './resume';

// A small Fusion-style program: tool change, spindle on with a pause, two passes around a 20 x 10 rectangle.
const kJob = [
  '%',
  '(T1 D=3.175 CR=0 - ZMIN=-2 - flat end mill)',
  'G90 G94 G17',
  'G21',
  'T1 M6',
  'S18000 M3',
  'G54',
  'G0 X0 Y0',
  'G0 Z5',
  'G1 Z-1 F300', // 9: plunge
  'G1 X20 F1200', // 10
  'Y10', // 11
  'X0', // 12
  'Y0', // 13
  'Z-2 F300', // 14: second pass plunge
  'X20 F1200', // 15
  'Y10', // 16
  'X0', // 17
  'Y0', // 18
  'G0 Z5',
  'M5',
  'M30',
  '',
].join('\n');

const byteAfter = (gcode: string, line: number) =>
  new TextEncoder().encode(
    gcode
      .split('\n')
      .slice(0, line + 1)
      .join('\n') + '\n'
  ).length;

describe('parseProgram', () => {
  it('tracks the modal state and positions', () => {
    const program = parseProgram(kJob);
    const l16 = program.lines[16]!;
    expect(l16.before).toMatchObject({
      units: 'G21',
      distance: 'G90',
      motion: 'G1',
      feed: 1200,
      speed: 18000,
      spindle: 'M3',
      tool: 1,
      wcs: 'G54',
    });
    expect(l16.start).toEqual({ x: 20, y: 0, z: -2 });
    expect(l16.end).toEqual({ x: 20, y: 10, z: -2 });
    expect(l16.motion).toBe(true);
    expect(program.lines[20]!.motion).toBe(false);
  });

  it('converts inches and follows incremental moves', () => {
    const program = parseProgram('G20 G91\nG1 X1 F10\nX1\n');
    expect(program.lines[2]!.end.x).toBeCloseTo(50.8);
  });

  it('forgets axes moved in machine coordinates', () => {
    const program = parseProgram('G0 X1 Y2 Z3\nG53 G0 Z-1\nG0 X5\n');
    expect(program.lines[1]!.motion).toBe(false);
    expect(program.lines[2]!.start.z).toBeNaN();
    expect(program.lines[2]!.start.x).toBe(1);
  });

  it('samples arcs so that a point on the arc is close', () => {
    // Quarter circle from (10,0) to (0,10) around the origin.
    const program = parseProgram('G0 X10 Y0 Z-1\nG3 X0 Y10 I-10 J0 F500\nG0 Z5\nG0 X50\n');
    const onArc = { x: 10 * Math.cos(Math.PI / 4), y: 10 * Math.sin(Math.PI / 4), z: -1 };
    const restart = findRestartLine(program, 100, onArc);
    expect(restart).toEqual({ line: 1, distance: expect.closeTo(0, 1) });
  });

  it('samples R-format arcs on the right side', () => {
    const program = parseProgram('G0 X10 Y0 Z-1\nG2 X-10 Y0 R10 F500\n');
    // Clockwise from +X to -X goes through -Y.
    const ys = program.lines[1]!.path.map(p => p.y);
    expect(Math.min(...ys)).toBeCloseTo(-10, 0);
  });
});

describe('findRestartLine', () => {
  const program = parseProgram(kJob);

  it('finds the move the tool was on, behind the read position', () => {
    // Planner read ahead to line 18, but the tool was half way along line 16 (second pass, X20 Y5).
    const percent = (byteAfter(kJob, 18) / program.totalBytes) * 100;
    expect(findRestartLine(program, percent, { x: 20, y: 5, z: -2 })).toEqual({ line: 16, distance: 0 });
  });

  it('tells the passes apart by depth', () => {
    const percent = (byteAfter(kJob, 18) / program.totalBytes) * 100;
    expect(findRestartLine(program, percent, { x: 20, y: 5, z: -1 })!.line).toBe(11);
  });

  it('does not look past what was read', () => {
    // Only up to line 12 was read: the second pass cannot be the restart point.
    const percent = (byteAfter(kJob, 12) / program.totalBytes) * 100;
    expect(findRestartLine(program, percent, { x: 20, y: 5, z: -2 })!.line).toBe(11);
  });

  it('prefers the earliest of equally close moves', () => {
    // (0,0,-2) is the end of line 14 (plunge) and the start of line 15: the earlier one re-cuts rather than skips.
    const percent = (byteAfter(kJob, 18) / program.totalBytes) * 100;
    expect(findRestartLine(program, percent, { x: 0, y: 0, z: -2 })!.line).toBe(14);
  });
});

describe('buildResumeProgram', () => {
  const program = parseProgram(kJob);

  it('retracts, moves over the restart point, starts the spindle, plunges and continues', () => {
    const resume = buildResumeProgram(program, { line: 16, safeZMachine: -1, name: 'pocket' });
    const lines = resume.gcode.split('\n');
    expect(lines.slice(0, resume.preambleLines)).toEqual([
      '(camNC resume of pocket from line 17)',
      'G21 G90 G17 G94 G54',
      'G53 G0 Z-1',
      'G0 X20 Y0',
      '(MSG,Resume: check the bit is clear and the right tool is in, then Resume)',
      'M0',
      'M3 S18000',
      'G4 P5',
      'G0 Z0',
      'G1 Z-2 F300',
      'G21 G90 G17 G94 F1200',
      '(camNC resume: original program continues)',
    ]);
    // `Y10` relied on the modal G1.
    expect(lines[resume.preambleLines]).toBe('G1 Y10');
    expect(lines.slice(resume.preambleLines + 1)).toEqual(kJob.split('\n').slice(17));
    expect(resume.start).toEqual({ x: 20, y: 0, z: -2 });
  });

  it('continues along the same path as the original', () => {
    const resume = buildResumeProgram(program, { line: 16, safeZMachine: -1 });
    const resumed = parseProgram(resume.gcode);
    const tail = (p: ReturnType<typeof parseProgram>, from: number) =>
      p.lines
        .slice(from)
        .filter(l => l.motion)
        .map(l => l.end);
    expect(tail(resumed, resume.preambleLines)).toEqual(tail(program, 16));
  });

  it('warns about a tool change before the restart point', () => {
    expect(resumeWarnings(program, 16)).toEqual([expect.stringContaining('T1 is in the spindle')]);
  });

  it('warns about G92 and incremental moves', () => {
    const p = parseProgram('G92 X0 Y0\nG91\nG1 X1 F100\nG1 X1\n');
    const warnings = resumeWarnings(p, 3);
    expect(warnings.some(w => w.includes('G92'))).toBe(true);
    expect(warnings.some(w => w.includes('G91'))).toBe(true);
  });

  it('refuses a restart where the position is unknown', () => {
    const p = parseProgram('G0 X1 Y1 Z1\nG28\nG1 X5 F100\n');
    expect(() => buildResumeProgram(p, { line: 2, safeZMachine: -1 })).toThrow(/not known/);
  });

  it('includes the resume moves in the bounds', () => {
    const resume = buildResumeProgram(program, { line: 16, safeZMachine: -1 });
    const bounds = programBounds(parseProgram(resume.gcode));
    expect(bounds.min).toEqual({ x: 0, y: 0, z: -2 });
    expect(bounds.max.x).toBe(20);
  });
});
