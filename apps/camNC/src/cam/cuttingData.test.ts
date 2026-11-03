import { afterEach, describe, expect, it } from 'vitest';
import { cuttingKey, defaultCutting, resolveCutting, useCuttingData } from './cuttingData';
import { kDefaultPlan, toCamSettings } from './planSettings';

const bit = { number: 1, diameter: 3.175, name: '1/8 mill v1', feed: 2400, plungeFeed: 360, rpm: 18000, stepover: 1.27 };

afterEach(() => useCuttingData.setState({ saved: {} }));

describe('cutting data', () => {
  it('takes each value from this job, else saved for the bit + material, else the library, else the default', () => {
    const { values, source } = resolveCutting(bit, 'oak', { feed: 2000, stepdown: 1.2 }, { stepdown: 2 });
    expect(values).toEqual({ feed: 2000, plungeFeed: 360, stepdown: 2, stepover: 1.27, rpm: 18000, finalFeedFactor: 0.5 });
    expect(source).toEqual({
      feed: 'saved',
      plungeFeed: 'library',
      stepdown: 'job',
      stepover: 'library',
      rpm: 'library',
      finalFeedFactor: 'default',
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

  it('keeps an older job’s full-feed final pass as this job’s choice', () => {
    expect(toCamSettings({ ...kDefaultPlan, finalFeedFactor: 1 }).finalFeedFactor).toBe(1);
    expect(toCamSettings({ ...kDefaultPlan, finalFeedFactor: 0.5 }).finalFeedFactor).toBe(0.5);
  });
});
