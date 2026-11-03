import { Vector3 } from 'three';
import { ParsedToolpath } from './gcodeParsing';

/** Colour of the already milled part of the toolpath, in the top and the 3D views. */
export const kJobDoneColor = '#22c55e';

/** Lines that produce toolpath segments (motion words, not offset/dwell/probe/homing commands). */
const kMotion = /[XYZ]\s*-?[\d.]/i;
const kNoMotion = /\b(G10|G92|G28|G30|G4|G38\.\d|G53)\b/i;

/**
 * Byte offset (in the uploaded file) where each toolpath segment's G-code line ends. Approximate: assumes
 * one segment per motion line (arcs produce several points but come from one line).
 */
export function motionLineEnds(gcode: string): number[] {
  const ends: number[] = [];
  let offset = 0;
  let utf8Extra = 0;
  for (const line of gcode.split('\n')) {
    const code = line.replace(/\(.*?\)|;.*$/g, '');
    offset += line.length + 1;
    // FluidNC reports progress in bytes; account for multi-byte characters (comments in non-ASCII).
    for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) > 0x7f) utf8Extra++;
    if (kMotion.test(code) && !kNoMotion.test(code)) ends.push(offset + utf8Extra);
  }
  return ends;
}

/**
 * Index into `toolpath.pathPoints` up to which the job has progressed, given FluidNC's `SD:` percentage
 * (which is the share of the file read so far, a few planner blocks ahead of the tool).
 */
export function progressPointIndex(toolpath: ParsedToolpath, lineEnds: number[], percent: number): number {
  if (!lineEnds.length || !toolpath.pathPoints.length) return 0;
  const totalBytes = new TextEncoder().encode(toolpath.gcode).length;
  const byte = (percent / 100) * totalBytes;
  let done = 0;
  while (done < lineEnds.length && lineEnds[done]! <= byte) done++;
  const fraction = done / lineEnds.length;
  return Math.min(toolpath.pathPoints.length, Math.round(fraction * toolpath.pathPoints.length));
}

/** Where a running job splits the toolpath: the tool is at `point`, on the segment ending at `pathPoints[index]`. */
export interface ProgressSplit {
  index: number;
  point: Vector3;
}

/**
 * Snaps the job progress to the tool. `readIndex` (from `progressPointIndex`) runs ahead of the tool by the planner
 * buffer and is only approximate, so the segment nearest the tool position (in toolpath coordinates) is searched for
 * around it. Without a position, or when the tool is not near the path, falls back to `readIndex`.
 */
export function snapProgressToTool(
  points: Vector3[],
  readIndex: number,
  tool: Vector3 | null,
  { lookback = 2000, lookahead = 200, maxDistance = 3 } = {}
): ProgressSplit | null {
  if (points.length < 2 || readIndex < 1) return null;
  const fallback = () => {
    const index = Math.min(readIndex, points.length - 1);
    return { index, point: points[Math.min(readIndex, points.length) - 1]!.clone() };
  };
  if (!tool) return fallback();
  const ab = new Vector3();
  const ap = new Vector3();
  const closest = new Vector3();
  let best: ProgressSplit | null = null;
  let bestDistance = Infinity;
  const from = Math.max(1, readIndex - lookback);
  const to = Math.min(points.length - 1, readIndex + lookahead);
  for (let i = from; i <= to; i++) {
    const a = points[i - 1]!;
    ab.subVectors(points[i]!, a);
    const lengthSq = ab.lengthSq();
    const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ap.subVectors(tool, a).dot(ab) / lengthSq));
    closest.copy(a).addScaledVector(ab, t);
    const d = closest.distanceTo(tool);
    // A path that passes the same spot twice (e.g. a finishing pass): the occurrence nearest the read position wins.
    const tie = best && Math.abs(d - bestDistance) < 0.05;
    if (tie ? Math.abs(i - readIndex) < Math.abs(best!.index - readIndex) : d < bestDistance) {
      best = { index: i, point: closest.clone() };
      bestDistance = Math.min(d, bestDistance);
    }
  }
  return best && bestDistance <= maxDistance ? best : fallback();
}

/** The `length` mm of path just behind the tool, ending at the tool, for a short trail. */
export function trailBehind(points: Vector3[], split: ProgressSplit, length: number): Vector3[] {
  const trail = [split.point];
  let left = length;
  let prev = split.point;
  for (let i = split.index - 1; i >= 0 && left > 0; i--) {
    const p = points[i]!;
    const d = prev.distanceTo(p);
    if (d >= left) {
      trail.push(prev.clone().lerp(p, left / d));
      break;
    }
    trail.push(p);
    left -= d;
    prev = p;
  }
  return trail.reverse();
}
