import { clipLines, offset, pathLength, union, type PathsD, type Vec3 } from './geom';
import type { PartCam } from './toolpaths';

/** Keep the complete cutter envelope of optional tangent leads out of neighboring finished geometry. */
export function tangentEntryClashes(cam: PartCam, neighbors: PathsD, toBoard: (point: Vec3) => Vec3, tolerance = 0.05): boolean {
  if (!neighbors.length) return false;
  const material = union(neighbors);
  return cam.operations.some(operation => {
    const keepout = offset(material, operation.tool.diameter / 2 + tolerance);
    return operation.passes.some(pass => {
      if (pass.entry !== 'tangent') return false;
      for (let i = 1; i < pass.pts.length; i++) {
        if (pass.roles && pass.roles[i] !== 'lead-in' && pass.roles[i] !== 'lead-out') continue;
        const a = toBoard(pass.pts[i - 1]),
          b = toBoard(pass.pts[i]);
        const line = [
          { x: a[0], y: a[1] },
          { x: b[0], y: b[1] },
        ];
        if (clipLines([line], keepout).some(path => pathLength(path, false) > 1e-7)) return true;
      }
      return false;
    });
  });
}
