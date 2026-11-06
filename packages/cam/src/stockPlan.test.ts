import { describe, expect, it } from 'vitest';
import { certifyStockLinks } from './stockPlan';
import { toGcode } from './gcode';
import type { PartCam, Pass } from './toolpaths';

const pass = (from: number, to: number, direct = false): Pass => ({
  pts: [
    [from, 0, 5],
    [to, 0, 5],
  ],
  feeds: [1800, 1800],
  link: direct ? 'direct' : 'retract',
  clearLink: direct,
});
const cam = (passes: Pass[]): PartCam => ({
  stockTop: 10,
  warnings: [],
  operations: [
    {
      name: 'Pocket',
      kind: 'pocket',
      feature: 'pocket',
      tool: { number: 1, diameter: 4 },
      passes,
    },
  ],
});

describe('stock-certified job links', () => {
  it('rechecks asserted short links at posting and preserves actual no-motion joins', () => {
    const source = cam([
      pass(0, 5),
      {
        ...pass(5, 10, true),
        pts: [
          [5, 1, 5],
          [10, 1, 5],
        ],
      },
    ]);
    const code = toGcode(source);
    expect(code).toMatch(/G0 Z12\nY1\nZ11\nG1 Z5 F480/);
    const joined = cam([pass(0, 5), pass(5, 10, true)]);
    expect(toGcode(joined)).not.toContain('G0 Z12');
    expect(source.operations[0].passes[1].link).toBe('direct');
  });
  it('rejects an asserted clear link over material not yet cut and uses the plunge fallback', () => {
    const original = cam([pass(0, 5), pass(12, 20, true)]);
    const result = certifyStockLinks(original, { plungeFeed: 300 });
    expect(result.retractedLinks).toBe(1);
    expect(result.cam.operations[0].passes[1]).toMatchObject({ link: 'retract', clearLink: false, feeds: [300, 1800] });
    expect(original.operations[0].passes[1]).toMatchObject({ link: 'direct', clearLink: true, feeds: [1800, 1800] });
  });

  it('keeps a proven retrace even when the distance exceeds one diameter', () => {
    const result = certifyStockLinks(cam([pass(0, 20), pass(2, 10, true)]), { plungeFeed: 300 });
    expect(result.retractedLinks).toBe(0);
    expect(result.cam.operations[0].passes[1]).toMatchObject({ link: 'direct', clearLink: true });
  });

  it('uses earlier operations but never future material removal as evidence', () => {
    const original = cam([pass(0, 20)]);
    original.operations.push({ ...original.operations[0], tool: { number: 2, diameter: 2 }, passes: [pass(2, 4), pass(18, 19, true)] });
    const result = certifyStockLinks(original, { plungeFeed: 300 });
    expect(result.retractedLinks).toBe(0);
    expect(result.cam.operations[1].passes[1].clearLink).toBe(true);
    expect(certifyStockLinks(cam([pass(0, 5), pass(12, 20, true), pass(5, 12)]), { plungeFeed: 300 }).retractedLinks).toBe(1);
  });

  it('preserves a sequential ramp-to-lap join with no motion even under path uncertainty', () => {
    const original = cam([pass(0, 10), pass(10, 20, true)]);
    const result = certifyStockLinks(original, { plungeFeed: 300, pathTolerance: 0.01 });
    expect(result.retractedLinks).toBe(0);
    expect(result.cam.operations[0].passes[1]).toMatchObject({ link: 'direct', clearLink: true });
  });
});
