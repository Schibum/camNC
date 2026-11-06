import { describe, expect, it } from 'vitest';
import { programStatistics } from './programStatistics';

describe('posted block statistics', () => {
  it('counts modal blocks and feed changes without counting comments or arc interpolation chords', () => {
    const code = '(setup)\nG21 G90 G94 G17\nG0 X0 Y0 Z10\nG1 Z1 F480\nX0.05 F600\nG3 X1 Y1 I0 J1\nG18\nG2 X2 Z2 I1 K0 F300\nG17\nM30\n';
    expect(programStatistics(code)).toMatchObject({
      executableBlocks: 9,
      motionBlocks: 5,
      arcBlocks: 2,
      cuttingLineBlocks: 2,
      feedChanges: 3,
      tinyCuttingLines: 1,
      unresolvedCuttingLines: 0,
      minimumCuttingLineMm: 0.05,
      averageCuttingLineMm: 4.525,
    });
    expect(programStatistics(code).bytes).toBe(new TextEncoder().encode(code).length);
  });
  it('keeps unknown positioning explicit and does not assign machine parking to work geometry', () => {
    const stats = programStatistics('G1 X1 F600\nG53 G0 Z-5\nG1 X2\nG0 X0 Y0 Z10\nG1 Z9\n');
    expect(stats).toMatchObject({ motionBlocks: 5, cuttingLineBlocks: 3, unresolvedCuttingLines: 2, averageCuttingLineMm: 1 });
    expect(() => programStatistics('G91 G1 X1 F600')).toThrow(/Unsupported/);
    expect(() => programStatistics('', 0)).toThrow(/threshold/);
  });
});
