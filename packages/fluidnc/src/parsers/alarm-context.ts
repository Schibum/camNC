/** A move that a soft limit stopped: the axis, its target in machine coordinates, and the limits when reported. */
export interface SoftLimitViolation {
  axis: string;
  target: number;
  /** Only FluidNC 4.x reports the limits. */
  min?: number;
  max?: number;
}

/**
 * Parse the `[MSG:…]` text FluidNC logs right before `ALARM:2` (text as returned by `parseMessageLine`):
 * - 3.9.x: `INFO: Soft limit on X target:2.990`
 * - 4.x: `INFO: Soft limit exceeded on X axis: target 2.990 mm, limit [3, 1223] mm`
 */
export function parseSoftLimitMessage(message: string): SoftLimitViolation | null {
  const v4 = message.match(/Soft limit exceeded on ([A-Z]) axis: target (-?[\d.]+) mm, limit \[(-?[\d.]+), (-?[\d.]+)\]/i);
  if (v4) return { axis: v4[1]!.toUpperCase(), target: Number(v4[2]), min: Number(v4[3]), max: Number(v4[4]) };
  const v3 = message.match(/Soft limit on ([A-Z]) target:\s*(-?[\d.]+)/i);
  if (v3) return { axis: v3[1]!.toUpperCase(), target: Number(v3[2]) };
  return null;
}
