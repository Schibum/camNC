import { camPart, splitByBit, toGcode, type PartFeatures } from '@wbcnc/cam';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bitKey,
  cuttingKey,
  legacyCuttingKey,
  savedCuttingFor,
  savedCuttingEntries,
  defaultCutting,
  resolveCutting,
  useCuttingData,
} from './cuttingData';
import { kDefaultPlan, toCamSettings } from './planSettings';

const bit = { number: 1, diameter: 3.175, name: '1/8 mill v1', feed: 2400, plungeFeed: 360, rpm: 18000, stepover: 1.27 };

it('shows unambiguous legacy recipes and hides reset markers without guessing between physical cutters', () => {
  const first = { ...bit, guid: 'cutter-1', name: 'Mill @ shop' },
    second = { ...first, guid: 'cutter-2' };
  const legacy = legacyCuttingKey(first, 'oak');
  const saved = { [legacy]: { feed: 2200 }, [cuttingKey(first, 'oak')]: {} };
  expect(savedCuttingEntries(saved, [first])).toMatchObject([{ key: legacy, bit: first, material: 'oak', shared: false }]);
  expect(savedCuttingEntries(saved, [first, second])).toMatchObject([{ key: legacy, bit: undefined, material: 'oak', shared: true }]);
  expect(savedCuttingFor(saved, first, 'oak')).toEqual({});
});

afterEach(() => useCuttingData.setState({ saved: {} }));

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const part = (): PartFeatures => {
  const outline = rect(0, 0, 200, 100);
  const pocket = rect(30, 40, 70, 60);
  return {
    thickness: 8,
    footprint: [outline],
    outlines: [outline],
    throughHoles: [],
    levels: [],
    pockets: [{ floorZ: 4, region: [pocket], strictRegion: [pocket], above: [], area: 800 }],
    bottomFaces: [],
    slopedArea: 0,
  };
};

describe('cutting data', () => {
  it('takes each value from this job, else saved for the bit + material, else the library, else the default', () => {
    const { values, source } = resolveCutting(bit, 'oak', { feed: 2000, stepdown: 1.2 }, { stepdown: 2 });
    expect(values).toEqual({
      feed: 2000,
      plungeFeed: 360,
      rampFeed: 360,
      leadFeed: 2000,
      leadOutFeed: 2000,
      finishFeed: 1000,
      reducedFeed: 1000,
      transitionFeed: 2000,
      stepdown: 2,
      stepover: 1.27,
      rpm: 18000,
      finalFeedFactor: 0.5,
      wallFinish: 0,
      outlineFinish: 0.1,
    });
    expect(source).toEqual({
      feed: 'saved',
      plungeFeed: 'library',
      rampFeed: 'default',
      leadFeed: 'default',
      leadOutFeed: 'default',
      finishFeed: 'default',
      reducedFeed: 'default',
      transitionFeed: 'default',
      stepdown: 'job',
      stepover: 'library',
      rpm: 'library',
      finalFeedFactor: 'default',
      wallFinish: 'default',
      outlineFinish: 'default',
    });
  });

  it('derives independent feed defaults from the resolved job values', () => {
    const { values, source } = resolveCutting({ number: 1, diameter: 3.175, name: 'flat' }, 'oak', undefined, {
      feed: 2200,
      plungeFeed: 420,
      finalFeedFactor: 0.6,
    });
    expect(values).toMatchObject({
      rampFeed: 420,
      leadFeed: 2200,
      leadOutFeed: 2200,
      finishFeed: 1320,
      reducedFeed: 1100,
      transitionFeed: 2200,
    });
    for (const field of ['rampFeed', 'leadFeed', 'leadOutFeed', 'finishFeed', 'reducedFeed', 'transitionFeed'] as const)
      expect(source[field]).toBe('default');
  });

  it('resolves each independent feed from job, saved, library, then its dependent default', () => {
    const enriched = { ...bit, rampFeed: 300, leadFeed: 700, leadOutFeed: 800, finishFeed: 900, reducedFeed: 600, transitionFeed: 1300 };
    const { values, source } = resolveCutting(
      enriched,
      'oak',
      { rampFeed: 350, leadFeed: 750, leadOutFeed: 850 },
      { rampFeed: 400, leadOutFeed: 950 }
    );
    expect(values).toMatchObject({
      rampFeed: 400,
      leadFeed: 750,
      leadOutFeed: 950,
      finishFeed: 900,
      reducedFeed: 600,
      transitionFeed: 1300,
    });
    expect(source).toMatchObject({
      rampFeed: 'job',
      leadFeed: 'saved',
      leadOutFeed: 'job',
      finishFeed: 'library',
      reducedFeed: 'library',
      transitionFeed: 'library',
    });
  });

  it('preserves mounted cutter identity and independent feeds through the job settings', () => {
    const physical = {
      ...bit,
      guid: 'physical-tool',
      flutes: 2,
      fluteLength: 20,
      stickout: 25,
      presetId: 'wood',
      presetName: 'Selected data',
      rampFeed: 310,
      leadFeed: 640,
      leadOutFeed: 730,
      finishFeed: 890,
      reducedFeed: 530,
      transitionFeed: 1200,
    };
    const settings = toCamSettings({ ...kDefaultPlan, bit: physical });
    expect(settings.tools![0]).toMatchObject({
      guid: 'physical-tool',
      flutes: 2,
      fluteLength: 20,
      stickout: 25,
      presetId: 'wood',
      presetName: 'Selected data',
      rampFeed: 310,
      leadFeed: 640,
      leadOutFeed: 730,
      finishFeed: 890,
      reducedFeed: 530,
      transitionFeed: 1200,
    });
    expect(settings.tools![0].name).toContain(bit.name);
    expect(settings).toMatchObject({
      rampFeed: 310,
      leadFeed: 640,
      leadOutFeed: 730,
      finishFeed: 890,
      reducedFeed: 530,
      transitionFeed: 1200,
    });
  });

  it('keeps legacy keys for unnamed identity and separates physical tools by GUID', () => {
    expect(bitKey(bit)).toBe(`${bit.number}|${bit.diameter}|${bit.name}`);
    expect(bitKey({ ...bit, guid: 'first' })).not.toBe(bitKey({ ...bit, guid: 'second' }));
    expect(cuttingKey({ ...bit, guid: 'a@b|c' }, 'oak')).toBe('guid:a%40b%7Cc@oak');
    expect(bitKey({ ...bit, guid: 'first', name: 'renamed', number: 9 })).toBe(bitKey({ ...bit, guid: 'first' }));
  });

  it('copies a legacy shared recipe on edit without assigning it to another physical tool, and reset blocks fallback', () => {
    const first = { ...bit, guid: 'first' },
      second = { ...bit, guid: 'second' };
    const legacy = legacyCuttingKey(first, 'oak'),
      key = cuttingKey(first, 'oak');
    useCuttingData.setState({ saved: { [legacy]: { feed: 2000, stepdown: 1 } } });
    const read = (tool: typeof first) => savedCuttingFor(useCuttingData.getState().saved, tool, 'oak');
    expect(read(first)).toEqual({ feed: 2000, stepdown: 1 });
    expect(read(second)).toEqual({ feed: 2000, stepdown: 1 });
    useCuttingData.getState().save(key, { feed: 2200 }, legacy);
    expect(read(first)).toEqual({ feed: 2200, stepdown: 1 });
    expect(read(second)).toEqual({ feed: 2000, stepdown: 1 });
    useCuttingData.getState().reset(key, 'stepdown', legacy);
    expect(read(first)).toEqual({ feed: 2200 });
    useCuttingData.getState().reset(key, 'feed', legacy);
    expect(read(first)).toEqual({});
    expect(read(second)).toEqual({ feed: 2000, stepdown: 1 });
    useCuttingData.getState().save(key, { plungeFeed: 300 }, legacy);
    expect(read(first)).toEqual({ plungeFeed: 300 });
    useCuttingData.getState().reset(cuttingKey(second, 'oak'), undefined, legacy);
    expect(read(second)).toEqual({});
    expect(useCuttingData.getState().saved[legacy]).toEqual({ feed: 2000, stepdown: 1 });
    expect(toCamSettings({ ...kDefaultPlan, bit: first }, 'oak', useCuttingData.getState().saved).feed).toBe(bit.feed);
  });

  it('defaults to half the bit per pass in hardwood, deeper in softer material', () => {
    expect(defaultCutting(3.175, 'oak').stepdown).toBe(1.59);
    expect(defaultCutting(3.175, 'mdf').stepdown).toBe(3.17);
    expect(resolveCutting({ number: 1, diameter: 6, name: 'x' }, 'oak', undefined, undefined).source.feed).toBe('default');
  });

  it('saves per bit and material, and forgets a value or an entry', () => {
    const { save, reset } = useCuttingData.getState();
    save(cuttingKey(bit, 'oak'), { stepdown: 1 });
    save(cuttingKey(bit, 'oak'), { feed: 2000 });
    expect(useCuttingData.getState().saved).toEqual({ [cuttingKey(bit, 'oak')]: { stepdown: 1, feed: 2000 } });
    reset(cuttingKey(bit, 'oak'), 'stepdown');
    expect(useCuttingData.getState().saved).toEqual({ [cuttingKey(bit, 'oak')]: { feed: 2000 } });
    reset(cuttingKey(bit, 'oak'), 'feed');
    expect(useCuttingData.getState().saved).toEqual({});
  });

  it('becomes the CAM settings: feeds and speed of the main bit, each bit its own stepdown', () => {
    const small = { number: 2, diameter: 1.5, name: '1.5 mm' };
    const plan = { ...kDefaultPlan, bit, smallBit: small, cutting: { feed: 2100 } };
    const s = toCamSettings(plan, 'oak', { [cuttingKey(bit, 'oak')]: { stepdown: 1.4 }, [cuttingKey(small, 'oak')]: { stepdown: 0.5 } });
    expect(s.feed).toBe(2100);
    expect(s.plungeFeed).toBe(360);
    expect(s.spindleRpm).toBe(18000);
    expect(s.stepoverFactor).toBeCloseTo(0.4);
    expect(s.tools!.map(t => [t.diameter, t.stepdown])).toEqual([
      [3.175, 1.4],
      [1.5, 0.5],
    ]);
  });

  it('gives each bit its own cutting data, by the same lookup: the small bit’s saved feed is not ignored', () => {
    const big = { number: 1, diameter: 6, name: '6 mm', feed: 3000, plungeFeed: 900, rpm: 18000 };
    const small = { number: 2, diameter: 2, name: '2 mm', feed: 600, plungeFeed: 150, rpm: 24000, fluteLength: 8 };
    const plan = { ...kDefaultPlan, bit: big, smallBit: small };
    const s = toCamSettings(plan, 'oak', { [cuttingKey(small, 'oak')]: { feed: 500 } });
    expect(s.tools![0]).toMatchObject({ diameter: 6, feed: 3000, plungeFeed: 900, rpm: 18000, stepover: 2.4, finalFeedFactor: 0.5 });
    expect(s.tools![1]).toMatchObject({
      diameter: 2,
      feed: 500,
      plungeFeed: 150,
      rpm: 24000,
      stepover: 0.8,
      finalFeedFactor: 0.5,
      fluteLength: 8,
    });
    // This job's overrides are the main bit's only.
    expect(toCamSettings({ ...plan, cutting: { feed: 2500 } }, 'oak').tools!.map(t => t.feed)).toEqual([2500, 600]);

    // ...and they reach the small bit's program.
    const slot = rect(100, 40, 104, 70);
    const f: PartFeatures = { ...part(), pockets: [{ floorZ: 6, region: [slot], strictRegion: [slot], above: [], area: 120 }] };
    const programs = splitByBit(camPart(f, s)).map(p => toGcode(p, { spindleRpm: s.spindleRpm }));
    expect(programs).toHaveLength(2);
    expect(programs[0]).toMatch(/^M3 S24000$/m);
    expect(programs[0]).toMatch(/F500\b/);
    expect(programs[0]).toMatch(/F150\b/);
    expect(programs[0]).not.toMatch(/F3000|F900\b|S18000/);
    expect(programs[1]).toMatch(/^M3 S18000$/m);
    expect(programs[1]).toMatch(/F3000\b/);
  });

  it('a job with one bit makes the same G-code as with one set of feeds', () => {
    const s = toCamSettings({ ...kDefaultPlan, bit, cutting: { feed: 2100 } }, 'oak');
    const plain = { ...s, tools: s.tools!.map(t => ({ number: t.number, diameter: t.diameter, name: t.name, stepdown: t.stepdown })) };
    const withoutPlanId = (code: string) =>
      code
        .split('\n')
        .filter(line => !line.startsWith('(Plan: '))
        .join('\n');
    expect(withoutPlanId(toGcode(camPart(part(), s), { spindleRpm: s.spindleRpm }))).toBe(
      withoutPlanId(toGcode(camPart(part(), plain), { spindleRpm: s.spindleRpm }))
    );
  });

  it('turns the wall finish on for pockets when set (off by default)', () => {
    expect(toCamSettings(kDefaultPlan).pocketWallAllowance).toBe(0);
    expect(toCamSettings({ ...kDefaultPlan, cutting: { wallFinish: 0.2 } }).pocketWallAllowance).toBe(0.2);
  });

  it('outlines keep a light skim by default, and finish in depth steps when asked for more', () => {
    expect(toCamSettings(kDefaultPlan)).toMatchObject({ leaveStock: 0.1 });
    expect(toCamSettings(kDefaultPlan).profileFinishStepdown).toBeUndefined();
    expect(toCamSettings({ ...kDefaultPlan, cutting: { outlineFinish: 0.2 } }).profileFinishStepdown).toBeUndefined();
    expect(toCamSettings({ ...kDefaultPlan, cutting: { outlineFinish: 1, stepdown: 4 } })).toMatchObject({
      leaveStock: 1,
      profileFinishStepdown: 4,
    });
  });

  it('keeps an older job’s full-feed final pass as this job’s choice', () => {
    expect(toCamSettings({ ...kDefaultPlan, finalFeedFactor: 1 }).finalFeedFactor).toBe(1);
    expect(toCamSettings({ ...kDefaultPlan, finalFeedFactor: 0.5 }).finalFeedFactor).toBe(0.5);
  });
});
