import { describe, expect, it } from 'vitest';
import { circle, machiningCases, rectangle } from '../test/machining-fixtures';
import { correctCircularFinish, verticalEntryBlend, verticalExitBlend } from './finishing';
import type { Vec3 } from './geom';
import { toGcode } from './gcode';
import { tabRemovalProgram } from './tabRemoval';
import { DEFAULT_SETTINGS, pocketOperation, profileOperation, throughCuts, type PartCam, type Pass } from './toolpaths';

const tool = DEFAULT_SETTINGS.tools[0];
const settings = {
  ...DEFAULT_SETTINGS,
  profileEntry: 'plunge' as const,
  maxStepdown: 1.5,
  profileFinishStepdown: 1.5,
  cornerFeed: false as const,
};
const minimum = (p: Pass) => Math.min(...p.pts.map(q => q[2]));
const program = (op: ReturnType<typeof profileOperation>): PartCam => ({ stockTop: 3, warnings: [], operations: [op] });
const closed = (p: Pass) => expect(p.pts.at(-1)).toEqual(p.pts[0]);
const circular = (radius = 5, samples = 120): Pass => {
  const pts: Vec3[] = circle(0, 0, radius, samples).map(p => [p.x, p.y, 0]);
  pts.push(pts[0]);
  return {
    pts,
    feeds: pts.map((_, i) => (i ? 900 : 480)),
    roles: pts.map((_, i) => (i ? 'finish' : 'approach')),
    phase: 'finish',
    materialSide: 'right',
    link: 'retract',
  };
};

describe('optional finishing controls', () => {
  it('retains identical programs when every optional control is off', () => {
    const off = {
      ...settings,
      profileVerticalLeadRadius: 0,
      profileVerticalExitRadius: 0,
      profileSpringPasses: 0,
      pocketSpringPasses: 0,
      circularFinishFeed: false,
    };
    const shape = rectangle(5, 5, 35, 25);
    expect(toGcode(program(profileOperation('profile', shape, 3, tool, settings)))).toBe(
      toGcode(program(profileOperation('profile', shape, 3, tool, off)))
    );
    expect(toGcode(program(pocketOperation('pocket', [shape], 3, 1, tool, settings)))).toBe(
      toGcode(program(pocketOperation('pocket', [shape], 3, 1, tool, off)))
    );
  });

  it('bounds the quarter-circle entry by the step and first segment, retaining the whole floor lap', () => {
    const pts: Vec3[] = [
      [0, 0, -0.3],
      [10, 0, -0.3],
      [10, 8, -0.3],
      [0, 8, -0.3],
      [0, 0, -0.3],
    ];
    const original: Pass = {
      pts,
      feeds: [480, 900, 900, 900, 900],
      roles: ['approach', 'finish', 'finish', 'finish', 'finish'],
      entry: 'plunge',
      link: 'retract',
    };
    const result = verticalEntryBlend(original, { radius: 3, axialStep: 0.4, plungeFeed: 480, tolerance: 0.001 });
    expect(result.warning).toMatch(/reduced/);
    expect(result.passes).toHaveLength(2);
    const [entry, lap] = result.passes;
    expect(entry.verticalBlendRadius).toBe(0.4);
    expect(entry.pts[0]).toEqual([0, 0, 0.10000000000000003]);
    for (const q of entry.pts) {
      expect(q[0]).toBeGreaterThanOrEqual(0);
      expect(q[0]).toBeLessThanOrEqual(0.4 + 1e-10);
      expect(q[1]).toBe(0);
      expect(q[2]).toBeGreaterThanOrEqual(-0.3);
      expect(Math.hypot(q[0] - 0.4, q[2] - 0.1)).toBeCloseTo(0.4, 8);
    }
    expect(entry.feeds.every(f => f <= 480)).toBe(true);
    closed(lap);
    expect(lap.pts.every(q => q[2] === -0.3)).toBe(true);
    for (const corner of pts) expect(lap.pts).toContainEqual(corner);
    // The complete closed lap has the same perimeter, even though its seam moves.
    expect(lap.pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - lap.pts[i][0], q[1] - lap.pts[i][1]), 0)).toBeCloseTo(36, 8);
  });

  it('uses vertical blends through the profile API and posts principal-plane arcs', () => {
    const op = profileOperation('inside', rectangle(5, 5, 35, 25), 3, tool, { ...settings, profileVerticalLeadRadius: 0.4 }, true);
    const entries = op.passes.filter(p => p.auxiliary === 'entry');
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.feeds.every(f => f <= 480)).toBe(true);
      expect(Math.max(...entry.pts.map(q => q[2])) - minimum(entry)).toBeLessThanOrEqual(0.4 + 1e-9);
      expect(entry.roles?.slice(1).every(r => r === 'lead-in')).toBe(true);
    }
    const final = op.passes.at(-1)!;
    closed(final);
    expect(final.pts.every(q => q[2] === settings.finalZ)).toBe(true);
    const gcode = toGcode(program(op));
    expect(gcode).toMatch(/G1[89]/);
    expect(gcode).toMatch(/G[23] /);
  });

  it('keeps ramp and tab entries intact when a vertical blend is unsupported', () => {
    const ramp = profileOperation('ramp', rectangle(5, 5, 35, 25), 3, tool, {
      ...settings,
      profileEntry: 'ramp',
      profileVerticalLeadRadius: 0.4,
    });
    expect(ramp.passes.some(p => p.auxiliary)).toBe(false);
    expect(ramp.warnings?.join(' ')).toMatch(/contour ramps/);
    const tabs = { height: 1, width: 4, minCount: 1, spacing: 200, centers: [{ x: 20, y: 5 }] };
    const base = profileOperation('tabs', rectangle(5, 5, 35, 25), 3, tool, { ...settings, tabs });
    const blended = profileOperation('tabs', rectangle(5, 5, 35, 25), 3, tool, {
      ...settings,
      tabs,
      profileVerticalLeadRadius: 0.4,
      profileVerticalExitRadius: 0.4,
    });
    expect(blended.passes.at(-1)?.pts).toEqual(base.passes.at(-1)?.pts);
    expect(blended.passes.at(-1)?.roles).toEqual(base.passes.at(-1)?.roles);
    expect(blended.warnings?.join(' ')).toMatch(/tabs and other height changes/);
    expect(blended.warnings?.join(' ')).toMatch(/only supported inside holes/);
    expect(tabRemovalProgram(program(blended), { feed: 600, plungeFeed: 300 }).tabs).toEqual(
      tabRemovalProgram(program(base), { feed: 600, plungeFeed: 300 }).tabs
    );
  });

  it('appends a rising exit only after a complete inside lap and leaves outside templates closed', () => {
    const op = profileOperation('inside', rectangle(5, 5, 35, 25), 3, tool, { ...settings, profileVerticalExitRadius: 0.3 }, true);
    const exits = op.passes.filter(p => p.auxiliary === 'exit');
    expect(exits.length).toBeGreaterThan(0);
    for (const exit of exits) {
      const index = op.passes.indexOf(exit),
        lap = op.passes[index - 1];
      closed(lap);
      expect(lap.pts.every(q => q[2] === minimum(lap))).toBe(true);
      expect(exit.pts[0]).toEqual(lap.pts.at(-1));
      expect(exit.pts.every(q => q[2] >= minimum(lap))).toBe(true);
      expect(exit.feeds.every(f => f <= 480)).toBe(true);
      expect(exit.roles?.slice(1).every(r => r === 'lead-out')).toBe(true);
      const [a, b] = lap.pts;
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy);
      for (const q of exit.pts) {
        expect((q[0] - a[0]) * dy - (q[1] - a[1]) * dx).toBeCloseTo(0, 8);
        const along = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / length;
        expect(along).toBeGreaterThanOrEqual(-1e-8);
        expect(along).toBeLessThanOrEqual(length + 1e-8);
        expect(Math.hypot(along, q[2] - a[2] - 0.3)).toBeCloseTo(0.3, 8);
      }
    }
    expect(toGcode(program(op))).toMatch(/G1[89]/);
    const outside = profileOperation('outside', rectangle(5, 5, 35, 25), 3, tool, { ...settings, profileVerticalExitRadius: 0.3 });
    expect(outside.passes.some(p => p.auxiliary === 'exit')).toBe(false);
    closed(outside.passes.at(-1)!);
    expect(outside.warnings?.join(' ')).toMatch(/only supported inside holes/);
  });

  it('repeats complete final-depth profile laps while retaining tab release geometry', () => {
    const tabs = { height: 1, width: 4, minCount: 1, spacing: 200, centers: [{ x: 20, y: 5 }] };
    const base = profileOperation('profile', rectangle(5, 5, 35, 25), 3, tool, { ...settings, tabs });
    const op = profileOperation('profile', rectangle(5, 5, 35, 25), 3, tool, { ...settings, tabs, profileSpringPasses: 2 });
    expect(op.passes.slice(0, base.passes.length)).toEqual(base.passes);
    const springs = op.passes.filter(p => p.spring);
    expect(springs).toHaveLength(2);
    for (const spring of springs) {
      expect(spring.phase).toBe('finish');
      expect(minimum(spring)).toBe(settings.finalZ);
      expect(Math.max(...spring.pts.map(q => q[2]))).toBe(1);
      closed(spring);
      expect(spring.pts).toEqual(base.passes.at(-1)?.pts);
    }
    expect(tabRemovalProgram(program(op), { feed: 600, plungeFeed: 300 }).tabs).toEqual(
      tabRemovalProgram(program(base), { feed: 600, plungeFeed: 300 }).tabs
    );
    const templates = throughCuts(machiningCases.profiles(), {
      ...settings,
      profileVerticalLeadRadius: 0.4,
      profileVerticalExitRadius: 0.4,
      profileSpringPasses: 2,
    });
    expect(templates.flatMap(p => p.passes).some(p => p.auxiliary || p.spring)).toBe(false);
  });

  it('adds pocket spring laps on both wall and island boundaries at the final floor', () => {
    const region = [rectangle(0, 0, 30, 20), rectangle(12, 8, 18, 12).reverse()];
    const base = pocketOperation('pocket', region, 3, 1, tool, settings);
    const op = pocketOperation('pocket', region, 3, 1, tool, { ...settings, pocketSpringPasses: 2 });
    expect(op.passes.slice(0, base.passes.length)).toEqual(base.passes);
    const springs = op.passes.filter(p => p.spring);
    expect(springs).toHaveLength(4);
    for (const spring of springs) {
      closed(spring);
      expect(spring.phase).toBe('finish');
      expect(spring.pts.every(q => q[2] === 1)).toBe(true);
      expect(spring.roles?.slice(1).every(r => r === 'finish')).toBe(true);
    }
  });

  it('uses the contact-radius ratio only for positively recognized inside finishing circles', () => {
    const pass = circular();
    const corrected = correctCircularFinish(pass, 1.5, 0.005);
    expect(corrected.circularFeedFactor).toBeCloseTo(5 / 6.5, 10);
    expect(corrected.pts).toBe(pass.pts);
    expect(corrected.roles).toBe(pass.roles);
    expect(corrected.feeds[0]).toBe(480);
    for (const feed of corrected.feeds.slice(1)) expect(feed).toBeCloseTo((900 * 5) / 6.5, 8);
    expect(correctCircularFinish(corrected, 1.5, 0.005)).toBe(corrected);
    for (const other of [
      { ...pass, phase: 'rough' as const },
      { ...pass, materialSide: undefined },
      { ...pass, materialSide: 'left' as const },
      { ...pass, pts: pass.pts.map(p => [p[0] * 1.1, p[1], p[2]] as Vec3) },
      circular(5, 12),
      { ...pass, pts: pass.pts.slice(0, -1), feeds: pass.feeds.slice(0, -1), roles: pass.roles!.slice(0, -1) },
    ])
      expect(correctCircularFinish(other, 1.5, 0.005)).toBe(other);
    const reversed = { ...pass, pts: [...pass.pts].reverse(), materialSide: 'left' as const };
    expect(correctCircularFinish(reversed, 1.5, 0.005).circularFeedFactor).toBeCloseTo(5 / 6.5, 10);
  });

  it('corrects actual circular hole finishing without changing outside feed or geometry', () => {
    const hole = circle(20, 20, 7, 120);
    const base = profileOperation('inside', hole, 3, tool, settings, true);
    const corrected = profileOperation('inside', hole, 3, tool, { ...settings, circularFinishFeed: true, profileSpringPasses: 1 }, true);
    const matching = corrected.passes.slice(0, base.passes.length);
    expect(matching.map(p => p.pts)).toEqual(base.passes.map(p => p.pts));
    expect(matching.filter(p => p.phase === 'finish').every(p => p.circularFeedFactor! > 0 && p.circularFeedFactor! < 1)).toBe(true);
    for (let i = 0; i < base.passes.length; i++)
      for (let j = 1; j < base.passes[i].feeds.length; j++) {
        const factor = matching[i].circularFeedFactor ?? 1;
        expect(matching[i].feeds[j]).toBeCloseTo(base.passes[i].feeds[j] * factor, 8);
      }
    const spring = corrected.passes.at(-1)!;
    expect(spring.spring).toBe(true);
    expect(spring.circularFeedFactor).toBeGreaterThan(0);
    const outside = profileOperation('outside', hole, 3, tool, { ...settings, circularFinishFeed: true });
    expect(outside.passes.some(p => p.circularFeedFactor !== undefined)).toBe(false);
  });

  it('keeps tangent entries complete and does not double-correct a finished pocket floor', () => {
    const tangent = profileOperation(
      'inside',
      circle(20, 20, 9),
      3,
      tool,
      { ...settings, profileEntry: 'tangent', profileVerticalLeadRadius: 0.1 },
      true
    );
    expect(tangent.passes.some(p => p.auxiliary === 'entry')).toBe(true);
    const final = tangent.passes.at(-1)!;
    closed(final);
    expect(final.pts.every(q => q[2] === settings.finalZ)).toBe(true);
    expect(tangent.warnings?.join(' ')).toMatch(/exit was omitted/);
    const region = [circle(20, 20, 7)];
    const pocketSettings = { ...settings, pocketWallAllowance: 0.2, pocketFloorAllowance: 0.4, pocketFinishStepdown: 0.5 };
    const base = pocketOperation('pocket', region, 3, 1, tool, pocketSettings);
    const corrected = pocketOperation('pocket', region, 3, 1, tool, { ...pocketSettings, circularFinishFeed: true });
    expect(corrected.passes.map(p => p.pts)).toEqual(base.passes.map(p => p.pts));
    expect(corrected.passes.some(p => p.circularFeedFactor !== undefined && minimum(p) === 1)).toBe(true);
    for (let i = 0; i < corrected.passes.length; i++) {
      const a = base.passes[i],
        b = corrected.passes[i];
      for (let j = 0; j < a.feeds.length; j++) {
        const factor = b.roles?.[j] === 'finish' || b.roles?.[j] === 'corner' ? (b.circularFeedFactor ?? 1) : 1;
        expect(b.feeds[j]).toBeCloseTo(a.feeds[j] * factor, 8);
      }
    }
  });

  it('retains the complete lap before a helper exit and rejects invalid public settings', () => {
    const lap = circular();
    const exit = verticalExitBlend(lap, { radius: 0.1, plungeFeed: 480, tolerance: 0.001 });
    expect(exit.passes[0]).toBe(lap);
    expect(exit.passes.at(-1)?.pts.every(q => q[2] >= 0)).toBe(true);
    for (const invalid of [
      { profileVerticalLeadRadius: -1 },
      { profileVerticalLeadRadius: NaN },
      { profileVerticalExitRadius: Infinity },
      { profileSpringPasses: 1.5 },
      { profileSpringPasses: 6 },
      { pocketSpringPasses: -1 },
      { pocketSpringPasses: 6 },
      { circularFinishFeed: 'yes' as unknown as boolean },
    ])
      expect(() => profileOperation('invalid', rectangle(0, 0, 20, 15), 3, tool, { ...settings, ...invalid })).toThrow();
  });
});
