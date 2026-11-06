import { describe, expect, it } from 'vitest';
import { machiningCases, machiningPart, rectangle } from '../test/machining-fixtures';
import { splitByBit } from './board';
import { toGcode } from './gcode';
import { camPart, DEFAULT_SETTINGS, pocketOperation, profileOperation, type CamSettings, type Tool } from './toolpaths';
import { CamInputError, validateCamSettings } from './validation';

describe('cutting input validation', () => {
  it.each([
    { feed: 0 },
    { plungeFeed: -1 },
    { rampFeed: 0 },
    { leadFeed: -1 },
    { leadOutFeed: Infinity },
    { finishFeed: 0 },
    { reducedFeed: -1 },
    { transitionFeed: NaN },
    { maxStepdown: 0 },
    { maxStepdown: NaN },
    { profileStepdown: -1 },
    { profileFinishStepdown: 0 },
    { pocketFinishStepdown: -1 },
    { pocketFloorAllowance: -1 },
    { profileLeadRadius: 0 },
    { cornerFeed: { factor: 1.1, minAngleDeg: 30, maxRadius: 1, distance: 1 } },
    { cornerFeed: { factor: 0.5, minAngleDeg: 180, maxRadius: 1, distance: 1 } },
    { tabs: { ...(DEFAULT_SETTINGS.tabs || { height: 2, width: 5, minCount: 3, spacing: 100 }), rampLength: -1 } },
    { stepoverFactor: 0 },
    { stepoverFactor: Infinity },
    { stepoverFactor: 2 },
    { rampAngleDeg: 0 },
    { rampAngleDeg: 90 },
    { rampAngleDeg: NaN },
    { safeHeight: 0 },
    { retractHeight: -1 },
    { safeHeight: 1, retractHeight: 2 },
    { leaveStock: -1 },
    { finalZ: Infinity },
    { innerCornerRadius: -0.1 },
    { pocketWallAllowance: -1 },
    { pocketFinishFeedFactor: 0 },
    { finalFeedFactor: NaN },
    { tools: [] },
    { tools: [{ number: 1, diameter: 0 }] },
    { tools: [{ number: 1, diameter: 3.175, stepdown: -1 }] },
    { tools: [{ number: 1, diameter: 3.175, stepover: 4 }] },
    { material: { name: 'test', stepdownFactor: 0 } },
  ] satisfies Partial<CamSettings>[])('rejects invalid cutting data before geometry: %j', invalid => {
    expect(() => camPart(machiningCases.rectangle(), invalid)).toThrow(CamInputError);
  });

  it('returns a field and useful reason for correction', () => {
    try {
      validateCamSettings({ ...DEFAULT_SETTINGS, maxStepdown: 0 });
      throw new Error('Invalid settings were accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(CamInputError);
      expect((error as CamInputError).issues).toEqual([{ field: 'maxStepdown', message: 'must be greater than zero' }]);
    }
  });

  it('rejects invalid geometry and floors instead of emitting nonfinite output', () => {
    const features = machiningCases.rectangle();
    features.pockets[0].region[0][0].x = NaN;
    expect(() => camPart(features)).toThrow(/\.x: must be finite/);
    expect(() => camPart(machiningPart([[rectangle(20, 20, 70, 50)]], 13))).toThrow(/floorZ/);
  });

  it('bounds extremely small depth and sideways increments and shallow ramps', () => {
    expect(() => camPart(machiningCases.rectangle(), { maxStepdown: 1e-8 })).toThrow(/10000 depth passes/);
    expect(() => camPart(machiningCases.rectangle(), { stepoverFactor: 1e-12 })).toThrow(/0.001 mm/);
    expect(() => camPart(machiningCases.rectangle(), { rampAngleDeg: 1e-12 })).toThrow(/entry segments/);
  });

  it('validates tools and depths when individual operation builders are used', () => {
    expect(() => profileOperation('profile', rectangle(0, 0, 40, 30), 12, { number: 1, diameter: NaN }, DEFAULT_SETTINGS)).toThrow();
    expect(() => pocketOperation('pocket', [rectangle(0, 0, 40, 30)], 12, 14, DEFAULT_SETTINGS.tools[0], DEFAULT_SETTINGS)).toThrow(
      /floorZ/
    );
  });
});

describe('axial profile limits', () => {
  it.each([false, true])('limits the last release descent as well as roughing, inside=%s', inside => {
    const step = 0.2;
    const op = profileOperation(
      'profile',
      rectangle(5, 5, 45, 35),
      2,
      DEFAULT_SETTINGS.tools[0],
      { ...DEFAULT_SETTINGS, maxStepdown: step },
      inside
    );
    const levels = [2, ...new Set(op.passes.map(pass => Math.min(...pass.pts.map(point => point[2]))))];
    expect(levels.at(-1)).toBe(-0.3);
    for (let i = 1; i < levels.length; i++) expect(levels[i - 1] - levels[i]).toBeLessThanOrEqual(step + 1e-9);
    expect(levels.filter(z => z === -0.3)).toHaveLength(1);
  });
});

describe('physical tools and program spindle speeds', () => {
  const first: Tool = { number: 1, diameter: 3.175, guid: 'tool-a', rpm: 15000 };
  const input = (second: Tool) => ({
    stockTop: 12,
    warnings: [],
    operations: [first, second].map((tool, i) => ({
      name: `operation ${i}`,
      kind: 'pocket' as const,
      feature: 'pocket' as const,
      tool,
      passes: [
        {
          pts: [
            [20 + i * 30, 20, 6],
            [30 + i * 30, 20, 6],
          ] as [number, number, number][],
          feeds: [480, 1800],
          link: 'retract' as const,
        },
      ],
    })),
  });

  it.each([
    { ...first, guid: 'tool-b' },
    { ...first, number: 2 },
    { ...first, fluteLength: 6 },
    { ...first, rpm: 21000 },
  ])('splits incompatible tools or spindle speeds despite equal diameter: %j', second => {
    const cam = input(second);
    expect(() => toGcode(cam)).toThrow(/program per bit|spindle speed per program/);
    const programs = splitByBit(cam);
    expect(programs).toHaveLength(2);
    expect(programs.flatMap(program => program.operations)).toEqual(cam.operations);
    expect(toGcode(programs[1])).toContain(`M3 S${second.rpm}`);
  });

  it('keeps one physical tool together when only its label or cutting feed changes', () => {
    expect(splitByBit(input({ ...first, name: 'renamed', feed: 1200 }))).toHaveLength(1);
  });
});
