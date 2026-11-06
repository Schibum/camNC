import { describe, expect, it } from 'vitest';
import { polyArea, type PathD } from './geom';
import { StockModel, type PocketTransitionPolicy } from './stock';

const rect = (x0: number, y0: number, x1: number, y1: number): PathD => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('conservative swept stock', () => {
  it('certifies a complete cutter retrace but rejects a centerline-only clearance', () => {
    const stock = new StockModel({ stockTop: 10 });
    stock.recordPath(
      [
        [0, 0, 5],
        [20, 0, 5],
      ],
      2
    );
    expect(stock.certifyLink([2, 0, 5], [18, 0, 5], 2).clear).toBe(true);
    expect(stock.certifyLink([2, 1, 5], [18, 1, 5], 2).clear).toBe(false);
    expect(stock.certifyLink([2, 1, 5], [18, 1, 5], 0.9).clear).toBe(true);
  });

  it('keeps removal depth and ramp interpolation, including a conservative sloping link', () => {
    const stock = new StockModel({ stockTop: 10 });
    stock.recordPath(
      [
        [0, 0, 10],
        [10, 0, 5],
      ],
      2
    );
    expect(stock.certifyLink([8, 0, 6], [10, 0, 6], 2).clear).toBe(true);
    expect(stock.certifyLink([0, 0, 6], [4, 0, 6], 2).clear).toBe(false);
    expect(stock.certifyLink([8, 0, 4], [10, 0, 6], 2).clear).toBe(false);
    expect(stock.certifyLink([0, 0, 11], [10, 0, 12], 2).reason).toBe('above-stock');
  });

  it('does not connect disjoint cavities through intact stock', () => {
    const stock = new StockModel({ stockTop: 10 });
    stock.recordPath(
      [
        [0, 0, 5],
        [5, 0, 5],
      ],
      2
    );
    stock.recordPath(
      [
        [12, 0, 5],
        [20, 0, 5],
      ],
      2
    );
    expect(stock.certifyLink([5, 0, 5], [12, 0, 5], 2).clear).toBe(false);
  });

  it('certifies a larger tool only when the union of previous sweeps covers its envelope', () => {
    const stock = new StockModel({ stockTop: 10 });
    for (const y of [-3, -2, -1, 0, 1, 2, 3])
      stock.recordPath(
        [
          [-5, y, 5],
          [25, y, 5],
        ],
        1
      );
    const proof = stock.certifyLink([0, 0, 5], [20, 0, 5], 2);
    expect(proof.clear).toBe(true);
    expect(proof.reason).toBe('swept-region');
    expect(stock.certifyLink([0, 0, 5], [20, 0, 5], 5).clear).toBe(false);
  });

  it('accounts for air outside the initial stock without accepting a stock crossing', () => {
    const stock = new StockModel({ stockTop: 10, footprint: [rect(0, 0, 10, 10)] });
    expect(stock.certifyLink([-5, 20, 5], [15, 20, 5], 1).clear).toBe(true);
    expect(stock.certifyLink([-5, 5, 5], [15, 5, 5], 1).clear).toBe(false);
  });

  it('reports remaining material and an upper bound on newly engaged area', () => {
    const stock = new StockModel({ stockTop: 10, footprint: [rect(-10, -10, 30, 10)] });
    const before = stock.measureMove([0, 0, 5], [20, 0, 5], 2);
    stock.recordPath(
      [
        [0, 0, 5],
        [20, 0, 5],
      ],
      2
    );
    const after = stock.measureMove([0, 0, 5], [20, 0, 5], 2);
    expect(before.newArea).toBeGreaterThan(20 * 4);
    expect(after.newArea).toBeLessThan(before.newArea * 0.01);
    expect(polyArea(stock.remainingAt(5))).toBeLessThan(800);
    expect(polyArea(stock.remainingAt(4))).toBeGreaterThanOrEqual(800);
    expect(polyArea(stock.remainingAt(4))).toBeLessThan(801);
  });

  it('reserves path uncertainty and does not mutate recorded input', () => {
    const point: [number, number, number] = [20, 0, 5];
    const stock = new StockModel({ stockTop: 10, pathTolerance: 0.01 });
    stock.recordPath([[0, 0, 5], point], 2);
    point[2] = 1;
    expect(stock.certifyLink([0, 0, 5], [20, 0, 5], 2).clear).toBe(false);
    expect(stock.certifyLink([0, 0, 5.03], [20, 0, 5.03], 1.9).clear).toBe(true);
    expect(stock.certifyLink([0, 0, 4], [20, 0, 4], 1).clear).toBe(false);
    expect(() => stock.recordPath([[NaN, 0, 0]], 1)).toThrow();
  });

  it('does not treat an intended final hole as pre-existing air in the original blank', () => {
    const stock = new StockModel({ stockTop: 12, footprint: [rect(0, 0, 30, 30)] });
    expect(stock.certifyLink([12, 15, 6], [18, 15, 6], 2).clear).toBe(false);
    stock.recordPath(
      [
        [10, 15, 6],
        [20, 15, 6],
      ],
      3
    );
    expect(stock.certifyLink([12, 15, 6], [18, 15, 6], 2).clear).toBe(true);
  });

  it('retains a material web thinner than the polygon coordinate grid', () => {
    const stock = new StockModel({ stockTop: 10, footprint: [rect(0, -1, 0.00002, 1)] });
    expect(stock.certifyLink([-1, 0, 5], [1, 0, 5], 0.1).clear).toBe(false);
  });

  it('reserves vertical uncertainty when a slightly higher ramp would leave stock at the query plane', () => {
    const nominal = new StockModel({ stockTop: 10 });
    const uncertain = new StockModel({ stockTop: 10, pathTolerance: 0.01 });
    for (const model of [nominal, uncertain])
      model.recordPath(
        [
          [0, 0, 5.001],
          [10, 0, 5],
        ],
        2
      );
    expect(nominal.certifyLink([2, 0, 5.001], [8, 0, 5.001], 1.9).clear).toBe(true);
    expect(uncertain.certifyLink([2, 0, 5.001], [8, 0, 5.001], 1.9).clear).toBe(false);
  });
});

describe('bounded pocket cutting transitions', () => {
  const from: [number, number, number] = [5, 0, 5];
  const to: [number, number, number] = [6, 0, 5];
  const policy: PocketTransitionPolicy = {
    region: [rect(-10, -10, 30, 10)],
    maximumStepover: 1.2,
    cutFeed: 1800,
    transitionFeed: 1500,
  };
  const occupied = () => {
    const stock = new StockModel({ stockTop: 10, pathTolerance: 0.01 });
    stock.recordPath([[0, 0, 5], from], 2);
    return stock;
  };

  it('anchors the current cutter disk without weakening uncertain travel clearance', () => {
    const stock = occupied();
    expect(stock.certifyLink(from, to, 2).clear).toBe(false);
    const result = stock.certifyCuttingTransition(from, to, 2, policy);
    expect(result.allowed).toBe(true);
    expect(result.maximumImmersion).toBeCloseTo(1.02);
    expect(result.maximumFrontierWidth).toBeCloseTo(4.02);
    expect(result.feed * result.maximumFrontierWidth).toBeLessThanOrEqual(policy.cutFeed * policy.maximumStepover);
    expect(result.feed).toBeLessThanOrEqual(policy.transitionFeed);
  });

  it('requires the immediately current pose and the same cutter radius', () => {
    expect(new StockModel({ stockTop: 10 }).certifyCuttingTransition(from, to, 2, policy).reason).toBe('pose-unproven');
    const stock = occupied();
    expect(stock.certifyCuttingTransition([4, 0, 5], to, 2, policy).reason).toBe('pose-unproven');
    expect(stock.certifyCuttingTransition(from, to, 1.9, policy).reason).toBe('pose-unproven');
    stock.recordPath([[20, 0, 5]], 2);
    expect(stock.certifyCuttingTransition(from, to, 2, policy).reason).toBe('pose-unproven');
  });

  it('rejects depth changes and excessive penetration including the uncertainty reserve', () => {
    const stock = occupied();
    expect(stock.certifyCuttingTransition(from, [6, 0, 4.99], 2, policy).reason).toBe('depth-change');
    expect(stock.certifyCuttingTransition(from, [6.19, 0, 5], 2, policy).reason).toBe('stepover-exceeded');
    expect(stock.certifyCuttingTransition(from, [7, 0, 5], 2, policy).reason).toBe('stepover-exceeded');
  });

  it('protects islands and the full cutter envelope, including sub-grid retained material', () => {
    const stock = occupied();
    for (const width of [0.4, 0.00002]) {
      const island = rect(5.7, 1.6, 5.7 + width, 1.8).reverse();
      expect(stock.certifyCuttingTransition(from, to, 2, { ...policy, region: [...policy.region, island] }).reason).toBe('outside-pocket');
    }
    expect(stock.certifyCuttingTransition(from, to, 2, { ...policy, region: [rect(0, -2, 20, 2)] }).reason).toBe('outside-pocket');
    expect(stock.certifyCuttingTransition(from, to, 2, { ...policy, region: [rect(-10, 20, 30, 30)] }).reason).toBe('outside-pocket');
  });

  it('also preserves a selected rough wall allowance along a cutting bridge', () => {
    const stock = occupied();
    const region = [rect(-10, -2.15, 30, 10)];
    expect(stock.certifyCuttingTransition(from, to, 2, { ...policy, region }).allowed).toBe(true);
    expect(stock.certifyCuttingTransition(from, to, 2, { ...policy, region, wallAllowance: 0.2 }).reason).toBe('outside-pocket');
  });

  it('restores the occupied pose when speculative material history is rolled back', () => {
    const stock = occupied();
    const checkpoint = stock.checkpoint();
    stock.recordPath([[20, 0, 5]], 2);
    stock.rollback(checkpoint);
    expect(stock.certifyCuttingTransition(from, to, 2, policy).allowed).toBe(true);
    stock.rollback(0);
    expect(stock.certifyCuttingTransition(from, to, 2, policy).allowed).toBe(false);
  });
});
