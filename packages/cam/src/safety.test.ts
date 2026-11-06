import { describe, expect, it } from 'vitest';
import { checkGcodeSafety, checkProgramSafety } from './safety';
import { toGcode } from './gcode';
import { readGcode } from './analyze';
import type { Operation, PartCam } from './toolpaths';

const tool = { number: 1, diameter: 6, name: 'bit', flutes: 2 } as unknown as Operation['tool'];
const op = (name: string, z: number, at = [50, 50]): Operation => ({
  name,
  kind: 'profile',
  feature: 'outline',
  tool,
  passes: [
    {
      pts: [
        [at[0], at[1], 8],
        [at[0], at[1], z],
        [at[0] + 5, at[1], z],
      ],
      feeds: [100, 100, 500],
    },
  ] as Operation['passes'],
});
const cam = (...operations: Operation[]): PartCam => ({ stockTop: 8, operations, warnings: [] });
const limits = { stockTop: 8, size: [400, 100] as [number, number], minZ: -0.3, toolRadius: 3 };

describe('the lift at the end of a program', () => {
  it('requires a known work position after a machine-coordinate move', () => {
    const code = 'G0 X10 Y10 Z15\nG53 G0 Z-5\nG1 X20 F600';
    expect(checkGcodeSafety(code, limits).map(issue => issue.rule)).toContain('unknown-position');
    expect(
      checkGcodeSafety(`${code}\nG0 X20 Y10 Z15\nG1 X30 F600`, limits).filter(issue => issue.rule === 'unknown-position')
    ).toHaveLength(2);
  });
  it('is in machine coordinates: no move on the board, so no rule sees a rapid at Z-5', () => {
    const gcode = toGcode(cam(op('Outline', 2)));
    expect(gcode).toContain('G53 G0 Z-5');
    expect(checkGcodeSafety(gcode, limits)).toEqual([]);
    const moves = readGcode(gcode);
    expect(Math.min(...moves.filter(m => m.rapid).map(m => m.to[2]))).toBeGreaterThan(limits.stockTop);
    // And it adds nothing sideways: the last move is the lift to safe Z above the cut's end.
    const last = moves.at(-1)!;
    expect(last.to.slice(0, 2)).toEqual([55, 50]);
    expect(last.to.slice(0, 2)).toEqual(last.from.slice(0, 2));
  });

  it('comes after the spindle stops, and a real rapid at that Z would still be caught', () => {
    const lines = toGcode(cam(op('Outline', 2))).split('\n');
    expect(lines.indexOf('G53 G0 Z-5')).toBeGreaterThan(lines.lastIndexOf('M5'));
    expect(checkGcodeSafety('G0 X10 Y10 Z20\nG0 Z-5', limits).map(i => i.rule)).toContain('rapid-in-stock');
  });
});

describe('who switches the spindle', () => {
  const take: Operation = { ...op('Outline', 2), pauseBefore: 'Hold the part', part: 'Side' };
  const manualLines = (gcode: string) => gcode.split('\n').filter(l => /manual/i.test(l));

  it('by hand, the default: every pause says what to do, and a last pause after the park', () => {
    const gcode = toGcode(cam(take, op('Outline 2', 2)));
    expect(gcode).toBe(toGcode(cam(take, op('Outline 2', 2)), { spindle: 'hand' }));
    expect(manualLines(gcode)).toEqual([
      'M0 (MSG Hold the part. Manual spindle: off now, on before Resume)',
      'M0 (MSG Program done. Manual spindle: off now)',
    ]);
  });

  it('by the controller: no such words and no last pause, the same M3, M5 and dwell', () => {
    const hand = toGcode(cam(take, op('Outline 2', 2)));
    const gcode = toGcode(cam(take, op('Outline 2', 2)), { spindle: 'controller' });
    expect(manualLines(gcode)).toEqual([]);
    expect(gcode).toContain('M0 (MSG Hold the part)');
    expect(gcode).not.toContain('Program done');
    expect(gcode.trim().split('\n').slice(-3)).toEqual(['M5', 'G53 G0 Z-5', 'M30']);
    const spindleLines = (g: string) => g.split('\n').filter(l => /^(M3|M5|G4)\b/.test(l));
    expect(spindleLines(gcode)).toEqual(spindleLines(hand));
    expect(spindleLines(gcode).some(l => l.startsWith('G4'))).toBe(true);
    expect(checkGcodeSafety(gcode, limits)).toEqual([]);
  });

  it('by the controller, the confirmation before the first start stays', () => {
    const gcode = toGcode(cam(op('Outline', 2)), { spindle: 'controller', spindleRpm: 15000 });
    expect(gcode).toContain('M0 (MSG Spindle starts at 15000 RPM next)');
    expect(gcode.indexOf('M0 (MSG Spindle')).toBeLessThan(gcode.indexOf('M3 S15000'));
  });
});

describe('safety of a program for a board lying askew', () => {
  const turned = (deg: number, x: number, y: number) => {
    const a = (deg * Math.PI) / 180;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  };
  // The board's far corner, turned 10°: well outside the straight rectangle, inside the turned one.
  const atCorner = turned(10, 390, 90);
  const gcode = toGcode(cam(op('a: Outline', 1, atCorner)));

  it('checks moves against the rectangle the board really covers', () => {
    expect(checkGcodeSafety(gcode, limits).map(i => i.rule)).toContain('outside-board');
    expect(checkGcodeSafety(gcode, { ...limits, rotationDeg: 10 })).toEqual([]);
  });

  it('a move off the turned board is found, though it lies inside the straight rectangle', () => {
    // Inside X 0..400, Y 0..100, but at 10° that spot is off the board.
    const inStraight = toGcode(cam(op('a: Outline', 1, [395, 10])));
    expect(checkGcodeSafety(inStraight, limits)).toEqual([]);
    expect(checkGcodeSafety(inStraight, { ...limits, rotationDeg: 10 }).map(i => i.rule)).toContain('outside-board');
  });
});

describe('safety of a program with dowel pin holes', () => {
  it('only the dowel holes may go into the spoilboard', () => {
    const fine = cam(op('Dowel pin hole 1', -6), op('a: Outline', -0.3));
    expect(checkProgramSafety(fine, toGcode(fine), limits)).toEqual([]);

    const tooDeep = cam(op('Dowel pin hole 1', -6), op('a: Outline', -4));
    const issues = checkProgramSafety(tooDeep, toGcode(tooDeep), limits);
    expect(issues.map(i => i.rule)).toEqual(['too-deep', 'too-deep']);
    expect(issues[0].message).toMatch(/Z-4 is below -0\.3/);
  });

  it('without dowel holes it is the plain check; with nothing else in the program too', () => {
    const plain = cam(op('a: Outline', -4));
    expect(checkProgramSafety(plain, toGcode(plain), limits)).toEqual(checkGcodeSafety(toGcode(plain), limits));
    const holes = cam(op('Dowel pin hole 1', -6));
    expect(checkProgramSafety(holes, toGcode(holes), limits)).toEqual([]);
  });

  it('holds the rest of the program to the turned rectangle too', () => {
    const askew = cam(op('Dowel pin hole 1', -6), op('a: Outline', 1, [395, 10]));
    expect(checkProgramSafety(askew, toGcode(askew), { ...limits, rotationDeg: 10 }).map(i => i.rule)).toContain('outside-board');
  });
});
