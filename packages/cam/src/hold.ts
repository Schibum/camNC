import { EndType, inflatePathsD, JoinType, pointInPolygonD, PointInPolygonResult, type PathsD } from 'clipper2-ts';
import { difference, offset, polyArea, PRECISION, union } from './geom';
import type { PartCam } from './toolpaths';

type P2 = { x: number; y: number };

export interface TabHold {
  /** Middle of the tab, on the bit's path. */
  at: P2;
  /** The stock on its far side is wide enough and reaches the board's edge: the tab holds the part. */
  anchored: boolean;
}

export interface PartHold {
  part: string;
  tabs: TabHold[];
  anchored: number;
  /** Enough anchored tabs to hold the part once its outline is cut through. */
  ok: boolean;
}

export interface HoldOptions {
  /** Narrowest stock strip, mm, that still holds a tab (after both cuts beside it). Default 3. */
  minWeb?: number;
  /** Anchored tabs a part needs. Default 2. */
  minTabs?: number;
  /** Extra places that hold the board besides its edge (e.g. clamp zones). */
  anchors?: PathsD;
}

const through = (z: number) => z <= 1e-3;

/** Inside a region given as loops (outer loops + holes), by crossing parity. */
function inside(p: P2, region: PathsD) {
  let n = 0;
  for (const loop of region) if (pointInPolygonD(p, loop) === PointInPolygonResult.IsInside) n++;
  return n % 2 === 1;
}

/** Split a region into its pieces: each outer loop with the holes inside it. */
function pieces(region: PathsD): PathsD[] {
  const outers = region.filter(l => polyArea([l]) > 0);
  const holes = region.filter(l => polyArea([l]) < 0);
  const out = outers.map(o => [o]);
  for (const h of holes) out.find(c => pointInPolygonD(h[0], c[0]) !== PointInPolygonResult.IsOutside)?.push(h);
  return out;
}

/**
 * Do the tabs hold? After every through cut (the outline final passes and through holes, at their full width), the
 * board's remaining stock outside the parts is what a tab can hold on to. A tab counts when the stock on its far side
 * is at least `minWeb` wide all the way to the board's edge (or an anchor): a tab into the 1 mm sliver left between
 * two neighbouring cuts holds nothing.
 */
export function holdCheck(cam: PartCam, board: { w: number; h: number }, opts: HoldOptions = {}): PartHold[] {
  const minWeb = opts.minWeb ?? 3;
  const minTabs = opts.minTabs ?? 2;
  const cuts: PathsD = [];
  // The tabs' own material: left out when judging the stock beyond them (it would widen a thin strip).
  const bridges: PathsD = [];
  const parts: { part: string; interior: PathsD; tabs: { at: P2; dir: P2 }[]; r: number }[] = [];
  for (const op of cam.operations) {
    if (op.kind !== 'profile') continue;
    const r = op.tool.diameter / 2;
    for (const pass of op.passes) {
      if (!pass.pts.some(q => through(q[2]))) continue;
      // The cut-through stretches, at the bit's width; the raised ones in between are tabs.
      const lines: PathsD = [];
      const tabs: { at: P2; dir: P2 }[] = [];
      const tabLines: PathsD = [];
      let run: P2[] = [];
      let tab: P2[] = [];
      const flush = () => {
        if (run.length > 1) lines.push(run);
        run = [];
      };
      for (let i = 1; i < pass.pts.length; i++) {
        const [a, b] = [pass.pts[i - 1], pass.pts[i]];
        if (through(a[2]) && through(b[2])) {
          if (tab.length > 1) {
            const mid = tab[Math.floor(tab.length / 2)];
            const [p, q] = [tab[0], tab[tab.length - 1]];
            tabs.push({
              at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
              dir: { x: q.x - p.x || mid.x - p.x, y: q.y - p.y || mid.y - p.y },
            });
            tabLines.push(tab);
          }
          tab = [];
          if (!run.length) run.push({ x: a[0], y: a[1] });
          run.push({ x: b[0], y: b[1] });
        } else {
          flush();
          if (!through(a[2]) && !through(b[2])) {
            if (!tab.length) tab.push({ x: a[0], y: a[1] });
            tab.push({ x: b[0], y: b[1] });
          }
        }
      }
      flush();
      cuts.push(...inflatePathsD(lines, r, JoinType.Round, EndType.Round, 2, PRECISION));
      bridges.push(...inflatePathsD(tabLines, r, JoinType.Round, EndType.Butt, 2, PRECISION));
      if (op.feature === 'outline') {
        const loop = pass.pts.map(q => ({ x: q[0], y: q[1] }));
        parts.push({ part: op.name.replace(/: [^:]*$/, ''), interior: offset(union([loop]), -r), tabs, r });
      }
    }
  }
  const rect = [
    [
      { x: 0, y: 0 },
      { x: board.w, y: 0 },
      { x: board.w, y: board.h },
      { x: 0, y: board.h },
    ],
  ];
  const waste = difference(rect, union(cuts, [...parts.flatMap(p => p.interior), ...bridges]));
  // Strips narrower than minWeb hold nothing: drop them, keep the rest's shape.
  const sturdy = offset(offset(waste, -minWeb / 2), minWeb / 2);
  const edge = difference(rect, offset(rect, -0.5));
  const anchored = pieces(sturdy).filter(
    piece =>
      polyArea(union(difference(piece, difference(piece, edge)), [])) > 1e-6 ||
      (opts.anchors && polyArea(difference(piece, difference(piece, opts.anchors))) > 1e-6)
  );
  const held = (p: P2) => anchored.some(piece => inside(p, piece));

  return parts.map(({ part, interior, tabs, r }) => {
    const checked = tabs.map(({ at, dir }) => {
      const l = Math.hypot(dir.x, dir.y) || 1;
      let n = { x: -dir.y / l, y: dir.x / l };
      // The normal away from the part.
      if (inside({ x: at.x + n.x * (r + 0.1), y: at.y + n.y * (r + 0.1) }, interior)) n = { x: -n.x, y: -n.y };
      return { at, anchored: held({ x: at.x + n.x * (r + 0.6), y: at.y + n.y * (r + 0.6) }) };
    });
    const count = checked.filter(t => t.anchored).length;
    return { part, tabs: checked, anchored: count, ok: count >= Math.min(minTabs, Math.max(1, tabs.length)) && tabs.length > 0 };
  });
}
