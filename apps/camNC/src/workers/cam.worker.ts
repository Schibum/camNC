import {
  boardBits,
  camBoard,
  camPart,
  DEFAULT_TABS,
  checkGcodeSafety,
  detectFlat,
  extractFeatures,
  flatMatrix,
  groupIdentical,
  kMaxSlopedShare,
  loadStep,
  loadStl,
  metrics,
  readGcode,
  splitByBit,
  summarizePart,
  toGcode,
  type BoardSpec,
  type CamSettings,
  type PartCam,
  type FlatPart,
  type PartFeatures,
  type StepBody,
} from '@wbcnc/cam';
import * as Comlink from 'comlink';
// Lazy: this worker only starts when a model is opened, and occt only loads the wasm on the first STEP file.
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import type { BoardRequest, BodyMesh, CamPartInfo, ModelImport, OpSummary, Outline2D, PlanResult } from '../cam/camTypes';

/** Parts of the models imported in this worker, by model key, so generating G-code needs no re-import. */
const models = new Map<string, Map<string, { part: FlatPart; features: PartFeatures }>>();

async function readBodies(bytes: Uint8Array, fileName: string): Promise<{ bodies: StepBody[]; readMs: number }> {
  if (/\.stl$/i.test(fileName)) {
    const t0 = performance.now();
    const bodies = loadStl(bytes, fileName.replace(/\.stl$/i, ''));
    return { bodies, readMs: performance.now() - t0 };
  }
  return loadStep(bytes, { locateFile: () => occtWasmUrl });
}

const api = {
  /** STEP or STL → flat parts, identical ones grouped, with feature summaries and display meshes. */
  async importModel(bytes: Uint8Array, fileName: string, key = fileName): Promise<ModelImport> {
    const { bodies, readMs } = await readBodies(bytes, fileName);
    const t0 = performance.now();
    const flat = bodies.map(b => detectFlat(b));
    const groups = groupIdentical(flat);
    const partOf = new Map<FlatPart, string>();
    const cache = new Map<string, { part: FlatPart; features: PartFeatures }>();
    models.set(key, cache);
    const parts: CamPartInfo[] = groups.map((g, i) => {
      const id = `part-${i}`;
      g.names.forEach(n => partOf.set(flat.find(f => f.name === n && !partOf.has(f))!, id));
      const notFlat = g.part.slopedShare > kMaxSlopedShare;
      // 3D parts (350k triangles of knife slots take ~30s) are only analysed if milled anyway (see loaded()).
      const features = notFlat ? emptyFeatures(g.part) : extractFeatures(g.part.mesh, g.part.thickness);
      cache.set(id, { part: g.part, features });
      const summary = summarizePart(g.part, features);
      const shape = (paths: { x: number; y: number }[][]): Outline2D => paths.map(p => p.map(q => [+q.x.toFixed(2), +q.y.toFixed(2)]));
      return {
        id,
        name: g.names[0],
        names: g.names,
        size: g.part.size,
        thickness: g.part.thickness,
        summary,
        shape: {
          outlines: shape(features.outlines),
          holes: shape(features.throughHoles),
          pockets: features.pockets.map(p => ({ depth: g.part.thickness - p.floorZ, region: shape(p.strictRegion) })),
        },
      };
    });
    const meshes: BodyMesh[] = bodies.map((b, i) => ({
      name: b.name,
      partId: partOf.get(flat[i]) ?? parts[0].id,
      positions: Float32Array.from(b.mesh.positions),
      indices: b.mesh.indices,
      flat: flatMatrix(flat[i]),
    }));
    const result: ModelImport = { parts, meshes, readMs, analyzeMs: performance.now() - t0 };
    return Comlink.transfer(
      result,
      meshes.flatMap(m => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer])
    );
  },

  /** Toolpaths and FluidNC G-code for one part of an imported model, with per-operation numbers and safety checks. */
  async generate(key: string, partId: string, settings: Partial<CamSettings>): Promise<PlanResult> {
    const { part, features } = loaded(key, partId);
    const cam = camPart(features, settings);
    return summarize(cam, toGcode(cam, { partName: part.name, stockSize: part.size }), part.size, settings);
  },

  /** One program for a whole board: its parts at their nested positions, operations grouped by bit. */
  async generateBoard(key: string, board: BoardRequest, settings: Partial<CamSettings>): Promise<PlanResult> {
    const spec: BoardSpec = {
      ...board,
      tabs: { ...DEFAULT_TABS, ...board.tabs },
      parts: board.parts.map(p => {
        const { part, features } = loaded(key, p.partId);
        return { id: p.id, name: p.name, features, size: part.size, x: p.x, y: p.y, rotated: p.rotated };
      }),
    };
    const cam = camBoard(spec, settings);
    const size: [number, number, number] = [board.w, board.h, board.stockTop];
    const result = summarize(cam, toGcode(cam, { partName: `Board ${board.name}`, stockSize: size }), size, settings, board.thickness);
    const programs = splitByBit(cam);
    if (programs.length > 1)
      result.programs = programs.map(p => {
        const tool = p.operations[0].tool;
        const gcode = toGcode(p, { partName: `Board ${board.name}, bit T${tool.number} D=${tool.diameter}`, stockSize: size });
        return { tool: tool.number, diameter: tool.diameter, gcode, timeMin: metrics(readGcode(gcode), cam.stockTop).timeMin };
      });
    return result;
  },
};

function loaded(key: string, partId: string) {
  const entry = models.get(key)?.get(partId);
  if (!entry) throw new Error('Open the model again: this part is not loaded.');
  // A 3D part milled as flat anyway: extract its features now.
  if (!entry.features.levels.length && entry.part.slopedShare > kMaxSlopedShare)
    entry.features = extractFeatures(entry.part.mesh, entry.part.thickness);
  return entry;
}

/** "left: Pocket 2 z=3.5" -> "left · Pocket 4.5 deep" (board programs prefix the part). */
const label = (name: string, top: number) => {
  const [, prefix, op] = name.match(/^(?:(.+): )?(.+)$/)!;
  const z = op.match(/z=([\d.]+)/);
  const text = z
    ? `Pocket ${+(top - +z[1]).toFixed(2)} deep`
    : op.startsWith('Hole')
      ? 'Through hole'
      : op.startsWith('Outline')
        ? 'Outline: rough + final pass'
        : op;
  return prefix ? `${prefix} · ${text}` : text;
};

/** Per-operation numbers, safety rules and a preview of a generated program. */
/** `partTop`: the parts' top face, which pocket depths are measured from (the stock may be thicker). */
function summarize(
  cam: PartCam,
  gcode: string,
  size: [number, number, number],
  settings: Partial<CamSettings>,
  partTop = cam.stockTop
): PlanResult {
  const one = (ops: typeof cam.operations) => metrics(readGcode(toGcode({ ...cam, operations: ops })), cam.stockTop);
  const ops: OpSummary[] = cam.operations.map(op => {
    const zs = op.passes.flatMap(p => p.pts.map(q => q[2]));
    const levels = new Set(op.passes.map(p => Math.min(...p.pts.map(q => q[2])).toFixed(2)));
    return {
      name: op.name,
      label: label(op.name, partTop),
      kind: op.kind,
      tool: { number: op.tool.number, diameter: op.tool.diameter },
      // Where it starts cutting: a deeper pocket starts at the floor of the one before.
      zTop: op.kind === 'pocket' ? Math.min(cam.stockTop, Math.max(...zs)) : cam.stockTop,
      zBottom: Math.min(...zs),
      depthSteps: levels.size,
      feeds: [...new Set(op.passes.flatMap(p => p.feeds.slice(1)))].sort((a, b) => b - a),
      timeMin: one([op]).timeMin,
    };
  });
  const moves = readGcode(gcode);
  const safety = checkGcodeSafety(gcode, {
    stockTop: cam.stockTop,
    size: [size[0], size[1]],
    minZ: settings.finalZ ?? -0.3,
    toolRadius: Math.max(0, ...cam.operations.map(o => o.tool.diameter / 2)),
  }).map(i => i.message);
  return {
    gcode,
    timeMin: metrics(moves, cam.stockTop).timeMin,
    warnings: cam.warnings,
    safety,
    ops,
    bits: boardBits(cam),
    programs: [
      {
        tool: cam.operations[0]?.tool.number ?? 1,
        diameter: cam.operations[0]?.tool.diameter ?? 0,
        gcode,
        timeMin: metrics(moves, cam.stockTop).timeMin,
      },
    ],
    size,
    // Cutting moves inside the stock, for the preview.
    path: moves.filter(m => !m.rapid && Math.min(m.from[2], m.to[2]) < cam.stockTop - 1e-3).map(m => [m.from, m.to]),
  };
}

function emptyFeatures(part: FlatPart): PartFeatures {
  return {
    thickness: part.thickness,
    footprint: [],
    outlines: [],
    throughHoles: [],
    levels: [],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
}

export type CamWorkerAPI = typeof api;
Comlink.expose(api);
