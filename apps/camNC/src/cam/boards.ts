import type { HoldDown } from '@wbcnc/cam';
import { clampKeepOuts, nestRects, placedSize, type NestResult, type Rect } from '@wbcnc/cam/nest';
import { autoNest, type NestObjective, type SheetPacker } from './autoNest';
import type { BoardRequest, CamPartInfo } from './camTypes';
import type { MaterialKey } from './planSettings';

export interface StockBoardV1 {
  id: string;
  thickness: number;
  w: number;
  h: number;
  /** How many of these boards there are; undefined = as many as needed. */
  quantity?: number;
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
  /** Free border inside the board edge, mm; default bit + 2 (`defaultMargin`). */
  margin?: number;
  /** Space between parts, mm; default bit + 4 (`boardGap`). */
  gap?: number;
  /** Stock thickness measured at the machine; default the parts' thickness + `kStockAllowance`. */
  measuredThickness?: number;
  /** Bodies on this board, as instance ids (see `instancesOf`). */
  items: string[];
  /** Bodies the user put on this board by hand: auto-fill leaves them here. */
  pinned?: string[];
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

/** Default border inside the board edge: the outline cut (bit) plus 2 mm stays on the board. */
export const defaultMargin = (bit: number) => +(bit + 2).toFixed(1);
/** Gap between parts: the bit plus 4 mm, so outline cuts never meet. */
export const boardGap = (bit: number) => Math.ceil(bit + 4);

/**
 * Before the bit changes: keep each board's margin and gap as they are, so the nest the user saw stays (a bigger
 * bit would otherwise widen them and push parts off the board).
 */
export function freezeSpacing(boards: BoardV1[], bit: number): BoardV1[] {
  return boards.map(b => ({ ...b, margin: b.margin ?? defaultMargin(bit), gap: b.gap ?? boardGap(bit) }));
}

/** Why a board's spacing is too tight for this bit: the cut around each part needs the bit's width (+1 mm). */
export function spacingProblem(board: BoardV1, nest: { gap: number; margin: number }, bit: number): string | null {
  if (nest.gap < bit + 1) return `Board ${board.name}: the ${nest.gap} mm gap between parts is too narrow for the ⌀${bit} bit.`;
  if (nest.margin < bit / 2 + 1) return `Board ${board.name}: the ${nest.margin} mm edge margin is too narrow for the ⌀${bit} bit.`;
  return null;
}
/** Boards are bought a little thicker than the parts: cutting starts at thickness + this unless measured. */
export const kStockAllowance = 0.3;
export const stockTopOf = (board: BoardV1) => board.measuredThickness ?? +(board.thickness + kStockAllowance).toFixed(2);
export const kDefaultTabs = { width: 5, height: 2, minCount: 3 };
const kClamp = { w: 60, h: 40 };

const thicknessKey = (t: number) => +t.toFixed(1);

export function instancesOf(parts: CamPartInfo[], milled: (partId: string) => boolean): PartInstance[] {
  return (
    parts
      // 3D parts default to not milled (camQueries); milling one anyway is the user's call.
      .filter(p => milled(p.id))
      .flatMap(p => p.names.map((name, k) => ({ id: `${p.id}#${k}`, partId: p.id, name, size: p.size, thickness: p.thickness })))
  );
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
  let out = (boards ?? []).map(b => {
    const items = b.items.filter(id => byId.get(id)?.thickness !== undefined && thicknessKey(byId.get(id)!.thickness) === b.thickness);
    return b.pinned ? { ...b, items, pinned: b.pinned.filter(id => items.includes(id)) } : { ...b, items };
  });
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
  margin: number;
  keepOuts: Rect[];
}

const kMaxElongation = 2.5;

/**
 * Fit a board to its parts, but not as a strip: the smallest area can be one long row (2.4 m for the kinderregal
 * sides and shelves). Beyond 2.5:1, nest on a width near the square root of the parts' area instead.
 */
function fitCompact(items: { id: string; w: number; h: number }[], gap: number, margin: number): NestResult {
  const fit = nestRects(items, { gap, margin });
  const { w, h } = fit.board;
  if (!items.length || Math.max(w, h) / Math.min(w, h) <= kMaxElongation) return fit;
  const area = items.reduce((a, i) => a + (i.w + gap) * (i.h + gap), 0);
  const width = Math.max(...items.map(i => i.w)) + 2 * margin;
  for (const W of [Math.sqrt(area) * 1.2, Math.sqrt(area) * 1.5, Math.sqrt(area) * 2].map(x =>
    Math.max(width, Math.ceil(x + 2 * margin))
  )) {
    const n = nestRects(items, { gap, margin, board: { w: W, h: 1e6 } });
    if (n.unplaced.length) continue;
    const used = n.placements.map(p => {
      const i = items.find(x => x.id === p.id)!;
      return { x: p.x + (p.rotated ? i.h : i.w), y: p.y + (p.rotated ? i.w : i.h) };
    });
    const board = { w: Math.max(...used.map(u => u.x)) + margin, h: Math.max(...used.map(u => u.y)) + margin };
    const partArea = items.reduce((a, i) => a + i.w * i.h, 0);
    if (Math.max(board.w, board.h) / Math.min(board.w, board.h) <= kMaxElongation)
      return { ...n, board, yield: partArea / (board.w * board.h) };
  }
  return fit;
}

/** Lay out a board's bodies: rectangle nesting, clamp keep-outs for "clamps only". */
export function nestBoard(board: BoardV1, instances: PartInstance[], bit: number): BoardNest {
  const byId = new Map(instances.map(i => [i.id, i]));
  const items = board.items.flatMap(id => (byId.has(id) ? [{ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] }] : []));
  const gap = board.gap ?? boardGap(bit);
  const margin = board.margin ?? defaultMargin(bit);
  const clamps = board.holdDown === 'clamps';
  if (!board.size.fit) {
    const fixed = { w: board.size.w, h: board.size.h };
    const keepOuts = clamps ? clampKeepOuts(fixed, kClamp) : [];
    return { ...nestRects(items, { gap, margin, keepOuts, board: fixed }), gap, margin, keepOuts };
  }
  let nest = fitCompact(items, gap, margin);
  if (!clamps) return { ...nest, gap, margin, keepOuts: [] };
  // Clamps need free corners: grow the fitted board until the parts fit around them.
  for (let extra = kClamp.h; extra <= 4 * kClamp.h; extra += kClamp.h / 2) {
    const fixed = { w: nest.board.w, h: nest.board.h + extra };
    const keepOuts = clampKeepOuts(fixed, kClamp);
    const n = nestRects(items, { gap, margin, keepOuts, board: fixed });
    if (!n.unplaced.length) return { ...n, gap, margin, keepOuts };
    nest = nest.unplaced.length ? n : nest;
  }
  return { ...nest, gap, margin, keepOuts: clampKeepOuts(nest.board, kClamp) };
}

export function boardRequest(board: BoardV1, nest: BoardNest, instances: PartInstance[]): BoardRequest {
  const byId = new Map(instances.map(i => [i.id, i]));
  return {
    id: board.id,
    name: board.name,
    w: nest.board.w,
    h: nest.board.h,
    thickness: board.thickness,
    stockTop: stockTopOf(board),
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
 * Put every body on boards from the stock list, per thickness, using as little stock as possible (see `autoNest`).
 * Bodies the user moved by hand (`pinned`) stay on their board, and free bodies fill the room left on such a board
 * first when it has a fixed size. Thicknesses without stock keep their boards. Bodies that fit on no stock board
 * (`tooBig`) or are left when the stock runs out (`short`) go on a fitted board of their own.
 */
export function autoFillFromStock(
  boards: BoardV1[],
  instances: PartInstance[],
  stock: StockBoardV1[],
  bit: number,
  material: MaterialKey,
  objective: NestObjective = 'boards'
): { boards: BoardV1[]; tooBig: string[]; short: string[] } {
  const out: BoardV1[] = [];
  const tooBig: string[] = [];
  const short: string[] = [];
  const byId = new Map(instances.map(i => [i.id, i]));
  const thicknesses = [...new Set(instances.map(i => thicknessKey(i.thickness)))].sort((a, b) => b - a);
  for (const t of thicknesses) {
    const sheets = stock.filter(s => thicknessKey(s.thickness) === t);
    const old = boards.filter(b => b.thickness === t);
    const mine = instances.filter(i => thicknessKey(i.thickness) === t).map(i => i.id);
    if (!sheets.length) {
      out.push(...(old.length ? old : [newBoard(out, t, material, mine)]));
      continue;
    }
    const template = { ...newBoard([], t, old[0]?.material ?? material) };
    if (old[0]) Object.assign(template, { holdDown: old[0].holdDown, tabs: old[0].tabs });
    const fresh = (items: string[], size: BoardV1['size']): BoardV1 => ({ ...template, id: crypto.randomUUID(), items, size });

    const kept = old.flatMap(b => {
      const pinned = (b.pinned ?? []).filter(id => b.items.includes(id) && mine.includes(id));
      return pinned.length ? [{ ...b, items: pinned, pinned }] : [];
    });
    let free = mine.filter(id => !kept.some(b => b.items.includes(id)));
    const left = new Map(sheets.map(s => [s.id, s.quantity ?? Infinity]));
    for (const b of kept) {
      if (b.size.fit) continue;
      const { w, h } = b.size;
      const sheet = sheets.find(s => s.w === w && s.h === h && left.get(s.id)! > 0);
      if (sheet) left.set(sheet.id, left.get(sheet.id)! - 1);
      if (!free.length) continue;
      const placed = new Set(nestBoard({ ...b, items: [...b.items, ...free] }, instances, bit).placements.map(p => p.id));
      const items = [...b.items, ...free.filter(id => placed.has(id))];
      if (!b.items.every(id => placed.has(id)) || nestBoard({ ...b, items }, instances, bit).unplaced.length) continue;
      b.items = items;
      free = free.filter(id => !placed.has(id));
    }

    const pack: SheetPacker = (ids, sheet) => {
      const nest = nestBoard(fresh(ids, { fit: false, w: sheet.w, h: sheet.h }), instances, bit);
      return {
        placed: nest.placements.map(p => p.id),
        used: nest.placements.map(p => {
          const r = placedRect(p, byId.get(p.id)!);
          return { ...r, w: r.w + nest.gap, h: r.h + nest.gap };
        }),
      };
    };
    const res = autoNest(
      free.map(id => ({ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] })),
      sheets.map(s => ({ id: s.id, w: s.w, h: s.h, quantity: Number.isFinite(left.get(s.id)) ? left.get(s.id) : undefined })),
      pack,
      { objective }
    );
    out.push(...kept, ...res.boards.map(b => fresh(b.items, { fit: false, w: b.sheet.w, h: b.sheet.h })));
    if (res.tooBig.length || res.short.length) out.push(fresh([...res.tooBig, ...res.short], { fit: true }));
    tooBig.push(...res.tooBig);
    short.push(...res.short);
  }
  // A fresh layout: name the boards A, B, C… in order (kept boards of other thicknesses too, so names stay unique).
  // Boards with parts placed by hand keep their name.
  const taken = new Set(out.filter(b => b.pinned?.length).map(b => b.name));
  let k = 0;
  const named = out.map(b => {
    if (b.pinned?.length) return b;
    while (taken.has(letter(k))) k++;
    return { ...b, name: letter(k++) };
  });
  return { boards: named, tooBig, short };
}

/** Bounding rectangle of a placed body (for hit testing / labels). */
export function placedRect(p: { x: number; y: number; rotated: boolean }, inst: PartInstance): Rect {
  const s = placedSize({ id: inst.id, w: inst.size[0], h: inst.size[1] }, p.rotated);
  return { x: p.x, y: p.y, w: s.w, h: s.h };
}
