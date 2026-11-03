import type { BoardPart, BoardSpec } from './board';
import type { PartFeatures } from './features';
import { camPart, type CamSettings, type Operation } from './toolpaths';

type P2 = { x: number; y: number };

/** How side B lines up after the board is turned over (top to bottom: board y -> H - y). */
export type FlipRegistration = 'camera' | 'dowels' | 'fence';

/** Pin holes for a flip on dowels: board and spoilboard, so the turned board drops onto the same pins. */
export interface DowelSpec {
  /** Where the pins go on side A; each also gets its mirror (x, H - y) drilled. */
  at: P2[];
  diameter: number;
  /** How far into the spoilboard, mm below the board's bottom. */
  depth: number;
}

/**
 * After side B (the board turned over top to bottom, see `sideBSpec`), what side A left is somewhere else: a point at
 * (x, y) lies at (x, H - y), and a height z above the bottom is `stockTop` - z below the new top. Every registration
 * turns the board this way (they differ in how it's lined up, not where things go).
 */
export interface TurnedOver {
  /** The board's height (Y). */
  h: number;
}

const partRect = (p: BoardPart) => {
  const [w, h] = p.rotated ? [p.size[1], p.size[0]] : [p.size[0], p.size[1]];
  return { x: p.x, y: p.y, w, h };
};

/**
 * Side B of a board turned over top to bottom: every part where it lies then (y -> H - y), with the features of its
 * other face (`flipped`: features of the part turned over, around its X axis, or its Y axis when it lies turned).
 */
export function sideBSpec(board: BoardSpec, flipped: (part: BoardPart) => PartFeatures): BoardSpec {
  return {
    ...board,
    id: `${board.id}:b`,
    dowels: undefined,
    parts: board.parts.map(p => {
      const r = partRect(p);
      return { ...p, features: flipped(p), y: board.h - r.y - r.h };
    }),
  };
}

/**
 * Two pin spots on side A, each with its mirror (x, H - y) also free of parts: far apart along the board, clear of
 * every part by `clearance` (and of the edge). Undefined when the board has no room for them.
 */
export function dowelSpots(board: BoardSpec, diameter: number, clearance: number): P2[] | undefined {
  const rects = board.parts.map(partRect);
  const r = diameter / 2 + clearance;
  const free = (p: P2) =>
    p.x - r >= 0 &&
    p.y - r >= 0 &&
    p.x + r <= board.w &&
    p.y + r <= board.h &&
    rects.every(q => p.x + r <= q.x || p.x - r >= q.x + q.w || p.y + r <= q.y || p.y - r >= q.y + q.h);
  const spots: P2[] = [];
  const step = 1;
  for (let x = r; x <= board.w - r; x += step)
    for (let y = r; y <= board.h / 2; y += step) {
      const p = { x, y };
      // A pin on the middle line is its own mirror; elsewhere the mirror needs room too (and must not overlap it).
      if (free(p) && free({ x, y: board.h - y }) && (Math.abs(board.h - 2 * y) < 1e-6 || board.h - 2 * y >= 2 * r)) spots.push(p);
    }
  if (spots.length < 2) return undefined;
  // The pair farthest apart: the board can't turn about the pins.
  let best: [P2, P2] = [spots[0], spots[1]],
    bd = -1;
  const left = spots.reduce((a, b) => (b.x < a.x ? b : a));
  for (const s of spots) {
    const d = Math.hypot(s.x - left.x, s.y - left.y);
    if (d > bd) {
      bd = d;
      best = [left, s];
    }
  }
  return bd >= board.w / 3 ? best : undefined;
}

/** The pin holes, cut through the board into the spoilboard with the job's bit (in board coordinates). */
export function dowelOperations(board: BoardSpec, dowels: DowelSpec, settings: Partial<CamSettings>): Operation[] {
  const all = dowels.at.flatMap(p => (Math.abs(board.h - 2 * p.y) < 1e-6 ? [p] : [p, { x: p.x, y: board.h - p.y }]));
  const circle = (c: P2) =>
    Array.from({ length: 72 }, (_, i) => ({
      x: c.x + (dowels.diameter / 2) * Math.cos(-(i / 72) * 2 * Math.PI),
      y: c.y + (dowels.diameter / 2) * Math.sin(-(i / 72) * 2 * Math.PI),
    }));
  const stockTop = board.stockTop ?? board.thickness;
  const features: PartFeatures = {
    thickness: stockTop,
    footprint: [],
    outlines: [],
    throughHoles: all.map(circle),
    levels: [],
    pockets: [],
    bottomFaces: [],
    slopedArea: 0,
  };
  const cam = camPart(features, { ...settings, tabs: false, stockTop, cutThrough: true, finalZ: -dowels.depth });
  return cam.operations.map((op, i) => ({ ...op, name: `Dowel pin hole ${i + 1}` }));
}
