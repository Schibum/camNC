import { camPart, splitByBit, toGcode, type PartFeatures } from '@wbcnc/cam';
import { afterEach, describe, expect, it } from 'vitest';
import { cuttingKey, defaultCutting, resolveCutting, useCuttingData } from './cuttingData';
import { kDefaultPlan, toCamSettings } from './planSettings';

const bit = { number: 1, diameter: 3.175, name: '1/8 mill v1', feed: 2400, plungeFeed: 360, rpm: 18000, stepover: 1.27 };

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
    expect(values).toEqual({ feed: 2000, plungeFeed: 360, stepdown: 2, stepover: 1.27, rpm: 18000, finalFeedFactor: 0.5, wallFinish: 0 });
    expect(source).toEqual({
      feed: 'saved',
      plungeFeed: 'library',
      stepdown: 'job',
      stepover: 'library',
      rpm: 'library',
      finalFeedFactor: 'default',
      wallFinish: 'default',
    });
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
    expect(toGcode(camPart(part(), s), { spindleRpm: s.spindleRpm })).toBe(toGcode(camPart(part(), plain), { spindleRpm: s.spindleRpm }));
  });

  it('turns the wall finish on for pockets when set (off by default)', () => {
    expect(toCamSettings(kDefaultPlan).pocketWallAllowance).toBe(0);
    expect(toCamSettings({ ...kDefaultPlan, cutting: { wallFinish: 0.2 } }).pocketWallAllowance).toBe(0.2);
  });

  it('keeps an older job’s full-feed final pass as this job’s choice', () => {
    expect(toCamSettings({ ...kDefaultPlan, finalFeedFactor: 1 }).finalFeedFactor).toBe(1);
    expect(toCamSettings({ ...kDefaultPlan, finalFeedFactor: 0.5 }).finalFeedFactor).toBe(0.5);
  });
});
