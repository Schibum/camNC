/** Why a job is paused and what Resume will do, from the uploaded G-code and FluidNC's SD progress. */
export interface PauseHint {
  /** E.g. "The program paused (M0): Turn ON 30000RPM". */
  reason: string;
  /** What to do before resuming, from what comes next in the program. */
  next: string | null;
  /** 1-based line of the pausing command. */
  line: number;
}

const kPause = /\b(M0?0|M0?1|M60|M0?6)\b/i;
/** How far (bytes) the reported progress may be from the end of the pausing line. FluidNC reads M0 as a sync point. */
const kMaxDistance = 2048;
/** Lines after the pause that are looked at for what comes next. */
const kLookAhead = 12;

interface Line {
  code: string;
  comment: string;
  /** Byte offset just after the line (UTF-8, newline included). */
  end: number;
}

function splitLines(gcode: string): Line[] {
  const encoder = new TextEncoder();
  const out: Line[] = [];
  let offset = 0;
  for (const raw of gcode.split('\n')) {
    offset += encoder.encode(raw).length + 1;
    const comments = [...raw.matchAll(/\(([^)]*)\)|;(.*)$/g)].map(m => (m[1] ?? m[2] ?? '').trim()).filter(Boolean);
    out.push({ code: raw.replace(/\(.*?\)|;.*$/g, '').trim(), comment: comments.join(' '), end: offset });
  }
  return out;
}

/** `(MSG Turn ON 30000RPM)` and `(MSG,Turn …)` are messages to the operator. */
function operatorMessage(comment: string) {
  const match = comment.match(/^MSG[,\s]+(.*)$/i);
  return match ? match[1]!.trim() : null;
}

function toolDescription(gcode: string, tool: number) {
  // Fusion's tools table: (  T3 D=6 CR=0 - ZMIN=-9.5 - flat end mill )
  const match = gcode.match(new RegExp(`\\(\\s*T${tool}\\s+D=([\\d.]+)([^)]*)\\)`, 'i'));
  // The description is the last " - " field.
  const description = match?.[2]!.split(' - ').pop()!.trim();
  return match ? `${match[1]} mm${description ? ` ${description}` : ''}` : null;
}

function describeNext(lines: Line[], from: number, gcode: string): string | null {
  for (const line of lines.slice(from, from + kLookAhead)) {
    const code = line.code.toUpperCase();
    if (/\bG38\.[2-5]\b/.test(code)) {
      return 'Next it probes Z (G38). Attach the probe clip and put the plate under the bit, then Resume.';
    }
    const tool = code.match(/\bT(\d+)\b/);
    if (tool && /\bM0?6\b/.test(code)) {
      const description = toolDescription(gcode, Number(tool[1]));
      return `Tool change to T${tool[1]}${description ? ` (${description})` : ''}: change the bit, then Resume. Re-zero Z if the program does not probe.`;
    }
    if (/\bM0?[34]\b/.test(code)) {
      return 'Next it starts the spindle. Make sure the spindle and dust collection are ready, then Resume.';
    }
    if (/\b(G0?[0-3])\b|[XYZ]-?[\d.]/.test(code)) return 'Resume continues with the next move.';
  }
  return null;
}

/**
 * Find the command the job paused at, given FluidNC's `SD:` percent (share of the file read), and explain it.
 * Returns `null` when no pausing command is near that position, e.g. after a feed hold.
 */
export function pauseHint(gcode: string, percent: number): PauseHint | null {
  const lines = splitLines(gcode);
  const total = lines.at(-1)?.end ?? 0;
  if (!total) return null;
  const byte = (percent / 100) * total;
  // The percent is rounded to two decimals; allow for that on large files.
  const tolerance = Math.max(kMaxDistance, total * 0.0001);
  let best = -1;
  for (let i = 0; i < lines.length && lines[i]!.end <= byte + tolerance; i++) {
    if (kPause.test(lines[i]!.code)) best = i;
  }
  if (best < 0 || byte - lines[best]!.end > tolerance) return null;
  const line = lines[best]!;
  const command = line.code
    .match(kPause)![1]!
    .toUpperCase()
    .replace(/^M0(\d)$/, 'M$1');
  const message = operatorMessage(line.comment) ?? (line.comment || null);
  const kind = command === 'M6' ? 'tool change (M6)' : command === 'M1' ? 'optional stop (M1)' : `program pause (${command})`;
  const reason = `The job stopped at a ${kind} on line ${best + 1}${message ? `: “${message}”` : ''}.`;
  const next = command === 'M6' ? describeNext([line], 0, gcode) : describeNext(lines, best + 1, gcode);
  return { reason, next, line: best + 1 };
}
