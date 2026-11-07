import type { MachineBoundsValues } from '@/setup/MachineBoundsForm';

export interface BedPreset {
  label: string;
  width: number;
  depth: number;
}

/** Common working areas, to preview G-code without a machine connection. */
export const kBedPresets: BedPreset[] = [
  { label: 'Desktop', width: 300, depth: 300 },
  { label: 'Small', width: 600, depth: 600 },
  { label: 'Half sheet', width: 1220, depth: 1220 },
  { label: 'Full sheet (4 × 8 ft)', width: 1220, depth: 2440 },
];

/** The largest preset, so that most programs fit: drawn until the user picks a size or a machine reports its own. */
export const kDefaultBed: MachineBoundsValues = { xmin: 0, xmax: 1220, ymin: 0, ymax: 2440 };

/** Bounds of a bed of the given size with its origin at machine zero. */
export function boundsFromSize(width: number, depth: number): MachineBoundsValues {
  return { xmin: 0, xmax: width, ymin: 0, ymax: depth };
}
