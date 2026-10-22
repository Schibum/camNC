/** Whether the gcode probes (G38.2-5) or sets a work offset (G10 L2/L20), i.e. likely zeroes Z itself. */
export function hasProbeOrZeroCommand(gcode: string) {
  return /\bG38\.[2-5]\b|\bG10\s*L20?\b/i.test(gcode.slice(0, 10_000));
}
