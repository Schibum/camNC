import colormap from 'colormap';
import { Color, SRGBColorSpace } from 'three';
import { ParsedToolpath } from './gcodeParsing';

const plasmamap = colormap({
  colormap: 'plasma',
  nshades: 100,
  format: 'rgba',
  alpha: 1,
}).map(c => new Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, SRGBColorSpace));

// The darkest end of plasma is near black and disappears on dark camera images and backgrounds; start a bit in.
const kPlasmaStart = 0.15;

/** Depth color for `float` in [0, 1] (deepest to highest). */
export function getPlasmaColor(float: number) {
  const t = kPlasmaStart + Math.min(Math.max(float, 0), 1) * (1 - kPlasmaStart);
  const index = Math.floor(t * (plasmamap.length - 1));
  return plasmamap[Math.min(Math.max(index, 0), plasmamap.length - 1)];
}

/** Plasma colors per path point (rgb triples), spread over the Z range `[minZ, maxZ]` (the toolpath bounds by default). */
export function getZHeightColors(toolpath: ParsedToolpath, range?: { min: number; max: number }) {
  const boundingBox = toolpath.getBounds();
  const minZ = range?.min ?? boundingBox.min.z;
  const maxZ = range?.max ?? boundingBox.max.z;
  // Avoid division by zero for toolpaths without Z changes (e.g. laser or pen plotter gcode).
  const zRange = maxZ - minZ || 1;
  const colors = new Array(toolpath.pathPoints.length * 3);
  for (let i = 0; i < toolpath.pathPoints.length; i++) {
    const color = getPlasmaColor((toolpath.pathPoints[i].z - minZ) / zRange);

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return colors;
}
