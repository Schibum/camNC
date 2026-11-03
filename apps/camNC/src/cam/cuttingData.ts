import type { LibraryTool } from '@wbcnc/cam';
import { MATERIALS } from '@wbcnc/cam/settings';
import { create } from 'zustand';
import { combine, persist } from 'zustand/middleware';

type MaterialKey = keyof typeof MATERIALS;

/** How one bit cuts one material. Feeds in mm/min, stepdown and stepover in mm. */
export interface CuttingData {
  feed: number;
  plungeFeed: number;
  /** Depth per pass, pockets and outline roughing. */
  stepdown: number;
  /** Sideways step between pocket rings. */
  stepover: number;
  rpm: number;
  /** Final outline pass feed as a share of the feed: 0.5 for a clean edge, 1 like Fusion. */
  finalFeedFactor: number;
}

export type CuttingField = keyof CuttingData;
/** Where a value comes from, most specific first. */
export type CuttingSource = 'job' | 'saved' | 'library' | 'default';

export const kCuttingFields: CuttingField[] = ['feed', 'plungeFeed', 'stepdown', 'stepover', 'rpm', 'finalFeedFactor'];

export const kCuttingLabels: Record<CuttingField, { label: string; unit: string; step: number }> = {
  feed: { label: 'Feed', unit: 'mm/min', step: 50 },
  plungeFeed: { label: 'Plunge feed', unit: 'mm/min', step: 10 },
  stepdown: { label: 'Stepdown', unit: 'mm', step: 0.1 },
  stepover: { label: 'Stepover', unit: 'mm', step: 0.1 },
  rpm: { label: 'Spindle speed', unit: 'rpm', step: 500 },
  finalFeedFactor: { label: 'Final pass feed', unit: '× feed', step: 0.1 },
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

export const bitKey = (b: LibraryTool) => `${b.number}|${b.diameter}|${b.name}`;
/** The saved table's key: one bit (as the library names it) in one material. */
export const cuttingKey = (bit: LibraryTool, material: MaterialKey) => `${bitKey(bit)}@${material}`;

const round = (v: number) => +v.toFixed(2);

/** Without a library or saved values: the material's stepdown (hardwood 0.5 × the bit), 40 % stepover. */
export function defaultCutting(diameter: number, material: MaterialKey): CuttingData {
  return {
    feed: 1800,
    plungeFeed: 480,
    stepdown: round(MATERIALS[material].stepdownFactor * diameter),
    stepover: round(0.4 * diameter),
    rpm: 15000,
    finalFeedFactor: 0.5,
  };
}

/** What the tool library says for this bit (Fusion presets aren't per material here). */
export function libraryCutting(bit: LibraryTool): Partial<CuttingData> {
  const out: Partial<CuttingData> = {};
  if (bit.feed) out.feed = bit.feed;
  if (bit.plungeFeed) out.plungeFeed = bit.plungeFeed;
  if (bit.rpm) out.rpm = bit.rpm;
  if (bit.stepdown) out.stepdown = bit.stepdown;
  if (bit.stepover) out.stepover = bit.stepover;
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
  for (const field of kCuttingFields) {
    const [from, layer] = layers.find(([, l]) => l[field] !== undefined)!;
    values[field] = layer[field]!;
    source[field] = from;
  }
  return { values, source };
}

/** Cutting data saved for a bit + material, for every job on this device. */
export const useCuttingData = create(
  persist(
    combine({ saved: {} as Record<string, Partial<CuttingData>> }, set => ({
      save: (key: string, patch: Partial<CuttingData>) => set(s => ({ saved: { ...s.saved, [key]: { ...s.saved[key], ...patch } } })),
      /** Forget one value (or the whole entry): the library or default applies again. */
      reset: (key: string, field?: CuttingField) =>
        set(s => {
          const { [key]: entry, ...rest } = s.saved;
          if (!field || !entry) return { saved: rest };
          const others = without(entry, field);
          return { saved: Object.keys(others).length ? { ...rest, [key]: others } : rest };
        }),
    })),
    { name: 'camnc-cutting-data' }
  )
);
