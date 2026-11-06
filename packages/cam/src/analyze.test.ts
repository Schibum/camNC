import { describe, expect, it } from 'vitest';
import { metrics, readGcode } from './analyze';

describe('G-code reader', () => {
  it('strips comments and reads words', () => {
    const moves = readGcode('G0 Z5 (safe (height)\nG1 X10 Y.5 F1800 ; feed\n(only a comment)\nG1 X-2.25');
    expect(moves.map(m => m.to)).toEqual([
      [0, 0, 5],
      [10, 0.5, 5],
      [-2.25, 0.5, 5],
    ]);
  });

  it('stays fast on hostile input (unclosed comments, long numbers)', () => {
    const t0 = performance.now();
    readGcode('('.repeat(50_000));
    readGcode(`G1 X${'1'.repeat(50_000)}`);
    readGcode(`(${'('.repeat(50_000)}`);
    const ms = performance.now() - t0;
    console.log(`hostile input: ${ms.toFixed(1)} ms`);
    // The old pattern took seconds; a generous bound keeps this stable on loaded CI runners.
    expect(ms).toBeLessThan(1000);
  });

  it('keeps machine-coordinate parking separate instead of inventing a work Z', () => {
    const moves = readGcode('G0 Z5\nG53 G0 Z-5\nG1 X10 F600');
    expect(moves.map(move => move.to)).toEqual([
      [0, 0, 5],
      [10, 0, 5],
    ]);
    expect(moves[1].positionKnown).toBe(false);
    expect(metrics(moves, 0).unresolvedMoves).toBe(1);
  });

  it('maps a machine-coordinate lift only when its work offset is supplied', () => {
    const moves = readGcode('G0 Z5\nG53 G0 Z-5\nG1 X10 F600', { workOffset: [0, 0, -20], includeMachineMoves: true });
    expect(moves[1]).toMatchObject({ from: [0, 0, -15], to: [0, 0, -5], coordinateFrame: 'machine', positionKnown: true });
    expect(moves[2].from).toEqual([0, 0, 15]);
    expect(moves[2].to).toEqual([10, 0, 15]);
  });

  it('uses the reference Z rapid limit for its cheap ideal-feed metric', () => {
    expect(metrics(readGcode('G0 Z20'), 0).timeMin).toBeCloseTo(1 / 60);
    expect(metrics(readGcode('G0 Z20'), 0, 9000, 600).timeMin).toBeCloseTo(2 / 60);
  });
});
