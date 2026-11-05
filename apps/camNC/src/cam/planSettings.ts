import type { CamSettings, LibraryTool } from '@wbcnc/cam';
import { DEFAULT_TABS, MATERIALS } from '@wbcnc/cam/settings';
import { cuttingKey, resolveCutting, type CuttingData } from './cuttingData';

export type MaterialKey = keyof typeof MATERIALS;

/** What the Plan step lets you choose; stored with the job. */
export interface PlanSettingsV1 {
  bit: LibraryTool;
  /** Optional smaller bit for features the main bit can't reach; boards then pause once to swap. */
  smallBit?: LibraryTool;
  material: MaterialKey;
  /** Older jobs: the final pass feed chosen for this job (now part of `cutting`). */
  finalFeedFactor?: number;
  /** How far the final pass cuts below the board into the spoilboard, mm. */
  cutBelow: number;
  /** 2 mm high, 5 mm long holding tabs, at least 3 per outline. */
  tabs: boolean;
  /** Cutting data for the main bit in this job only, over what's saved for the bit + material. */
  cutting?: Partial<CuttingData>;
  /** Parts that don't fit on their board, left out of the job on purpose (instance ids). */
  leaveOut?: string[];
  /** Bottom skin thickness, mm (default 1). */
  skin?: number;
}

/** The built-in bit: no library values, so its cutting data shows as the defaults. */
export const kDefaultBit: LibraryTool = { number: 1, diameter: 3.175, name: '1/8″ flat' };

export const kDefaultPlan: PlanSettingsV1 = {
  bit: kDefaultBit,
  material: 'oak',
  cutBelow: 0.3,
  tabs: false,
};

/** This job's overrides for the main bit; an older job's final pass feed other than the default counts as one. */
export function jobCutting(p: PlanSettingsV1): Partial<CuttingData> {
  const legacy = p.finalFeedFactor !== undefined && p.finalFeedFactor !== 0.5 ? { finalFeedFactor: p.finalFeedFactor } : {};
  return { ...legacy, ...p.cutting };
}

/**
 * The CAM settings for one board's material. `saved`: the cutting data saved per bit + material (`useCuttingData`);
 * each bit cuts by its own. The settings' own feeds and speed are the main bit's: it cuts the outlines, and what follows
 * them (freeing the parts, removing tabs).
 */
export function toCamSettings(
  p: PlanSettingsV1,
  material: MaterialKey = p.material,
  saved: Record<string, Partial<CuttingData>> = {}
): Partial<CamSettings> {
  const bits = [p.bit, ...(p.smallBit && p.smallBit.diameter < p.bit.diameter ? [p.smallBit] : [])];
  const cut = bits.map((b, i) => resolveCutting(b, material, saved[cuttingKey(b, material)], i === 0 ? jobCutting(p) : undefined).values);
  const main = cut[0];
  return {
    // Distinct tool numbers, so the program's tools table and swaps name them apart.
    tools: bits.map((b, i) => ({
      number: i === 0 ? b.number : Math.max(b.number, p.bit.number + 1),
      diameter: b.diameter,
      name: 'flat end mill',
      stepdown: cut[i].stepdown,
      feed: cut[i].feed,
      plungeFeed: cut[i].plungeFeed,
      rpm: cut[i].rpm,
      stepover: cut[i].stepover,
      finalFeedFactor: cut[i].finalFeedFactor,
      fluteLength: b.fluteLength,
    })),
    material: MATERIALS[material],
    feed: main.feed,
    plungeFeed: main.plungeFeed,
    stepoverFactor: main.stepover / p.bit.diameter,
    finalFeedFactor: main.finalFeedFactor,
    pocketWallAllowance: main.wallFinish,
    spindleRpm: main.rpm,
    finalZ: -p.cutBelow,
    tabs: p.tabs ? DEFAULT_TABS : false,
  };
}
