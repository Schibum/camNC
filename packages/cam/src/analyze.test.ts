import { describe, expect, it } from 'vitest';
import { readGcode } from './analyze';

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
});
