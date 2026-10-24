export interface Vec {
  x: number;
  y: number;
  z: number;
}

/** One straight piece of travel, in machine coordinates. */
export interface Segment {
  to: Vec;
  /** mm/min, `null` for a rapid move. */
  feed: number | null;
  /** Length in mm. */
  length: number;
}

const kAxes = ['x', 'y', 'z'] as const;
const kMaxChord = 1.5;

export function distance(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function parseWords(line: string) {
  const words: Record<string, number> = {};
  for (const match of line.toUpperCase().matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)) words[match[1]!] = Number(match[2]);
  return words;
}

export function stripComments(line: string) {
  return line
    .replace(/\([^)]*\)/g, '')
    .replace(/;.*$/, '')
    .trim();
}

/**
 * Turns G-code lines into straight segments. Understands the subset that CAM output and camNC's
 * macros use: G0/G1/G2/G3 (I/J or R arcs in the XY plane), G53, G90/G91, modal feed. Everything
 * else (spindle, coolant, tool changes, dwell, ...) does not move the machine and is ignored.
 */
export class MotionInterpreter {
  relative = false;
  feed = 1000;
  private mode = 0;

  /**
   * @param pos Current position in machine coordinates.
   * @param wco Work coordinate offset, so that machine = work + wco.
   */
  constructor(
    public pos: Vec,
    private readonly wco: Vec
  ) {}

  /** Segments for one line. Returns an empty array for lines that do not move. */
  line(text: string): Segment[] {
    const line = stripComments(text).toUpperCase();
    if (!line) return [];
    const words = parseWords(line);
    for (const match of line.matchAll(/G(\d+(?:\.\d+)?)/g)) {
      const code = Number(match[1]);
      if (code === 90) this.relative = false;
      else if (code === 91) this.relative = true;
      else if (code >= 0 && code <= 3) this.mode = code;
    }
    if (words.F !== undefined) this.feed = words.F;
    const machine = /G53(?!\d)/.test(line);
    const hasAxis = kAxes.some(axis => words[axis.toUpperCase()] !== undefined);
    if (!hasAxis || /G(?:10|28|30|38|92)/.test(line)) return [];

    const target = { ...this.pos };
    for (const axis of kAxes) {
      const value = words[axis.toUpperCase()];
      if (value === undefined) continue;
      if (machine) target[axis] = value;
      else target[axis] = this.relative ? this.pos[axis] + value : value + this.wco[axis];
    }
    const feed = this.mode === 0 ? null : this.feed;
    const segments = this.mode >= 2 ? this.arc(target, words, this.mode === 2, feed) : [this.segment(target, feed)];
    this.pos = target;
    return segments;
  }

  private segment(to: Vec, feed: number | null): Segment {
    return { to, feed, length: distance(this.pos, to) };
  }

  private arc(target: Vec, words: Record<string, number>, clockwise: boolean, feed: number | null): Segment[] {
    const start = this.pos;
    let cx: number;
    let cy: number;
    if (words.I !== undefined || words.J !== undefined) {
      cx = start.x + (words.I ?? 0);
      cy = start.y + (words.J ?? 0);
    } else if (words.R !== undefined) {
      const dx = target.x - start.x;
      const dy = target.y - start.y;
      const chord = Math.hypot(dx, dy);
      const h = Math.sqrt(Math.max(0, words.R * words.R - (chord * chord) / 4));
      const sign = clockwise === words.R > 0 ? -1 : 1;
      cx = start.x + dx / 2 + (sign * h * -dy) / (chord || 1);
      cy = start.y + dy / 2 + (sign * h * dx) / (chord || 1);
    } else {
      return [this.segment(target, feed)];
    }
    const radius = Math.hypot(start.x - cx, start.y - cy);
    const a0 = Math.atan2(start.y - cy, start.x - cx);
    let sweep = Math.atan2(target.y - cy, target.x - cx) - a0;
    if (clockwise && sweep >= 0) sweep -= Math.PI * 2;
    if (!clockwise && sweep <= 0) sweep += Math.PI * 2;
    if (Math.abs(sweep) < 1e-9) sweep = clockwise ? -Math.PI * 2 : Math.PI * 2;
    const steps = Math.max(1, Math.ceil((Math.abs(sweep) * radius) / kMaxChord));
    const segments: Segment[] = [];
    let previous = start;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const angle = a0 + sweep * t;
      const to =
        i === steps
          ? target
          : { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), z: start.z + (target.z - start.z) * t };
      segments.push({ to, feed, length: distance(previous, to) });
      previous = to;
    }
    return segments;
  }
}

/** All segments of a file, starting at `start`. */
export function compileGcode(text: string, start: Vec, wco: Vec): Segment[] {
  const interpreter = new MotionInterpreter(start, wco);
  return text.split(/\r?\n/).flatMap(line => interpreter.line(line));
}
