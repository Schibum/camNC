import type { HoldDown } from '@wbcnc/cam';
import { clampKeepOuts, nestRects, placedSize, type NestResult, type Rect } from '@wbcnc/cam/nest';
import type { BoardRequest, CamPartInfo } from './camTypes';
import type { MaterialKey } from './planSettings';

export interface StockBoardV1 {
  id: string;
  thickness: number;
  w: number;
  h: number;
}

export interface BoardV1 {
  id: string;
  /** A, B, C … in the order the boards were made. */
  name: string;
  thickness: number;
  material: MaterialKey;
  /** Fit the board to its parts, or a fixed size (e.g. from the stock list). */
  size: { fit: true } | { fit: false; w: number; h: number };
  holdDown: HoldDown;
  tabs: { width: number; height: number; minCount: number };
  /** Bodies on this board, as instance ids (see `instancesOf`). */
  items: string[];
}

/** One body to cut: the k-th of a group of identical bodies. */
export interface PartInstance {
  id: string;
  partId: string;
  name: string;
  size: [number, number, number];
  thickness: number;
}

export const kHoldDownLabels = {
  'fixture-tape': 'Fixture + tape',
  tabs: 'Tabs',
  'tabs-guided': 'Tabs + guided removal',
  clamps: 'Clamps only',
} as const;

export const kBoardMargin = 20;
/** Gap between parts: the bit plus 4 mm, so outline cuts never meet. */
export const boardGap = (bit: number) => Math.ceil(bit + 4);
export const kDefaultTabs = { width: 5, height: 2, minCount: 3 };
const kClamp = { w: 60, h: 40 };

const thicknessKey = (t: number) => +t.toFixed(1);

export function instancesOf(parts: CamPartInfo[], milled: (partId: string) => boolean): PartInstance[] {
  return parts
    .filter(p => milled(p.id) && !p.summary.notFlat)
    .flatMap(p => p.names.map((name, k) => ({ id: `${p.id}#${k}`, partId: p.id, name, size: p.size, thickness: p.thickness })));
}

const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `B${i + 1}`);

export function newBoard(boards: BoardV1[], thickness: number, material: MaterialKey, items: string[] = []): BoardV1 {
  const used = new Set(boards.map(b => b.name));
  let i = 0;
  while (used.has(letter(i))) i++;
  return {
    id: crypto.randomUUID(),
    name: letter(i),
    thickness: thicknessKey(thickness),
    material,
    size: { fit: true },
    holdDown: 'tabs',
    tabs: kDefaultTabs,
    items,
  };
}

/**
 * Keep the user's boards in sync with the parts to mill: drop bodies that are gone (or not milled any more), put new
 * ones on the first board of their thickness (making one if needed). Empty boards stay until deleted (the user may
 * be about to drag parts onto them).
 */
export function reconcileBoards(boards: BoardV1[] | undefined, instances: PartInstance[], material: MaterialKey): BoardV1[] {
  const byId = new Map(instances.map(i => [i.id, i]));
  let out = (boards ?? []).map(b => ({
    ...b,
    items: b.items.filter(id => byId.get(id)?.thickness !== undefined && thicknessKey(byId.get(id)!.thickness) === b.thickness),
  }));
  const placed = new Set(out.flatMap(b => b.items));
  for (const inst of instances) {
    if (placed.has(inst.id)) continue;
    const t = thicknessKey(inst.thickness);
    const board = out.find(b => b.thickness === t);
    if (board) board.items.push(inst.id);
    else out = [...out, newBoard(out, t, material, [inst.id])];
  }
  return out;
}

export interface BoardNest extends NestResult {
  gap: number;
  keepOuts: Rect[];
}

/** Lay out a board's bodies: rectangle nesting, clamp keep-outs for "clamps only". */
export function nestBoard(board: BoardV1, instances: PartInstance[], bit: number): BoardNest {
  const byId = new Map(instances.map(i => [i.id, i]));
  const items = board.items.flatMap(id => (byId.has(id) ? [{ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] }] : []));
  const gap = boardGap(bit);
  const clamps = board.holdDown === 'clamps';
  if (!board.size.fit) {
    const fixed = { w: board.size.w, h: board.size.h };
    const keepOuts = clamps ? clampKeepOuts(fixed, kClamp) : [];
    return { ...nestRects(items, { gap, margin: kBoardMargin, keepOuts, board: fixed }), gap, keepOuts };
  }
  let nest = nestRects(items, { gap, margin: kBoardMargin });
  if (!clamps) return { ...nest, gap, keepOuts: [] };
  // Clamps need free corners: grow the fitted board until the parts fit around them.
  for (let extra = kClamp.h; extra <= 4 * kClamp.h; extra += kClamp.h / 2) {
    const fixed = { w: nest.board.w, h: nest.board.h + extra };
    const keepOuts = clampKeepOuts(fixed, kClamp);
    const n = nestRects(items, { gap, margin: kBoardMargin, keepOuts, board: fixed });
    if (!n.unplaced.length) return { ...n, gap, keepOuts };
    nest = nest.unplaced.length ? n : nest;
  }
  return { ...nest, gap, keepOuts: clampKeepOuts(nest.board, kClamp) };
}

export function boardRequest(board: BoardV1, nest: BoardNest, instances: PartInstance[]): BoardRequest {
  const byId = new Map(instances.map(i => [i.id, i]));
  return {
    id: board.id,
    name: board.name,
    w: nest.board.w,
    h: nest.board.h,
    thickness: board.thickness,
    holdDown: board.holdDown,
    tabs: board.tabs,
    parts: nest.placements.map(p => ({
      id: p.id,
      partId: byId.get(p.id)!.partId,
      name: byId.get(p.id)!.name,
      x: p.x,
      y: p.y,
      rotated: p.rotated,
    })),
  };
}

/**
 * Put every body on boards from the stock list: per thickness, fill the biggest stock board, overflow onto the next.
 * Thicknesses without stock keep fitted boards. Returns the new boards and the bodies that fit on no stock board.
 */
export function autoFillFromStock(
  boards: BoardV1[],
  instances: PartInstance[],
  stock: StockBoardV1[],
  bit: number,
  material: MaterialKey
): { boards: BoardV1[]; tooBig: string[] } {
  const out: BoardV1[] = [];
  const tooBig: string[] = [];
  const thicknesses = [...new Set(instances.map(i => thicknessKey(i.thickness)))].sort((a, b) => b - a);
  for (const t of thicknesses) {
    const sheets = stock.filter(s => thicknessKey(s.thickness) === t).sort((a, b) => b.w * b.h - a.w * a.h);
    const old = boards.filter(b => b.thickness === t);
    let left = instances.filter(i => thicknessKey(i.thickness) === t).map(i => i.id);
    if (!sheets.length) {
      out.push(...(old.length ? old : [newBoard(out, t, material, left)]));
      continue;
    }
    const sheet = sheets[0];
    while (left.length) {
      const board = { ...newBoard(out, t, old[0]?.material ?? material, left), size: { fit: false as const, w: sheet.w, h: sheet.h } };
      if (old[0]) Object.assign(board, { holdDown: old[0].holdDown, tabs: old[0].tabs });
      const nest = nestBoard(board, instances, bit);
      const placed = nest.placements.map(p => p.id);
      if (!placed.length) {
        tooBig.push(...left);
        break;
      }
      out.push({ ...board, items: placed });
      left = left.filter(id => !placed.includes(id));
    }
  }
  return { boards: out, tooBig };
}

/** Bounding rectangle of a placed body (for hit testing / labels). */
export function placedRect(p: { x: number; y: number; rotated: boolean }, inst: PartInstance): Rect {
  const s = placedSize({ id: inst.id, w: inst.size[0], h: inst.size[1] }, p.rotated);
  return { x: p.x, y: p.y, w: s.w, h: s.h };
}
