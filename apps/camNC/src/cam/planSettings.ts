import { DEFAULT_TABS, MATERIALS, type CamSettings, type LibraryTool } from '@wbcnc/cam';

export type MaterialKey = keyof typeof MATERIALS;

/** What the Plan step lets you choose; stored with the job. */
export interface PlanSettingsV1 {
  bit: LibraryTool;
  material: MaterialKey;
  /** Final outline pass speed as a fraction of the feed: 0.5 for a clean edge, 1 like Fusion. */
  finalFeedFactor: number;
  /** How far the final pass cuts below the board into the spoilboard, mm. */
  cutBelow: number;
  /** 2 mm high, 5 mm long holding tabs, at least 3 per outline. */
  tabs: boolean;
}

export const kDefaultBit: LibraryTool = { number: 1, diameter: 3.175, name: '1/8″ flat', feed: 1800, plungeFeed: 480 };

export const kDefaultPlan: PlanSettingsV1 = {
  bit: kDefaultBit,
  material: 'oak',
  finalFeedFactor: 0.5,
  cutBelow: 0.3,
  tabs: false,
};

export function toCamSettings(p: PlanSettingsV1): Partial<CamSettings> {
  return {
    tools: [{ number: p.bit.number, diameter: p.bit.diameter, name: 'flat end mill' }],
    material: MATERIALS[p.material],
    feed: p.bit.feed ?? 1800,
    plungeFeed: p.bit.plungeFeed ?? 480,
    finalFeedFactor: p.finalFeedFactor,
    finalZ: -p.cutBelow,
    tabs: p.tabs ? DEFAULT_TABS : false,
  };
}
