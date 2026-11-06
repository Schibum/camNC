import { describe, expect, it } from 'vitest';
import { readGcode } from './analyze';
import { toGcode } from './gcode';
import { certifyStockLinks } from './stockPlan';
import { camPart, DEFAULT_SETTINGS, pocketOperation, type PartCam } from './toolpaths';
import type { PathD, Vec3 } from './geom';
import { StockModel } from './stock';
import { machiningPart } from '../test/machining-fixtures';

const rect = (x0: number, y0: number, x1: number, y1: number): PathD => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const fixture = (destination: Vec3 = [6, 0, 5]): PartCam => ({
  stockTop: 10,
  warnings: [],
  operations: [
    {
      name: 'Pocket',
      kind: 'pocket',
      feature: 'pocket',
      tool: { number: 1, diameter: 4 },
      plungeFeed: 120,
      pocketTransition: { region: [rect(-10, -10, 30, 10)], maximumStepover: 1.2, cutFeed: 1800, transitionFeed: 1500 },
      passes: [
        {
          pts: [
            [0, 0, 5],
            [5, 0, 5],
          ],
          feeds: [120, 1800],
          link: 'retract',
        },
        {
          pts: [destination, [10, 0, destination[2]]],
          feeds: [1800, 1800],
          link: 'direct',
          cuttingTransition: { from: [5, 0, 5], to: destination },
        },
      ],
    },
  ],
});
const resolve = (cam: PartCam) => certifyStockLinks(cam, { plungeFeed: 480, pathTolerance: 0.01 });
const retracts = (code: string) => readGcode(code).filter(move => move.rapid && move.to[2] > move.from[2] + 1e-6).length;

describe('posted pocket cutting transitions', () => {
  it('turns a proved stepover into an explicit bounded feed segment and keeps travel proof strict', () => {
    const source = fixture();
    const result = resolve(source);
    expect(result.cuttingCertificates[0].certificate.allowed).toBe(true);
    expect(result.retractedLinks).toBe(0);
    const pass = result.cam.operations[0].passes[1];
    expect(pass.pts.slice(0, 2)).toEqual([
      [5, 0, 5],
      [6, 0, 5],
    ]);
    expect(pass.roles?.slice(0, 2)).toEqual(['link', 'link']);
    expect(pass.feeds[1] * 4.02).toBeLessThanOrEqual(1800 * 1.2);
    expect(source.operations[0].passes[1].pts[0]).toEqual([6, 0, 5]);
    source.operations[0].passes[1].cuttingTransition = undefined;
    expect(resolve(source).retractedLinks).toBe(1);
  });

  it('rechecks an embedded transition at every post without changing its feed repeatedly', () => {
    const original = fixture();
    const once = resolve(original).cam;
    const twice = resolve(once).cam;
    expect(twice.operations[0].passes[1]).toEqual(once.operations[0].passes[1]);
    expect(toGcode(once)).toEqual(toGcode(twice));
  });

  it('removes an embedded bridge when its preceding pass is missing or reordered', () => {
    const resolved = resolve(fixture()).cam;
    const operation = resolved.operations[0];
    for (const passes of [[operation.passes[1]], [...operation.passes].reverse()]) {
      const code = toGcode({ ...resolved, operations: [{ ...operation, passes }] });
      const firstCut = readGcode(code).find(move => !move.rapid && move.to[2] < 10);
      expect(firstCut?.to).toEqual([6, 0, 5]);
      expect(firstCut?.feed).toBeLessThanOrEqual(120);
    }
  });

  it.each([{ destination: [7, 0, 5] as Vec3 }, { destination: [6, 0, 4.99] as Vec3 }])(
    'rejects excessive or descending marked hops %j and preserves the selected plunge feed',
    ({ destination }) => {
      const source = fixture(destination);
      const result = resolve(source);
      expect(result.retractedLinks).toBe(1);
      expect(result.cam.operations[0].passes[1].feeds[0]).toBe(120);
      const approach = readGcode(toGcode(source)).find(move => !move.rapid && move.to.every((value, i) => value === destination[i]));
      expect(approach?.feed).toBe(120);
    }
  );

  it('rejects a retained island even if the marked centerline misses it', () => {
    const source = fixture();
    source.operations[0].pocketTransition!.region.push(rect(5.7, 1.6, 5.70002, 1.8).reverse());
    expect(resolve(source).cuttingCertificates[0].certificate.reason).toBe('outside-pocket');
    expect(resolve(source).retractedLinks).toBe(1);
  });

  it('rejects a corrupted embedded bridge rather than treating it as an ordinary authored cut', () => {
    const source = resolve(fixture()).cam;
    source.operations[0].passes[1].pts.splice(1, 0, [5.5, 1, 5]);
    source.operations[0].passes[1].feeds.splice(1, 0, 300);
    source.operations[0].passes[1].roles!.splice(1, 0, 'link');
    expect(() => toGcode(source)).toThrow(/transition prefix/);
    const stock = new StockModel({ stockTop: 10 });
    stock.recordPath([[20, 0, 5]], 2);
    const checkpoint = stock.checkpoint();
    expect(() => certifyStockLinks(source, { plungeFeed: 120 }, stock)).toThrow(/transition prefix/);
    expect(stock.checkpoint()).toBe(checkpoint);
  });

  it('falls back when a split program no longer carries the pocket policy', () => {
    const source = resolve(fixture()).cam;
    source.operations[0].pocketTransition = undefined;
    const posted = resolve(source).cam;
    expect(posted.operations[0].passes[1].link).toBe('retract');
    expect(posted.operations[0].passes[1].pts[0]).toEqual([6, 0, 5]);
    expect(posted.operations[0].passes[1].feeds[0]).toBe(120);
  });

  it('preserves a generated job plunge of 120 after passes are edited or split', () => {
    const job = camPart(machiningPart(), { tools: [{ number: 1, diameter: 4 }], plungeFeed: 120, cutThrough: false });
    const operation = job.operations[0];
    const index = operation.passes.findIndex(
      pass => pass.cuttingTransition && pass.pts[0].every((value, axis) => value === pass.cuttingTransition!.from[axis])
    );
    expect(index).toBeGreaterThan(0);
    const selected = operation.passes[index];
    const destination = selected.cuttingTransition!.to;
    const previous = structuredClone(operation.passes[index - 1]);
    previous.pts[previous.pts.length - 1] = [destination[0] + 5, destination[1] + 5, destination[2]];
    for (const passes of [[selected], [previous, selected]]) {
      const code = toGcode({ ...job, operations: [{ ...operation, passes }] });
      const approach = readGcode(code).find(move => !move.rapid && move.to.every((value, i) => Math.abs(value - destination[i]) < 0.001));
      expect(approach?.feed).toBeLessThanOrEqual(120);
    }
  });

  it('retains material-rate limits on controlled pocket stepovers', () => {
    const job = camPart(machiningPart(), {
      tools: [{ number: 1, diameter: 4 }],
      pocketStrategy: 'controlled',
      maxPlanarRemovalRate: 600,
      maxStepdown: 3,
      plungeFeed: 120,
      cutThrough: false,
    });
    expect(job.stockSummary!.cuttingTransitions).toBeGreaterThan(0);
    expect(job.stockSummary!.maximumPlanarRemovalRate).toBeLessThanOrEqual(600);
    expect(() => toGcode(job)).not.toThrow();
  });

  it('reduces retracts on a multi-ring pocket while retaining its bounded initial entry', () => {
    const operation = pocketOperation(
      'Pocket',
      [rect(0, 0, 60, 40)],
      10,
      7,
      { number: 1, diameter: 4 },
      {
        ...DEFAULT_SETTINGS,
        maxStepdown: 3,
        plungeFeed: 120,
        innerCornerRadius: 0,
      }
    );
    const source: PartCam = { stockTop: 10, operations: [operation], warnings: [] };
    expect(operation.plungeFeed).toBe(120);
    const baseline: PartCam = {
      ...source,
      operations: [
        { ...operation, pocketTransition: undefined, passes: operation.passes.map(pass => ({ ...pass, cuttingTransition: undefined })) },
      ],
    };
    const posted = toGcode(source);
    expect(retracts(posted)).toBeLessThan(retracts(toGcode(baseline)) / 2);
    const resolved = resolve(source);
    expect(resolved.cuttingCertificates.filter(proof => proof.certificate.allowed).length).toBeGreaterThan(5);
    expect(resolved.cam.operations[0].passes[0].link).toBe('retract');
    expect(retracts(posted)).toBeGreaterThan(0);
  });
});
