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
  dowelClearance,
  dowelProblem,
  dowelSpots,
  freePartsProgram,
  kDefaultSkin,
  kTapeLayer,
  flipPart,
  holdCheck,
  holdClashes,
  holdOptionsOf,
  holdTimeline,
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
  rotateAboutOrigin,
  type PartCam,
  type FlatPart,
  type PartFeatures,
  type StepBody,
} from '@wbcnc/cam';
import * as Comlink from 'comlink';
// Lazy: this worker only starts when a model is opened, and occt only loads the wasm on the first STEP file.
import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import type { BoardRequest, BodyMesh, CamPartInfo, ModelImport, OpSummary, Outline2D, PlanResult, ReleaseProgram } from '../cam/camTypes';

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

  /** One program for a whole board: its parts at their nested positions, operations grouped by bit. */
  async generateBoard(key: string, board: BoardRequest, settings: Partial<CamSettings>, { perPart = false } = {}): Promise<PlanResult> {
    const spec = boardSpec(key, board);
    const flip = board.flip;
    // On dowels: side A drills the pins (and their mirrors) where there's room on the board.
    let problem: string | undefined;
    if (flip?.registration === 'dowels') {
      const diameter = flip.dowelDiameter ?? 6;
      problem = dowelProblem(spec, diameter, settings);
      const at = problem ? undefined : dowelSpots(spec, diameter, dowelClearance(settings));
      if (at) spec.dowels = { at, diameter, depth: 6 };
      else
        problem ??= `No room for two ⌀${diameter} dowel pins clear of the parts: make the board bigger, or re-align with the camera instead.`;
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
    const holding = (cam.holding ?? []).map(h => ({
      name: h.name,
      how: h.how,
      tabs: h.tabs.length,
      ...(h.wanted && { wanted: h.wanted }),
    }));
    // Skins and tabs are taken care of last: after side B, when there is one, with the board turned over.
    const release = releasePrograms(flat, board, settings, !!plan.sideB, perPart);
    plan = { ...plan, ...stability(flat, spec), ...(release.length && { release }) };
    // A skin (or the layer on the tape) holds every part until the end.
    if (board.holdDown === 'skin' || board.holdDown === 'fixture-tape')
      return {
        ...plan,
        holding,
        skin: board.skin ?? (board.holdDown === 'skin' ? kDefaultSkin : kTapeLayer),
        ...(board.holdDown === 'fixture-tape' && { taped: true }),
      };
    if (!usesTabs(board.holdDown)) return plan;
    return { ...plan, hold: holdCheck(flat, board, holdOptionsOf(spec)), holding, skin: board.skin ?? kDefaultSkin };
  },
};

/**
 * Does everything stay put during the job? What comes loose at which step (stock with too few holds, parts cut free
 * with nothing holding them), and hold points the bit would hit. On the board as laid out (not turned on the bed).
 */
function stability(flat: PartCam, spec: BoardSpec): Pick<PlanResult, 'timeline' | 'holdClash'> {
  if (spec.holdDown === 'fixture-tape') return {};
  const how = (part: string) => flat.holding?.find(h => h.name === part)?.how;
  // Nothing holds the parts, as the user chose: say so, don't block.
  const watched = spec.holdDown === 'none' || spec.holdDown === 'clamps';
  const after = (op: string) => {
    const [, part] = op.match(/^(.+): [^:]*$/) ?? [];
    return part ? `the outline of ${part}` : op;
  };
  const timeline = holdTimeline(flat, spec, holdOptionsOf(spec)).map(ev => {
    const block = ev.kind === 'pivot' || (!watched && how(ev.what) !== 'self' && how(ev.what) !== 'tabs');
    const message =
      ev.kind === 'pivot'
        ? `After cutting ${after(ev.after)}, a piece of the board ${
            (ev.holds ?? 0) >= 3
              ? `has ${ev.holds} screws or clamps, but all to one side of it`
              : `is held by ${ev.holds === 0 ? 'no' : `only ${ev.holds}`} screw${ev.holds === 1 ? '' : 's'} or clamp${ev.holds === 1 ? '' : 's'}`
          }, so it can turn or lift. It needs 3 around its middle: drag one there (ringed on the board), or keep a frame on the Boards step.`
        : `${ev.what} comes loose when its outline is cut through${watched ? ', as you chose: nothing holds the parts. Keep an eye on it.' : ': no tabs into stock that is held.'}`;
    return { ...ev, block, message };
  });
  const cuts = flat.operations.flatMap(op => op.passes.map(p => ({ r: op.tool.diameter / 2, pts: p.pts })));
  const holdClash = holdClashes(spec.holdPoints ?? [], cuts, flat.stockTop).map(h => ({ x: h.x, y: h.y }));
  return { timeline, holdClash };
}

/**
 * The guided programs after the cutting, from the board as laid out (not turned on the bed): `freePartsProgram` for
 * parts that keep a skin or the layer on the tape, `tabRemovalProgram` for "tabs + guided removal". No new toolpaths:
 * they follow the outlines' last passes.
 */
function releasePrograms(flat: PartCam, board: BoardRequest, settings: Partial<CamSettings>, turned: boolean, perPart: boolean) {
  const feed = (settings.feed ?? 1800) * (settings.finalFeedFactor ?? 0.5);
  const plungeFeed = settings.plungeFeed ?? 480;
  const finalZ = settings.finalZ ?? -0.3;
  const flipped = turned ? { turned: { h: board.h } } : {};
  const taped = board.holdDown === 'fixture-tape';
  const out: ReleaseProgram[] = [];
  const pauses = (n: number, what: string) => `${n} ${n === 1 ? 'pause' : 'pauses'}: ${what}`;
  const add = (
    kind: ReleaseProgram['kind'],
    title: string,
    note: (n: number) => string,
    cam: PartCam,
    layer: number,
    more: Partial<ReleaseProgram>
  ) => {
    if (!cam.operations.length) return;
    const count = cam.operations.filter(o => o.pauseAfter || o.pauseBefore).length;
    const made = releaseProgram(kind, title, note(count), count, cam, board, settings, turned ? flat.stockTop - layer + finalZ : finalZ);
    out.push({ ...made, turned, ...more });
  };
  const turn = onBed(board);
  if (flat.holding?.some(h => h.how === 'skin')) {
    const program = freePartsProgram(flat, { feed, plungeFeed, finalZ, ...flipped, pause: !taped }); // Taped down: nothing to take out in between.
    add(
      'free',
      taped ? 'Cut free' : 'Free the parts',
      n => (taped ? 'No pauses: take the parts off the tape at the end' : pauses(n, n === 1 ? 'take out the part' : 'take out each part')),
      turnCam(program.cam, turn),
      board.skin ?? (taped ? kTapeLayer : kDefaultSkin),
      { parts: program.parts.map(p => ({ ...p, at: turn2(turn, p.at) })) }
    );
  }
  if (board.holdDown === 'tabs-guided') {
    const program = tabRemovalProgram(flat, {
      feed,
      plungeFeed,
      ...flipped,
      ...(perPart && { perPart, fullFeed: settings.feed ?? 1800 }),
    });
    add(
      'tabs',
      'Remove the tabs',
      n => pauses(n, perPart ? (n === 1 ? 'take out the part' : 'take out each part') : 'hold the part at each tab'),
      turnCam(program.cam, turn),
      board.tabs.height,
      { perPart, tabs: program.tabs.map(t => ({ ...t, at: turn2(turn, t.at), hold: turn2(turn, t.hold) })) }
    );
  }
  return out;
}

/**
 * G-code, numbers and safety checks of one guided program. `minZ`: turned over, the program cuts from the new top, so
 * the limit is what it has to cut through plus the usual depth past it, not the depth below the spoilboard's surface.
 */
function releaseProgram(
  kind: ReleaseProgram['kind'],
  title: string,
  note: string,
  pauses: number,
  cam: PartCam,
  board: BoardRequest,
  settings: Partial<CamSettings>,
  minZ: number
): ReleaseProgram {
  const { tool } = cam.operations[0];
  const size: [number, number, number] = [board.w, board.h, board.stockTop];
  const gcode = toGcode(cam, {
    partName: `Board ${board.name}: ${title}`,
    board: board.name,
    stockSize: size,
    spindleRpm: settings.spindleRpm,
  });
  return {
    kind,
    title,
    gcode,
    timeMin: metrics(readGcode(gcode), cam.stockTop).timeMin,
    tool: tool.number,
    diameter: tool.diameter,
    pauses,
    note,
    ops: opSummaries(cam, cam.stockTop).map(op => ({ ...op, program: { kind, title, note } })),
    safety: checkGcodeSafety(gcode, { stockTop: cam.stockTop, size: [size[0], size[1]], minZ, toolRadius: tool.diameter / 2 }).map(
      i => `${title}: ${i.message}`
    ),
    turned: false,
  };
}

/** Board coordinates -> the program's: turned like the board lies on the bed. */
const onBed = (board: BoardRequest) => rotateAboutOrigin(board.rotationDeg ?? 0);
const turn2 = (turn: ReturnType<typeof onBed>, p: { x: number; y: number }) => {
  const [x, y] = turn([p.x, p.y, 0]);
  return { x, y };
};
const turnCam = (cam: PartCam, turn: ReturnType<typeof onBed>): PartCam => ({
  ...cam,
  operations: cam.operations.map(op => ({ ...op, passes: op.passes.map(p => ({ ...p, pts: p.pts.map(turn) })) })),
});

function boardSpec(key: string, board: BoardRequest): BoardSpec {
  return {
    ...board,
    tabs: { ...DEFAULT_TABS, ...board.tabs },
    parts: board.parts.map(p => {
      const { part, features } = loaded(key, p.partId);
      return { id: p.id, name: p.name, features, size: part.size, x: p.x, y: p.y, rotated: p.rotated, tabFallback: p.tabFallback };
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
  const ops = opSummaries(cam, partTop);
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

/** The numbers of each operation. `partTop`: the parts' top face, which pocket depths are measured from. */
function opSummaries(cam: PartCam, partTop: number): OpSummary[] {
  const one = (ops: typeof cam.operations) => metrics(readGcode(toGcode({ ...cam, operations: ops })), cam.stockTop);
  return cam.operations.map(op => {
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
