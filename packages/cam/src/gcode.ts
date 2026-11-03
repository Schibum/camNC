import type { Vec3 } from './geom';
import type { PartCam, Tool } from './toolpaths';

type P2 = { x: number; y: number };
export type Prim = { type: 'line'; to: P2 } | { type: 'arc'; to: P2; c: P2; cw: boolean };

function circleThrough(a: P2, b: P2, c: P2): { c: P2; r: number } | undefined {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return undefined;
  const a2 = a.x * a.x + a.y * a.y,
    b2 = b.x * b.x + b.y * b.y,
    c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { c: { x, y }, r: Math.hypot(a.x - x, a.y - y) };
}

/**
 * Greedy arc fitting: replace runs of >= 4 points that lie on one circle (vertices within tol, chords at most
 * maxSagitta from the arc) by a G2/G3 arc. Tessellated circles from the STEP mesh and Clipper round joins both come back as arcs.
 */
export function fitArcs(p: P2[], tol = 0.01, maxSagitta = 0.05, maxRadius = 1000): Prim[] {
  const out: Prim[] = [];
  const n = p.length;
  let i = 0;
  const check = (i: number, j: number) => {
    const circ = circleThrough(p[i], p[(i + j) >> 1], p[j]);
    if (!circ || circ.r > maxRadius) return undefined;
    let sweep = 0,
      sign = 0;
    for (let k = i + 1; k <= j; k++) {
      const a = p[k - 1],
        b = p[k];
      if (Math.abs(Math.hypot(b.x - circ.c.x, b.y - circ.c.y) - circ.r) > tol) return undefined;
      // Arc vs. original chord deviation (sagitta).
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (circ.r - Math.hypot(m.x - circ.c.x, m.y - circ.c.y) > maxSagitta) return undefined;
      const ang = Math.atan2(
        (a.x - circ.c.x) * (b.y - circ.c.y) - (a.y - circ.c.y) * (b.x - circ.c.x),
        (a.x - circ.c.x) * (b.x - circ.c.x) + (a.y - circ.c.y) * (b.y - circ.c.y)
      );
      if (Math.abs(ang) > Math.PI / 4 || Math.abs(ang) < 1e-9) return undefined;
      const sg = Math.sign(ang);
      if (sign && sg !== sign) return undefined;
      sign = sg;
      sweep += Math.abs(ang);
    }
    if (sweep > 2 * Math.PI - 0.05) return undefined;
    return { c: circ.c, cw: sign < 0 };
  };
  while (i < n - 1) {
    let best: { j: number; c: P2; cw: boolean } | undefined;
    for (let j = i + 3; j < n && j - i <= 400; j++) {
      const r = check(i, j);
      if (!r) break;
      best = { j, ...r };
    }
    if (best) {
      out.push({ type: 'arc', to: p[best.j], c: best.c, cw: best.cw });
      i = best.j;
    } else {
      out.push({ type: 'line', to: p[i + 1] });
      i++;
    }
  }
  return out;
}

export interface GcodeOptions {
  partName?: string;
  stockSize?: Vec3;
  spindleRpm?: number;
  /** Absolute Z for moves between operations / at start and end. Default stock top + 5. */
  safeZ?: number;
  /** Absolute Z between passes of one operation. Default stock top + 2. */
  retractZ?: number;
  arcTolerance?: number;
  /** Disable arc fitting (all G1). */
  arcs?: boolean;
}

const fmt = (v: number) => {
  const s = v.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

const toolLine = (t: Tool, zMin: number) =>
  `(  T${t.number} D=${fmt(t.diameter)} CR=0 - ZMIN=${fmt(zMin)} - ${t.name ?? 'flat end mill'} )`;

/** FluidNC/grbl dialect G-code. Z0 = stock bottom, XY0 = lower left of the part. */
export function toGcode(cam: PartCam, opts: GcodeOptions = {}): string {
  const rpm = opts.spindleRpm ?? 15000;
  const safeZ = opts.safeZ ?? cam.stockTop + 5;
  const retractZ = opts.retractZ ?? cam.stockTop + 2;
  const approachZ = cam.stockTop + 1;
  const useArcs = opts.arcs ?? true;
  const tol = opts.arcTolerance ?? 0.01;

  const tools: { tool: Tool; zMin: number }[] = [];
  for (const op of cam.operations) {
    const zMin = Math.min(...op.passes.flatMap(p => p.pts.map(q => q[2])));
    const t = tools.find(t => t.tool.number === op.tool.number);
    if (t) t.zMin = Math.min(t.zMin, zMin);
    else tools.push({ tool: op.tool, zMin });
  }

  const out: string[] = ['(camNC CAM POC)'];
  if (opts.partName) out.push(`(Part: ${opts.partName})`);
  if (opts.stockSize) out.push(`(Stock: ${opts.stockSize.map(fmt).join(' x ')} mm)`);
  out.push('(Z0 = stock bottom, X0 Y0 = lower left corner of the part)');
  out.push('( Tools Table:)', ...tools.map(t => toolLine(t.tool, t.zMin)), '( )');
  for (const w of cam.warnings) out.push(`(WARNING: ${w.replace(/[()]/g, '')})`);
  out.push('G21 G90 G94 G17');

  let x = NaN,
    y = NaN,
    z = NaN,
    f = NaN;
  let motion = '';
  const move = (g: 'G0' | 'G1', to: Partial<{ x: number; y: number; z: number }>, feed?: number) => {
    const words: string[] = [];
    if (to.x !== undefined && fmt(to.x) !== fmt(x)) words.push(`X${fmt((x = to.x))}`);
    if (to.y !== undefined && fmt(to.y) !== fmt(y)) words.push(`Y${fmt((y = to.y))}`);
    if (to.z !== undefined && fmt(to.z) !== fmt(z)) words.push(`Z${fmt((z = to.z))}`);
    if (!words.length) return;
    if (g === 'G1' && feed !== undefined && feed !== f) words.push(`F${fmt((f = feed))}`);
    out.push((g !== motion ? `${(motion = g)} ` : '') + words.join(' '));
  };
  const arc = (a: Extract<Prim, { type: 'arc' }>, feed: number) => {
    const g = a.cw ? 'G2' : 'G3';
    const words = [`X${fmt(a.to.x)}`, `Y${fmt(a.to.y)}`, `I${fmt(a.c.x - x)}`, `J${fmt(a.c.y - y)}`];
    if (feed !== f) words.push(`F${fmt((f = feed))}`);
    out.push((g !== motion ? `${(motion = g)} ` : '') + words.join(' '));
    x = a.to.x;
    y = a.to.y;
  };

  move('G0', { z: safeZ });
  let currentTool: Tool | undefined = cam.operations[0]?.tool;
  // With several bits, say which one goes in first.
  const first = tools.length > 1 && currentTool ? `Insert T${currentTool.number} D=${fmt(currentTool.diameter)}, t` : 'T';
  out.push(`M0 (MSG ${first}urn ON spindle ${rpm}RPM)`);

  cam.operations.forEach((op, oi) => {
    if (currentTool && op.tool.number !== currentTool.number) {
      move('G0', { z: safeZ });
      out.push(`M0 (MSG Spindle OFF. Change to T${op.tool.number} D=${fmt(op.tool.diameter)}, re-zero Z, spindle ON ${rpm}RPM)`);
      currentTool = op.tool;
    }
    // Markers for the job view: which operation and pass the machine is in.
    out.push(`(OP ${oi + 1}/${cam.operations.length} ${op.name} - T${op.tool.number} D=${fmt(op.tool.diameter)})`);
    op.passes.forEach((pass, pi) => {
      const [p0] = pass.pts;
      out.push(`(PASS ${pi + 1}/${op.passes.length} Z${fmt(Math.min(...pass.pts.map(p => p[2])))})`);
      // Safety net: a direct link is only allowed for short hops (e.g. stepping between adjacent rings).
      const longLink = Math.hypot(p0[0] - x, p0[1] - y) > op.tool.diameter;
      if (pi === 0 || pass.link === 'retract' || longLink) {
        move('G0', { z: pi === 0 ? safeZ : Math.max(retractZ, z) });
        move('G0', { x: p0[0], y: p0[1] });
        move('G0', { z: Math.max(approachZ, p0[2]) });
        move('G1', { z: p0[2] }, pass.feeds[0]);
      } else {
        move('G1', { x: p0[0], y: p0[1], z: p0[2] }, pass.feeds[0]);
      }
      // Arc-fit runs of constant Z and feed; everything else is G1.
      let i = 1;
      while (i < pass.pts.length) {
        let j = i;
        const zr = pass.pts[i - 1][2];
        while (useArcs && j < pass.pts.length && Math.abs(pass.pts[j][2] - zr) < 1e-6 && pass.feeds[j] === pass.feeds[i]) j++;
        if (j - i >= 3) {
          const run = pass.pts.slice(i - 1, j).map(p => ({ x: p[0], y: p[1] }));
          for (const prim of fitArcs(run, tol)) {
            if (prim.type === 'line') move('G1', { x: prim.to.x, y: prim.to.y }, pass.feeds[i]);
            else arc(prim, pass.feeds[i]);
          }
          i = j;
        } else {
          const p = pass.pts[i];
          move('G1', { x: p[0], y: p[1], z: p[2] }, pass.feeds[i]);
          i++;
        }
      }
    });
  });
  move('G0', { z: safeZ });
  move('G0', { x: 0, y: 0 });
  return out.join('\n') + '\n';
}
