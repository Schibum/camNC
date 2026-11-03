import type { CamSettings, LibraryTool } from '@wbcnc/cam';
import { DEFAULT_TABS, MATERIALS } from '@wbcnc/cam/settings';

export type MaterialKey = keyof typeof MATERIALS;

/** What the Plan step lets you choose; stored with the job. */
export interface PlanSettingsV1 {
  bit: LibraryTool;
  /** Optional smaller bit for features the main bit can't reach; boards then pause once to swap. */
  smallBit?: LibraryTool;
  material: MaterialKey;
  /** Final outline pass speed as a fraction of the feed: 0.5 for a clean edge, 1 like Fusion. */
  finalFeedFactor: number;
  /** How far the final pass cuts below the board into the spoilboard, mm. */
  cutBelow: number;
  /** 2 mm high, 5 mm long holding tabs, at least 3 per outline. */
  tabs: boolean;
  /** Max depth per pass, mm, for pockets and outline roughing. Unset: the material's share of the bit diameter. */
  maxStepdown?: number;
  /** Parts that don't fit on their board, left out of the job on purpose (instance ids). */
  leaveOut?: string[];
}

export const kDefaultBit: LibraryTool = { number: 1, diameter: 3.175, name: '1/8″ flat', feed: 1800, plungeFeed: 480 };

export const kDefaultPlan: PlanSettingsV1 = {
  bit: kDefaultBit,
  material: 'oak',
  finalFeedFactor: 0.5,
  cutBelow: 0.3,
  tabs: false,
};

export function toCamSettings(p: PlanSettingsV1, material: MaterialKey = p.material): Partial<CamSettings> {
  const bits = [p.bit, ...(p.smallBit && p.smallBit.diameter < p.bit.diameter ? [p.smallBit] : [])];
  return {
    // Distinct tool numbers, so the program's tools table and swaps name them apart.
    tools: bits.map((b, i) => ({
      number: i === 0 ? b.number : Math.max(b.number, p.bit.number + 1),
      diameter: b.diameter,
      name: 'flat end mill',
    })),
    material: MATERIALS[material],
    feed: p.bit.feed ?? 1800,
    plungeFeed: p.bit.plungeFeed ?? 480,
    finalFeedFactor: p.finalFeedFactor,
    finalZ: -p.cutBelow,
    tabs: p.tabs ? DEFAULT_TABS : false,
    maxStepdown: p.maxStepdown,
  };
}
