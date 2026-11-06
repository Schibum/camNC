import type { Tool } from './toolpaths';

/** Cutting data and editable labels do not identify the mounted cutter. */
export function toolIdentityKey(tool: Tool): string {
  return JSON.stringify([
    tool.guid ?? null,
    tool.number,
    tool.diameter,
    tool.fluteLength ?? null,
    tool.flutes ?? null,
    tool.stickout ?? null,
  ]);
}

export const samePhysicalTool = (a: Tool, b: Tool): boolean => toolIdentityKey(a) === toolIdentityKey(b);

/** One program has one mounted cutter and one spindle speed. */
export function toolProgramKey(tool: Tool, fallbackRpm?: number): string {
  return JSON.stringify([toolIdentityKey(tool), tool.rpm ?? fallbackRpm ?? null]);
}
