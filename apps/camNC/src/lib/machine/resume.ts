/**
 * Resume a job that was interrupted (power cycle, reset, alarm, Stop) from close to where it stopped.
 *
 * camNC keeps the job's G-code and the last machine position with the SD progress (see jobRecord.ts). From these,
 * {@link findRestartLine} picks the motion line the tool was on, and {@link buildResumeProgram} writes a program that
 * restores the modal state, retracts, moves over the restart point, starts the spindle, plunges and runs the rest.
 */

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Modal state before a line, as far as resuming needs it. */
export interface ModalState {
  units: 'G20' | 'G21';
  distance: 'G90' | 'G91';
  plane: 'G17' | 'G18' | 'G19';
  wcs: string;
  motion: 'G0' | 'G1' | 'G2' | 'G3' | null;
  feedMode: 'G93' | 'G94';
  /** In the program's units per minute. */
  feed: number | null;
  speed: number | null;
  spindle: 'M3' | 'M4' | 'M5';
  mist: boolean;
  flood: boolean;
  tool: number | null;
}

export interface GcodeLine {
  /** 0-based line index. */
  index: number;
  raw: string;
  /** Upper case, without comments. */
  code: string;
  /** Byte offset just after the line (UTF-8, newline included), comparable with FluidNC's `SD:` percent. */
  byteEnd: number;
  /** Modal state before this line. */
  before: ModalState;
  /** Work position before and after this line, in mm. NaN where unknown (after G53, G28, …). */
  start: Point3;
  end: Point3;
  /** A move in work coordinates (G0–G3 with axis words). */
  motion: boolean;
  /** Points along the move, in mm, for the distance to the last known position. Arcs are sampled. */
  path: Point3[];
}

export interface ParsedProgram {
  lines: GcodeLine[];
  totalBytes: number;
}

const kInitialState: ModalState = {
  units: 'G21',
  distance: 'G90',
  plane: 'G17',
  wcs: 'G54',
  motion: null,
  feedMode: 'G94',
  feed: null,
  speed: null,
  spindle: 'M5',
  mist: false,
  flood: false,
  tool: null,
};

const kWord = /([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g;

function stripComments(raw: string) {
  return raw
    .replace(/\(.*?\)|;.*$/g, '')
    .trim()
    .toUpperCase();
}

function words(code: string) {
  return [...code.matchAll(kWord)].map(m => ({ letter: m[1]!, value: Number(m[2]) }));
}

/** G codes of a line as normalised strings: `G0`, `G1`, `G38.2`, `G90`, … */
function gCodes(code: string) {
  return words(code)
    .filter(w => w.letter === 'G')
    .map(w => `G${w.value}`);
}

const kNoMotion = new Set(['G4', 'G10', 'G28', 'G28.1', 'G30', 'G30.1', 'G53', 'G92', 'G92.1', 'G38.2', 'G38.3', 'G38.4', 'G38.5']);

/** Points along an arc in the XY plane (G17), for the distance search. Other planes use the chord. */
function arcPoints(start: Point3, end: Point3, params: { i?: number; j?: number; r?: number }, clockwise: boolean): Point3[] {
  let cx: number;
  let cy: number;
  if (params.i !== undefined || params.j !== undefined) {
    cx = start.x + (params.i ?? 0);
    cy = start.y + (params.j ?? 0);
  } else if (params.r !== undefined) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const chord = Math.hypot(dx, dy);
    if (chord === 0) return [start, end];
    const h = Math.sqrt(Math.max(0, params.r * params.r - (chord / 2) ** 2));
    // The centre is left of the chord for CCW arcs with positive R (and right for CW); negative R picks the long way.
    const side = (clockwise ? -1 : 1) * (params.r < 0 ? -1 : 1);
    cx = (start.x + end.x) / 2 - (side * h * dy) / chord;
    cy = (start.y + end.y) / 2 + (side * h * dx) / chord;
  } else {
    return [start, end];
  }
  const radius = Math.hypot(start.x - cx, start.y - cy);
  const a0 = Math.atan2(start.y - cy, start.x - cx);
  let a1 = Math.atan2(end.y - cy, end.x - cx);
  if (clockwise) {
    while (a1 >= a0) a1 -= 2 * Math.PI;
  } else {
    while (a1 <= a0) a1 += 2 * Math.PI;
  }
  const steps = Math.max(4, Math.min(64, Math.ceil((Math.abs(a1 - a0) * radius) / 1)));
  const out: Point3[] = [];
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const a = a0 + (a1 - a0) * t;
    out.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a), z: start.z + (end.z - start.z) * t });
  }
  return out;
}

/** Track modal state and the work position through a program. Positions are in mm. */
export function parseProgram(gcode: string): ParsedProgram {
  const encoder = new TextEncoder();
  const lines: GcodeLine[] = [];
  let state: ModalState = { ...kInitialState };
  let pos: Point3 = { x: 0, y: 0, z: 0 };
  let byte = 0;
  const rawLines = gcode.split('\n');
  rawLines.forEach((raw, index) => {
    byte += encoder.encode(raw).length + 1;
    const code = stripComments(raw.replace(/\r$/, ''));
    const before = { ...state };
    const start = { ...pos };
    const ws = words(code);
    const gs = gCodes(code);
    const next = { ...state };
    for (const g of gs) {
      if (g === 'G20' || g === 'G21') next.units = g;
      else if (g === 'G90' || g === 'G91') next.distance = g;
      else if (g === 'G17' || g === 'G18' || g === 'G19') next.plane = g;
      else if (/^G5[4-9]/.test(g)) next.wcs = g;
      else if (g === 'G93' || g === 'G94') next.feedMode = g;
      else if (g === 'G0' || g === 'G1' || g === 'G2' || g === 'G3') next.motion = g;
      else if (g === 'G80') next.motion = null;
    }
    const scale = next.units === 'G20' ? 25.4 : 1;
    const param: Record<string, number> = {};
    for (const w of ws) {
      if (w.letter === 'F') next.feed = w.value;
      else if (w.letter === 'S') next.speed = w.value;
      else if (w.letter === 'T') next.tool = w.value;
      else if (w.letter === 'M') {
        if (w.value === 3 || w.value === 4 || w.value === 5) next.spindle = `M${w.value}` as ModalState['spindle'];
        else if (w.value === 7) next.mist = true;
        else if (w.value === 8) next.flood = true;
        else if (w.value === 9) next.mist = next.flood = false;
        else if (w.value === 2 || w.value === 30) next.spindle = 'M5';
      } else param[w.letter] = w.value;
    }
    const hasAxis = 'X' in param || 'Y' in param || 'Z' in param;
    const nonModal = gs.find(g => kNoMotion.has(g));
    let motion = false;
    let path: Point3[] = [];
    if (nonModal === 'G28' || nonModal === 'G30') {
      // Goes to a stored machine position: the work position is no longer known.
      pos = { x: NaN, y: NaN, z: NaN };
    } else if (hasAxis && nonModal) {
      // G53 moves in machine coordinates, G92 changes the coordinates: the axes named are no longer known.
      if (nonModal === 'G53' || nonModal === 'G92') {
        for (const axis of ['X', 'Y', 'Z'] as const) if (axis in param) pos[axis.toLowerCase() as 'x' | 'y' | 'z'] = NaN;
      }
    } else if (hasAxis && next.motion) {
      const end = { ...pos };
      for (const axis of ['x', 'y', 'z'] as const) {
        const value = param[axis.toUpperCase()];
        if (value === undefined) continue;
        end[axis] = next.distance === 'G91' ? pos[axis] + value * scale : value * scale;
      }
      motion = true;
      if ((next.motion === 'G2' || next.motion === 'G3') && next.plane === 'G17') {
        const scaled = (v: number | undefined) => (v === undefined ? undefined : v * scale);
        path = arcPoints(pos, end, { i: scaled(param.I), j: scaled(param.J), r: scaled(param.R) }, next.motion === 'G2');
      } else {
        path = [pos, end];
      }
      pos = end;
    }
    state = next;
    lines.push({ index, raw, code, byteEnd: byte, before, start, end: { ...pos }, motion, path });
  });
  return { lines, totalBytes: byte };
}

function distanceToSegment(p: Point3, a: Point3, b: Point3) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / len2));
  return Math.hypot(p.x - (a.x + ab.x * t), p.y - (a.y + ab.y * t), p.z - (a.z + ab.z * t));
}

function distanceToPath(p: Point3, path: Point3[]) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, distanceToSegment(p, path[i - 1]!, path[i]!));
  return best;
}

const isKnown = (p: Point3) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/**
 * Motion lines looked at before the reported read position. FluidNC reads ahead of the tool by its planner buffer
 * (and splits arcs into several planner blocks), so the tool is at most a few dozen lines behind.
 */
const kSearchWindow = 400;
/** Moves this close (mm) to the best one count as equally close; the earliest wins, so nothing is skipped. */
const kTieTolerance = 0.05;

export interface RestartPoint {
  /** 0-based index of the line to restart at. */
  line: number;
  /** Distance (mm) of that move from the last known position. */
  distance: number;
}

/**
 * The motion line the tool was on: the move closest to the last work position, among the lines read before the
 * reported SD percent. Restarting at the start of that move re-cuts a little air rather than skipping material.
 */
export function findRestartLine(program: ParsedProgram, percent: number, lastWorkPos: Point3): RestartPoint | null {
  const byte = (percent / 100) * program.totalBytes;
  // FluidNC rounds the percent to two decimals. Too small a tolerance only restarts a little earlier.
  const tolerance = program.totalBytes * 0.00005 + 2;
  let lastRead = -1;
  for (const line of program.lines) {
    if (line.byteEnd > byte + tolerance) break;
    lastRead = line.index;
  }
  if (lastRead < 0) return null;
  let best: RestartPoint | null = null;
  let seen = 0;
  const candidates: RestartPoint[] = [];
  for (let i = lastRead; i >= 0 && seen < kSearchWindow; i--) {
    const line = program.lines[i]!;
    if (!line.motion) continue;
    seen++;
    if (!isKnown(line.start) || !isKnown(line.end)) continue;
    const distance = distanceToPath(lastWorkPos, line.path);
    candidates.push({ line: i, distance });
    if (!best || distance < best.distance) best = { line: i, distance };
  }
  if (!best) return null;
  // Earliest among the equally close (e.g. the same contour at the same depth, read twice).
  const limit = best.distance + kTieTolerance;
  return candidates.filter(c => c.distance <= limit).reduce((a, b) => (b.line < a.line ? b : a));
}

export interface ResumeOptions {
  /** 0-based line to restart at. */
  line: number;
  /** Machine Z to retract to before any XY move (`G53 G0 Z…`). */
  safeZMachine: number;
  /** Seconds to wait after starting the spindle. */
  spindleDwell?: number;
  /** Rapid down to this far (mm) above the restart point, then feed down. */
  plungeClearance?: number;
  name?: string;
}

export interface ResumeProgram {
  gcode: string;
  /** Lines before the original program's restart line, i.e. 1-based line numbers in the resume program are offset. */
  preambleLines: number;
  /** Where the tool goes down to, in work coordinates (mm). */
  start: Point3;
  warnings: string[];
}

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';

/** Why a restart at `line` may go wrong, from what the program does before it. */
export function resumeWarnings(program: ParsedProgram, line: number): string[] {
  const warnings: string[] = [];
  const target = program.lines[line];
  if (!target) return ['That line is past the end of the program.'];
  const before = program.lines.slice(0, line);
  if (target.before.distance === 'G91' || before.some(l => l.motion && l.before.distance === 'G91' && /G91/.test(l.code))) {
    warnings.push('The program moves in incremental mode (G91), so the restart position may be wrong.');
  }
  if (before.some(l => /\bG92\b/.test(l.code))) {
    warnings.push('The program sets a G92 offset, which is lost after a reset. Check the position before resuming.');
  }
  if (target.before.feedMode === 'G93') warnings.push('The program uses inverse time feed (G93), which camNC cannot resume safely.');
  const toolChanges = before.filter(l => /\bM0?6\b/.test(l.code));
  if (toolChanges.length) {
    const tool = target.before.tool;
    warnings.push(
      `The program changed tools before this point. Make sure ${tool !== null ? `T${tool}` : 'the right tool'} is in the spindle and Z is zeroed for it.`
    );
  }
  if (target.before.plane !== 'G17') warnings.push(`The program cuts in ${target.before.plane}; only the XY plane is checked.`);
  return warnings;
}

/** The plunge feed: the feed of the last Z-only G1 move down before the restart, or the feed at the restart. */
function plungeFeed(program: ParsedProgram, line: number): number | null {
  for (let i = line - 1; i >= 0; i--) {
    const l = program.lines[i]!;
    const after = program.lines[i + 1]!.before;
    if (!l.motion || after.motion !== 'G1') continue;
    if (l.end.z < l.start.z && l.end.x === l.start.x && l.end.y === l.start.y) return after.feed;
  }
  return program.lines[line]?.before.feed ?? null;
}

/**
 * The program that continues `program` at `options.line`:
 * modal state → retract (G53) → over the restart point → confirm (M0) → spindle → plunge → the rest.
 */
export function buildResumeProgram(program: ParsedProgram, options: ResumeOptions): ResumeProgram {
  const { line, safeZMachine, spindleDwell = 5, plungeClearance = 2 } = options;
  const target = program.lines[line];
  if (!target) throw new Error(`Line ${line + 1} is past the end of the program`);
  if (!target.motion) throw new Error(`Line ${line + 1} is not a move`);
  if (!isKnown(target.start)) throw new Error(`The position before line ${line + 1} is not known (after a G53/G28 move)`);
  const state = target.before;
  const start = target.start;
  const scale = state.units === 'G20' ? 25.4 : 1;
  const feedMm = state.feed !== null ? state.feed * scale : null;
  const plunge = plungeFeed(program, line);
  const plungeMm = plunge !== null ? plunge * scale : feedMm;

  const out: string[] = [];
  out.push(`(camNC resume${options.name ? ` of ${options.name.replace(/[()]/g, '')}` : ''} from line ${line + 1})`);
  out.push(`G21 G90 G17 G94 ${state.wcs}`);
  out.push(`G53 G0 Z${fmt(safeZMachine)}`);
  out.push(`G0 X${fmt(start.x)} Y${fmt(start.y)}`);
  out.push('(MSG,Resume: check the bit is clear and the right tool is in, then Resume)');
  out.push('M0');
  if (state.spindle !== 'M5') {
    out.push(`${state.spindle}${state.speed !== null ? ` S${fmt(state.speed)}` : ''}`);
    out.push(`G4 P${fmt(spindleDwell)}`);
  }
  if (state.mist) out.push('M7');
  if (state.flood) out.push('M8');
  out.push(`G0 Z${fmt(start.z + plungeClearance)}`);
  out.push(`G1 Z${fmt(start.z)}${plungeMm !== null ? ` F${fmt(plungeMm)}` : ''}`);
  // The program's own modes for the rest.
  out.push(
    [state.units, state.distance, state.plane, state.feedMode, state.feed !== null ? `F${fmt(state.feed)}` : ''].filter(Boolean).join(' ')
  );
  out.push('(camNC resume: original program continues)');
  const preambleLines = out.length;

  const first = program.lines[line]!;
  // A move that relies on the modal motion code (e.g. `X10 Y5` after G1) needs it spelled out now.
  const hasMotionCode = gCodes(first.code).some(g => ['G0', 'G1', 'G2', 'G3'].includes(g));
  out.push(hasMotionCode || !state.motion ? first.raw : `${state.motion} ${first.raw.trimStart()}`);
  for (const l of program.lines.slice(line + 1)) out.push(l.raw);
  let gcode = out.join('\n');
  // Keep the original's final newline (or lack of it).
  if (!gcode.endsWith('\n') && program.lines.at(-1)?.raw === '') gcode += '\n';

  return { gcode, preambleLines, start, warnings: resumeWarnings(program, line) };
}

/** Work-coordinate bounds of the moves in a program (mm), for the travel check. */
export function programBounds(program: ParsedProgram) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const l of program.lines) {
    if (!l.motion) continue;
    for (const p of l.path) {
      for (const axis of ['x', 'y', 'z'] as const) {
        if (!Number.isFinite(p[axis])) continue;
        min[axis] = Math.min(min[axis], p[axis]);
        max[axis] = Math.max(max[axis], p[axis]);
      }
    }
  }
  return { min, max };
}
