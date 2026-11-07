import { demoStorage } from '@/lib/demo/demo-storage';
import type { LibraryTool } from '@wbcnc/cam';
import { MATERIALS } from '@wbcnc/cam/settings';
import { create } from 'zustand';
import { combine, createJSONStorage, persist } from 'zustand/middleware';

type MaterialKey = keyof typeof MATERIALS;

/** How one bit cuts one material. Feeds in mm/min, stepdown and stepover in mm. */
export interface CuttingData {
  feed: number;
  plungeFeed: number;
  rampFeed: number;
  leadFeed: number;
  leadOutFeed: number;
  finishFeed: number;
  reducedFeed: number;
  transitionFeed: number;
  /** Depth per pass, pockets and outline roughing. */
  stepdown: number;
  /** Sideways step between pocket rings. */
  stepover: number;
  rpm: number;
  /** Default outline finishing feed as a share of cutting feed. */
  finalFeedFactor: number;
  /**
   * Pocket radial stock left by roughing and removed by depth-limited wall finishing.
   */
  wallFinish: number;
  /** Outline and through-hole radial stock left by roughing and removed by the final lap. */
  outlineFinish: number;
}

export type CuttingField = keyof CuttingData;
/** Where a value comes from, most specific first. */
export type CuttingSource = 'job' | 'saved' | 'library' | 'default';

const baseFields = ['feed', 'plungeFeed', 'stepdown', 'stepover', 'rpm', 'finalFeedFactor', 'wallFinish', 'outlineFinish'] as const;
const motionFields = ['rampFeed', 'leadFeed', 'leadOutFeed', 'finishFeed', 'reducedFeed', 'transitionFeed'] as const;
export const kCuttingFields: CuttingField[] = [
  'feed',
  'plungeFeed',
  ...motionFields,
  'stepdown',
  'stepover',
  'rpm',
  'finalFeedFactor',
  'wallFinish',
  'outlineFinish',
];

export const kCuttingLabels: Record<CuttingField, { label: string; unit: string; step: number; min?: number }> = {
  feed: { label: 'Feed', unit: 'mm/min', step: 50 },
  plungeFeed: { label: 'Plunge feed', unit: 'mm/min', step: 10 },
  rampFeed: { label: 'Ramp feed', unit: 'mm/min', step: 10 },
  leadFeed: { label: 'Lead-in feed', unit: 'mm/min', step: 50 },
  leadOutFeed: { label: 'Lead-out feed', unit: 'mm/min', step: 50 },
  finishFeed: { label: 'Finishing feed', unit: 'mm/min', step: 50 },
  reducedFeed: { label: 'Inner-corner feed', unit: 'mm/min', step: 50 },
  transitionFeed: { label: 'Link feed', unit: 'mm/min', step: 50 },
  stepdown: { label: 'Stepdown', unit: 'mm', step: 0.1 },
  stepover: { label: 'Stepover', unit: 'mm', step: 0.1 },
  rpm: { label: 'Spindle speed', unit: 'rpm', step: 500 },
  finalFeedFactor: { label: 'Final pass feed', unit: '× feed', step: 0.1 },
  wallFinish: { label: 'Pocket wall finish', unit: 'mm radial stock · 0 = off', step: 0.05, min: 0 },
  outlineFinish: { label: 'Outline wall finish', unit: 'mm radial stock · 0 = off', step: 0.05, min: 0 },
};

/** What each value does, for its tooltip: the consequence, not the mechanism. */
export const kCuttingHints: Record<CuttingField, string> = {
  feed: 'How fast the bit moves through the wood. Faster saves time but loads the bit; too slow can burn the wood.',
  plungeFeed: 'How fast the bit goes down into the wood. Slower is gentler on the bit.',
  rampFeed: 'Speed while entering along a sloped path. Follows the resolved plunge feed unless you set it separately.',
  leadFeed: 'Speed while joining a wall on a tangent lead. Defaults to the resolved cutting feed.',
  leadOutFeed: 'Speed while leaving a wall on a tangent lead. Defaults to the resolved cutting feed.',
  finishFeed: 'Speed of finishing cuts. Defaults to cutting feed × final pass feed; a value set here takes precedence over that factor.',
  reducedFeed: 'Feed cap for tight inner-wall turns. Defaults to half the cutting feed; straight cuts keep their cutting feed.',
  transitionFeed: 'Speed of permitted links between cuts. Retracts and plunges still use their own movement limits.',
  stepdown: 'How deep each pass cuts. Less is gentler on the bit and slower.',
  stepover: 'How far each pocket pass moves sideways. Less leaves a smoother floor and is slower.',
  rpm: 'How fast the spindle turns. The program starts the spindle at this speed; with a router, set its dial to match.',
  finalFeedFactor: 'Default finishing speed as a share of cutting feed. A separate finishing-feed value takes precedence.',
  wallFinish:
    'Roughing stays this far off pocket walls, then finishing passes remove that radial stock in limited depth increments. 0 turns it off.',
  outlineFinish:
    'Roughing stays this far off outlines and through holes, then a final lap cuts them to size. Above 0.2 mm the walls are finished in stepdown increments, not in one lap. 0 turns it off.',
};

export const kSourceLabels: Record<CuttingSource, string> = {
  job: 'this job',
  saved: 'saved',
  library: 'library',
  default: 'default',
};

/** A copy of `o` without `key`. */
export function without<T extends object>(o: T, key: keyof T): T {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

export const legacyBitKey = (b: LibraryTool) => `${b.number}|${b.diameter}|${b.name}`;
export const bitKey = (b: LibraryTool) => (b.guid ? `guid:${encodeURIComponent(b.guid)}` : legacyBitKey(b));
/** The saved table's key: one bit (as the library names it) in one material. */
export const cuttingKey = (bit: LibraryTool, material: MaterialKey) => `${bitKey(bit)}@${material}`;
export const legacyCuttingKey = (bit: LibraryTool, material: MaterialKey) => `${legacyBitKey(bit)}@${material}`;

/** Old name-based recipes stay shared until a physical tool is explicitly edited; no ambiguous recipe is moved. */
export function savedCuttingFor(
  saved: Record<string, Partial<CuttingData>>,
  bit: LibraryTool,
  material: MaterialKey
): Partial<CuttingData> | undefined {
  const key = cuttingKey(bit, material);
  if (Object.prototype.hasOwnProperty.call(saved, key)) return saved[key];
  return saved[legacyCuttingKey(bit, material)];
}

/** Match saved recipes without assigning an ambiguous legacy name to one physical cutter. */
export function savedCuttingEntries(saved: Record<string, Partial<CuttingData>>, bits: LibraryTool[]) {
  return Object.entries(saved)
    .filter(([, values]) => Object.keys(values).length > 0)
    .map(([key, values]) => {
      const separator = key.lastIndexOf('@');
      const identity = key.slice(0, separator);
      const exact = bits.filter(bit => bitKey(bit) === identity);
      const matches = exact.length ? exact : bits.filter(bit => legacyBitKey(bit) === identity);
      return {
        key,
        values,
        material: key.slice(separator + 1) as MaterialKey,
        bit: matches.length === 1 ? matches[0] : undefined,
        shared: matches.length > 1,
      };
    });
}

const round = (v: number) => +v.toFixed(2);

/** Without a library or saved values: the material's stepdown (hardwood 0.5 × the bit), 40 % stepover. */
export function defaultCutting(diameter: number, material: MaterialKey): CuttingData {
  return {
    feed: 1800,
    plungeFeed: 480,
    rampFeed: 480,
    leadFeed: 1800,
    leadOutFeed: 1800,
    finishFeed: 900,
    reducedFeed: 900,
    transitionFeed: 1800,
    stepdown: round(MATERIALS[material].stepdownFactor * diameter),
    stepover: round(0.4 * diameter),
    rpm: 15000,
    finalFeedFactor: 0.5,
    wallFinish: 0,
    outlineFinish: 0.1,
  };
}

/** The selected library cutting data, without inferring a material match. */
export function libraryCutting(bit: LibraryTool): Partial<CuttingData> {
  const out: Partial<CuttingData> = {};
  for (const field of ['feed', 'plungeFeed', ...motionFields, 'rpm', 'stepdown', 'stepover', 'finalFeedFactor'] as const)
    if (bit[field] !== undefined) out[field] = bit[field];
  return out;
}

export interface ResolvedCutting {
  values: CuttingData;
  source: Record<CuttingField, CuttingSource>;
}

/** Per value: this job's override, else saved for this bit + material, else the tool library, else the default. */
export function resolveCutting(
  bit: LibraryTool,
  material: MaterialKey,
  saved: Partial<CuttingData> | undefined,
  job: Partial<CuttingData> | undefined
): ResolvedCutting {
  const layers: [CuttingSource, Partial<CuttingData>][] = [
    ['job', job ?? {}],
    ['saved', saved ?? {}],
    ['library', libraryCutting(bit)],
    ['default', defaultCutting(bit.diameter, material)],
  ];
  const values = {} as CuttingData;
  const source = {} as Record<CuttingField, CuttingSource>;
  for (const field of baseFields) {
    const [from, layer] = layers.find(([, l]) => l[field] !== undefined)!;
    values[field] = layer[field]!;
    source[field] = from;
  }
  const derived: Pick<CuttingData, (typeof motionFields)[number]> = {
    rampFeed: values.plungeFeed,
    leadFeed: values.feed,
    leadOutFeed: values.feed,
    finishFeed: round(values.feed * values.finalFeedFactor),
    reducedFeed: round(values.feed * 0.5),
    transitionFeed: values.feed,
  };
  for (const field of motionFields) {
    const explicit = layers.slice(0, -1).find(([, layer]) => layer[field] !== undefined);
    values[field] = explicit ? explicit[1][field]! : derived[field];
    source[field] = explicit ? explicit[0] : 'default';
  }
  return { values, source };
}

/** Cutting data saved for a bit + material, for every job on this device. */
export const useCuttingData = create(
  persist(
    combine({ saved: {} as Record<string, Partial<CuttingData>> }, set => ({
      save: (key: string, patch: Partial<CuttingData>, legacyKey?: string) =>
        set(s => ({ saved: { ...s.saved, [key]: { ...(s.saved[key] ?? (legacyKey ? s.saved[legacyKey] : undefined)), ...patch } } })),
      /** Forget one value (or the whole entry): the library or default applies again. */
      reset: (key: string, field?: CuttingField, legacyKey?: string) =>
        set(s => {
          const { [key]: current, ...rest } = s.saved;
          const entry = current ?? (legacyKey ? s.saved[legacyKey] : undefined);
          if (legacyKey && legacyKey !== key) {
            // An empty own entry deliberately blocks fallback after reset, including across reloads.
            return { saved: { ...rest, [key]: field && entry ? without(entry, field) : {} } };
          }
          if (!field || !entry) return { saved: rest };
          const others = without(entry, field);
          return { saved: Object.keys(others).length ? { ...rest, [key]: others } : rest };
        }),
    })),
    { storage: createJSONStorage(() => demoStorage), name: 'camnc-cutting-data' }
  )
);
