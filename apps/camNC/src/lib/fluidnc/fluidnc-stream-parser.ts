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
}

/** Utility: convert “num,num,num[,extra,…]” ➜ structured object */
function toPosition(block: string): Position {
  const nums = block.split(',').map(Number);
  return {
    x: nums[0],
    y: nums[1],
    z: nums[2],
    extra: nums.length > 3 ? nums.slice(3) : undefined,
  };
}

/**
 * Parse ONE line. Returns `null` if the line isn’t a status frame.
 */
export function parseFluidNCLine(line: string): ParsedStatus | null {
  if (!line.startsWith('<')) return null; // fast reject

  // 1. State and optional sub-state “Hold:0”
  const stateMatch = line.match(/^<([A-Za-z]+)(?::(\d+))?/);
  if (!stateMatch) return null;

  // 2. Grab the coordinate blocks – non-greedy until next '|' or '>'
  const mposMatch = line.match(/\|MPos:([^|>]+)/);
  const wposMatch = line.match(/\|WPos:([^|>]+)/);
  const wcoMatch = line.match(/\|WCO:([^|>]+)/);

  return {
    state: stateMatch[1],
    subState: stateMatch[2] ? Number(stateMatch[2]) : undefined,
    mpos: mposMatch ? toPosition(mposMatch[1]) : undefined,
    wpos: wposMatch ? toPosition(wposMatch[1]) : undefined,
    wco: wcoMatch ? toPosition(wcoMatch[1]) : undefined,
  };
}
