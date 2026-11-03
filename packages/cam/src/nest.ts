/** Rectangle nesting of parts on boards (true-shape nesting comes later). Pure geometry, no Clipper or occt. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NestItem {
  id: string;
  /** Size of the part's bounding box, laid flat. */
  w: number;
  h: number;
  /** May turn 90°; off by default: wood grain usually runs along the part. */
  canRotate?: boolean;
}

export interface NestOptions {
  /** Free space between parts: bit diameter + margin, so the outline cuts never touch. */
  gap: number;
  /** Free border inside the board edge (clamps, uneven edges). */
  margin: number;
  /** Areas parts must stay out of, e.g. clamps (board coordinates, X0 Y0 lower left). */
  keepOuts?: Rect[];
  /** Fixed board size; omitted = fit the board to the parts. */
  board?: { w: number; h: number };
}

export interface Placement {
  id: string;
  /** Lower left corner of the (possibly turned) part on the board. */
  x: number;
  y: number;
  /** Turned 90° counterclockwise. */
  rotated: boolean;
}

export interface NestResult {
  board: { w: number; h: number };
  placements: Placement[];
  /** Items that didn't fit on a fixed board. */
  unplaced: string[];
  /** Part area / board area. */
  yield: number;
}

/** Item size as placed. */
export const placedSize = (item: NestItem, rotated: boolean) => (rotated ? { w: item.h, h: item.w } : { w: item.w, h: item.h });

/**
 * Shelf packing: tallest parts first, rows from the lower left. A fitted board is as wide as the widest part and
 * grows in Y. Keep-outs are not avoided yet.
 */
export function nestRects(items: NestItem[], opts: NestOptions): NestResult {
  const { gap, margin } = opts;
  const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const width = opts.board?.w ?? Math.max(0, ...items.map(i => i.w)) + 2 * margin;
  const placements: Placement[] = [];
  const unplaced: string[] = [];
  let x = margin,
    y = margin,
    rowH = 0;
  for (const item of order) {
    if (x > margin && x + item.w > width - margin) {
      x = margin;
      y += rowH + gap;
      rowH = 0;
    }
    if (item.w > width - 2 * margin || (opts.board && y + item.h > opts.board.h - margin)) {
      unplaced.push(item.id);
      continue;
    }
    placements.push({ id: item.id, x, y, rotated: false });
    x += item.w + gap;
    rowH = Math.max(rowH, item.h);
  }
  const board = opts.board ?? { w: width, h: y + rowH + margin };
  const used = items.filter(i => !unplaced.includes(i.id)).reduce((s, i) => s + i.w * i.h, 0);
  return { board, placements, unplaced, yield: board.w * board.h ? used / (board.w * board.h) : 0 };
}

/** Clamp keep-out zones at two opposite corners (lower left, upper right), like holding a board with two clamps. */
export function clampKeepOuts(board: { w: number; h: number }, clamp = { w: 60, h: 40 }): Rect[] {
  return [
    { x: 0, y: 0, w: clamp.w, h: clamp.h },
    { x: board.w - clamp.w, y: board.h - clamp.h, w: clamp.w, h: clamp.h },
  ];
}
