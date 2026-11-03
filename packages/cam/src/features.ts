import { areaD, type PathsD } from 'clipper2-ts';
import { cleanRegion, difference, intersect, offset, polyArea, triangle, triangleNormal2A, union, type Mesh, type PathD } from './geom';

/** Height of an up-facing horizontal face group and the area it covers (top view). */
export interface Level {
  z: number;
  region: PathsD;
  area: number;
}

export interface PocketFeature {
  floorZ: number;
  /** Area to clear down to floorZ. Includes deeper levels (they are cleared further afterwards) and is extended past
   * the outline where the pocket is open to the edge (by `extendOpen`, must exceed the tool radius), so the tool can
   * run off the part. */
  region: PathsD;
  /** Same, strictly inside the part (for reporting / coverage). */
  strictRegion: PathsD;
  /** Material above the floor (top view): an open pocket may be extended anywhere but into this. */
  above: PathsD;
  area: number;
}

export interface PartFeatures {
  thickness: number;
  /** Union of everything that has material (top view), with through holes as negative paths. */
  footprint: PathsD;
  /** Outer boundaries of the footprint (positive orientation). */
  outlines: PathsD;
  /** Through holes, as positive polygons. */
  throughHoles: PathsD;
  /** Distinct up-facing horizontal heights, top first. */
  levels: Level[];
  pockets: PocketFeature[];
  /** Down-facing horizontal faces strictly inside the stock: features that must be cut from the bottom. */
  bottomFaces: { z: number; area: number }[];
  /** Up-facing area that is neither horizontal nor vertical (not 2.5D machinable with a flat end mill). */
  slopedArea: number;
}

const HORIZONTAL = 1 - 1e-6;
const Z_TOL = 0.005;

function projectTriangle(mesh: Mesh, t: number): PathD {
  const [a, b, c] = triangle(mesh, t);
  const path = [
    { x: a[0], y: a[1] },
    { x: b[0], y: b[1] },
    { x: c[0], y: c[1] },
  ];
  return areaD(path) < 0 ? path.reverse() : path;
}

/**
 * The pocket extended `ext` past the outline where it is open to the edge (rabbets, edge grooves), so the bit runs out
 * into the waste outside the part instead of stopping at the edge. Use ext > bit radius.
 */
export function openPocketRegion(outlines: PathsD, pocket: Pick<PocketFeature, 'strictRegion'>, ext: number): PathsD {
  // Only past the outer outline: not into material above the floor, and not into through holes inside the part.
  const waste = difference(offset(outlines, ext), outlines);
  return cleanRegion(union(pocket.strictRegion, intersect(offset(pocket.strictRegion, ext), waste)), 0.01, 0.5);
}

/**
 * Derive 2.5D features from a flat-oriented mesh (Z up, stock bottom at Z=0).
 *
 * Instead of slicing at z-levels we project the up-facing faces: for a 2.5D prism every top-view point has exactly
 * one top face, so the union of up-facing horizontal triangles grouped by height is the exact height map. Slicing
 * would only add value for undercuts, which a 3-axis router can't make anyway.
 */
export function extractFeatures(mesh: Mesh, thickness: number, extendOpen = 2): PartFeatures {
  const byZ = new Map<number, PathsD>();
  const bottomByZ = new Map<number, number>();
  const all: PathsD = [];
  const sloped: PathsD = [];
  let slopedArea = 0;
  const quantize = (z: number) => +(Math.round(z / Z_TOL) * Z_TOL).toFixed(4);

  const nTri = mesh.indices.length / 3;
  for (let t = 0; t < nTri; t++) {
    const tri = triangle(mesh, t);
    const n2a = triangleNormal2A(...tri);
    const len = Math.hypot(...n2a);
    if (len < 1e-12) continue;
    const nz = n2a[2] / len;
    const z = quantize((tri[0][2] + tri[1][2] + tri[2][2]) / 3);
    if (nz > HORIZONTAL) {
      const p = projectTriangle(mesh, t);
      all.push(p);
      let list = byZ.get(z);
      if (!list) byZ.set(z, (list = []));
      list.push(p);
    } else if (nz < -HORIZONTAL) {
      if (z > Z_TOL && z < thickness - Z_TOL) bottomByZ.set(z, (bottomByZ.get(z) ?? 0) + len / 2);
    } else if (nz > 1e-4) {
      const p = projectTriangle(mesh, t);
      all.push(p);
      sloped.push(p);
      slopedArea += len / 2;
    }
  }

  const footprint = cleanRegion(union(all));
  const outlines = footprint.filter(p => areaD(p) > 0);
  const throughHoles = footprint.filter(p => areaD(p) < 0).map(p => [...p].reverse());

  const levels: Level[] = [...byZ.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([z, tris]) => {
      const region = cleanRegion(union(tris));
      return { z, region, area: polyArea(region) };
    })
    .filter(l => l.area > 0.5);

  const top = levels[0]?.z ?? thickness;
  const pockets: PocketFeature[] = [];
  const slopedRegion = sloped.length ? union(sloped) : [];
  for (const level of levels) {
    if (level.z >= top - Z_TOL || level.z <= Z_TOL) continue;
    const higher = union(
      levels.filter(l => l.z > level.z + Z_TOL).flatMap(l => l.region),
      slopedRegion
    );
    const strictRegion = cleanRegion(difference(footprint, higher), 0.01, 0.5);
    if (!strictRegion.length) continue;
    const pocket = { floorZ: level.z, strictRegion, above: higher, area: polyArea(strictRegion) };
    pockets.push({ ...pocket, region: openPocketRegion(outlines, pocket, extendOpen) });
  }

  return {
    thickness,
    footprint,
    outlines,
    throughHoles,
    levels,
    pockets,
    bottomFaces: [...bottomByZ.entries()].map(([z, area]) => ({ z, area })).sort((a, b) => b.z - a.z),
    slopedArea,
  };
}
