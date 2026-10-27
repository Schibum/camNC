export const kBedColors = {
  fill: '#262b33',
  minor: '#323944',
  major: '#4a5462',
};

/** Coordinates of grid lines every `step` mm inside [min, max], at multiples of `step` so that they line up with machine coordinates. */
export function gridLines(min: number, max: number, step: number): number[] {
  const lines: number[] = [];
  for (let i = Math.ceil(min / step - 1e-9); i * step <= max + 1e-9; i++) lines.push(i * step);
  return lines;
}
