/** Minimal G-code reader + metrics used to compare our output with Fusion's (POC tooling, not for the app). */
import { distPointSeg, type Vec3 } from './geom';

export interface Move {
  from: Vec3;
  to: Vec3;
  rapid: boolean;
  feed: number;
}

/** Reads G0-G3 (all planes), discretizing arcs into <= 0.5mm / 5° chords. */
export function readGcode(src: string): Move[] {
  const moves: Move[] = [];
  let pos: Vec3 = [0, 0, 0];
  let motion = 0,
    plane = 17,
    feed = 0;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw
      .replace(/\(.*?\)/g, '')
      .replace(/;.*/, '')
      .toUpperCase();
    const words = [...line.matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)].map(m => [m[1], parseFloat(m[2])] as const);
    if (!words.length) continue;
    const w: Record<string, number> = {};
    let hasAxis = false;
    for (const [k, v] of words) {
      if (k === 'G') {
        if (v <= 3) motion = v;
        else if (v === 17 || v === 18 || v === 19) plane = v;
      } else {
        w[k] = v;
        if ('XYZ'.includes(k)) hasAxis = true;
      }
    }
    if (w.F !== undefined) feed = w.F;
    if (!hasAxis || words.some(([k, v]) => k === 'G' && v === 53)) {
      if (hasAxis && w.Z !== undefined) pos = [pos[0], pos[1], Math.max(pos[2], 20)];
      continue;
    }
    const to: Vec3 = [w.X ?? pos[0], w.Y ?? pos[1], w.Z ?? pos[2]];
    if (motion <= 1) {
      moves.push({ from: pos, to, rapid: motion === 0, feed });
    } else {
      // Map plane to (u, v, axial) indices.
      const [u, v, a] = plane === 17 ? [0, 1, 2] : plane === 18 ? [2, 0, 1] : [1, 2, 0];
      const off: Record<number, number> = { 0: w.I ?? 0, 1: w.J ?? 0, 2: w.K ?? 0 };
      const cu = pos[u] + off[u],
        cv = pos[v] + off[v];
      const r = Math.hypot(pos[u] - cu, pos[v] - cv);
      const a0 = Math.atan2(pos[v] - cv, pos[u] - cu);
      let a1 = Math.atan2(to[v] - cv, to[u] - cu);
      const cw = motion === 2;
      if (cw && a1 >= a0 - 1e-9) a1 -= 2 * Math.PI;
      if (!cw && a1 <= a0 + 1e-9) a1 += 2 * Math.PI;
      const sweep = a1 - a0;
      const n = Math.max(2, Math.ceil(Math.max(Math.abs(sweep) / (Math.PI / 36), (Math.abs(sweep) * r) / 0.5)));
      let prev = pos;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const p: Vec3 = [0, 0, 0];
        p[u] = cu + r * Math.cos(a0 + sweep * t);
        p[v] = cv + r * Math.sin(a0 + sweep * t);
        p[a] = pos[a] + (to[a] - pos[a]) * t;
        if (k === n) p[u] = to[u];
        if (k === n) p[v] = to[v];
        moves.push({ from: prev, to: p, rapid: false, feed });
        prev = p;
      }
    }
    pos = to;
  }
  return moves;
}

export interface Metrics {
  cutLength: number;
  rapidLength: number;
  /** Minutes: cuts at programmed feed, rapids at 9000 XY / 1800 Z. */
  timeMin: number;
  /** Moves that go from above the stock top into material. */
  plunges: number;
  /** Distinct Z levels of horizontal cutting moves. */
  zLevels: number[];
  zMin: number;
}

export function metrics(moves: Move[], stockTop: number, rapidXY = 9000, rapidZ = 1800): Metrics {
  let cutLength = 0,
    rapidLength = 0,
    time = 0,
    plunges = 0,
    zMin = Infinity;
  const levels = new Map<string, number>();
  for (const m of moves) {
    const dxy = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]);
    const dz = Math.abs(m.to[2] - m.from[2]);
    const len = Math.hypot(dxy, dz);
    zMin = Math.min(zMin, m.to[2]);
    if (m.rapid) {
      rapidLength += len;
      time += Math.max(dxy / rapidXY, dz / rapidZ);
    } else {
      cutLength += len;
      time += len / (m.feed || 1000);
      if (m.from[2] >= stockTop - 0.01 && m.to[2] < stockTop - 0.01) plunges++;
      if (dz < 1e-6 && dxy > 0 && m.to[2] < stockTop - 0.01) {
        const k = m.to[2].toFixed(2);
        levels.set(k, (levels.get(k) ?? 0) + dxy);
      }
    }
  }
  const zLevels = [...levels.entries()]
    .filter(([, l]) => l > 5)
    .map(([z]) => +z)
    .sort((a, b) => b - a);
  return { cutLength, rapidLength, timeMin: time, plunges, zLevels, zMin };
}

/** XY polyline points of cutting moves at (within tol of) the deepest Z: the final outline pass. */
export function finalPassPoints(moves: Move[], step = 0.5, tol = 0.01): [number, number][] {
  const zMin = Math.min(...moves.filter(m => !m.rapid).map(m => m.to[2]));
  const pts: [number, number][] = [];
  for (const m of moves) {
    if (m.rapid || Math.abs(m.to[2] - zMin) > tol || Math.abs(m.from[2] - zMin) > tol) continue;
    const len = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) pts.push([m.from[0] + ((m.to[0] - m.from[0]) * k) / n, m.from[1] + ((m.to[1] - m.from[1]) * k) / n]);
  }
  return pts;
}

/** Nearest point on a point chain (consecutive samples within 1mm = segment) for each query point. */
export function nearestOnPath(points: [number, number][], path: [number, number][]): { d: number; q: [number, number] }[] {
  const cell = 5;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1],
      [bx, by] = path[i];
    if (Math.hypot(bx - ax, by - ay) > 1) continue;
    const k = key((ax + bx) / 2, (ay + by) / 2);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(i);
  }
  return points.map(([x, y]) => {
    let best = Infinity;
    let q: [number, number] = [x, y];
    const cx = Math.floor(x / cell),
      cy = Math.floor(y / cell);
    for (let ring = 0; ring < 200 && best > (ring - 1) * cell; ring++) {
      for (let gx = cx - ring; gx <= cx + ring; gx++)
        for (let gy = cy - ring; gy <= cy + ring; gy++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== ring) continue;
          for (const i of grid.get(`${gx},${gy}`) ?? []) {
            const [ax, ay] = path[i - 1],
              [bx, by] = path[i];
            const d = distPointSeg(x, y, ax, ay, bx, by);
            if (d < best) {
              best = d;
              const dx = bx - ax,
                dy = by - ay,
                l2 = dx * dx + dy * dy;
              const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
              q = [ax + t * dx, ay + t * dy];
            }
          }
        }
    }
    return { d: best, q };
  });
}

export const pointsToPathDistances = (points: [number, number][], path: [number, number][]) => nearestOnPath(points, path).map(n => n.d);

export const stats = (d: number[]) => {
  const s = [...d].sort((a, b) => a - b);
  return {
    max: s[s.length - 1] ?? NaN,
    mean: s.reduce((a, b) => a + b, 0) / (s.length || 1),
    p95: s[Math.floor(s.length * 0.95)] ?? NaN,
  };
};

/** 2D transform applied to our moves to register them on Fusion's setup frame. */
export type Xf = { rot: 0 | 1 | 2 | 3; mirror: boolean; dx: number; dy: number };

export function applyXf([x, y]: [number, number], xf: Xf): [number, number] {
  let px = xf.mirror ? -x : x,
    py = y;
  for (let k = 0; k < xf.rot; k++) [px, py] = [-py, px];
  return [px + xf.dx, py + xf.dy];
}

export function transformMoves(moves: Move[], xf: Xf): Move[] {
  const t = (p: Vec3): Vec3 => [...applyXf([p[0], p[1]], xf), p[2]];
  return moves.map(m => ({ ...m, from: t(m.from), to: t(m.to) }));
}

/**
 * Register our part frame on Fusion's setup frame: try the 4 rotations (mirrors optional: a mirror means the board
 * was flipped, which would put pockets on the wrong side), align bboxes, then refine the translation ICP-style
 * (Fusion's lead-in/out moves sit at the final depth too and skew the bbox).
 */
export function register(ours: [number, number][], ref: [number, number][], mirrors = false): { xf: Xf; mean: number }[] {
  const bmin = (p: [number, number][]) => [Math.min(...p.map(q => q[0])), Math.min(...p.map(q => q[1]))];
  const [rx, ry] = bmin(ref);
  const candidates: { xf: Xf; mean: number }[] = [];
  const sample = ours.filter((_, i) => i % 10 === 0);
  for (const mirror of mirrors ? [false, true] : [false])
    for (const rot of [0, 1, 2, 3] as const) {
      const xf0: Xf = { rot, mirror, dx: 0, dy: 0 };
      const moved = sample.map(p => applyXf(p, xf0));
      const [mx, my] = bmin(moved);
      const xf = { ...xf0, dx: rx - mx, dy: ry - my };
      let mean = Infinity;
      for (let it = 0; it < 10; it++) {
        const near = nearestOnPath(
          sample.map(p => applyXf(p, xf)),
          ref
        );
        // Trim outliers (lead-ins, features only one side has) before averaging the shift.
        const ds = near.map(n => n.d).sort((a, b) => a - b);
        const cut = ds[Math.floor(ds.length * 0.9)];
        let sx = 0,
          sy = 0,
          n = 0;
        near.forEach((nn, i) => {
          if (nn.d > cut) return;
          const [px, py] = applyXf(sample[i], xf);
          sx += nn.q[0] - px;
          sy += nn.q[1] - py;
          n++;
        });
        mean = ds.reduce((a, b) => a + b, 0) / ds.length;
        if (!n || Math.hypot(sx / n, sy / n) < 1e-4) break;
        xf.dx += sx / n;
        xf.dy += sy / n;
      }
      candidates.push({ xf, mean });
    }
  // Symmetric outlines fit equally well in several rotations; callers disambiguate (e.g. by pocket overlap).
  return candidates.sort((a, b) => a.mean - b.mean);
}

/** Lowest Z the tool reaches per grid cell (flat end mill swept along the cutting moves). */
export class DepthMap {
  readonly data: Float32Array;
  readonly w: number;
  readonly h: number;
  constructor(
    readonly x0: number,
    readonly y0: number,
    x1: number,
    y1: number,
    readonly res: number
  ) {
    this.w = Math.ceil((x1 - x0) / res);
    this.h = Math.ceil((y1 - y0) / res);
    this.data = new Float32Array(this.w * this.h).fill(Infinity);
  }
  stamp(x: number, y: number, z: number, r: number) {
    const rc = Math.ceil(r / this.res);
    const cx = Math.round((x - this.x0) / this.res),
      cy = Math.round((y - this.y0) / this.res);
    for (let j = Math.max(0, cy - rc); j <= Math.min(this.h - 1, cy + rc); j++)
      for (let i = Math.max(0, cx - rc); i <= Math.min(this.w - 1, cx + rc); i++) {
        const dx = this.x0 + i * this.res - x,
          dy = this.y0 + j * this.res - y;
        if (dx * dx + dy * dy <= r * r) {
          const k = j * this.w + i;
          if (z < this.data[k]) this.data[k] = z;
        }
      }
  }
  sweep(moves: Move[], r: number, below: number) {
    for (const m of moves) {
      if (m.rapid || (m.from[2] >= below && m.to[2] >= below)) continue;
      const len = Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1], m.to[2] - m.from[2]);
      const n = Math.max(1, Math.ceil(len / (this.res * 0.7)));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        this.stamp(m.from[0] + t * (m.to[0] - m.from[0]), m.from[1] + t * (m.to[1] - m.from[1]), m.from[2] + t * (m.to[2] - m.from[2]), r);
      }
    }
  }
}

/** SVG top view: cutting moves colored by depth (deep = dark blue, top = yellow), rapids light gray. */
export function toSvg(panels: { title: string; moves: Move[] }[], zRange: [number, number], scale = 2): string {
  const all = panels.flatMap(p => p.moves.flatMap(m => [m.from, m.to])).filter(p => p[2] < zRange[1] + 0.5);
  const minX = Math.min(...all.map(p => p[0])) - 5,
    maxX = Math.max(...all.map(p => p[0])) + 5;
  const minY = Math.min(...all.map(p => p[1])) - 5,
    maxY = Math.max(...all.map(p => p[1])) + 5;
  const pw = (maxX - minX) * scale,
    ph = (maxY - minY) * scale;
  const color = (z: number) => {
    const t = Math.max(0, Math.min(1, (z - zRange[0]) / (zRange[1] - zRange[0])));
    return `hsl(${240 - 180 * t} 85% ${30 + 25 * t}%)`;
  };
  const gap = 20,
    head = 30;
  const parts = panels.map((p, idx) => {
    const ox = idx * (pw + gap);
    const tx = (x: number) => (ox + (x - minX) * scale).toFixed(1);
    const ty = (y: number) => (head + (maxY - y) * scale).toFixed(1);
    const lines = p.moves
      .filter(m => m.rapid || m.to[2] < zRange[1] + 0.01 || m.from[2] < zRange[1] + 0.01)
      .map(m =>
        m.rapid
          ? `<line x1="${tx(m.from[0])}" y1="${ty(m.from[1])}" x2="${tx(m.to[0])}" y2="${ty(m.to[1])}" stroke="#bbb" stroke-width="0.6" stroke-dasharray="3 3"/>`
          : `<line x1="${tx(m.from[0])}" y1="${ty(m.from[1])}" x2="${tx(m.to[0])}" y2="${ty(m.to[1])}" stroke="${color(Math.min(m.from[2], m.to[2]))}" stroke-width="1.2"/>`
      );
    return `<text x="${ox + 4}" y="20" font-family="sans-serif" font-size="16">${p.title}</text>${lines.join('')}`;
  });
  const W = panels.length * pw + (panels.length - 1) * gap,
    H = ph + head;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}"><rect width="100%" height="100%" fill="white"/>${parts.join('')}</svg>`;
}
