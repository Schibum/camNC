import type { TurnedOver } from './flip';
import type { Vec3 } from './geom';
import type { Operation, Pass, PartCam } from './toolpaths';
import { releaseMetadata } from './releaseMetadata';

/** One tab to cut free in a guided tab removal program. */
export interface TabStop {
  /** 1-based, in program order. */
  index: number;
  /** Part name (from the board program's operation names). */
  part: string;
  /** Middle of the tab, on the bit's path (board coordinates). */
  at: { x: number; y: number };
  /** Where to hold the part while this tab is cut: on the part, well away from the bit. */
  hold: { x: number; y: number };
  /** Tab length along the cut (incl. the bit), mm. */
  length: number;
}

/**
 * The tabs left by a program (raised stretches of each outline's deepest pass), and a program that cuts them one by
 * one: before each tab the bit goes up, the spindle stops and it pauses (M0) so you can hold the part; on Resume the
 * spindle starts again and it cuts through the tab at the final depth and slower feed. The last tab of a part frees it,
 * so nothing flies off.
 *
 * `perPart`: no stop per tab. A part's tabs are cut in a row (at `fullFeed`, the last one, which frees it, at `feed`),
 * then the bit goes up, the spindle stops and the program pauses: "Take out <part>". The spindle starts again before
 * the next part; nothing moves while paused.
 */
export function tabRemovalProgram(
  cam: PartCam,
  opts: { feed: number; plungeFeed: number; turned?: TurnedOver; perPart?: boolean; fullFeed?: number }
): { cam: PartCam; tabs: TabStop[] } {
  const turned = opts.turned;
  const at = (p: { x: number; y: number }) => (turned ? { x: p.x, y: turned.h - p.y } : p);
  const tabs: TabStop[] = [];
  const operations: Operation[] = [];
  for (const op of cam.operations.filter(o => o.feature === 'outline')) {
    const deepest = Math.min(...op.passes.flatMap(p => p.pts.map(q => q[2])));
    const final = op.passes.filter(p => Math.abs(Math.min(...p.pts.map(q => q[2])) - deepest) < 1e-6).at(-1);
    if (!final) continue;
    const part = op.name.includes(': ') ? op.name.split(': ')[0] : op.name;
    const xs = final.pts.map(q => q[0]),
      ys = final.pts.map(q => q[1]);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    const runs = raisedRuns(final.pts, deepest);
    const passes: Pass[] = [];
    for (const run of runs) {
      const mid = run[Math.floor(run.length / 2)];
      const length = run.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - run[i][0], q[1] - run[i][1]), 0);
      const index = tabs.length + 1;
      tabs.push({ index, part, at: at({ x: mid[0], y: mid[1] }), hold: at(holdPoint(box, mid)), length });
      // Turned over after side B, the tab hangs from the new top: cut from there through it, as far past it as the
      // deepest pass went below the bottom; mirrored and reversed, so the bit cuts the same way as before.
      const top = Math.max(...run.map(q => q[2]));
      const pts: Vec3[] = turned
        ? [...run].reverse().map(q => [q[0], turned.h - q[1], cam.stockTop - top + deepest])
        : run.map(q => [q[0], q[1], deepest]);
      const last = passes.length === runs.length - 1;
      const feed = opts.perPart && !last ? (opts.fullFeed ?? opts.feed) : opts.feed;
      const pass: Pass = {
        pts,
        feeds: pts.map((_, k) => (k === 0 ? opts.plungeFeed : feed)),
        roles: pts.map((_, k) => (k === 0 ? 'approach' : 'finish')),
        phase: 'finish',
        link: 'retract',
      };
      passes.push(pass);
      if (opts.perPart) continue;
      operations.push({
        name: `${part}: Tab ${index}`,
        kind: 'profile',
        feature: 'outline',
        tool: op.tool,
        passes: [pass],
        part,
      });
    }
    if (opts.perPart && passes.length)
      operations.push({
        name: `${part}: Tabs`,
        kind: 'profile',
        feature: 'outline',
        tool: op.tool,
        passes,
        pauseAfter: `Take out ${part}, then continue`,
        part,
      });
  }
  const released: PartCam = { ...cam, ...releaseMetadata(cam, turned), holding: undefined, operations, warnings: [] };
  if (opts.perPart) return { cam: released, tabs };
  tabs.forEach(
    t => (operations[t.index - 1].pauseBefore = `Tab ${t.index} of ${tabs.length}: spindle off until Resume. Hold away from bit: ${t.part}`)
  );
  return { cam: released, tabs };
}

/** Stretches of a closed pass that are lifted above its deepest Z (the tabs), with their end points. */
function raisedRuns(pts: Vec3[], deepest: number): Vec3[][] {
  const low = (q: Vec3) => q[2] <= deepest + 1e-6;
  const closed = pts.length > 2 && Math.hypot(pts[0][0] - pts.at(-1)![0], pts[0][1] - pts.at(-1)![1]) < 1e-7;
  if (closed) {
    const loop = pts.slice(0, -1),
      start = loop.findIndex(low);
    if (start >= 0) pts = [...loop.slice(start), ...loop.slice(0, start), loop[start]];
  }
  const runs: Vec3[][] = [];
  let cur: Vec3[] | null = null;
  for (let i = 1; i < pts.length; i++) {
    const q = pts[i];
    if (!low(q)) {
      // Starts at the vertical step up (same XY as the low point before).
      cur ??= [pts[i - 1]];
      cur.push(q);
    } else if (cur) {
      cur.push(q);
      // Drop the vertical steps: keep XY-distinct points.
      runs.push(cur.filter((p, k) => k === 0 || Math.hypot(p[0] - cur![k - 1][0], p[1] - cur![k - 1][1]) > 1e-6));
      cur = null;
    }
  }
  return runs.filter(r => r.length >= 2);
}

/** Middle of the part, or if that's close to the tab, the far side of it. */
function holdPoint(box: { x0: number; y0: number; x1: number; y1: number }, tab: Vec3) {
  const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  if (Math.hypot(c.x - tab[0], c.y - tab[1]) >= 40) return c;
  const fx = tab[0] < c.x ? box.x1 : box.x0,
    fy = tab[1] < c.y ? box.y1 : box.y0;
  return { x: c.x + (fx - c.x) * 0.6, y: c.y + (fy - c.y) * 0.6 };
}
