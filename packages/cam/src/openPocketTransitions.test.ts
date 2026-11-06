import { describe, expect, it } from 'vitest';
import type { PartFeatures } from './features';
import { difference, distPointSeg, polyArea, union, type PathD, type PathsD, type Vec3 } from './geom';
import { readGcode } from './analyze';
import { toGcode } from './gcode';
import { StockModel, type PocketTransitionPolicy } from './stock';
import { camPart, DEFAULT_SETTINGS } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number): PathD => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
function openPart(region: PathsD, depth: number): PartFeatures {
  const outline = rect(0, 0, 500, 100);
  const upper = difference([outline], region);
  return {
    thickness: 18,
    outlines: [outline],
    footprint: [outline],
    throughHoles: [],
    levels: [{ z: 18, region: upper, area: polyArea(upper) }],
    pockets: [{ floorZ: 18 - depth, region, strictRegion: region, above: upper, area: polyArea(region) }],
    bottomFaces: [],
    slopedArea: 0,
  };
}
const rabbet = (width: number, depth: number) => openPart([rect(50, 0, 450, width)], depth);

describe('open-edge pocket cutting transitions', () => {
  it.each([
    { width: 12, depth: 9, maximumRetracts: 7 },
    { width: 40, depth: 3, maximumRetracts: 4 },
  ])('keeps default $width mm rows connected with bounded cutting and preserves floor coverage', ({ width, depth, maximumRetracts }) => {
    const job = camPart(rabbet(width, depth), { tools: [{ number: 1, diameter: 6 }], cutThrough: false });
    const code = toGcode(job),
      moves = readGcode(code);
    const retracts = moves.filter(move => move.rapid && move.to[2] > move.from[2] + 1e-6).length;
    expect(retracts).toBeLessThanOrEqual(maximumRetracts);
    expect(job.stockSummary!.cuttingTransitions).toBeGreaterThan(5);
    const budget = job.accuracy!.budget;
    const deviation = budget.fitting + budget.outputRounding + budget.controllerRounding;
    for (const pass of job.operations[0].passes) {
      const transition = pass.cuttingTransition;
      if (!transition || pass.link !== 'direct') continue;
      expect(Math.hypot(transition.to[0] - transition.from[0], transition.to[1] - transition.from[1]) + 2 * deviation).toBeLessThanOrEqual(
        2.4
      );
      expect(transition.to[2]).toBe(transition.from[2]);
      expect(pass.feeds[1] * (6 + 2 * deviation)).toBeLessThanOrEqual(DEFAULT_SETTINGS.feed * 2.4);
    }
    const floor = moves.filter(
      move => !move.rapid && Math.abs(move.from[2] - (18 - depth)) < 0.001 && Math.abs(move.to[2] - (18 - depth)) < 0.001
    );
    for (const x of [75, 250, 425])
      for (const y of [0.1, 3, width / 2, width - 0.1]) {
        expect(Math.min(...floor.map(move => distPointSeg(x, y, move.from[0], move.from[1], move.to[0], move.to[1])))).toBeLessThanOrEqual(
          3.01
        );
      }
  });

  it.each([
    {
      region: [rect(50, 0, 450, 2.5)],
      targets: [
        [75, 0.1],
        [250, 1],
        [425, 2.4],
      ],
    },
    {
      region: union([rect(245, 0, 255, 22)], [rect(200, 20, 300, 80)]),
      targets: [
        [250, 1],
        [250, 50],
        [210, 70],
        [290, 30],
      ],
    },
  ])('keeps coverage for exterior-center-only cuts and an interior chamber beyond its narrow opening: %j', ({ region, targets }) => {
    const job = camPart(openPart(region, 3), { tools: [{ number: 1, diameter: 6 }], cutThrough: false });
    const floor = readGcode(toGcode(job)).filter(move => !move.rapid && move.from[2] === 15 && move.to[2] === 15);
    for (const [x, y] of targets)
      expect(Math.min(...floor.map(move => distPointSeg(x, y, move.from[0], move.from[1], move.to[0], move.to[1])))).toBeLessThanOrEqual(
        3.01
      );
  });

  it('rechecks the retained-material evidence at post instead of trusting an embedded waste-side bridge', () => {
    const job = camPart(rabbet(12, 9), { tools: [{ number: 1, diameter: 6 }], cutThrough: false });
    const count = (code: string) => readGcode(code).filter(move => move.rapid && move.to[2] > move.from[2] + 1e-6).length;
    const original = count(toGcode(job));
    job.operations[0].pocketTransition!.retainedSolid = undefined;
    expect(count(toGcode(job))).toBeGreaterThan(original);
  });

  const from: Vec3 = [53, -4, 9],
    to: Vec3 = [53, -2, 9];
  const policy: PocketTransitionPolicy = {
    region: [rect(50, -8, 450, 12)],
    retainedSolid: [rect(0, 0, 500, 100)],
    maximumStepover: 2.4,
    cutFeed: 1800,
    transitionFeed: 1800,
    wallAllowance: 0.2,
  };
  const occupied = (point = from) => {
    const stock = new StockModel({ stockTop: 18, pathTolerance: 0.01 });
    stock.recordPath([point], 3);
    return stock;
  };

  it('allows the full cutter to extend into waste while preserving strict travel proof', () => {
    const stock = occupied();
    expect(stock.certifyCuttingTransition(from, to, 3, { ...policy, retainedSolid: undefined }).allowed).toBe(false);
    expect(stock.certifyCuttingTransition(from, to, 3, policy).allowed).toBe(true);
    expect(stock.certifyLink(from, to, 3).clear).toBe(false);
  });

  it('rejects real end-wall and far-wall collisions instead of treating every opening boundary as waste', () => {
    for (const point of [
      [51, 1, 9],
      [53, 9.1, 9],
    ] as Vec3[]) {
      const end: Vec3 = [point[0] + 0.1, point[1], point[2]];
      expect(occupied(point).certifyCuttingTransition(point, end, 3, policy).reason).toBe('outside-pocket');
    }
  });

  it('retains islands smaller than the clipping grid in the open-envelope proof', () => {
    for (const width of [0.4, 0.00002]) {
      const region = [...policy.region, rect(53.2, 0.8, 53.2 + width, 1).reverse()];
      expect(occupied().certifyCuttingTransition(from, to, 3, { ...policy, region }).reason).toBe('outside-pocket');
    }
  });

  it('does not bridge disconnected edge pockets just because their surrounding waste is removable', () => {
    const start: Vec3 = [99.9, -4, 9],
      end: Vec3 = [100.2, -4, 9];
    const region = [rect(50, -8, 100, 12), rect(100.1, -8, 150, 12)];
    expect(occupied(start).certifyCuttingTransition(start, end, 3, { ...policy, region }).reason).toBe('outside-pocket');
  });
});
