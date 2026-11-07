/** Between boards on the table, mm: room for a board's label, its handles and the clamps' bodies. */
export const kTableGap = 150;
/** Around what's drawn of a board, mm. */
export const kBoardPad = kTableGap / 3;

/** A spot to look for room from a free part's first choice, in steps: nearest first, along its row before above or below. */
const kStep = 40;
const kRings = (() => {
  const out: [number, number][] = [];
  for (let i = -60; i <= 60; i++) for (let j = -60; j <= 60; j++) out.push([i, j]);
  return out.sort(
    (a, b) =>
      Math.max(Math.abs(a[0]), Math.abs(a[1])) - Math.max(Math.abs(b[0]), Math.abs(b[1])) || Math.abs(a[1]) - Math.abs(b[1]) || b[0] - a[0]
  );
})();

export interface TableRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What goes on the table of one board: its size, and the parts of its list that aren't on it. */
export interface TableBoard {
  id: string;
  w: number;
  h: number;
  off: { id: string; w: number; h: number; at?: { x: number; y: number } }[];
}

export interface TableLayout {
  /** Upper left corners. */
  boards: Map<string, { x: number; y: number }>;
  /** Upper left corners. */
  off: Map<string, { x: number; y: number }>;
  /** Where a part dropped makes a new board. */
  newBoard: TableRect;
  /** All of that. */
  bounds: TableRect;
}

const overlap = (a: TableRect, b: TableRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grown = (r: TableRect, by: number): TableRect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

/**
 * The boards on one table (mm, Y down): in rows of `cols`, each row's tops in line, so a board that changes size only moves what
 * is to its right and in the rows below. A part off its board lies where it was dropped; one that no board took, or that a board
 * has since grown over, goes on the nearest free spot under its board.
 */
export function layoutTable(boards: TableBoard[], cols: number): TableLayout {
  const out: TableLayout = { boards: new Map(), off: new Map(), newBoard: { x: 0, y: 0, w: 0, h: 0 }, bounds: { x: 0, y: 0, w: 0, h: 0 } };
  let top = 0;
  let rightOfFirstRow = 0;
  const rects: TableRect[] = [];
  for (let i = 0; i < boards.length; i += cols) {
    const row = boards.slice(i, i + cols);
    let x = 0;
    for (const b of row) {
      out.boards.set(b.id, { x, y: top });
      rects.push({ x, y: top, w: b.w, h: b.h });
      x += b.w + kTableGap;
    }
    if (i === 0) rightOfFirstRow = x;
    top += Math.max(...row.map(b => b.h)) + kTableGap;
  }
  out.newBoard = { x: rightOfFirstRow, y: 0, w: 320, h: 300 };
  rects.push(out.newBoard);

  const taken: TableRect[] = [];
  const isFree = (r: TableRect) => !rects.some(o => overlap(r, grown(o, 30))) && !taken.some(o => overlap(r, grown(o, 20)));
  // Those dropped by hand first: the others go around them.
  for (const b of boards)
    for (const p of b.off) {
      if (!p.at) continue;
      const r = { ...p.at, w: p.w, h: p.h };
      if (!isFree(r)) continue;
      out.off.set(p.id, p.at);
      taken.push(r);
    }
  for (const b of boards) {
    const at = out.boards.get(b.id)!;
    for (const p of b.off) {
      if (out.off.has(p.id)) continue;
      const from = p.at ?? { x: at.x + b.w / 2 - p.w / 2, y: at.y + b.h + 100 };
      let spot: { x: number; y: number } | undefined;
      for (const [i, j] of kRings) {
        const q = { x: from.x + i * kStep, y: from.y + j * kStep };
        if (isFree({ ...q, w: p.w, h: p.h })) {
          spot = q;
          break;
        }
      }
      spot ??= { x: at.x, y: Math.max(...[...rects, ...taken].map(r => r.y + r.h)) + kTableGap };
      out.off.set(p.id, spot);
      taken.push({ ...spot, w: p.w, h: p.h });
    }
  }
  const all = [...rects, ...taken];
  const [x0, y0] = [Math.min(...all.map(r => r.x)), Math.min(...all.map(r => r.y))];
  out.bounds = { x: x0, y: y0, w: Math.max(...all.map(r => r.x + r.w)) - x0, h: Math.max(...all.map(r => r.y + r.h)) - y0 };
  return out;
}

/** How many boards to a row, so they come out biggest in an area of this size. */
export function bestColumns(boards: TableBoard[], area: { w: number; h: number }) {
  let best = 1,
    scale = 0;
  for (let cols = 1; cols <= boards.length; cols++) {
    const { bounds } = layoutTable(
      boards.map(b => ({ ...b, off: [] })),
      cols
    );
    const s = fitScale(area, bounds);
    if (s > scale) [best, scale] = [cols, s];
  }
  return best;
}

/** The most and least px per mm the table is drawn at. */
export const kMinScale = 0.03;
export const kMaxScale = 12;

/** Px per mm that shows this much of the table in an area of this size, with room around it for labels and handles. */
export function fitScale(area: { w: number; h: number }, size: { w: number; h: number }) {
  const s = Math.min((area.w - 72) / Math.max(1, size.w), (area.h - 88) / Math.max(1, size.h));
  return Math.min(kMaxScale, Math.max(kMinScale, s));
}
