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
