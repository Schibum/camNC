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
  dowelSpots,
  flipPart,
  holdCheck,
  sideBSpec,
  kMaxSlopedShare,
  loadStep,
  loadStl,
  metrics,
  readGcode,
  splitByBit,
  tabRemovalProgram,
  usesTabs,
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
import type { BoardRequest, BodyMesh, CamPartInfo, ModelImport, OpSummary, Outline2D, PlanResult, TabRemovalResult } from '../cam/camTypes';

/** Parts of the models imported in this worker, by model key, so generating G-code needs no re-import. */
/** A loaded part: its features, and those of its underside once turned over (side B), by turn axis. */
interface ModelEntry {
  part: FlatPart;
  features: PartFeatures;
  flipped?: Partial<Record<'x' | 'y', PartFeatures>>;
}
const models = new Map<string, Map<string, ModelEntry>>();

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
    const cache = new Map<string, ModelEntry>();
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
      // A copy: the transfer detaches it, and a 3D part milled anyway still needs its mesh here (loaded()).
      indices: b.mesh.indices.slice(),
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
    return summarize(cam, part.name, part.size, settings);
  },

  /** After cutting a board with tabs: a program that stops before each tab, then cuts through it. */
  async generateTabRemoval(key: string, board: BoardRequest, settings: Partial<CamSettings>): Promise<TabRemovalResult> {
    const cam = camBoard(boardSpec(key, board), settings);
    const feed = (settings.feed ?? 1800) * (settings.finalFeedFactor ?? 0.5);
    const { cam: removal, tabs } = tabRemovalProgram(cam, { feed, plungeFeed: settings.plungeFeed ?? 480 });
    const gcode = toGcode(removal, {
      partName: `Board ${board.name}: tab removal`,
      board: board.name,
      stockSize: [board.w, board.h, board.stockTop],
      spindleRpm: settings.spindleRpm,
    });
    return { gcode, tabs, timeMin: metrics(readGcode(gcode), cam.stockTop).timeMin };
  },

  /** One program for a whole board: its parts at their nested positions, operations grouped by bit. */
  async generateBoard(key: string, board: BoardRequest, settings: Partial<CamSettings>): Promise<PlanResult> {
    const spec = boardSpec(key, board);
    const flip = board.flip;
    // On dowels: side A drills the pins (and their mirrors) where there's room on the board.
    let problem: string | undefined;
    if (flip?.registration === 'dowels') {
      const diameter = flip.dowelDiameter ?? 6;
      const at = dowelSpots(spec, diameter, 3);
      if (at) spec.dowels = { at, diameter, depth: 6 };
      else
        problem = `No room for two ⌀${diameter} dowel pins clear of the parts: make the board bigger, or re-align with the camera instead.`;
    }
    const cam = camBoard(spec, settings);
    // The second side cuts the undersides: the warning that they need one is answered.
    if (flip) cam.warnings = cam.warnings.filter(w => !w.includes('flipped'));
    const size: [number, number, number] = [board.w, board.h, board.stockTop];
    let plan = summarize(cam, `Board ${board.name}`, size, settings, board.thickness, board.name);
    if (flip) {
      const b = camBoard(
        sideBSpec(spec, p => flippedFeatures(key, p.id, board, p.rotated)),
        { ...settings, cutThrough: false }
      );
      plan = {
        ...plan,
        flip: { registration: flip.registration, dowels: spec.dowels?.at, dowelDiameter: spec.dowels?.diameter, problem },
        ...(b.operations.length && { sideB: summarize(b, `Board ${board.name} side B`, size, settings, board.stockTop, board.name) }),
      };
    }
    // The hold check runs on the board as laid out, before it's turned to lie like the stock on the bed.
    const flat = board.rotationDeg ? camBoard({ ...spec, rotationDeg: 0 }, settings) : cam;
    return usesTabs(board.holdDown) ? { ...plan, hold: holdCheck(flat, board) } : plan;
  },
};

function boardSpec(key: string, board: BoardRequest): BoardSpec {
  return {
    ...board,
    tabs: { ...DEFAULT_TABS, ...board.tabs },
    parts: board.parts.map(p => {
      const { part, features } = loaded(key, p.partId);
      return { id: p.id, name: p.name, features, size: part.size, x: p.x, y: p.y, rotated: p.rotated };
    }),
  };
}

/**
 * A part's underside, as side B sees it: the part turned over (about its Y axis when it lies turned on the board, so the
 * board turns top to bottom), depths measured from the stock's new top (its old bottom).
 */
function flippedFeatures(key: string, instanceId: string, board: BoardRequest, rotated: boolean): PartFeatures {
  const partId = board.parts.find(p => p.id === instanceId)!.partId;
  const entry = loaded(key, partId);
  const cache = (entry.flipped ??= {});
  const axis = rotated ? 'y' : 'x';
  const f = (cache[axis] ??= extractFeatures(flipPart(entry.part, axis).mesh, entry.part.thickness));
  const dz = board.stockTop - entry.part.thickness;
  return dz
    ? {
        ...f,
        thickness: f.thickness + dz,
        levels: f.levels.map(l => ({ ...l, z: l.z + dz })),
        pockets: f.pockets.map(p => ({ ...p, floorZ: p.floorZ + dz })),
      }
    : f;
}

function loaded(key: string, partId: string) {
  const entry = models.get(key)?.get(partId);
  if (!entry) throw new Error('Open the model again: this part is not loaded.');
  // A 3D part milled as flat anyway: extract its features now.
  if (!entry.features.levels.length && entry.part.slopedShare > kMaxSlopedShare)
    entry.features = extractFeatures(entry.part.mesh, entry.part.thickness);
  return entry;
}

/** "left: Pocket 2 z=3.5" -> "left · Pocket 4.5 deep" (board programs prefix the part). */
const label = (name: string, top: number, title?: string) => {
  const [, prefix, op] = name.match(/^(?:(.+): )?(.+)$/)!;
  const z = op.match(/z=([\d.]+)/);
  const text = title
    ? title[0].toUpperCase() + title.slice(1)
    : z
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
/**
 * Per-operation numbers, safety rules and a preview of a generated job, as one program per bit (FluidNC can't zero
 * Z during a pause, so bits are swapped between programs). `partTop`: the parts' top face, which pocket depths are
 * measured from (the stock may be thicker).
 */
function summarize(
  cam: PartCam,
  name: string,
  size: [number, number, number],
  settings: Partial<CamSettings>,
  partTop = cam.stockTop,
  board?: string
): PlanResult {
  const split = splitByBit(cam);
  const programs = split.map(p => {
    const tool = p.operations[0].tool;
    const gcode = toGcode(p, {
      partName: split.length > 1 ? `${name}, bit T${tool.number} D=${tool.diameter}` : name,
      board,
      stockSize: size,
      spindleRpm: settings.spindleRpm,
    });
    return { tool: tool.number, diameter: tool.diameter, gcode, timeMin: metrics(readGcode(gcode), cam.stockTop).timeMin };
  });
  const one = (ops: typeof cam.operations) => metrics(readGcode(toGcode({ ...cam, operations: ops })), cam.stockTop);
  const ops: OpSummary[] = cam.operations.map(op => {
    const zs = op.passes.flatMap(p => p.pts.map(q => q[2]));
    const levels = new Set(op.passes.map(p => Math.min(...p.pts.map(q => q[2])).toFixed(2)));
    // Where it starts cutting: a deeper pocket starts at the floor of the one before.
    const zTop = op.kind === 'pocket' ? Math.min(cam.stockTop, Math.max(...zs)) : cam.stockTop;
    const depths = [zTop, ...[...levels].map(Number).sort((a, b) => b - a)];
    return {
      name: op.name,
      // The title's depths are from the part's top; a thicker stock (allowance) doesn't change them.
      label: label(op.name, partTop, op.title),
      kind: op.kind,
      tool: { number: op.tool.number, diameter: op.tool.diameter },
      zTop,
      zBottom: Math.min(...zs),
      depthSteps: levels.size,
      stepdown: Math.max(...depths.slice(1).map((z, i) => depths[i] - z)),
      feeds: [...new Set(op.passes.flatMap(p => p.feeds.slice(1)))].sort((a, b) => b - a),
      timeMin: one([op]).timeMin,
    };
  });
  const safety = programs.flatMap(p =>
    checkGcodeSafety(p.gcode, {
      stockTop: cam.stockTop,
      size: [size[0], size[1]],
      // Dowel pin holes go into the spoilboard on purpose.
      minZ: Math.min(
        settings.finalZ ?? -0.3,
        ...cam.operations.filter(o => o.name.startsWith('Dowel pin hole')).flatMap(o => o.passes.flatMap(q => q.pts.map(v => v[2])))
      ),
      toolRadius: p.diameter / 2,
    }).map(i => i.message)
  );
  // The whole job, for the preview and the totals.
  const moves = programs.flatMap(p => readGcode(p.gcode));
  return {
    gcode: programs.map(p => p.gcode).join('\n'),
    timeMin: programs.reduce((t, p) => t + p.timeMin, 0),
    warnings: cam.warnings,
    safety,
    ops,
    bits: boardBits(cam),
    programs,
    size,
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
