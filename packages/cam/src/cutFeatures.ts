import { areaD, type PathsD } from 'clipper2-ts';
import { cleanRegion, difference, intersect, polyArea, union, type PathD } from './geom';
import { openPocketRegion, type Level, type PartFeatures, type PocketFeature } from './features';

export interface FlatCut {
  id: string;
  /** mm below the top: where the cut starts and its floor. */
  from: number;
  to: number;
  through: boolean;
  outline: PathD;
  /** Regions nested in the outline, left uncut. */
  islands: PathD[];
}
export interface FlatProfile {
  thickness: number;
  /** Counterclockwise. */
  outline: PathD;
  /** Counterclockwise, as cut through the part. */
  holes: PathD[];
  cuts: FlatCut[];
}

const Z_TOL = 0.005;
const reversed = (paths: PathsD) => paths.map(path => [...path].reverse());

/** What each through hole comes from: its index in `holes`, or the cut that made it. */
export type HoleSource = { hole: number } | { cut: string };

/**
 * A profile's 2.5D features, built from its polygons so exact curves reach CAM without going through a mesh. Cuts apply
 * in order to a height map. A cut only removes what's under its start, so a cut on a pocket floor can't undercut the
 * material beside that pocket.
 */
export function featuresFromCuts(
  { thickness, outline, holes, cuts }: FlatProfile,
  extendOpen = 2
): { features: PartFeatures; holeSources: HoleSource[] } {
  let footprint: PathsD = [outline, ...reversed(holes)];
  const heights = new Map<number, PathsD>([[thickness, footprint]]);
  const quantize = (z: number) => +(Math.round(z / Z_TOL) * Z_TOL).toFixed(4);
  const holeCuts: { id: string; region: PathsD }[] = [];
  for (const cut of cuts) {
    const floor = cut.through ? 0 : quantize(thickness - cut.to),
      start = quantize(thickness - cut.from);
    let shape = intersect(difference([cut.outline], cut.islands), footprint);
    if (cut.from > 0) {
      const open = [...heights].filter(([z]) => z <= start + Z_TOL).flatMap(([, region]) => region);
      shape = intersect(shape, union(open, []));
    }
    if (polyArea(shape) <= 0) continue;
    const removed: PathsD = [];
    for (const [z, region] of heights) {
      if (z <= floor + Z_TOL) continue;
      removed.push(...intersect(region, shape));
      heights.set(z, difference(region, shape));
    }
    if (cut.through) {
      footprint = difference(footprint, shape);
      holeCuts.push({ id: cut.id, region: shape });
    } else heights.set(floor, union(heights.get(floor) ?? [], removed));
  }

  const outlines = holeCuts.length ? footprint.filter(path => areaD(path) > 0) : [outline];
  let throughHoles = holes,
    holeSources: HoleSource[] = holes.map((_, hole) => ({ hole }));
  if (holeCuts.length) {
    // Holes a cut didn't touch keep their place and their exact points, because saved hole choices refer to them.
    const left = footprint.filter(path => areaD(path) < 0).map(path => [...path].reverse()),
      same = (a: PathD, b: PathD) => Math.abs(polyArea([a]) - polyArea([b])) < 1e-3 && polyArea(intersect([a], [b])) > polyArea([a]) - 1e-3,
      kept = holes.flatMap((path, hole) => (left.some(other => same(path, other)) ? [{ path, source: { hole } as HoleSource }] : [])),
      added = left
        .filter(path => !holes.some(other => same(other, path)))
        .map(path => ({
          path,
          source: { cut: holeCuts.find(({ region }) => polyArea(intersect([path], region)) > 0)?.id ?? holeCuts[0]!.id } as HoleSource,
        }));
    throughHoles = [...kept, ...added].map(entry => entry.path);
    holeSources = [...kept, ...added].map(entry => entry.source);
  }

  const levels: Level[] = [...heights]
    .sort((a, b) => b[0] - a[0])
    .map(([z, region]) => {
      const cleaned = cleanRegion(region);
      return { z, region: cleaned, area: polyArea(cleaned) };
    })
    .filter(level => level.area > 0.5);
  const top = levels[0]?.z ?? thickness;
  const pockets: PocketFeature[] = [];
  for (const level of levels) {
    if (level.z >= top - Z_TOL || level.z <= Z_TOL) continue;
    const above = union(
      levels.filter(other => other.z > level.z + Z_TOL).flatMap(other => other.region),
      []
    );
    const strictRegion = difference(cleanRegion(difference(footprint, above), 0.01, 0.5), above);
    if (!strictRegion.length) continue;
    const pocket = { floorZ: level.z, strictRegion, above, area: polyArea(strictRegion) };
    pockets.push({ ...pocket, region: openPocketRegion(outlines, pocket, extendOpen) });
  }
  return {
    features: { thickness, footprint, outlines, throughHoles, levels, pockets, bottomFaces: [], slopedArea: 0 },
    holeSources,
  };
}
