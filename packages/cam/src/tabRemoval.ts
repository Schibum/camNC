import type { Vec3 } from './geom';
import type { Operation, Pass, PartCam } from './toolpaths';

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
 * one: before each tab it stops (M0) so you can hold the part, then cuts through the tab at the final depth and
 * slower feed. The last tab of a part frees it, so nothing flies off.
 */
export function tabRemovalProgram(cam: PartCam, opts: { feed: number; plungeFeed: number }): { cam: PartCam; tabs: TabStop[] } {
  const tabs: TabStop[] = [];
  const operations: Operation[] = [];
  for (const op of cam.operations.filter(o => o.feature === 'outline')) {
    const deepest = Math.min(...op.passes.flatMap(p => p.pts.map(q => q[2])));
    const final = op.passes.find(p => Math.min(...p.pts.map(q => q[2])) === deepest);
    if (!final) continue;
    const part = op.name.includes(': ') ? op.name.split(': ')[0] : op.name;
    const xs = final.pts.map(q => q[0]),
      ys = final.pts.map(q => q[1]);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    for (const run of raisedRuns(final.pts, deepest)) {
      const mid = run[Math.floor(run.length / 2)];
      const length = run.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - run[i][0], q[1] - run[i][1]), 0);
      const index = tabs.length + 1;
      tabs.push({ index, part, at: { x: mid[0], y: mid[1] }, hold: holdPoint(box, mid), length });
      const pts: Vec3[] = run.map(q => [q[0], q[1], deepest]);
      const pass: Pass = { pts, feeds: pts.map((_, k) => (k === 0 ? opts.plungeFeed : opts.feed)), link: 'retract' };
      operations.push({
        name: `${part}: Tab ${index}`,
        kind: 'profile',
        feature: 'outline',
        tool: op.tool,
        passes: [pass],
        pauseBefore: `Tab ${index}: hold ${part} at the marked spot, away from the bit, then resume`,
      });
    }
  }
  tabs.forEach(
    t =>
      (operations[t.index - 1].pauseBefore =
        `Tab ${t.index} of ${tabs.length}: hold ${t.part} at the marked spot, away from the bit, then resume`)
  );
  return { cam: { stockTop: cam.stockTop, operations, warnings: [] }, tabs };
}

/** Stretches of a closed pass that are lifted above its deepest Z (the tabs), with their end points. */
function raisedRuns(pts: Vec3[], deepest: number): Vec3[][] {
  const low = (q: Vec3) => q[2] <= deepest + 1e-6;
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
