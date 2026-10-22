import colormap from 'colormap';
import { Color, SRGBColorSpace } from 'three';
import { ParsedToolpath } from './gcodeParsing';

const plasmamap = colormap({
  colormap: 'plasma',
  nshades: 100,
  format: 'rgba',
  alpha: 1,
}).map(c => new Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, SRGBColorSpace));

function getPlasmaColor(float: number) {
  const index = Math.floor(float * (plasmamap.length - 1));
  return plasmamap[Math.min(Math.max(index, 0), plasmamap.length - 1)];
}

export function getZHeightColors(toolpath: ParsedToolpath) {
  const boundingBox = toolpath.getBounds();
  // Avoid division by zero for toolpaths without Z changes (e.g. laser or pen plotter gcode).
  const zRange = boundingBox.max.z - boundingBox.min.z || 1;
  const colors = new Array(toolpath.pathPoints.length * 3);
  for (let i = 0; i < toolpath.pathPoints.length; i++) {
    const color = getPlasmaColor((toolpath.pathPoints[i].z - boundingBox.min.z) / zRange);

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return colors;
}
