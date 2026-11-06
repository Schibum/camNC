import { Vector3 } from 'three';
import { ParsedToolpath } from './gcodeParsing';

/** Colour of the already milled part of the toolpath, in the top and the 3D views. */
export const kJobDoneColor = '#22c55e';

const fileMaps = new WeakMap<ParsedToolpath, { lineEnds: Uint32Array; totalBytes: number }>();

/** Byte offset (in the uploaded file) where each source line ends, computed once per toolpath. */
function getFileMap(toolpath: ParsedToolpath) {
  let map = fileMaps.get(toolpath);
  if (!map) {
    const lines = toolpath.gcode.split('\n');
    const lineEnds = new Uint32Array(lines.length);
    const encoder = new TextEncoder();
    let offset = 0;
    // FluidNC reports progress in bytes, so multi-byte characters (comments in non-ASCII) count.
    lines.forEach((line, i) => {
      offset += encoder.encode(line).length + 1;
      lineEnds[i] = offset;
    });
    // No newline after the last line.
    map = { lineEnds, totalBytes: encoder.encode(toolpath.gcode).length };
    fileMaps.set(toolpath, map);
  }
  return map;
}

/** How many of the ascending `values` are at most `limit`. */
function countUpTo(values: ArrayLike<number>, limit: number) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]! <= limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Index into `toolpath.pathPoints` up to which the job has progressed, given FluidNC's `SD:` percentage
 * (which is the share of the file read so far, a few planner blocks ahead of the tool). Goes by the source line of
 * each point, since an arc's line makes many points and other lines none.
 */
export function progressPointIndex(toolpath: ParsedToolpath, percent: number): number {
  if (!toolpath.pathPoints.length) return 0;
  const { lineEnds, totalBytes } = getFileMap(toolpath);
  const byte = (percent / 100) * totalBytes;
  const linesRead = byte >= totalBytes ? lineEnds.length : countUpTo(lineEnds, byte);
  return linesRead === 0 ? 0 : countUpTo(toolpath.lines, linesRead);
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
