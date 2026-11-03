import { areaD, type PathD, type PathsD } from 'clipper2-ts';
import type { PartFeatures } from './features';
import { difference, offset, polyArea, union } from './geom';
import { kMaxSlopedShare, type FlatPart } from './import';

export interface FeatureChip {
  kind: 'pockets' | 'groove' | 'holes' | 'curved-edge' | 'outline-only';
  /** Depth from the top in mm (pockets, grooves). */
  depth?: number;
  count?: number;
  label: string;
}

export interface PartSummary {
  chips: FeatureChip[];
  /** Features on the bottom face: the board must be flipped for a second setup. */
  needsFlip: boolean;
  /** Depths (from the bottom face) of the bottom-side features. */
  bottomDepths: number[];
  /** More than 5% of the top area is sloped or 3D-curved: not a 2.5D board (3D-printed or carved parts). */
  notFlat: boolean;
  prismaticRatio: number;
  /** Sloped share of the top area (see FlatPart.slopedShare). */
  slopedShare: number;
  slopedArea: number;
  /** Largest bit radius that still reaches every inside corner (~0: sharp corners, any bit rounds them); null if
   * there are no inside corners tighter than 10 mm. */
  smallestInsideRadius: number | null;
}

const round = (v: number, d = 1) => +v.toFixed(d);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Split polygons with holes into components (outer + its holes). */
function components(paths: PathsD): PathsD[] {
  const outers = paths.filter(p => areaD(p) > 0);
  return outers.map(o => [o, ...paths.filter(h => areaD(h) < 0 && polyArea(difference([[...h].reverse()], [o])) < 1e-6)]);
}

/**
 * At least `minLength` mm of short segments that keep turning slightly is a curve (arc or spline), not a polygon
 * corner; small corner fillets stay below it.
 */
function hasCurvedEdge(loop: PathD, minLength = 15) {
  let run = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[(i + n - 1) % n],
      b = loop[i],
      c = loop[(i + 1) % n];
    const t1 = Math.atan2(b.y - a.y, b.x - a.x),
      t2 = Math.atan2(c.y - b.y, c.x - b.x);
    const turn = Math.abs(Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1)));
    const len = Math.hypot(c.x - b.x, c.y - b.y);
    // Long segments are straight edges, even when they meet a fillet tangentially.
    run = turn > 0.001 && turn < 0.35 && len < 5 ? run + len : 0;
    if (run >= minLength) return true;
  }
  return false;
}

/** Area a bit of radius r can't reach: inside corners of pockets and of the outline (from outside). */
function unreachable(f: PartFeatures, r: number) {
  let a = 0;
  for (const p of f.pockets) a += polyArea(difference(p.region, offset(offset(p.region, -r), r)));
  if (f.outlines.length) a += polyArea(difference(offset(offset(f.outlines, r), -r), f.outlines));
  for (const h of f.throughHoles) a += polyArea(difference([h], offset(offset([h], -r), r)));
  return a;
}

/** Binary search for the largest radius that leaves (almost) nothing behind in inside corners. */
function smallestInsideRadius(f: PartFeatures, maxR = 10, tol = 0.05): number | null {
  if (unreachable(f, maxR) < tol) return null;
  let lo = 0,
    hi = maxR;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (unreachable(f, mid) < tol) lo = mid;
    else hi = mid;
  }
  return round(lo, 2);
}

/** What the Model screen shows per part: feature chips, flip / not-flat flags, the tightest inside corner. */
export function summarizePart(part: FlatPart, f: PartFeatures): PartSummary {
  const chips: FeatureChip[] = [];
  const t = part.thickness;
  const solid = union(f.outlines);
  // Each level's own area: what is not cleared further by a deeper level.
  f.pockets.forEach((p, i) => {
    const deeper = f.pockets[i + 1]?.strictRegion ?? [];
    const own = deeper.length ? difference(p.strictRegion, deeper) : p.strictRegion;
    let pockets = 0,
      grooves = 0;
    for (const c of components(own)) {
      if (polyArea(c) < 1) continue;
      // Open to the outline (a rabbet or a through groove)?
      const touchesEdge = polyArea(difference(offset(c, 0.05), solid)) > 0.01;
      if (touchesEdge) grooves++;
      else pockets++;
    }
    const depth = round(t - p.floorZ);
    if (pockets) chips.push({ kind: 'pockets', depth, count: pockets, label: `${plural(pockets, 'pocket')} ${depth} deep` });
    if (grooves)
      chips.push({
        kind: 'groove',
        depth,
        count: grooves,
        label: `${grooves > 1 ? `${grooves} ` : ''}edge groove${grooves > 1 ? 's' : ''} ${depth} deep`,
      });
  });
  if (f.throughHoles.length)
    chips.push({ kind: 'holes', count: f.throughHoles.length, label: plural(f.throughHoles.length, 'through hole') });
  if (f.outlines.some(o => hasCurvedEdge(o))) chips.push({ kind: 'curved-edge', label: 'curved edge' });
  if (!f.pockets.length && !f.throughHoles.length) chips.push({ kind: 'outline-only', label: 'outline only' });

  return {
    chips,
    needsFlip: f.bottomFaces.length > 0,
    bottomDepths: f.bottomFaces.map(b => round(b.z)),
    notFlat: part.slopedShare > kMaxSlopedShare,
    prismaticRatio: part.prismaticRatio,
    slopedShare: part.slopedShare,
    slopedArea: f.slopedArea,
    smallestInsideRadius: smallestInsideRadius(f),
  };
}
