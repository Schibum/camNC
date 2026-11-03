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
  /** The board's name ("A"): the header then says XY0 is that board's lower left corner. */
  board?: string;
  stockSize?: Vec3;
  /** For a bit without its own speed (`Tool.rpm`). */
  spindleRpm?: number;
  /** Seconds to wait after M3 for the spindle to reach speed. */
  spindleDwell?: number;
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

/**
 * FluidNC rejects a line longer than this, comments included ("error:14" in `gc_execute_line`), which stops the job with
 * an alarm: names and messages are clipped to fit.
 */
export const kMaxGcodeLine = 127;
const encoder = new TextEncoder();

/**
 * Text for inside a `( )` comment, at most `room` bytes. FluidNC can't nest comments: the rest of the line after an
 * inner `)` is read as G-code ("error:1", which stops the job too), and a `;` ends the line, message included.
 */
function commentText(text: string, room: number): string {
  const clean = text.replace(/[();]/g, '').replace(/[\r\n]+/g, ' ');
  if (encoder.encode(clean).length <= room) return clean;
  const chars = [...clean];
  while (encoder.encode(chars.join('')).length > room) chars.pop();
  return chars.join('');
}

/** What a pause that stops the spindle tells whoever switches it by hand: M3/M5 do nothing on a router. Short: see above. */
const kManualOffOn = 'Manual spindle: off now, on before Resume';
const kManualOff = 'Manual spindle: off now';

const toolLine = (t: Tool, zMin: number) =>
  `(  T${t.number} D=${fmt(t.diameter)} CR=0 - ZMIN=${fmt(zMin)} - ${commentText(t.name ?? 'flat end mill', 60)} )`;

/**
 * FluidNC/grbl dialect G-code for one bit. Z0 = stock bottom, XY0 = lower left of the stock (the board). Several bits make
 * several programs (`splitByBit`): FluidNC can't zero Z while a program is paused, so a swap can't happen inside one.
 */
export function toGcode(cam: PartCam, opts: GcodeOptions = {}): string {
  const diameters = new Set(cam.operations.map(o => o.tool.diameter));
  if (diameters.size > 1) throw new Error(`One program per bit: split the ${diameters.size} bits with splitByBit first`);
  const rpm = cam.operations[0]?.tool.rpm ?? opts.spindleRpm ?? 15000;
  const safeZ = opts.safeZ ?? cam.safeZ ?? cam.stockTop + 5;
  const retractZ = opts.retractZ ?? cam.retractZ ?? cam.stockTop + 2;
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

  const out: string[] = ['(camNC CAM)'];
  if (opts.partName) out.push(`(${commentText(opts.partName, kMaxGcodeLine - 2)})`);
  if (opts.stockSize) out.push(`(Stock: ${opts.stockSize.map(fmt).join(' x ')} mm)`);
  const corner = opts.board ? `board ${commentText(opts.board, 40)}` : 'the stock';
  const size = opts.stockSize ? `, ${fmt(opts.stockSize[0])} x ${fmt(opts.stockSize[1])} mm` : '';
  out.push(`(X0 Y0 = lower left corner of ${corner}${size}. Z0 = stock bottom)`);
  out.push('( Tools Table:)', ...tools.map(t => toolLine(t.tool, t.zMin)), '( )');
  for (const w of cam.warnings) out.push(`(WARNING: ${commentText(w, kMaxGcodeLine - '(WARNING: )'.length)})`);
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
  /** G2/G3 in XY; with `toZ` a helical arc (Z moves linearly along it). */
  const arc = (a: Extract<Prim, { type: 'arc' }>, feed: number, toZ?: number) => {
    const g = a.cw ? 'G2' : 'G3';
    const words = [`X${fmt(a.to.x)}`, `Y${fmt(a.to.y)}`];
    if (toZ !== undefined && fmt(toZ) !== fmt(z)) words.push(`Z${fmt((z = toZ))}`);
    words.push(`I${fmt(a.c.x - x)}`, `J${fmt(a.c.y - y)}`);
    if (feed !== f) words.push(`F${fmt((f = feed))}`);
    out.push((g !== motion ? `${(motion = g)} ` : '') + words.join(' '));
    x = a.to.x;
    y = a.to.y;
  };

  // After a pause with the spindle off: start it again and let it come up to speed before cutting on.
  let spindleOff = true;
  const spindleOn = () => {
    if (!spindleOff) return;
    out.push(`M3 S${rpm}`, `G4 P${fmt(opts.spindleDwell ?? 3)}`);
    spindleOff = false;
  };
  /** Bit up and spindle off before anyone reaches in; nothing moves until Resume. */
  const pause = (message: string, manual: string) => {
    move('G0', { z: safeZ });
    const room = kMaxGcodeLine - 'M0 (MSG . )'.length - manual.length;
    out.push('M5', `M0 (MSG ${commentText(message, room)}. ${manual})`);
    spindleOff = true;
  };

  move('G0', { z: safeZ });
  // Confirm before the spindle starts; a spindle the machine doesn't control (a router) is switched on here. A program
  // that begins with a pause confirms there: no spinning up just to stop again.
  if (!cam.operations[0]?.pauseBefore) {
    out.push(`M0 (MSG Spindle starts at ${rpm} RPM next. Manual spindle: turn it on now)`);
    spindleOn();
  }

  cam.operations.forEach((op, oi) => {
    if (op.pauseBefore) pause(op.pauseBefore, kManualOffOn);
    spindleOn();
    // Markers for the job view: which operation and pass the machine is in.
    const [opHead, opTail] = [`(OP ${oi + 1}/${cam.operations.length} `, ` - T${op.tool.number} D=${fmt(op.tool.diameter)})`];
    out.push(opHead + commentText(op.name, kMaxGcodeLine - opHead.length - opTail.length) + opTail);
    op.passes.forEach((pass, pi) => {
      const [p0] = pass.pts;
      out.push(`(PASS ${pi + 1}/${op.passes.length} Z${fmt(Math.min(...pass.pts.map(p => p[2])))})`);
      // Safety net: a direct link is only allowed for short hops (e.g. stepping between adjacent rings).
      // A link the generator knows runs through cleared material may be longer.
      const longLink = !pass.clearLink && Math.hypot(p0[0] - x, p0[1] - y) > op.tool.diameter;
      if (pi === 0 || pass.link === 'retract' || longLink) {
        move('G0', { z: pi === 0 ? safeZ : Math.max(retractZ, z) });
        move('G0', { x: p0[0], y: p0[1] });
        move('G0', { z: Math.max(approachZ, p0[2]) });
        move('G1', { z: p0[2] }, pass.feeds[0]);
      } else {
        move('G1', { x: p0[0], y: p0[1], z: p0[2] }, pass.feeds[0]);
      }
      // Arc-fit runs of constant feed where Z is constant or changes linearly along the path (ramps: helical arcs);
      // everything else is G1.
      const xy = (k: number) => Math.hypot(pass.pts[k][0] - pass.pts[k - 1][0], pass.pts[k][1] - pass.pts[k - 1][1]);
      const slope = (k: number) => (pass.pts[k][2] - pass.pts[k - 1][2]) / (xy(k) || NaN);
      let i = 1;
      while (i < pass.pts.length) {
        let j = i;
        const s0 = slope(i);
        while (useArcs && j < pass.pts.length && pass.feeds[j] === pass.feeds[i] && xy(j) > 1e-9 && Math.abs(slope(j) - s0) < 1e-4) j++;
        if (j - i >= 3) {
          const run = pass.pts.slice(i - 1, j).map(p => ({ x: p[0], y: p[1] }));
          const flat = Math.abs(s0) < 1e-9;
          let along = 0;
          const z0 = pass.pts[i - 1][2];
          let px = run[0].x,
            py = run[0].y;
          for (const prim of fitArcs(run, tol)) {
            // XY length of this primitive, for its end Z on a ramp.
            if (prim.type === 'line') along += Math.hypot(prim.to.x - px, prim.to.y - py);
            else {
              const rad = Math.hypot(px - prim.c.x, py - prim.c.y);
              let sweep = Math.atan2(prim.to.y - prim.c.y, prim.to.x - prim.c.x) - Math.atan2(py - prim.c.y, px - prim.c.x);
              if (prim.cw && sweep > 0) sweep -= 2 * Math.PI;
              if (!prim.cw && sweep < 0) sweep += 2 * Math.PI;
              along += Math.abs(sweep) * rad;
            }
            px = prim.to.x;
            py = prim.to.y;
            const toZ = flat ? undefined : z0 + s0 * along;
            if (prim.type === 'line') move('G1', { x: prim.to.x, y: prim.to.y, z: toZ }, pass.feeds[i]);
            else arc(prim, pass.feeds[i], toZ);
          }
          // Land exactly on the run's last point (arc lengths vs. chords differ slightly).
          if (!flat) move('G1', { z: pass.pts[j - 1][2] }, pass.feeds[i]);
          i = j;
        } else {
          const p = pass.pts[i];
          move('G1', { x: p[0], y: p[1], z: p[2] }, pass.feeds[i]);
          i++;
        }
      }
    });
    // After the last operation the program only parks: nothing to switch back on for.
    if (op.pauseAfter) pause(op.pauseAfter, oi < cam.operations.length - 1 ? kManualOffOn : kManualOff);
  });
  move('G0', { z: safeZ });
  out.push('M5');
  move('G0', { x: 0, y: 0 });
  out.push('M30');
  return out.join('\n') + '\n';
}
