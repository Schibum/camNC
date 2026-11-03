import {
  camPart,
  detectFlat,
  extractFeatures,
  flipPart,
  groupIdentical,
  loadStep,
  metrics,
  readGcode,
  toGcode,
  type CamSettings,
  type FlatPart,
  type PartFeatures,
} from '@wbcnc/cam';
import * as Comlink from 'comlink';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import type { CamPartSummary, GeneratedJob, Outline2D } from './camTypes';

const kept = new Map<string, { part: FlatPart; features: PartFeatures; flipped?: { part: FlatPart; features: PartFeatures } }>();

const toOutline = (paths: { x: number; y: number }[][]): Outline2D => paths.map(p => p.map(q => [q.x, q.y] as [number, number]));

function summarize(id: string, names: string[], part: FlatPart, features: PartFeatures): CamPartSummary {
  const warnings: string[] = [];
  if (features.bottomFaces.length) warnings.push('Has features on the bottom: needs a second, flipped setup');
  if (part.prismaticRatio < 0.95) warnings.push(`Not a flat board (${Math.round(part.prismaticRatio * 100)}% prismatic)`);
  if (features.slopedArea > 1) warnings.push(`${features.slopedArea.toFixed(0)}mm² sloped faces are ignored`);
  return {
    id,
    name: names[0],
    names,
    size: part.size,
    thickness: part.thickness,
    twoSided: features.bottomFaces.length > 0,
    warnings,
    outlines: toOutline(features.outlines),
    holes: toOutline(features.throughHoles),
    pockets: features.pockets.map(p => ({ z: p.floorZ, region: toOutline(p.strictRegion) })),
  };
}

/** Turn the CAM core's technical notes into what the user can act on; part-level notes are shown separately. */
function friendlyWarnings(raw: string[]) {
  const out = new Set<string>();
  for (const w of raw) {
    const corners = w.match(/left in corners\/narrow spots with D=([\d.]+)/);
    if (corners) out.add(`Inside corners stay rounded (bit radius ${+(+corners[1] / 2).toFixed(2)} mm)`);
    else if (w.includes('no tool fits')) out.add(`A feature is narrower than every bit: add a smaller bit (${w.split(':')[0]})`);
    else if (!w.includes('sloped') && !w.includes('flipped')) out.add(w);
  }
  return [...out];
}

const api = {
  async importStep(bytes: Uint8Array): Promise<{ parts: CamPartSummary[]; readMs: number }> {
    const { bodies, readMs } = await loadStep(bytes, { locateFile: () => wasmUrl });
    kept.clear();
    const groups = groupIdentical(bodies.map(detectFlat));
    const parts = groups.map((g, i) => {
      const id = `p${i}`;
      const features = extractFeatures(g.part.mesh, g.part.thickness);
      kept.set(id, { part: g.part, features });
      return summarize(id, g.names, g.part, features);
    });
    return { parts, readMs };
  },

  /** `side: 'bottom'` = the flipped second setup (bottom pockets only). */
  async generate(id: string, settings: Partial<CamSettings>, side: 'top' | 'bottom' = 'top'): Promise<GeneratedJob> {
    const entry = kept.get(id);
    if (!entry) throw new Error(`unknown part ${id}`);
    let { part, features } = entry;
    if (side === 'bottom') {
      if (!entry.flipped) {
        const fp = flipPart(entry.part);
        entry.flipped = { part: fp, features: extractFeatures(fp.mesh, fp.thickness) };
      }
      ({ part, features } = entry.flipped);
    }
    const cam = camPart(features, { ...settings, cutThrough: side === 'top' && settings.cutThrough !== false });
    const gcode = toGcode(cam, { partName: side === 'bottom' ? `${part.name}` : part.name, stockSize: part.size });
    const moves = readGcode(gcode);
    const m = metrics(moves, cam.stockTop);
    return {
      gcode,
      warnings: friendlyWarnings(cam.warnings),
      timeMin: m.timeMin,
      operations: cam.operations.map(op => ({ name: op.name, tool: op.tool, passes: op.passes.length })),
      // Cutting moves below the stock top, flattened for the preview.
      path: moves.filter(mv => !mv.rapid && (mv.from[2] < cam.stockTop || mv.to[2] < cam.stockTop)).map(mv => [mv.from, mv.to]),
    };
  },
};

export type CamWorkerAPI = typeof api;
Comlink.expose(api);
