import type { Tool } from './toolpaths';

/** A flat end mill from a tool library, with the feeds and speed the library suggests. */
export interface LibraryTool extends Tool {
  name: string;
  /** Fusion's id of the tool: a re-import updates the bit with the same guid. */
  guid?: string;
  flutes?: number;
  /** Length of cut (flute length), mm: how deep the bit can cut at most. */
  fluteLength?: number;
  feed?: number;
  plungeFeed?: number;
  rpm?: number;
  /** Depth per pass, mm, when the library sets one. */
  stepdown?: number;
  /** Sideways step between pocket rings, mm, when the library sets one. */
  stepover?: number;
}

interface FusionPreset {
  v_f?: number;
  v_f_plunge?: number;
  n?: number;
  stepdown?: number;
  stepover?: number;
  'use-stepdown'?: boolean;
  'use-stepover'?: boolean;
}

interface FusionTool {
  guid?: string;
  type?: string;
  unit?: string;
  description?: string;
  geometry?: { DC?: number; NOF?: number; LCF?: number };
  'post-process'?: { number?: number };
  'start-values'?: { presets?: FusionPreset[] };
}

/**
 * Flat end mills from a Fusion tool library export (Library.json: `{ data: [...] }`). Other tool types (ball, chamfer,
 * bull nose) and holders are skipped: the 2.5D generator only drives flat end mills. Inch libraries are converted.
 */
export function parseFusionToolLibrary(json: string | unknown): LibraryTool[] {
  return readFusionToolLibrary(json).tools;
}

/** Like parseFusionToolLibrary, plus how many entries of each other type were skipped (e.g. "ball end mill": 2). */
export function readFusionToolLibrary(json: string | unknown): { tools: LibraryTool[]; skipped: Record<string, number> } {
  const lib = (typeof json === 'string' ? JSON.parse(json) : json) as { data?: FusionTool[] };
  if (!Array.isArray(lib?.data)) throw new Error('Not a Fusion tool library (expected { "data": [...] })');
  const tools: LibraryTool[] = [];
  const skipped: Record<string, number> = {};
  for (const t of lib.data) {
    if (t.type !== 'flat end mill' || !t.geometry?.DC) {
      // Holders and the like have no type worth listing.
      if (t.type && t.type !== 'holder') skipped[t.type] = (skipped[t.type] ?? 0) + 1;
      continue;
    }
    const mm = t.unit === 'inches' ? 25.4 : 1;
    const preset = t['start-values']?.presets?.[0];
    tools.push({
      number: t['post-process']?.number ?? tools.length + 1,
      diameter: +(t.geometry.DC * mm).toFixed(4),
      name: t.description || `flat ${t.geometry.DC * mm} mm`,
      guid: t.guid,
      flutes: t.geometry.NOF,
      fluteLength: t.geometry.LCF ? +(t.geometry.LCF * mm).toFixed(2) : undefined,
      feed: preset?.v_f ? preset.v_f * mm : undefined,
      plungeFeed: preset?.v_f_plunge ? +(preset.v_f_plunge * mm).toFixed(1) : undefined,
      rpm: preset?.n,
      // Fusion keeps a stepdown/stepover in a preset but only applies it when its "use" flag is on.
      stepdown: preset?.['use-stepdown'] && preset.stepdown ? +(preset.stepdown * mm).toFixed(3) : undefined,
      stepover: preset?.['use-stepover'] && preset.stepover ? +(preset.stepover * mm).toFixed(3) : undefined,
    });
  }
  return { tools, skipped };
}
