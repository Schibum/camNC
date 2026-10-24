export interface Position {
  x: number;
  y: number;
  z: number;
  /** Any extra axes (A, B …) – present only if the device reports them */
  extra?: number[];
}

export interface ParsedStatus {
  /** Top-level machine state: Run, Idle, Hold … */
  state: string;
  /** Optional sub-state number (e.g. Hold:0 ➜ 0) */
  subState?: number;
  /** Machine coordinates */
  mpos?: Position;
  /** Work-coordinate position (WPos) – if the controller chooses to report it */
  wpos?: Position;
  /** Work-coordinate offset (WCO) */
  wco?: Position;
  /** Current feed rate and spindle speed (FS) */
  feed?: number;
  spindle?: number;
  /** Overrides in percent (Ov) – only reported every few frames */
  overrides?: Overrides;
  /** Active input pins (Pn), e.g. "PXZ". Absent means no pin is active. */
  pins?: string;
  /** Progress of a file running from SD or local FS (SD) */
  job?: JobProgress;
}

export interface Overrides {
  feed: number;
  rapid: number;
  spindle: number;
}

export interface JobProgress {
  /** Percentage of the file that has been read, 0-100 */
  percent: number;
  /** Path of the running file, e.g. `/sd/camnc.gcode` */
  file: string;
}

export const kOffsetCodes = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G28', 'G30', 'G92'] as const;
export type OffsetCode = (typeof kOffsetCodes)[number];

export interface ParsedOffset {
  /** The offset code, e.g. G54, G55, G28, … */
  code: OffsetCode;
  /** Position value for workspace/home offsets (G54…G92, G28, G30). */
  position: Position;
}

export interface ParsedModals {
  /** Raw modal words, e.g. ["G0", "G54", "G17", …] */
  words: string[];
  /** Current tool number if present (Tn) */
  tool?: number;
  /** Current spindle speed if present (Sn or Sn.n) */
  spindleSpeed?: number;
  /** Current feed rate if present (Fn or Fn.n) */
  feedRate?: number;
}

/** Utility: convert "num,num,num[,extra,…]" ➜ structured object */
function toPosition(block: string): Position {
  const nums = block.split(',').map(Number);
  return {
    x: nums[0]!,
    y: nums[1]!,
    z: nums[2]!,
    extra: nums.length > 3 ? nums.slice(3) : undefined,
  };
}

/**
 * Parse ONE line. Returns `null` if the line isn't a status frame.
 */
export function parseFluidNCLine(line: string): ParsedStatus | null {
  if (!line.startsWith('<')) return null; // fast reject

  // 1. State and optional sub-state "Hold:0"
  const stateMatch = line.match(/^<([A-Za-z]+)(?::(\d+))?/);
  if (!stateMatch) return null;

  // 2. Grab the coordinate blocks – non-greedy until next '|' or '>'
  const mposMatch = line.match(/\|MPos:([^|>]+)/);
  const wposMatch = line.match(/\|WPos:([^|>]+)/);
  const wcoMatch = line.match(/\|WCO:([^|>]+)/);
  const fsMatch = line.match(/\|FS:([^|>]+)/);
  const ovMatch = line.match(/\|Ov:([^|>]+)/);
  const pnMatch = line.match(/\|Pn:([^|>]*)/);
  // The file name may contain commas, so only split at the first one.
  const sdMatch = line.match(/\|SD:([\d.]+),([^|>]*)/);

  const status: ParsedStatus = {
    state: stateMatch[1]!,
    subState: stateMatch[2] ? Number(stateMatch[2]) : undefined,
    mpos: mposMatch ? toPosition(mposMatch[1]!) : undefined,
    wpos: wposMatch ? toPosition(wposMatch[1]!) : undefined,
    wco: wcoMatch ? toPosition(wcoMatch[1]!) : undefined,
  };
  if (fsMatch) {
    const [feed, spindle] = fsMatch[1]!.split(',').map(Number);
    status.feed = feed;
    status.spindle = spindle;
  }
  if (ovMatch) {
    const [feed = 100, rapid = 100, spindle = 100] = ovMatch[1]!.split(',').map(Number);
    status.overrides = { feed, rapid, spindle };
  }
  if (pnMatch) status.pins = pnMatch[1];
  if (sdMatch) status.job = { percent: Number(sdMatch[1]), file: sdMatch[2]! };
  return status;
}

/**
 * Parse ONE offset line returned by the `$#` command.
 *
 * Examples of FluidNC output lines:
 *   [G54:351.331,148.328,-9.265]
 *   [G55:0.000,0.000,0.000]
 *   [TLO:0.000]
 *
 * Returns `null` for any line that doesn't match the expected pattern.
 */
export function parseFluidNCOffsetLine(line: string): ParsedOffset | null {
  // Fast reject: must start with '[' and end with ']'
  if (!line.startsWith('[') || !line.endsWith(']')) return null;

  // Extract the code (e.g. G54) and the value block between ':' and ']'
  const match = line.match(/^\[([A-Z0-9]+):([^\]]+)]$/);
  if (!match) return null;

  const code = match[1];
  const valueBlock = match[2]!;
  // Split by comma – will yield one number for TLO, three (or more) for positions
  const nums = valueBlock.split(',').map(Number);

  // Ignore single-value offsets (currently only TLO) and non-numeric blocks (e.g. `[PRB:1,2,3:1]`)
  if (nums.length < 3 || nums.some(Number.isNaN)) {
    return null;
  }

  // Handle position-like offsets (three axes plus optional extra)
  return {
    code,
    position: toPosition(valueBlock),
  } as ParsedOffset;
}

/**
 * Parse ONE modal line returned by the `$G` command (FluidNC/Grbl style).
 *
 * Example lines:
 *   [GC:G0 G54 G17 G21 G90 G94 M0 M5 M9 T0 S0.0 F500.0]
 *   [GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]
 *
 * Returns `null` if the line doesn't match the expected pattern.
 */
export function parseFluidNCModalLine(line: string): ParsedModals | null {
  if (!line.startsWith('[GC:') || !line.endsWith(']')) return null;

  const contents = line.slice(4, -1); // Remove "[GC:" prefix and trailing "]"
  const words = contents.trim().split(/\s+/);

  const parsed: ParsedModals = { words };

  // Extract known numeric modals (tool, spindle speed, feed rate)
  for (const w of words) {
    if (w.startsWith('T')) {
      const num = Number(w.slice(1));
      if (!Number.isNaN(num)) parsed.tool = num;
    } else if (w.startsWith('S')) {
      const num = Number(w.slice(1));
      if (!Number.isNaN(num)) parsed.spindleSpeed = num;
    } else if (w.startsWith('F')) {
      const num = Number(w.slice(1));
      if (!Number.isNaN(num)) parsed.feedRate = num;
    }
  }

  return parsed;
}

/** A `[PRB:x,y,z:1]` probe result. */
export interface ProbeResult {
  position: Position;
  success: boolean;
}

export function parseProbeLine(line: string): ProbeResult | null {
  const match = line.match(/^\[PRB:([^:\]]+):(\d)\]$/);
  if (!match) return null;
  return { position: toPosition(match[1]!), success: match[2] === '1' };
}

/** `[MSG:...]` lines, returns the message text. */
export function parseMessageLine(line: string): string | null {
  const match = line.match(/^\[MSG:(.*)\]$/);
  return match ? match[1]!.trim() : null;
}

export function parseAlarmLine(line: string): number | null {
  const match = line.match(/^ALARM:(\d+)/);
  return match ? Number(match[1]) : null;
}

export function parseErrorLine(line: string): number | null {
  const match = line.match(/^error:(\d+)/);
  return match ? Number(match[1]) : null;
}

/** The welcome banner printed after a (soft) reset, e.g. `Grbl 3.9 [FluidNC v3.9.9 (wifi) '$' for help]`. */
export function isResetBanner(line: string): boolean {
  return /^Grbl \S+ \[FluidNC/.test(line);
}

export interface BuildInfo {
  /** e.g. `3.9.9` or `4.1.1` */
  version: string;
  major: number;
  /** Raw `[VER:…]` line content */
  raw: string;
}

/** Parse the `[VER:3.9 FluidNC v3.9.9 (wifi) :]` line of `$I`. */
export function parseBuildInfo(lines: string[]): BuildInfo | null {
  for (const line of lines) {
    const match = line.match(/^\[VER:(.*)\]$/);
    if (!match) continue;
    const version = match[1]!.match(/FluidNC v(\d+\.\d+\.\d+[\w.-]*)/)?.[1];
    if (!version) continue;
    return { version, major: Number(version.split('.')[0]), raw: match[1]! };
  }
  return null;
}
