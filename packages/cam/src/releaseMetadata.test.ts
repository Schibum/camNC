import { describe, expect, it } from 'vitest';
import { rectangle } from '../test/machining-fixtures';
import { planAccuracy } from './accuracy';
import { toGcode } from './gcode';
import { polyArea, type Vec3 } from './geom';
import { tabRemovalProgram } from './tabRemoval';
import { freePartsProgram } from './tabPlan';
import type { PartCam } from './toolpaths';

function plan(pts: Vec3[]): PartCam {
  return {
    stockTop: 12,
    safeZ: 17,
    retractZ: 14,
    warnings: ['Original roughing note'],
    accuracy: planAccuracy(0.008),
    stockFootprint: [rectangle(0, 0, 100, 70), rectangle(3, 4, 9, 11).reverse()],
    stockSummary: {
      certifiedLinks: 99,
      retractedLinks: 99,
      limitedSegments: 99,
      maximumPlanarRemovalRate: 99,
      axialEntryExceptions: 99,
      descendingSegments: 99,
    },
    operations: [
      {
        name: 'part: Outline',
        kind: 'profile',
        feature: 'outline',
        tool: { number: 1, diameter: 3.175 },
        passes: [{ pts, feeds: pts.map(() => 600), link: 'retract' }],
      },
    ],
  };
}
const tabbed = () =>
  plan([
    [10, 10, -0.3],
    [25, 10, -0.3],
    [25, 10, 2],
    [30, 10, 2],
    [30, 10, -0.3],
    [50, 10, -0.3],
    [50, 40, -0.3],
    [10, 40, -0.3],
    [10, 10, -0.3],
  ]);

describe('release-plan numerical metadata', () => {
  it.each([false, true])('preserves tab-release accuracy/blank and clears stale stock counts (perPart=%s)', perPart => {
    const source = tabbed();
    const { cam } = tabRemovalProgram(source, { feed: 600, plungeFeed: 300, perPart });
    expect(cam.accuracy).toEqual(source.accuracy);
    expect(cam.stockFootprint).toEqual(source.stockFootprint);
    expect(cam.stockSummary).toBeUndefined();
    expect(cam.warnings).toEqual([]);
    expect(source.stockSummary!.certifiedLinks).toBe(99);
  });

  it.each(['tabs', 'skin'] as const)('mirrors a nonrectangular blank with the %s release motion while preserving hole winding', kind => {
    const source =
      kind === 'tabs'
        ? tabbed()
        : plan([
            [10, 10, 0.5],
            [50, 10, 0.5],
            [50, 40, 0.5],
            [10, 40, 0.5],
            [10, 10, 0.5],
          ]);
    const before = JSON.stringify(source.stockFootprint);
    const turned = { h: 100 };
    const { cam } =
      kind === 'tabs'
        ? tabRemovalProgram(source, { feed: 600, plungeFeed: 300, turned })
        : freePartsProgram(source, { feed: 600, plungeFeed: 300, finalZ: -0.3, turned });
    expect(cam.stockFootprint).toEqual(source.stockFootprint!.map(loop => loop.map(p => ({ ...p, y: 100 - p.y })).reverse()));
    expect(cam.stockFootprint!.map(loop => Math.sign(polyArea([loop])))).toEqual(
      source.stockFootprint!.map(loop => Math.sign(polyArea([loop])))
    );
    expect(cam.accuracy).toEqual(source.accuracy);
    expect(cam.stockSummary).toBeUndefined();
    expect(JSON.stringify(source.stockFootprint)).toBe(before);
  });

  it('does not loosen the fitting tolerance for curved tab-release motion', () => {
    const pts: Vec3[] = [];
    for (let i = 0; i <= 72; i++) {
      const x = 30 + 5 * Math.cos((i * Math.PI) / 36),
        y = 30 + 5 * Math.sin((i * Math.PI) / 36);
      if (i === 10) {
        pts.push([x, y, -0.3], [x, y, 2]);
        continue;
      }
      if (i === 18) {
        pts.push([x, y, 2], [x, y, -0.3]);
        continue;
      }
      pts.push([x, y, i > 10 && i < 18 ? 2 : -0.3]);
    }
    const source = plan(pts);
    const { cam } = tabRemovalProgram(source, { feed: 600, plungeFeed: 300 });
    expect(cam.operations).toHaveLength(1);
    expect(cam.accuracy!.budget.fitting).toBeLessThan(0.004);
    expect(toGcode(cam)).not.toMatch(/^G[23] /m);
  });
});
