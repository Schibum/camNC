import type { Tool } from './toolpaths';

/** A flat end mill from a tool library, with the feeds and speed the library suggests. */
export interface LibraryTool extends Tool {
  name: string;
  /** Source tool ID: a re-import updates the bit with the same GUID. */
  guid?: string;
  flutes?: number;
  /** Length of cut (flute length), mm: how deep the bit can cut at most. */
  fluteLength?: number;
  /**
   * How far it sticks out below the collet nut as mounted, mm (measured): with the deepest cut, how low the nut gets
   * beside the holds.
   */
  stickout?: number;
  feed?: number;
  plungeFeed?: number;
  rpm?: number;
  /** Depth per pass, mm, when the library sets one. */
  stepdown?: number;
  /** Sideways step between pocket rings, mm, when the library sets one. */
  stepover?: number;
  /** Available cutting-data choices, retained without inferring a material recommendation. */
  presets?: ToolCuttingPreset[];
}

export interface ToolCuttingPreset {
  /** Source GUID when present; otherwise a stable index within the imported list. */
  id: string;
  name: string;
  description?: string;
  material?: { category?: string; query?: string };
  feed?: number;
  plungeFeed?: number;
  rampFeed?: number;
  leadFeed?: number;
  leadOutFeed?: number;
  transitionFeed?: number;
  finishFeed?: number;
  reducedFeed?: number;
  rpm?: number;
  stepdown?: number;
  stepover?: number;
  useStepdown: boolean;
  useStepover: boolean;
}

export interface ToolLibraryImportOptions {
  /** Tool GUID (or its tool number as a string) to the selected preset ID. */
  selectedPresets?: Readonly<Record<string, string>>;
}

interface ExportedPreset {
  guid?: string;
  name?: string;
  description?: string;
  material?: { category?: string; query?: string };
  v_f?: number;
  v_f_plunge?: number;
  v_f_ramp?: number;
  v_f_leadIn?: number;
  v_f_leadOut?: number;
  v_f_transition?: number;
  v_f_finish?: number;
  v_f_reduced?: number;
  n?: number;
  stepdown?: number;
  stepover?: number;
  'use-stepdown'?: boolean;
  'use-stepover'?: boolean;
}

/** Keep absent cutting data absent; a zero in a library is an unset value. */
function cuttingValue(value: number | undefined, scale = 1): number | undefined {
  if (value === undefined || value === 0) return undefined;
  const converted = value * scale;
  if (!Number.isFinite(converted) || converted < 0) throw new Error('Tool cutting data must contain positive finite numbers');
  return converted;
}

function readPreset(source: ExportedPreset, index: number, mm: number): ToolCuttingPreset {
  return {
    id: source.guid || `index:${index}`,
    name: source.name || `Preset ${index + 1}`,
    description: source.description,
    material: source.material ? { category: source.material.category, query: source.material.query } : undefined,
    feed: cuttingValue(source.v_f, mm),
    plungeFeed: cuttingValue(source.v_f_plunge, mm),
    rampFeed: cuttingValue(source.v_f_ramp, mm),
    leadFeed: cuttingValue(source.v_f_leadIn, mm),
    leadOutFeed: cuttingValue(source.v_f_leadOut, mm),
    transitionFeed: cuttingValue(source.v_f_transition, mm),
    finishFeed: cuttingValue(source.v_f_finish, mm),
    reducedFeed: cuttingValue(source.v_f_reduced, mm),
    rpm: cuttingValue(source.n),
    stepdown: cuttingValue(source.stepdown, mm),
    stepover: cuttingValue(source.stepover, mm),
    useStepdown: source['use-stepdown'] === true,
    useStepover: source['use-stepover'] === true,
  };
}

/** Switch only cutting data; preserve the mounted cutter's dimensions and measured stickout. */
export function selectToolPreset(tool: LibraryTool, id: string): LibraryTool {
  const preset = tool.presets?.find(p => p.id === id);
  if (!preset) throw new Error(`Tool ${tool.number} has no cutting preset ${id}`);
  return {
    ...tool,
    presetId: preset.id,
    presetName: preset.name,
    feed: preset.feed,
    plungeFeed: preset.plungeFeed,
    rampFeed: preset.rampFeed,
    leadFeed: preset.leadFeed,
    leadOutFeed: preset.leadOutFeed,
    transitionFeed: preset.transitionFeed,
    finishFeed: preset.finishFeed,
    reducedFeed: preset.reducedFeed,
    rpm: preset.rpm,
    stepdown: preset.useStepdown ? preset.stepdown : undefined,
    stepover: preset.useStepover ? preset.stepover : undefined,
  };
}

interface ExportedTool {
  guid?: string;
  type?: string;
  unit?: string;
  description?: string;
  geometry?: { DC?: number; NOF?: number; LCF?: number };
  'post-process'?: { number?: number };
  'start-values'?: { presets?: ExportedPreset[] };
}

/**
 * Flat end mills from a tool library export (Library.json: `{ data: [...] }`). Other tool types (ball, chamfer,
 * bull nose) and holders are skipped: the 2.5D generator only drives flat end mills. Inch libraries are converted.
 */
export function parseFusionToolLibrary(json: string | unknown, options: ToolLibraryImportOptions = {}): LibraryTool[] {
  return readFusionToolLibrary(json, options).tools;
}

/** Like parseFusionToolLibrary, plus how many entries of each other type were skipped (e.g. "ball end mill": 2). */
export function readFusionToolLibrary(
  json: string | unknown,
  options: ToolLibraryImportOptions = {}
): { tools: LibraryTool[]; skipped: Record<string, number> } {
  const lib = (typeof json === 'string' ? JSON.parse(json) : json) as { data?: ExportedTool[] };
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
    const presets = t['start-values']?.presets?.map((p, i) => readPreset(p, i, mm));
    if (presets && new Set(presets.map(p => p.id)).size !== presets.length) throw new Error('Tool preset IDs must be unique');
    const tool: LibraryTool = {
      number: t['post-process']?.number ?? tools.length + 1,
      diameter: +(t.geometry.DC * mm).toFixed(4),
      name: t.description || `flat ${t.geometry.DC * mm} mm`,
      guid: t.guid,
      flutes: t.geometry.NOF,
      fluteLength: t.geometry.LCF ? +(t.geometry.LCF * mm).toFixed(2) : undefined,
      ...(presets?.length ? { presets } : {}),
    };
    const selected = options.selectedPresets?.[tool.guid ?? String(tool.number)] ?? presets?.[0]?.id;
    tools.push(selected === undefined ? tool : selectToolPreset(tool, selected));
  }
  return { tools, skipped };
}
