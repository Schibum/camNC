import { describe, expect, it, vi } from 'vitest';
import { filletLoop, limitRemovalRate, planControlledPocket } from './engagement';
import { difference, polyArea, type PathD } from './geom';
import { StockModel } from './stock';
import type { Pass } from './toolpaths';

const rect = (x0: number, y0: number, x1: number, y1: number): PathD => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('controlled offset roughing', () => {
  it('constructs tangent quarter arcs at the requested radius and refuses insufficient edge length', () => {
    const loop = filletLoop(rect(0, 0, 20, 10), 2)!;
    expect(loop.length).toBeGreaterThan(16);
    expect(loop[0]).toEqual({ x: 0, y: 2 });
    expect(loop.every(point => point.x >= -1e-9 && point.x <= 20 + 1e-9 && point.y >= -1e-9 && point.y <= 10 + 1e-9)).toBe(true);
    expect(filletLoop(rect(0, 0, 2, 2), 2)).toBeUndefined();
  });

  it('retains residual material and provides separate corner cleanup without pretending its radius is bounded', () => {
    const region = [rect(0, 0, 30, 20)];
    const result = planControlledPocket(region, { toolRadius: 2, stepover: 1.5, minimumTurnRadius: 1, radialAllowance: 0.2 });
    expect(result.roughing.length).toBeGreaterThan(0);
    expect(result.cleanup.length).toBeGreaterThan(0);
    expect(result.entryExceptions.some(entry => entry.reason === 'full-slot-candidate')).toBe(true);
    expect(polyArea(result.unreachable)).toBeGreaterThan(0);
    expect(polyArea(result.remaining)).toBeLessThan(10);
    expect(result.reachableResidualArea).toBeLessThan(2);
    expect(difference(result.unreachable, result.remaining).length).toBe(0);
  });

  it('preserves an island while leaving impossible blends to explicit cleanup', () => {
    const region = [rect(0, 0, 30, 20), [...rect(12, 7, 18, 13)].reverse()];
    const result = planControlledPocket(region, { toolRadius: 2, stepover: 1.5, minimumTurnRadius: 3, radialAllowance: 0.2 });
    expect(result.cleanup.length).toBeGreaterThan(0);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(polyArea(result.remaining)).toBeLessThan(20);
  });

  it('rejects a nonoverlapping stepover instead of silently leaving unreachable stripes', () => {
    expect(() =>
      planControlledPocket([rect(0, 0, 30, 20)], { toolRadius: 2, stepover: 5, minimumTurnRadius: 1, radialAllowance: 0.2 })
    ).toThrow(/stepover/);
  });
});

describe('stock-aware material rate', () => {
  const path: Pass = {
    pts: [
      [0, 0, 5],
      [20, 0, 5],
      [20, 10, 5],
    ],
    feeds: [300, 1800, 1800],
    link: 'retract',
  };

  it('caps each resolved block using new stock and counts axial entry as an explicit exception', () => {
    const stock = new StockModel({ stockTop: 10 });
    const result = limitRemovalRate([path], { number: 1, diameter: 4 }, stock, { maxPlanarRemovalRate: 1200, minimumFeed: 1 });
    expect(result.limitedSegments).toBeGreaterThan(0);
    expect(result.axialEntries).toBe(1);
    expect(result.maximumAreaRate).toBeLessThanOrEqual(1200 + 1e-6);
    expect(result.passes[0].pts.at(-1)).toEqual([20, 10, 5]);
    expect(result.passes[0].feeds).toHaveLength(result.passes[0].pts.length);
    expect(result.passes[0].feeds.every(feed => Number(feed.toFixed(3)) <= feed + 1e-9)).toBe(true);
    expect(path.pts).toHaveLength(3);
  });

  it('keeps the requested feed through already cleared stock and rejects an impossible minimum feed', () => {
    const stock = new StockModel({ stockTop: 10 });
    stock.recordPath(
      [
        [-5, 0, 5],
        [25, 0, 5],
      ],
      3
    );
    const result = limitRemovalRate(
      [{ ...path, pts: path.pts.slice(0, 2), feeds: path.feeds.slice(0, 2) }],
      { number: 1, diameter: 4 },
      stock,
      { maxPlanarRemovalRate: 1200, minimumFeed: 1 }
    );
    expect(result.limitedSegments).toBe(0);
    expect(result.passes[0].feeds.slice(1).every(feed => feed === 1800)).toBe(true);
    expect(() =>
      limitRemovalRate([path], { number: 1, diameter: 4 }, new StockModel({ stockTop: 10 }), {
        maxPlanarRemovalRate: 0.1,
        minimumFeed: 100,
      })
    ).toThrow(/minimum/);
  });

  it('detects a thin web between air regions and preserves semantic roles after subdivision', () => {
    const stock = new StockModel({ stockTop: 10, footprint: [rect(9.99, -1, 10.01, 1)] });
    const result = limitRemovalRate(
      [{ ...path, pts: path.pts.slice(0, 2), feeds: path.feeds.slice(0, 2), roles: ['approach', 'cut'] }],
      { number: 1, diameter: 4 },
      stock,
      { maxPlanarRemovalRate: 1, minimumFeed: 0.1 }
    );
    expect(result.limitedSegments).toBeGreaterThan(0);
    expect(result.maximumAreaRate).toBeLessThanOrEqual(1 + 1e-6);
    expect(result.passes[0].roles).toHaveLength(result.passes[0].pts.length);
    expect(result.passes[0].roles!.slice(1).every(role => role === 'cut')).toBe(true);
  });

  it('never credits a remote direct-link bridge that the emitted program retracts over', () => {
    const stock = new StockModel({ stockTop: 10 });
    const result = limitRemovalRate(
      [
        {
          pts: [
            [0, 0, 5],
            [2, 0, 5],
          ],
          feeds: [300, 1800],
          link: 'retract',
        },
        {
          pts: [
            [20, 0, 5],
            [22, 0, 5],
          ],
          feeds: [1800, 1800],
          link: 'direct',
          clearLink: false,
        },
      ],
      { number: 1, diameter: 4 },
      stock,
      { maxPlanarRemovalRate: 100000, minimumFeed: 1, plungeFeed: 300 }
    );
    expect(result.retractedLinks).toBe(1);
    expect(result.passes[1]).toMatchObject({ link: 'retract', clearLink: false });
    expect(result.passes[1].feeds[0]).toBe(300);
    expect(stock.certifyLink([8, 0, 5], [12, 0, 5], 1).clear).toBe(false);
  });

  it('keeps a zero-motion sequential join continuous under nonzero path uncertainty', () => {
    const result = limitRemovalRate(
      [
        {
          pts: [
            [0, 0, 6],
            [2, 0, 5],
          ],
          feeds: [300, 300],
          link: 'retract',
        },
        {
          pts: [
            [2, 0, 5],
            [10, 0, 5],
          ],
          feeds: [1800, 1800],
          link: 'direct',
        },
      ],
      { number: 1, diameter: 4 },
      new StockModel({ stockTop: 10, pathTolerance: 0.01 }),
      { maxPlanarRemovalRate: 1000000, minimumFeed: 1 }
    );
    expect(result.retractedLinks).toBe(0);
    expect(result.passes[1]).toMatchObject({ link: 'direct', clearLink: true });
  });

  it('does not retain hypothetical removal when resolving a program fails', () => {
    const stock = new StockModel({ stockTop: 10 });
    stock.recordPath(
      [
        [-10, -10, 5],
        [-5, -10, 5],
      ],
      2
    );
    expect(() =>
      limitRemovalRate([path, { ...path, feeds: [300, -1, 1000] }], { number: 1, diameter: 4 }, stock, {
        maxPlanarRemovalRate: 1200,
        minimumFeed: 1,
      })
    ).toThrow();
    expect(stock.certifyLink([5, 0, 5], [10, 0, 5], 1).clear).toBe(false);
    expect(stock.certifyLink([-9, -10, 5], [-6, -10, 5], 1).clear).toBe(true);
  });

  it('skips detailed area analysis when the full-slot bound already permits the requested feed', () => {
    const stock = new StockModel({ stockTop: 10 });
    const measure = vi.spyOn(stock, 'measureMove');
    const result = limitRemovalRate([{ ...path, feeds: [100, 100, 100] }], { number: 1, diameter: 4 }, stock, {
      maxPlanarRemovalRate: 1200,
      minimumFeed: 1,
    });
    expect(measure).not.toHaveBeenCalled();
    expect(result.conservativeFrontierSegments).toBeGreaterThan(0);
    expect(result.maximumAreaRate).toBeLessThanOrEqual(1200);
    expect(result.passes[0].feeds.every(feed => feed === 100)).toBe(true);
  });

  it('permits an exactly representable minimum feed on the configured rate boundary', () => {
    const result = limitRemovalRate([path], { number: 1, diameter: 4 }, new StockModel({ stockTop: 10 }), {
      maxPlanarRemovalRate: 1200,
      minimumFeed: 300,
      maxDetailedQueries: 0,
    });
    expect(result.passes[0].feeds.every(feed => feed === 300)).toBe(true);
    expect(result.maximumAreaRate).toBeLessThanOrEqual(1200 + 1e-9);
  });

  it('bounds polygon analysis and falls back conservatively without dropping removal history', () => {
    const stock = new StockModel({ stockTop: 10 });
    const measure = vi.spyOn(stock, 'measureMove');
    const result = limitRemovalRate([path], { number: 1, diameter: 4 }, stock, {
      maxPlanarRemovalRate: 1200,
      minimumFeed: 1,
      maxDetailedQueries: 1,
    });
    expect(measure).toHaveBeenCalledTimes(1);
    expect(result.maximumAreaRate).toBeLessThanOrEqual(1200);
    expect(result.conservativeFrontierSegments).toBeGreaterThan(0);
    expect(stock.certifyLink([5, 0, 5], [15, 0, 5], 1).clear).toBe(true);

    const crowded = new StockModel({ stockTop: 10 });
    for (let i = 0; i < 500; i++)
      crowded.recordPath(
        [
          [-100, i, 5],
          [-90, i, 5],
        ],
        2
      );
    const detailed = vi.spyOn(crowded, 'measureMove');
    const fallback = limitRemovalRate([path], { number: 1, diameter: 4 }, crowded, { maxPlanarRemovalRate: 1200, minimumFeed: 1 });
    expect(detailed).not.toHaveBeenCalled();
    expect(fallback.maximumAreaRate).toBeLessThanOrEqual(1200);
    expect(crowded.certifyLink([-99, 20, 5], [-91, 20, 5], 1).clear).toBe(true);
  });
});
