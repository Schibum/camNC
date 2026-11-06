import { describe, expect, it } from 'vitest';
import { machiningCases, circle, rectangle } from '../test/machining-fixtures';
import { DepthMap, readGcode } from './analyze';
import { toGcode } from './gcode';
import { camPart, DEFAULT_SETTINGS, pocketOperation, profileOperation, type PartCam, type Pass } from './toolpaths';
import { checkGcodeSafety } from './safety';
import { tabRemovalProgram } from './tabRemoval';

const minimum = (pass: Pass) => Math.min(...pass.pts.map(p => p[2]));
const program = (op: ReturnType<typeof profileOperation>): PartCam => ({ stockTop: 12, warnings: [], operations: [op] });

describe('machining motion invariants', () => {
  it('ramps profiles and holes at the configured slope/feed without crossing their finished boundary', () => {
    const cam = camPart(machiningCases.profiles(), { maxStepdown: 1.5 });
    for (const op of cam.operations)
      for (const pass of op.passes) {
        expect(pass.roles).toHaveLength(pass.pts.length);
        if (pass.roles?.includes('ramp')) expect(pass.entry).toBe('ramp');
        for (let i = 1; i < pass.pts.length; i++)
          if (pass.roles?.[i] === 'ramp') {
            const a = pass.pts[i - 1],
              b = pass.pts[i],
              length = Math.hypot(b[0] - a[0], b[1] - a[1]);
            expect(length).toBeGreaterThan(0);
            expect((a[2] - b[2]) / length).toBeLessThanOrEqual(Math.tan((3 * Math.PI) / 180) + 1e-8);
            expect(pass.feeds[i]).toBe(480);
          }
      }
    const r = 3.175 / 2;
    const hole = cam.operations.find(op => op.feature === 'hole')!;
    for (const move of readGcode(toGcode(program(hole))).filter(m => !m.rapid && m.spindle))
      for (const p of [move.from, move.to]) expect(Math.hypot(p[0] - 50, p[1] - 35)).toBeLessThanOrEqual(6.5 - r + 0.02);
    const outline = cam.operations.find(op => op.feature === 'outline')!;
    for (const move of readGcode(toGcode(program(outline))).filter(m => !m.rapid && m.spindle))
      for (const p of [move.from, move.to]) {
        const outside = Math.hypot(Math.max(-p[0], 0, p[0] - 100), Math.max(-p[1], 0, p[1] - 70));
        expect(outside).toBeGreaterThanOrEqual(r - 0.02);
      }
  });

  it('applies distinct tool cutting data to actual semantic moves', () => {
    const tool = {
      number: 1,
      diameter: 3.175,
      rampFeed: 320,
      leadFeed: 650,
      leadOutFeed: 750,
      finishFeed: 820,
      reducedFeed: 350,
      transitionFeed: 900,
    };
    const cam = camPart(machiningCases.rectangle(), { tools: [tool], cutThrough: false, pocketWallAllowance: 0.2 });
    const passes = cam.operations[0].passes;
    for (const [role, feed] of [
      ['ramp', 320],
      ['lead-in', 650],
      ['lead-out', 750],
      ['finish', 820],
      ['corner', 350],
    ] as const) {
      const matching = passes.flatMap(p => p.feeds.filter((_, i) => p.roles?.[i] === role));
      expect(matching.length, role).toBeGreaterThan(0);
      expect(
        matching.every(f => f === feed),
        role
      ).toBe(true);
    }
  });

  it('retains finely sampled wall leads without admitting leads outside a narrow cutter region', () => {
    const r = DEFAULT_SETTINGS.tools[0].diameter / 2;
    const boundary = rectangle(100, 40, 121, 49);
    for (const geometryTolerance of [0.01, 0.02, 0.05]) {
      const op = pocketOperation('mortise', [boundary], 8, 3.8, DEFAULT_SETTINGS.tools[0], { ...DEFAULT_SETTINGS, geometryTolerance });
      const leads = op.passes.filter(pass => pass.roles?.includes('lead-in') && pass.roles?.includes('lead-out'));
      expect(leads, `wall leads at tolerance ${geometryTolerance}`).toHaveLength(3);
      const arcPoints = leads.flatMap(pass => pass.pts.filter((_, i) => pass.roles?.[i] === 'lead-in' || pass.roles?.[i] === 'lead-out'));
      const wallDistance = (q: number[]) => Math.min(q[0] - 100 - r, 121 - r - q[0], q[1] - 40 - r, 49 - r - q[1]);
      // At the default budget this includes the valid sample (110.646476, 47.405728), only 0.006772 mm off the wall.
      // Finer budgets put samples even closer; a coarser point-classification grid must not collapse them onto it.
      expect(arcPoints.some(q => wallDistance(q) > 1e-7 && wallDistance(q) < 0.009)).toBe(true);
      // The center region is convex, so these endpoint bounds also contain every lead chord and its whole cutter.
      for (const pass of leads) for (const q of pass.pts) expect(wallDistance(q)).toBeGreaterThanOrEqual(-1e-10);
    }
    // The smallest supported lead radius is r/4. Leave 0.002 mm less center-room than that, so its start/end are
    // outside, even though a 0.01 mm classifier could round them onto the boundary. Such a lead must be refused.
    const height = 2 * r + r / 4 - 0.002;
    const narrow = pocketOperation('narrow', [rectangle(100, 40, 121, 40 + height)], 8, 7, DEFAULT_SETTINGS.tools[0], {
      ...DEFAULT_SETTINGS,
      pocketWallAllowance: 0.01,
    });
    expect(narrow.passes.length).toBeGreaterThan(0);
    expect(narrow.passes.some(pass => pass.roles?.includes('lead-in') || pass.roles?.includes('lead-out'))).toBe(false);
    for (const pass of narrow.passes)
      for (const q of pass.pts) {
        expect(q[1]).toBeGreaterThanOrEqual(40 + r - 1e-10);
        expect(q[1]).toBeLessThanOrEqual(40 + height - r + 0.0001);
      }
  });

  it('reduces inner wall corners and leaves convex outside contours at their baseline feed', () => {
    const pocket = camPart(machiningCases.rectangle(), { cutThrough: false }).operations[0];
    expect(pocket.passes.some(p => p.roles?.includes('corner'))).toBe(true);
    const off = camPart(machiningCases.rectangle(), { cutThrough: false, cornerFeed: false }).operations[0];
    expect(off.passes.some(p => p.roles?.includes('corner'))).toBe(false);
    const outline = profileOperation('outline', rectangle(20, 20, 70, 50), 12, DEFAULT_SETTINGS.tools[0], DEFAULT_SETTINGS);
    expect(outline.passes.some(p => p.roles?.includes('corner'))).toBe(false);
  });

  it('leaves floor stock during roughing and finishes floor/walls in bounded depth increments', () => {
    const cam = camPart(machiningCases.rectangle(), {
      cutThrough: false,
      maxStepdown: 1.5,
      pocketWallAllowance: 0.2,
      pocketFloorAllowance: 0.4,
      pocketFinishStepdown: 0.5,
    });
    const op = cam.operations[0];
    expect(op.passes.filter(p => p.phase === 'rough').every(p => minimum(p) >= 6.4 - 1e-8)).toBe(true);
    expect(Math.min(...op.passes.map(minimum))).toBe(6);
    const finishLevels = [12, ...new Set(op.passes.filter(p => p.phase === 'finish').map(minimum))];
    for (let i = 1; i < finishLevels.length; i++) expect(finishLevels[i - 1] - finishLevels[i]).toBeLessThanOrEqual(0.5 + 1e-8);
    const gcode = toGcode(cam);
    expect(
      Math.min(
        ...readGcode(gcode)
          .filter(m => m.spindle)
          .map(m => m.to[2])
      )
    ).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(checkGcodeSafety(gcode, { stockTop: 12, size: [100, 70], minZ: 6, toolRadius: 3.175 / 2 })).toEqual([]);
  });

  it('keeps the requested tab plateau through repeated ramp laps and optional shoulders', () => {
    const tool = DEFAULT_SETTINGS.tools[0],
      r = tool.diameter / 2;
    const tabs = { height: 2, width: 5, minCount: 1, spacing: 200, centers: [{ x: 45, y: 20 }], rampLength: 2 };
    const op = profileOperation('tabbed', rectangle(20, 20, 70, 50), 12, tool, {
      ...DEFAULT_SETTINGS,
      tabs,
      maxStepdown: 1.5,
      rampAngleDeg: 0.5,
    });
    const moves = readGcode(toGcode(program(op)));
    const grid = new DepthMap(40, 17, 55, 21, 0.05);
    grid.sweep(moves, r, 12);
    const at = (x: number, y: number) => grid.data[Math.round((y - grid.y0) / grid.res) * grid.w + Math.round((x - grid.x0) / grid.res)];
    for (let x = 43; x <= 47; x += 0.5) expect(at(x, 20 - r)).toBeGreaterThanOrEqual(2 - 1e-5);
    expect(at(54, 20 - r)).toBeLessThanOrEqual(0);
    for (const pass of op.passes) {
      expect(pass.roles).toHaveLength(pass.pts.length);
      for (let i = 1; i < pass.pts.length; i++)
        if (pass.pts[i][2] < pass.pts[i - 1][2] - 1e-8 && pass.roles?.[i] !== 'tab') {
          expect(pass.roles?.[i]).toBe('ramp');
          expect(pass.feeds[i]).toBe(480);
        }
    }
    const final = op.passes.at(-1)!;
    expect(final.pts.every(p => Math.abs(p[2] + 0.3) < 1e-8 || p[2] > -0.3)).toBe(true);
    const removal = tabRemovalProgram(program(op), { feed: 600, plungeFeed: 300 });
    expect(removal.tabs).toHaveLength(1);
    expect(removal.tabs[0].length).toBeLessThan(tabs.width + tool.diameter + 2 * tabs.rampLength + 0.1);
  });

  it('generates contained tangent entry/exit and diagnoses conservative fallbacks', () => {
    const tool = DEFAULT_SETTINGS.tools[0];
    const hole = profileOperation('hole', circle(50, 35, 10), 12, tool, { ...DEFAULT_SETTINGS, profileEntry: 'tangent' }, true);
    expect(hole.passes.every(p => p.entry === 'tangent')).toBe(true);
    expect(hole.passes.some(p => p.roles?.includes('lead-in'))).toBe(true);
    const tabbed = profileOperation('tabbed', rectangle(20, 20, 70, 50), 12, tool, {
      ...DEFAULT_SETTINGS,
      profileEntry: 'tangent',
      tabs: { height: 2, width: 5, minCount: 3, spacing: 100 },
    });
    expect(tabbed.passes.every(p => p.entry === 'ramp' || p.entry === undefined)).toBe(true);
    expect(tabbed.warnings).toContain('Tangent entry with tabs uses a contour ramp to preserve the holding material');
  });
});
