import { pointInPolygonD, PointInPolygonResult } from 'clipper2-ts';
import { camBoard, partToBoard, type BoardPart, type BoardSpec } from './board';
import { holdState } from './hold';
import { camPart, DEFAULT_TABS, type CamSettings, type Operation, type PartCam, type TabSettings } from './toolpaths';

type P2 = { x: number; y: number };

/**
 * A part whose tabs can't reach stock that holds: a bottom skin (the outline stops above the board's bottom; freed at
 * the machine), tabs where they would go anyway (they may not hold), or none (you hold it down: tape, clamps).
 */
export type TabFallback = 'skin' | 'tabs' | 'self';

/** How a part on a board is held: tabs placed where they hold, or its fallback. */
export interface PartHolding {
  /** Board part id. */
  id: string;
  name: string;
  how: 'placed' | TabFallback;
  /** Tab spots facing stock that holds (before picking). */
  spots: number;
  /** Placed tabs, board coordinates. */
  tabs: P2[];
}

export const kDefaultSkin = 1;

/**
 * Where each part's tabs go: only on straight runs of its outline (no notch, curve or corner: room for the tab and the
 * bit) whose far side is stock that holds (wide enough all the way to the board's edge, see the hold check), spread
 * along the part. A part with fewer than `minTabs` such spots gets its fallback.
 */
export function planTabs(
  board: BoardSpec,
  settings: Partial<CamSettings>,
  opts: { minWeb?: number; minTabs?: number } = {}
): Map<string, PartHolding> {
  const tabs: TabSettings = { ...DEFAULT_TABS, ...board.tabs };
  const minTabs = opts.minTabs ?? 2;
  const stockTop = board.stockTop ?? board.thickness;
  // Every outline cut through, no tabs: what stock is left to hold on to.
  const open = camBoard({ ...board, holdDown: 'fixture-tape', rotationDeg: 0, dowels: undefined }, settings);
  const { held } = holdState(open, board, opts);
  const out = new Map<string, PartHolding>();
  for (const part of board.parts) {
    const cam = camPart(part.features, { ...settings, tabs: false, stockTop });
    const outline = cam.operations.find(o => o.feature === 'outline');
    const final = outline?.passes.at(-1);
    const fallback = part.tabFallback ?? board.tabFallback ?? 'skin';
    if (!outline || !final) {
      out.set(part.id, { id: part.id, name: part.name, how: fallback, spots: 0, tabs: [] });
      continue;
    }
    const r = outline.tool.diameter / 2;
    const loop = final.pts.map(q => partToBoard(part, q)).map(q => ({ x: q[0], y: q[1] }));
    const shape = part.features.outlines.map(l => l.map(q => partToBoard(part, [q.x, q.y, 0])).map(q => ({ x: q[0], y: q[1] })));
    const insidePart = (p: P2) => shape.some(l => pointInPolygonD(p, l) === PointInPolygonResult.IsInside);
    // Not where the pass starts and ends: a tab across that seam would be cut in two.
    const room = tabs.width + outline.tool.diameter;
    const seam = loop[0];
    const spots = candidates(loop, room).filter(
      c => Math.hypot(c.at.x - seam.x, c.at.y - seam.y) > room && held(farSide(c, r, insidePart))
    );
    const perimeter = loop.reduce((s, p, i) => s + (i ? Math.hypot(p.x - loop[i - 1].x, p.y - loop[i - 1].y) : 0), 0);
    const want = Math.max(tabs.minCount, Math.round(perimeter / tabs.spacing));
    const picked = spread(
      spots.map(s => s.at),
      want,
      tabs.width + outline.tool.diameter
    );
    out.set(
      part.id,
      picked.length >= minTabs
        ? { id: part.id, name: part.name, how: 'placed', spots: spots.length, tabs: picked }
        : { id: part.id, name: part.name, how: fallback, spots: spots.length, tabs: [] }
    );
  }
  return out;
}

/** The point just past the cut on the side away from the part. */
function farSide(c: { at: P2; dir: P2 }, r: number, insidePart: (p: P2) => boolean): P2 {
  const l = Math.hypot(c.dir.x, c.dir.y) || 1;
  let n = { x: -c.dir.y / l, y: c.dir.x / l };
  if (insidePart({ x: c.at.x + n.x * (r + 0.1), y: c.at.y + n.y * (r + 0.1) })) n = { x: -n.x, y: -n.y };
  return { x: c.at.x + n.x * (r + 0.6), y: c.at.y + n.y * (r + 0.6) };
}

/**
 * Tab spots on a closed path: every 3 mm along its straight runs (segments within 2° of the run's first), at least `room`/2
 * + 1 mm from a run's ends, so the tab and the bit's turn stay off notches, curves and corners.
 */
export function candidates(loop: P2[], room: number): { at: P2; dir: P2 }[] {
  const segs: { a: P2; b: P2; len: number; ang: number }[] = [];
  for (let i = 1; i < loop.length; i++) {
    const [a, b] = [loop[i - 1], loop[i]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 1e-6) segs.push({ a, b, len, ang: Math.atan2(b.y - a.y, b.x - a.x) });
  }
  const runs: (typeof segs)[] = [];
  for (const s of segs) {
    const run = runs.at(-1);
    // Against the run's first segment, not the previous one: a finely tessellated curve turns little per step.
    const first = run?.[0];
    const turn = first ? Math.abs(Math.atan2(Math.sin(s.ang - first.ang), Math.cos(s.ang - first.ang))) : Infinity;
    if (run && turn < (2 * Math.PI) / 180) run.push(s);
    else runs.push([s]);
  }
  const out: { at: P2; dir: P2 }[] = [];
  for (const run of runs) {
    const length = run.reduce((t, s) => t + s.len, 0);
    // The tab and the bit's width beside it, plus 1 mm, all on the straight.
    const margin = room / 2 + 1;
    if (length < 2 * margin) continue;
    const a = run[0].a,
      b = run.at(-1)!.b;
    const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    for (let d = margin; d <= length - margin + 1e-6; d += 3) out.push({ at: { x: a.x + dir.x * d, y: a.y + dir.y * d }, dir });
  }
  return out;
}

/** Up to `n` of the points, far apart (each the farthest from those picked so far), at least `min` apart. */
export function spread(points: P2[], n: number, min: number): P2[] {
  if (!points.length) return [];
  const d = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.y - b.y);
  // Start at one end of the part: the point farthest from the points' middle.
  const mid = { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
  const picked = [points.reduce((a, b) => (d(b, mid) > d(a, mid) ? b : a))];
  while (picked.length < n) {
    let best: P2 | undefined,
      bd = -1;
    for (const p of points) {
      const near = Math.min(...picked.map(q => d(p, q)));
      if (near > bd) {
        bd = near;
        best = p;
      }
    }
    if (!best || bd < min) break;
    picked.push(best);
  }
  return picked;
}

/** Board coordinates -> the part's own (inverse of partToBoard). */
export function boardToPart(p: Pick<BoardPart, 'x' | 'y' | 'rotated' | 'size'>, q: P2): P2 {
  return p.rotated ? { x: q.y - p.y, y: p.x + p.size[1] - q.x } : { x: q.x - p.x, y: q.y - p.y };
}

/**
 * After cutting a board with bottom-skin parts: frees them one at a time. For each, the bit cuts the skin along the
 * outline at the final depth (and once more, light), goes up, stops the spindle and pauses: "Take out <part>". The
 * spindle starts again before the next part; nothing moves while paused.
 */
export function freePartsProgram(
  cam: PartCam,
  opts: { feed: number; plungeFeed: number; finalZ: number }
): { cam: PartCam; parts: { name: string; at: P2 }[] } {
  const ops: Operation[] = [];
  const parts: { name: string; at: P2 }[] = [];
  for (const op of cam.operations) {
    if (op.feature !== 'outline') continue;
    const final = op.passes.at(-1);
    if (!final || Math.min(...final.pts.map(q => q[2])) <= opts.finalZ + 1e-6) continue;
    const name = op.name.replace(/: [^:]*$/, '');
    const pts = final.pts.map(q => [q[0], q[1], opts.finalZ] as [number, number, number]);
    const feeds = pts.map((_, k) => (k === 0 ? opts.plungeFeed : opts.feed));
    ops.push({
      name: `${name}: Free from the skin`,
      kind: 'profile',
      feature: 'outline',
      tool: op.tool,
      passes: [
        { pts, feeds, link: 'retract' },
        // A light second lap at the same depth: clean through where the first left a whisker.
        { pts, feeds: pts.map(() => opts.feed), link: 'direct' },
      ],
      pauseAfter: `Take out ${name}, then continue`,
    });
    const xs = pts.map(q => q[0]),
      ys = pts.map(q => q[1]);
    parts.push({ name, at: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 } });
  }
  return { cam: { ...cam, operations: ops, warnings: [] }, parts };
}
