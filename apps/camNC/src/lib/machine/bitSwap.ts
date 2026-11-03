import { operatorMessage, splitLines, type Line } from './pauseHints';

/** A bit as the program names it. */
export interface Bit {
  /** Tool number (`T2`). */
  tool: number;
  /** Diameter in mm, from the pause message or the tools table. */
  diameter?: number;
  /** From the tools table, e.g. "flat end mill". */
  description?: string;
}

/** A pause where the program asks for another bit. */
export interface BitSwap {
  /** The bit in the router before the pause, if the program tells. */
  from?: Bit;
  /** The bit to put in. */
  to: Bit;
  /** Spindle speed the message asks for. */
  rpm?: number;
}

/** `M0`/`M1` pauses (not `M00x`-style lookalikes). */
const kPause = /\bM0?[01]\b/i;
/** `Change to T2 D=6, …` or `Swap to T2 …`. Not `Insert T1 …`: that is the first bit, before anything was cut. */
const kChange = /\b(?:change|swap)\b[^()]*?\bT(\d+)\b(?:\s+D\s*=\s*([\d.]+))?/i;
/** Tools table entry: `T3 D=6 CR=0 - ZMIN=-9.5 - flat end mill` (Fusion and camNC). */
const kToolEntry = /^T(\d+)\s+D\s*=\s*([\d.]+)(.*)$/i;
/** camNC's operation marker: `OP 2/3 Pocket - T1 D=3.175`. */
const kOpMarker = /^OP\b.*\bT(\d+)(?:\s+D\s*=\s*([\d.]+))?/i;

/** The tools table, in program order. */
export function toolsTable(lines: Line[]): Bit[] {
  const tools: Bit[] = [];
  for (const line of lines) {
    if (line.code) continue;
    const match = line.comment.match(kToolEntry);
    if (!match || tools.some(t => t.tool === Number(match[1]))) continue;
    // The description is the last " - " field, unless that is ZMIN or the like.
    const last = match[3]!.split(' - ').slice(1).pop()?.trim();
    tools.push({ tool: Number(match[1]), diameter: Number(match[2]), ...(last && !/=/.test(last) ? { description: last } : {}) });
  }
  return tools;
}

function bit(tool: number, diameter: string | undefined, table: Bit[]): Bit {
  const entry = table.find(t => t.tool === tool);
  return {
    ...entry,
    tool,
    ...(diameter ? { diameter: Number(diameter) } : {}),
  };
}

/** The tool in use before `index`: the last operation marker, `T` word or bit message before it. */
function toolBefore(lines: Line[], index: number, table: Bit[]): Bit | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const { code, comment } = lines[i]!;
    const marker = comment.match(kOpMarker);
    if (marker) return bit(Number(marker[1]), marker[2], table);
    const word = code.match(/\bT(\d+)\b/i);
    if (word) return bit(Number(word[1]), undefined, table);
    const message = operatorMessage(comment);
    const named = message?.match(/\b(?:change|swap|insert)\b[^()]*?\bT(\d+)\b(?:\s+D\s*=\s*([\d.]+))?/i);
    if (named) return bit(Number(named[1]), named[2], table);
  }
  return undefined;
}

/**
 * Whether the pause on `line` (1-based, see `pauseHint`) asks for another bit, and which bits: camNC board programs
 * pause with `M0 (MSG Spindle OFF. Change to T2 D=6, re-zero Z, spindle ON 15000RPM)`.
 * Returns `null` for other pauses, e.g. `M0 (MSG Turn ON spindle 15000RPM)`.
 */
export function bitSwapAt(gcode: string, line: number): BitSwap | null {
  const lines = splitLines(gcode);
  const pause = lines[line - 1];
  if (!pause || !kPause.test(pause.code)) return null;
  const message = operatorMessage(pause.comment) ?? pause.comment;
  const change = message.match(kChange);
  if (!change) return null;
  const table = toolsTable(lines);
  const to = bit(Number(change[1]), change[2], table);
  // Without markers, the tool listed before it in the table (tables list tools in the order they are used).
  const position = table.findIndex(t => t.tool === to.tool);
  const from = toolBefore(lines, line - 1, table) ?? (position > 0 ? table[position - 1] : undefined);
  const rpm = message.match(/(\d+)\s*RPM\b/i);
  return {
    ...(from && from.tool !== to.tool ? { from } : {}),
    to,
    ...(rpm ? { rpm: Number(rpm[1]) } : {}),
  };
}

/** Short kind of a bit: "flat end mill" → "flat", "chamfer mill" → "chamfer". */
function kind(b: Bit) {
  return b.description?.replace(/\s*(end\s*)?mill$/i, '').trim() || undefined;
}

/** "6 mm flat", or "T2" when the diameter is unknown. With `withKind: false` just "6 mm". */
export function bitName(b: Bit, withKind = true) {
  const size = b.diameter !== undefined ? `${b.diameter} mm` : `T${b.tool}`;
  const k = withKind ? kind(b) : undefined;
  return k ? `${size} ${k}` : size;
}

/** "6 mm flat end mill", "6 mm bit" or "T2 bit". */
export function bitLongName(b: Bit) {
  const size = b.diameter !== undefined ? `${b.diameter} mm` : `T${b.tool}`;
  return `${size} ${b.description ?? 'bit'}`;
}

/** camNC programs say `(Z0 = stock bottom, …)`: then Z is zeroed on the spoilboard. */
export function zZeroIsStockBottom(gcode: string) {
  return /\(\s*Z0\s*=\s*stock bottom\b/i.test(gcode);
}

/** "Swap bit: 3.175 mm → 6 mm flat". The old bit's kind is only named when it differs. */
export function bitSwapTitle({ from, to }: BitSwap) {
  if (!from) return `Swap bit: put in the ${bitName(to)}`;
  return `Swap bit: ${bitName(from, kind(from) !== kind(to))} → ${bitName(to)}`;
}
