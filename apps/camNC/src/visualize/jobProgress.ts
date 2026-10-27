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
