import type { Tool } from './toolpaths';

/** A flat end mill from a tool library, with the feeds and speed the library suggests. */
export interface LibraryTool extends Tool {
  name: string;
  flutes?: number;
  feed?: number;
  plungeFeed?: number;
  rpm?: number;
}

interface FusionTool {
  type?: string;
  unit?: string;
  description?: string;
  geometry?: { DC?: number; NOF?: number };
  'post-process'?: { number?: number };
  'start-values'?: { presets?: { v_f?: number; v_f_plunge?: number; n?: number }[] };
}

/**
 * Flat end mills from a Fusion tool library export (Library.json: `{ data: [...] }`). Other tool types (ball, chamfer,
 * bull nose) and holders are skipped: the 2.5D generator only drives flat end mills. Inch libraries are converted.
 */
export function parseFusionToolLibrary(json: string | unknown): LibraryTool[] {
  const lib = (typeof json === 'string' ? JSON.parse(json) : json) as { data?: FusionTool[] };
  if (!Array.isArray(lib?.data)) throw new Error('Not a Fusion tool library (expected { "data": [...] })');
  const tools: LibraryTool[] = [];
  for (const t of lib.data) {
    if (t.type !== 'flat end mill' || !t.geometry?.DC) continue;
    const mm = t.unit === 'inches' ? 25.4 : 1;
    const preset = t['start-values']?.presets?.[0];
    tools.push({
      number: t['post-process']?.number ?? tools.length + 1,
      diameter: +(t.geometry.DC * mm).toFixed(4),
      name: t.description || `flat ${t.geometry.DC * mm} mm`,
      flutes: t.geometry.NOF,
      feed: preset?.v_f ? preset.v_f * mm : undefined,
      plungeFeed: preset?.v_f_plunge ? +(preset.v_f_plunge * mm).toFixed(1) : undefined,
      rpm: preset?.n,
    });
  }
  return tools;
}
