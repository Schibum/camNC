import type { HoldDown } from '@wbcnc/cam';
import { clampKeepOuts, nestRects, placedSize, type NestResult, type Placement, type Rect } from '@wbcnc/cam/nest';
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
  /**
   * Bodies the user put at a spot by hand (always pinned too): nested first, at exactly this spot, and the other
   * bodies around them. A spot that no longer works (off the board, on another part) is ignored.
   */
  positions?: Record<string, PartPosition>;
}

/** Where a body sits on its board: lower left corner of its (possibly turned) outline, board frame, mm. */
export interface PartPosition {
  x: number;
  y: number;
  /** Turned 90° counterclockwise. */
  rotated: boolean;
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
/** The positions of these bodies only. */
const onlyFor = (positions: Record<string, PartPosition>, ids: string[]) =>
  Object.fromEntries(Object.entries(positions).filter(([id]) => ids.includes(id)));

export function reconcileBoards(boards: BoardV1[] | undefined, instances: PartInstance[], material: MaterialKey): BoardV1[] {
  const byId = new Map(instances.map(i => [i.id, i]));
  let out = (boards ?? []).map(b => {
    const items = b.items.filter(id => byId.get(id)?.thickness !== undefined && thicknessKey(byId.get(id)!.thickness) === b.thickness);
    const kept = b.pinned ? { ...b, items, pinned: b.pinned.filter(id => items.includes(id)) } : { ...b, items };
    return b.positions ? { ...kept, positions: onlyFor(b.positions, items) } : kept;
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
function fitCompact(items: { id: string; w: number; h: number }[], gap: number, margin: number, fixed: Rect[]): NestResult {
  // Bodies placed by hand are obstacles, and the board grows to take them in.
  const grow = (b: { w: number; h: number }) => ({
    w: Math.max(b.w, ...fixed.map(r => r.x + r.w + margin)),
    h: Math.max(b.h, ...fixed.map(r => r.y + r.h + margin)),
  });
  const first = nestRects(items, { gap, margin, keepOuts: fixed });
  const fit = { ...first, board: grow(first.board) };
  const { w, h } = fit.board;
  if (!items.length || Math.max(w, h) / Math.min(w, h) <= kMaxElongation) return fit;
  const area = items.reduce((a, i) => a + (i.w + gap) * (i.h + gap), 0);
  const width = Math.max(...items.map(i => i.w)) + 2 * margin;
  for (const W of [Math.sqrt(area) * 1.2, Math.sqrt(area) * 1.5, Math.sqrt(area) * 2].map(x =>
    Math.max(width, Math.ceil(x + 2 * margin))
  )) {
    const n = nestRects(items, { gap, margin, keepOuts: fixed, board: { w: W, h: 1e6 } });
    if (n.unplaced.length) continue;
    const used = n.placements.map(p => {
      const i = items.find(x => x.id === p.id)!;
      return { x: p.x + (p.rotated ? i.h : i.w), y: p.y + (p.rotated ? i.w : i.h) };
    });
    const board = grow({ w: Math.max(...used.map(u => u.x)) + margin, h: Math.max(...used.map(u => u.y)) + margin });
    const partArea = items.reduce((a, i) => a + i.w * i.h, 0);
    if (Math.max(board.w, board.h) / Math.min(board.w, board.h) <= kMaxElongation)
      return { ...n, board, yield: partArea / (board.w * board.h) };
  }
  return fit;
}

const EPS = 1e-6;
/** At least `gap` apart. */
const apart = (a: Rect, b: Rect, gap: number) =>
  a.x + a.w + gap <= b.x + EPS || b.x + b.w + gap <= a.x + EPS || a.y + a.h + gap <= b.y + EPS || b.y + b.h + gap <= a.y + EPS;
/** Inside the board's edge margin (a fitted board grows: only its lower and left edge). */
const insideMargin = (r: Rect, margin: number, board?: { w: number; h: number }) =>
  r.x >= margin - EPS && r.y >= margin - EPS && (!board || (r.x + r.w <= board.w - margin + EPS && r.y + r.h <= board.h - margin + EPS));

/**
 * Lay out a board's bodies: the ones placed by hand (`positions`) first, at their spot, then rectangle nesting of the
 * rest around them; clamp keep-outs for "clamps only".
 */
export function nestBoard(board: BoardV1, instances: PartInstance[], bit: number): BoardNest {
  const byId = new Map(instances.map(i => [i.id, i]));
  const ids = board.items.filter(id => byId.has(id));
  const gap = board.gap ?? boardGap(bit);
  const margin = board.margin ?? defaultMargin(bit);
  const clamps = board.holdDown === 'clamps';
  const size = board.size.fit ? undefined : { w: board.size.w, h: board.size.h };
  const clampsOn = (b: { w: number; h: number }) => (clamps ? clampKeepOuts(b, kClamp) : []);

  // Placed by hand: kept at their spot while it is inside the margin and clear of the others and the clamps (on a
  // fitted board only the lower left clamp: the other one moves with the board's size).
  const fixed: Placement[] = [];
  const fixedRects: Rect[] = [];
  const blocked = size ? clampsOn(size) : clampsOn({ w: 0, h: 0 }).slice(0, 1);
  for (const id of ids) {
    const pos = board.positions?.[id];
    if (!pos) continue;
    const r = placedRect(pos, byId.get(id)!);
    if (!insideMargin(r, margin, size) || ![...fixedRects, ...blocked].every(o => apart(r, o, gap))) continue;
    fixed.push({ id, x: pos.x, y: pos.y, rotated: pos.rotated });
    fixedRects.push(r);
  }
  const items = ids.filter(id => !fixed.some(p => p.id === id)).map(id => ({ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] }));
  const order = new Map(ids.map((id, i) => [id, i]));
  const finish = (n: NestResult, keepOuts: Rect[]): BoardNest => {
    const placements = [...fixed, ...n.placements].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const area = placements.reduce((a, p) => a + byId.get(p.id)!.size[0] * byId.get(p.id)!.size[1], 0);
    const { w, h } = n.board;
    return { ...n, placements, yield: w * h > 0 ? area / (w * h) : 0, gap, margin, keepOuts };
  };

  if (size) {
    const keepOuts = clampsOn(size);
    return finish(nestRects(items, { gap, margin, keepOuts: [...keepOuts, ...fixedRects], board: size }), keepOuts);
  }
  let nest = fitCompact(items, gap, margin, fixedRects);
  if (!clamps) return finish(nest, []);
  // Clamps need free corners: grow the fitted board until the parts fit around them.
  for (let extra = kClamp.h; extra <= 4 * kClamp.h; extra += kClamp.h / 2) {
    const grown = { w: nest.board.w, h: nest.board.h + extra };
    const keepOuts = clampsOn(grown);
    if (!fixedRects.every(r => keepOuts.every(k => apart(r, k, gap)))) continue;
    const n = nestRects(items, { gap, margin, keepOuts: [...keepOuts, ...fixedRects], board: grown });
    if (!n.unplaced.length) return finish(n, keepOuts);
    nest = nest.unplaced.length ? n : nest;
  }
  return finish(nest, clampsOn(nest.board));
}

/** Where a dragged body would land on a board, and the board after dropping it there. */
export interface PartDrop {
  /** Lower left corner where it lands; null: it fits nowhere on this board. */
  at: PartPosition | null;
  /** Lands exactly at the drop point (stored as its position), or where the board's nest puts it. */
  exact: boolean;
  /** The board with the body on it (unchanged when it doesn't fit). */
  board: BoardV1;
}

/**
 * Drop a body (from this board or another one of the same thickness) with its lower left corner at `at`. Close to
 * where the board's nest would put it (within `snap` mm), it goes there. Otherwise, when that spot is free (inside the
 * margin, `gap` away from the other parts and keep-outs) and everything still fits, it stays exactly there:
 * positioned and pinned. Else it goes where the nest puts it, or nowhere when it doesn't fit.
 */
export function dropPart(board: BoardV1, instances: PartInstance[], bit: number, item: string, at: PartPosition, snap = 0): PartDrop {
  const inst = instances.find(i => i.id === item);
  if (!inst) return { at: null, exact: false, board };
  const same = board.items.includes(item);
  const positions =
    board.positions &&
    onlyFor(
      board.positions,
      board.items.filter(id => id !== item)
    );
  const pinned = (board.pinned ?? []).filter(id => id !== item);
  // Where the nest puts it, from the parts as they are now plus this one.
  const nested: BoardV1 = {
    ...board,
    items: same ? board.items : [...board.items, item],
    ...(positions && { positions }),
    pinned: same && !board.pinned?.includes(item) ? pinned : [...pinned, item],
  };
  const nestAt = nestBoard(nested, instances, bit).placements.find(p => p.id === item);
  const snapped = (): PartDrop =>
    nestAt ? { at: { x: nestAt.x, y: nestAt.y, rotated: nestAt.rotated }, exact: false, board: nested } : { at: null, exact: false, board };
  if (nestAt && Math.hypot(nestAt.x - at.x, nestAt.y - at.y) <= snap && nestAt.rotated === at.rotated) return snapped();

  // Exactly at the drop point: the spot is free on the board as drawn now, and the other parts still fit around it.
  const now = nestBoard(board, instances, bit);
  const r = placedRect(at, inst);
  const others = now.placements.filter(p => p.id !== item).map(p => placedRect(p, instances.find(i => i.id === p.id)!));
  const free = insideMargin(r, now.margin, now.board) && [...others, ...now.keepOuts].every(o => apart(r, o, now.gap));
  if (free) {
    const placed: BoardV1 = { ...nested, positions: { ...positions, [item]: at }, pinned: [...pinned, item] };
    const after = nestBoard(placed, instances, bit);
    const lands = after.placements.find(p => p.id === item);
    const lost = after.unplaced.filter(id => !now.unplaced.includes(id));
    if (lands && lands.x === at.x && lands.y === at.y && !lost.length) return { at, exact: true, board: placed };
  }
  return snapped();
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
 * Bodies the user moved by hand (`pinned`) stay on their board (at their spot, if placed there), and free bodies fill the room left on such a board
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
      if (!pinned.length) return [];
      return [{ ...b, items: pinned, pinned, ...(b.positions && { positions: onlyFor(b.positions, pinned) }) }];
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
