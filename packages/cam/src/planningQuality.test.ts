import { describe, expect, it } from 'vitest';
import { machiningCases, machiningPart, rectangle } from '../test/machining-fixtures';
import { camBoard, splitByBit } from './board';
import { checkAccuracyBudget } from './accuracy';
import { toGcode } from './gcode';
import { checkGcodeSafety } from './safety';
import { camPart } from './toolpaths';

describe('integrated stock and geometry planning', () => {
  it('uses unknown surrounding material conservatively and keeps configured accuracy separate from source claims', () => {
    const cam = camPart(machiningCases.island(), { cutThrough: false, maxStepdown: 1.5 });
    expect(cam.stockFootprint).toBeUndefined();
    expect(cam.accuracy!.scope).toBe('features');
    expect(cam.stockSummary!.retractedLinks).toBeGreaterThan(0);
    checkAccuracyBudget(cam.accuracy!.budget);
    for (const operation of cam.operations)
      for (let i = 1; i < operation.passes.length; i++) {
        const pass = operation.passes[i];
        expect(pass.roles).toHaveLength(pass.pts.length);
        if (pass.link === 'direct') expect(pass.clearLink).toBe(true);
      }
    const declared = camPart(machiningCases.rectangle(), { cutThrough: false, geometryTolerance: 0.05, sourceTolerance: 0.01 });
    expect(declared.accuracy!.scope).toBe('declared-source');
    expect(declared.accuracy!.budget.import).toBe(0.01);
    expect(() => camPart(machiningCases.rectangle(), { geometryTolerance: 0.001 })).toThrow(/geometryTolerance/);
  });

  it('runs the controlled strategy through actual CAM with explicit cleanup, residual stock and a bounded planar rate', () => {
    const cam = camPart(machiningPart(undefined, 10.5), {
      cutThrough: false,
      maxStepdown: 1.5,
      pocketStrategy: 'controlled',
      minimumRoughingRadius: 1,
      maxPlanarRemovalRate: 1200,
    });
    const op = cam.operations[0];
    expect(op.residualStock!.minimumTurnRadius).toBe(1);
    expect(op.residualStock!.remaining.length).toBeGreaterThan(0);
    expect(op.residualStock!.reachableArea).toBeLessThan(3);
    expect(op.passes.some(pass => pass.phase === 'rough')).toBe(true);
    expect(op.passes.some(pass => pass.phase === 'finish')).toBe(true);
    expect(cam.warnings.some(warning => warning.includes('full-width entry'))).toBe(true);
    expect(cam.stockSummary!.limitedSegments).toBeGreaterThan(0);
    expect(cam.stockSummary!.maximumPlanarRemovalRate).toBeLessThanOrEqual(1200 + 1e-6);
    expect(op.passes.every(pass => pass.roles?.length === pass.pts.length && pass.feeds.length === pass.pts.length)).toBe(true);
    expect(checkGcodeSafety(toGcode(cam), { stockTop: 12, size: [100, 70], minZ: 10.5, toolRadius: 3.175 / 2 })).toEqual([]);
  });

  it('keeps the complete cutter out of the island through roughing and explicit cleanup', () => {
    const features = machiningCases.island();
    features.pockets[0].floorZ = 10.5;
    const cam = camPart(features, { cutThrough: false, maxStepdown: 1.5, pocketStrategy: 'controlled', minimumRoughingRadius: 1 });
    const radius = 3.175 / 2;
    for (const pass of cam.operations[0].passes)
      for (let i = 1; i < pass.pts.length; i++) {
        const a = pass.pts[i - 1],
          b = pass.pts[i];
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const x = a[0] + t * (b[0] - a[0]),
            y = a[1] + t * (b[1] - a[1]);
          const distance = Math.hypot(Math.max(38 - x, 0, x - 53), Math.max(28 - y, 0, y - 43));
          expect(distance).toBeGreaterThanOrEqual(radius - 0.01);
        }
      }
  });

  it('stores the actual rotated board blank and preserves metadata across physical-tool programs', () => {
    const angle = (17 * Math.PI) / 180;
    const board = camBoard(
      {
        id: 'blank',
        name: 'Blank',
        w: 140,
        h: 100,
        thickness: 12,
        holdDown: 'none',
        rotationDeg: 17,
        parts: [{ id: 'part', name: 'Part', x: 20, y: 15, rotated: false, size: [100, 70, 12], features: machiningCases.rectangle() }],
      },
      { cutThrough: false }
    );
    expect(board.stockFootprint![0]).toHaveLength(4);
    expect(board.stockFootprint![0][2].x).toBeCloseTo(140 * Math.cos(angle) - 100 * Math.sin(angle));
    expect(board.stockFootprint![0][2].y).toBeCloseTo(140 * Math.sin(angle) + 100 * Math.cos(angle));
    const first = board.operations[0];
    board.operations.push({ ...first, tool: { ...first.tool, number: 2, guid: 'second-tool' } });
    const programs = splitByBit(board);
    expect(programs).toHaveLength(2);
    for (const program of programs) {
      expect(program.accuracy).toEqual(board.accuracy);
      expect(program.stockFootprint).toEqual(board.stockFootprint);
      expect(program.operations[0].passes[0].roles).toHaveLength(program.operations[0].passes[0].pts.length);
    }
  });

  it('accepts only an explicitly declared raw blank and rejects incompatible process limits', () => {
    const blank = [rectangle(-10, -10, 120, 90)];
    const cam = camPart(machiningCases.rectangle(), { cutThrough: false, blankFootprint: blank });
    expect(cam.stockFootprint).toEqual(blank);
    expect(cam.stockFootprint).not.toBe(blank);
    expect(() =>
      camPart(machiningCases.rectangle(), { pocketStrategy: 'controlled', maxPlanarRemovalRate: 0.001, minimumCuttingFeed: 100 })
    ).toThrow(/minimum/);
  });

  it('bounds controlled finishing depths and preserves diagnostics through floor-allowance planning', () => {
    const cam = camPart(machiningPart([[rectangle(20, 20, 40, 32)]], 10.5), {
      cutThrough: false,
      maxStepdown: 1.5,
      pocketStrategy: 'controlled',
      minimumRoughingRadius: 1,
      pocketFloorAllowance: 0.2,
      pocketFinishStepdown: 0.4,
    });
    const op = cam.operations[0];
    const levels = [
      12,
      ...new Set(op.passes.filter(pass => pass.phase === 'finish').map(pass => Math.min(...pass.pts.map(point => point[2])))),
    ];
    for (let i = 1; i < levels.length; i++) expect(levels[i - 1] - levels[i]).toBeLessThanOrEqual(0.4 + 1e-8);
    expect(op.residualStock!.floorZ).toBe(10.5);
    expect(op.warnings!.some(warning => warning.includes('full-width entry'))).toBe(true);
    expect(cam.warnings.some(warning => warning.includes('full-width entry'))).toBe(true);
  });
});
