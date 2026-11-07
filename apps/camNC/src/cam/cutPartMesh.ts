import { unionPaths, type PartFeatures } from '@wbcnc/cam';
import { ShapeUtils, Vector2 } from 'three';

type Path = { x: number; y: number }[];
const signedArea = (path: Path) =>
  path.reduce((sum, p, i) => sum + p.x * path[(i + 1) % path.length]!.y - path[(i + 1) % path.length]!.x * p.y, 0) / 2;
function contains(path: Path, point: { x: number; y: number }) {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[i]!,
      b = path[j]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
/** Clipper's paths as outer loops with the holes inside each. */
function shapes(region: Path[]) {
  const outers = region.filter(path => signedArea(path) > 0).sort((a, b) => signedArea(a) - signedArea(b)),
    groups = outers.map(outer => ({ outer, holes: [] as Path[] }));
  for (const hole of region.filter(path => signedArea(path) < 0)) groups.find(group => contains(group.outer, hole[0]!))?.holes.push(hole);
  return groups;
}

/**
 * A watertight solid for a part with cuts, without the hidden faces stacked slabs would leave: one cap per height, the
 * bottom, and walls between heights. Each horizontal face is exactly a level, so `extractFeatures` reads it back.
 */
export function cutPartMesh(features: PartFeatures): { positions: Float64Array; indices: Uint32Array } {
  const positions: number[] = [];
  const triangle = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) =>
    positions.push(...a, ...b, ...c);
  const cap = (region: Path[], z: number, up: boolean) => {
    for (const { outer, holes } of shapes(region)) {
      const contour = outer.map(p => new Vector2(p.x, p.y)),
        rings = holes.map(hole => hole.map(p => new Vector2(p.x, p.y))),
        all = [...contour, ...rings.flat()];
      for (const [i, j, k] of ShapeUtils.triangulateShape(contour, rings)) {
        const a = all[i!]!,
          b = all[j!]!,
          c = all[k!]!,
          counterclockwise = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0,
          [p, q] = counterclockwise === up ? [b, c] : [c, b];
        triangle([a.x, a.y, z], [p.x, p.y, z], [q.x, q.y, z]);
      }
    }
  };
  const levels = [...features.levels].sort((a, b) => b.z - a.z);
  for (const level of levels) cap(level.region, level.z, true);
  cap(features.footprint, 0, false);
  const heights = [...levels.map(level => level.z), 0];
  levels.forEach((_, i) => {
    const high = heights[i]!,
      low = heights[i + 1]!;
    // The solid at this height is everything at least this high. Its paths run with the material on their left, so
    // each wall faces outward.
    for (const path of unionPaths(levels.slice(0, i + 1).flatMap(level => level.region))) {
      path.forEach((p, n) => {
        const q = path[(n + 1) % path.length]!;
        triangle([p.x, p.y, low], [q.x, q.y, low], [q.x, q.y, high]);
        triangle([p.x, p.y, low], [q.x, q.y, high], [p.x, p.y, high]);
      });
    }
  });
  return { positions: Float64Array.from(positions), indices: Uint32Array.from({ length: positions.length / 3 }, (_, i) => i) };
}
