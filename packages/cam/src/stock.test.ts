import { describe, expect, it } from 'vitest';
import { polyArea, type PathD } from './geom';
import { StockModel } from './stock';

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
