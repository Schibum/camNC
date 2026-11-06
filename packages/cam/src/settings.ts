/**
 * Materials and tab defaults: plain data, importable without the geometry or the CAD kernel (UI thread:
 * '@wbcnc/cam/settings').
 */

export interface Material {
  name: string;
  /** Stepdown (pockets and outline roughing) as a fraction of the tool diameter. */
  stepdownFactor: number;
}

export const MATERIALS = {
  // Hardwood: half the diameter keeps small bits (1/8") alive at full feed.
  oak: { name: 'oak', stepdownFactor: 0.5 },
  softwood: { name: 'softwood', stepdownFactor: 1 },
  plywood: { name: 'plywood', stepdownFactor: 0.75 },
  mdf: { name: 'mdf', stepdownFactor: 1 },
} satisfies Record<string, Material>;

/** A piece in a through hole's middle up to this long, mm, is sucked up by the vacuum when it comes loose. */
export const kVacuumSlug = 15;

export interface TabSettings {
  /** Above the stock bottom (Z0). */
  height: number;
  /** Length of material left, along the cut. */
  width: number;
  minCount: number;
  /** Target distance between tabs; more tabs on longer outlines. */
  spacing: number;
  /** Sloped shoulders outside the full-height holding width; 0 keeps vertical transitions. */
  rampLength?: number;
  /** Where exactly (part coordinates, on the outline): placed by the board's tab plan. Default: spread over straight runs. */
  centers?: { x: number; y: number }[];
}

export const DEFAULT_TABS: TabSettings = { height: 2, width: 5, minCount: 3, spacing: 250 };
