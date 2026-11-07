import { describe, expect, it } from 'vitest';
import { circle, rectangle } from '../test/machining-fixtures';
import { readGcode } from './analyze';
import { toGcode } from './gcode';
import { pathLength } from './geom';
import { certifyStockLinks } from './stockPlan';
import { DEFAULT_SETTINGS, profileOperation, type PartCam, type Pass } from './toolpaths';

const tool = DEFAULT_SETTINGS.tools[0];
const settings = { ...DEFAULT_SETTINGS, maxStepdown: 1.5, cornerFeed: false as const };
const minimum = (pass: Pass) => Math.min(...pass.pts.map(point => point[2]));
const program = (operation: ReturnType<typeof profileOperation>): PartCam => ({ stockTop: 12, warnings: [], operations: [operation] });
const uniqueDepths = (passes: Pass[]) => [...new Set(passes.map(minimum))];
const length = (pass: Pass) =>
  pathLength(
    pass.pts.map(point => ({ x: point[0], y: point[1] })),
    false
  );

describe('profile finishing and depth transitions', () => {
  it.each([
    { name: 'through outline', inside: false, outlineFloor: undefined, finalZ: -0.3 },
    { name: 'skin outline', inside: false, outlineFloor: 1, finalZ: -0.3 },
    { name: 'through hole', inside: true, outlineFloor: 1, finalZ: -0.3 },
    { name: 'deep outline', inside: false, outlineFloor: undefined, finalZ: -6 },
  ])('cuts $name to depth without a finishing lap when wall stock is zero', ({ inside, outlineFloor, finalZ }) => {
    const floor = inside ? finalZ : (outlineFloor ?? finalZ);
    const operation = profileOperation(
      'zero finish',
      rectangle(20, 20, 70, 50),
      12,
      tool,
      {
        ...settings,
        leaveStock: 0,
        outlineFloor,
        outlineFinishAtRelease: true,
        finalZ,
        maxStepdown: 12,
      },
      inside
    );
    expect(operation.passes.every(pass => pass.phase === 'rough')).toBe(true);
    expect(operation.passes.at(-1)!.pts.every(point => point[2] === floor)).toBe(true);
    const depths = [12, ...uniqueDepths(operation.passes)];
    for (let i = 1; i < depths.length; i++) expect(depths[i - 1] - depths[i]).toBeLessThanOrEqual(12 + 1e-9);
    const laps = operation.passes.filter(pass => !pass.entry);
    expect(laps.filter(pass => minimum(pass) === floor)).toHaveLength(1);
    expect(laps.at(-1)!.pts[0]).toEqual(laps.at(-1)!.pts.at(-1));
    expect(
      laps
        .at(-1)!
        .feeds.slice(1)
        .every(feed => feed === settings.feed)
    ).toBe(true);
    expect(() => toGcode(program(operation))).not.toThrow();
  });

  it('retains tabs and explicitly requested spring laps with zero wall stock', () => {
    const operation = profileOperation('zero finish with tabs', rectangle(20, 20, 70, 50), 12, tool, {
      ...settings,
      leaveStock: 0,
      tabs: { height: 3, width: 6, minCount: 3, spacing: 200 },
      profileSpringPasses: 1,
    });
    const rough = operation.passes.filter(pass => pass.phase === 'rough');
    expect(minimum(rough.at(-1)!)).toBe(settings.finalZ);
    expect(rough.at(-1)!.pts.some(point => point[2] === 3)).toBe(true);
    const finish = operation.passes.filter(pass => pass.phase === 'finish');
    expect(finish).toHaveLength(1);
    expect(finish[0].spring).toBe(true);
    expect(finish[0].pts.some(point => point[2] === 3)).toBe(true);
    expect(() => toGcode(program(operation))).not.toThrow();
  });

  it('finishes a radial allowance with one complete full-depth lap by default', () => {
    const operation = profileOperation('outline', rectangle(20, 20, 70, 50), 12, tool, settings);
    const rough = operation.passes.filter(pass => pass.phase === 'rough');
    const finish = operation.passes.filter(pass => pass.phase === 'finish');
    expect(uniqueDepths(finish)).toEqual([settings.finalZ]);
    expect(finish).toHaveLength(2);
    expect(finish[0].entry).toBe('ramp');
    expect(finish[0].pts[0][2]).toBe(minimum(rough.at(-1)!));
    expect(finish.at(-1)!.entry).toBeUndefined();
    expect(finish.at(-1)!.pts[0]).toEqual(finish.at(-1)!.pts.at(-1));
    expect(length(finish.at(-1)!)).toBeGreaterThan(160);
    expect(operation.passes.at(-1)!.pts.every(point => point[2] === settings.finalZ)).toBe(true);
  });

  it('retains explicit bounded radial finishing independently of roughing steps', () => {
    const operation = profileOperation('outline', rectangle(20, 20, 70, 50), 12, tool, {
      ...settings,
      profileFinishStepdown: 0.6,
    });
    const finish = operation.passes.filter(pass => pass.phase === 'finish');
    const depths = [12, ...uniqueDepths(finish)];
    expect(depths.length).toBeGreaterThan(10);
    expect(depths.at(-1)).toBe(settings.finalZ);
    for (let i = 1; i < depths.length; i++) expect(depths[i - 1] - depths[i]).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(finish[0].pts[0][2]).toBe(12);
    const laps = finish.filter(pass => !pass.entry);
    expect(laps).toHaveLength(depths.length - 1);
    for (const lap of laps) expect(lap.pts[0]).toEqual(lap.pts.at(-1));
  });

  it('applies an explicit finishing depth limit to the bottom strip without a radial allowance', () => {
    const operation = profileOperation('outline', rectangle(20, 20, 70, 50), 12, tool, {
      ...settings,
      leaveStock: 0,
      profileFinishStepdown: 0.4,
    });
    const rough = operation.passes.filter(pass => pass.phase === 'rough');
    const finish = operation.passes.filter(pass => pass.phase === 'finish');
    const depths = [minimum(rough.at(-1)!), ...uniqueDepths(finish)];
    expect(finish[0].pts[0]).toEqual(rough.at(-1)!.pts.at(-1));
    for (let i = 1; i < depths.length; i++) expect(depths[i - 1] - depths[i]).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(depths.at(-1)).toBe(settings.finalZ);
  });

  it.each([
    { name: 'outline', shape: rectangle(20, 20, 70, 50), inside: false },
    { name: 'hole', shape: circle(50, 35, 8), inside: true },
  ])('continues $name depth ramps from the previous actual pose without a travel link', ({ name, shape, inside }) => {
    const operation = profileOperation(name, shape, 12, tool, settings, inside);
    const rough = operation.passes.filter(pass => pass.phase === 'rough');
    expect(rough.length).toBeGreaterThan(4);
    for (let i = 1; i < rough.length; i++) {
      expect(rough[i].link).toBe('direct');
      expect(rough[i].pts[0]).toEqual(rough[i - 1].pts.at(-1));
    }
    const resolved = certifyStockLinks(program(operation), { plungeFeed: 480, pathTolerance: 0.02 });
    expect(resolved.retractedLinks).toBe(0);
    expect(
      resolved.cam.operations[0].passes
        .filter(pass => pass.phase === 'rough')
        .slice(1)
        .every(pass => pass.clearLink)
    ).toBe(true);
    const code = toGcode(program(operation), { arcs: false });
    const blocks = code.split(/\(PASS \d+\/\d+ Z[^)]+\)/).slice(1);
    for (let i = 1; i < rough.length; i++) expect(blocks[i]).not.toMatch(/^G0 /m);
    for (const pass of rough)
      for (let i = 1; i < pass.pts.length; i++) {
        const [a, b] = [pass.pts[i - 1], pass.pts[i]];
        if (b[2] >= a[2]) continue;
        expect(pass.roles?.[i]).toBe('ramp');
        expect(pass.feeds[i]).toBeLessThanOrEqual(480);
        expect((a[2] - b[2]) / Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThanOrEqual(Math.tan((3 * Math.PI) / 180) + 1e-8);
      }
  });

  it('does not replace a radial move onto the final wall with an asserted clear link', () => {
    const operation = profileOperation('outline', rectangle(20, 20, 70, 50), 12, tool, settings);
    const firstFinish = operation.passes.find(pass => pass.phase === 'finish')!;
    expect(firstFinish.link).toBe('retract');
    const code = toGcode(program(operation), { arcs: false });
    const moves = readGcode(code);
    const rapids = moves.filter(move => move.rapid && Math.hypot(move.to[0] - move.from[0], move.to[1] - move.from[1]) > 1e-6);
    expect(rapids.every(move => Math.min(move.from[2], move.to[2]) >= 12)).toBe(true);
  });

  it('preserves tab plateaus when the continuous contour seam crosses holding material', () => {
    const unTabbed = profileOperation('outline', rectangle(20, 20, 70, 50), 12, tool, { ...settings, rampAngleDeg: 0.5 });
    const seam = unTabbed.passes
      .filter(pass => pass.phase === 'rough')
      .at(-1)!
      .pts.at(-1)!;
    const operation = profileOperation('outline', rectangle(20, 20, 70, 50), 12, tool, {
      ...settings,
      rampAngleDeg: 0.5,
      tabs: { height: 3, width: 6, minCount: 1, spacing: 200, centers: [{ x: seam[0], y: seam[1] }], rampLength: 2 },
    });
    const resolved = certifyStockLinks(program(operation), { plungeFeed: 480, pathTolerance: 0.02 });
    const passes = resolved.cam.operations[0].passes;
    for (let i = 1; i < passes.length; i++) if (passes[i].link === 'direct') expect(passes[i].pts[0]).toEqual(passes[i - 1].pts.at(-1));
    const last = operation.passes.at(-1)!;
    expect(last.pts[0]).toEqual(last.pts.at(-1));
    expect(last.pts.some(point => point[2] === 3)).toBe(true);
    expect(minimum(last)).toBe(settings.finalZ);
    const code = toGcode(program(operation), { arcs: false });
    for (const move of readGcode(code).filter(move => move.spindle && !move.rapid))
      if (Math.hypot(move.to[0] - seam[0], move.to[1] - seam[1]) < 2) expect(move.to[2]).toBeGreaterThanOrEqual(3 - 1e-6);
  });

  it('retains retract/plunge entry when a tiny hole cannot provide a contour ramp', () => {
    const operation = profileOperation('tiny hole', circle(50, 35, tool.diameter / 2 + 0.05), 12, tool, settings, true);
    expect(operation.passes.length).toBeGreaterThan(1);
    expect(operation.passes.every(pass => pass.link === 'retract' && pass.entry === 'plunge')).toBe(true);
    expect(operation.warnings).toContain('Contour entry loop is too small for a ramp; using a bounded plunge');
    expect(() => toGcode(program(operation))).not.toThrow();
  });

  it('bounds newly engaged axial depth below roughing even with full-depth finishing', () => {
    const operation = profileOperation('deep outline', rectangle(20, 20, 70, 50), 12, tool, { ...settings, finalZ: -6 });
    const finish = operation.passes.filter(pass => pass.phase === 'finish');
    const lastRough = operation.passes.filter(pass => pass.phase === 'rough').at(-1)!;
    expect(uniqueDepths(finish)).toEqual([-6]);
    expect(minimum(lastRough) + 6).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(finish[0].pts[0][2]).toBe(minimum(lastRough));
  });
});
