import type { FlipRegistration, TabFallback } from '@wbcnc/cam';
import type { HoldDown } from '@wbcnc/cam';
import { usesTabs } from '@wbcnc/cam/board';
import {
  frameMargin,
  kHoldDefaults,
  kHoldHeights,
  kHoldSpacing,
  kClampWidth,
  edgeDir,
  holdBox,
  pathClearance,
  snapClamp,
  suggestHoldPoints,
  type HoldKind,
  type HoldPoint,
} from '@wbcnc/cam/holdPoints';
import { nestRects, placedSize, type NestResult, type Placement, type Rect } from '@wbcnc/cam/nest';
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
  /** How the parts are held (tabs, skin, tape layer, nothing). */
  holdDown: HoldDown;
  /**
   * What holds the board: screws or clamps at hold points (default), or tape / a fixture under all of it (then the
   * parts keep a thin layer until the end: `fixture-tape`).
   */
  boardHold?: BoardHold;
  /**
   * The hold points: screw or clamp and greatest spacing along an edge (mm). A screw: `d` its head's ⌀. A clamp: `d`
   * how far its toe reaches in from the edge, `w` its width along the edge. `height`: how far it stands above the stock's
   * top, mm (the program's clearance heights go above it). Default a ⌀10 screw every 250.
   */
  holds?: { kind: HoldKind; d: number; w?: number; height?: number; spacing?: number };
  /** Hold points the user moved (board frame, mm): used as they are instead of the suggested ones. */
  holdPoints?: { x: number; y: number }[];
  /** The board's size when the user moved them: on a board of another size (laid out again) they're suggested afresh. */
  holdPointsOn?: { w: number; h: number };
  /** Keep a frame of stock around the parts for the holds; default on (left out when the parts don't fit with it). */
  frame?: boolean;
  tabs: { width: number; height: number; minCount: number };
  /** Free border inside the board edge, mm; default bit + 2, with tabs bit + 3.5 (`defaultMargin`). */
  margin?: number;
  /** Space between parts, mm; default bit + 4, with tabs 2 × bit + 3.5 (`boardGap`). */
  gap?: number;
  /** Stock thickness measured at the machine; default the parts' thickness + `kStockAllowance`. */
  measuredThickness?: number;
  /** Bodies on this board, as instance ids (see `instancesOf`). */
  items: string[];
  /**
   * The parts' undersides, after turning the board over: how it lines up then. Default: re-align with the camera
   * when a part has features underneath.
   */
  flip?: FlipRegistration | 'off';
  /** Pin diameter for a flip on dowel pins, mm (default 6). */
  dowelDiameter?: number;
  /** Per body (instance id): what it gets if its tabs can't hold, over the job's default. */
  tabFallbacks?: Record<string, TabFallback>;
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
  /** Has features on its underside: needs the board turned over for a second side. */
  needsFlip?: boolean;
  id: string;
  partId: string;
  name: string;
  size: [number, number, number];
  thickness: number;
}

export type BoardHold = 'points' | 'tape';

/** What holds the board: hold points, unless it's taped (the old "Fixture + tape" hold-down too). */
export const boardHoldOf = (board: Pick<BoardV1, 'boardHold' | 'holdDown'>): BoardHold =>
  board.boardHold ?? (board.holdDown === 'fixture-tape' ? 'tape' : 'points');

/** How the parts are held, with the old "Clamps only" read as nothing (the board's hold points hold the stock). */
export const partsHoldOf = (board: Pick<BoardV1, 'boardHold' | 'holdDown'>): HoldDown =>
  boardHoldOf(board) === 'tape'
    ? 'fixture-tape'
    : board.holdDown === 'clamps' || board.holdDown === 'fixture-tape'
      ? 'none'
      : board.holdDown;

export const holdsOf = (board: Pick<BoardV1, 'holds'>) => {
  const kind = board.holds?.kind ?? ('screw' as HoldKind);
  // Clamps saved before they had a width were sized as a round toe: start them afresh.
  const old = kind === 'clamp' && board.holds?.w === undefined;
  return {
    kind,
    d: (!old && board.holds?.d) || kHoldDefaults[kind],
    ...(kind === 'clamp' && { w: board.holds?.w ?? kClampWidth }),
    height: board.holds?.height ?? kHoldHeights[kind],
    spacing: board.holds?.spacing ?? kHoldSpacing,
  };
};

/** The board's hold-down settings, to copy to another board. */
export const holdSettingsOf = (b: BoardV1): Partial<BoardV1> => ({
  holdDown: b.holdDown,
  tabs: b.tabs,
  ...(b.boardHold && { boardHold: b.boardHold }),
  ...(b.holds && { holds: b.holds }),
  ...(b.frame !== undefined && { frame: b.frame }),
});

/** "Tabs · screws", "Tape or fixture": the board list's short line. */
export const holdLabel = (b: BoardV1) =>
  boardHoldOf(b) === 'tape'
    ? kBoardHoldLabels.tape
    : `${kHoldDownLabels[partsHoldOf(b) as keyof typeof kHoldDownLabels]} · ${holdsOf(b).kind}s`;

export const kBoardHoldLabels: Record<BoardHold, string> = {
  points: 'Screws or clamps',
  tape: 'Tape or fixture',
};

/** How the parts are held, when the board is held by screws or clamps. */
export const kHoldDownLabels = {
  tabs: 'Tabs',
  'tabs-guided': 'Tabs + guided removal',
  skin: 'Bottom skin + guided freeing',
  none: 'Nothing (I watch them)',
} as const;

/** Narrowest strip of stock, mm, that holds a tab after the cuts on both sides of it (the hold check's). */
const kTabWeb = 3.5;
/**
 * Default border inside the board edge: the outline cut (bit) plus 2 mm stays on the board. With tabs, enough that the
 * strip left outside the cut holds them.
 */
export const defaultMargin = (bit: number, holdDown?: HoldDown) => +(bit + (holdDown && usesTabs(holdDown) ? kTabWeb : 2)).toFixed(1);
/**
 * Gap between parts: the bit plus 4 mm, so outline cuts never meet. With tabs, room for both cuts and a strip between
 * them that holds the tabs of either part.
 */
export const boardGap = (bit: number, holdDown?: HoldDown) => Math.ceil(holdDown && usesTabs(holdDown) ? 2 * bit + kTabWeb : bit + 4);

/**
 * Before the bit changes: keep each board's margin and gap as they are, so the nest the user saw stays (a bigger
 * bit would otherwise widen them and push parts off the board).
 */
export function freezeSpacing(boards: BoardV1[], bit: number): BoardV1[] {
  return boards.map(b => ({ ...b, margin: b.margin ?? defaultMargin(bit, b.holdDown), gap: b.gap ?? boardGap(bit, b.holdDown) }));
}

/**
 * Why a board's gap is too tight for this bit: the cut around each part needs the bit's width (+1 mm), or one part's
 * outline cut eats into its neighbour. Blocks the job.
 */
export function spacingProblem(board: BoardV1, nest: { gap: number; margin: number }, bit: number): string | null {
  if (nest.gap < bit + 1) return `Board ${board.name}: the ${nest.gap} mm gap between parts is too narrow for the ⌀${bit} bit.`;
  return null;
}

/**
 * The outline cuts run past the board's edge (the margin is narrower than the bit): the bit only cuts air there, fine
 * unless something holds the board down there. A note, not a blocker (on tab boards the hold check catches parts the
 * thin strip left at the edge can't hold).
 */
export function edgeNote(board: BoardV1, nest: { gap: number; margin: number }, bit: number): string | null {
  if (nest.margin >= bit) return null;
  const past = `Board ${board.name}: the outline cuts run past the board edge (${nest.margin} mm margin, ⌀${bit} bit).`;
  // Held by screws or clamps: the hold check blocks the job if the bit would hit one of them.
  return boardHoldOf(board) === 'points'
    ? `${past} Keep screws and clamps clear of it: the job is blocked if the bit would hit one.`
    : `${past} Fine if nothing is clamped or screwed there.`;
}
/** Boards are bought a little thicker than the parts: cutting starts at thickness + this unless measured. */
export const kStockAllowance = 0.3;
export const stockTopOf = (board: BoardV1) => board.measuredThickness ?? +(board.thickness + kStockAllowance).toFixed(2);
export const kDefaultTabs = { width: 5, height: 2, minCount: 3 };

const thicknessKey = (t: number) => +t.toFixed(1);

export function instancesOf(parts: CamPartInfo[], milled: (partId: string) => boolean): PartInstance[] {
  return (
    parts
      // 3D parts default to not milled (camQueries); milling one anyway is the user's call.
      .filter(p => milled(p.id))
      .flatMap(p =>
        p.names.map((name, k) => ({
          id: `${p.id}#${k}`,
          partId: p.id,
          name,
          size: p.size,
          thickness: p.thickness,
          needsFlip: p.summary.needsFlip,
        }))
      )
  );
}

const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `B${i + 1}`);

export function newBoard(
  boards: BoardV1[],
  thickness: number,
  material: MaterialKey,
  items: string[] = [],
  id: string = crypto.randomUUID()
): BoardV1 {
  const used = new Set(boards.map(b => b.name));
  let i = 0;
  while (used.has(letter(i))) i++;
  return {
    id,
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
/** A board laid out afresh: its bodies stay on it, but none is pinned or at a spot of its own any more. */
export function relayoutBoard(board: BoardV1): BoardV1 {
  const rest = { ...board };
  delete rest.pinned;
  delete rest.positions;
  return rest;
}

/** The positions of these bodies only. */
const onlyFor = (positions: Record<string, PartPosition>, ids: string[]) =>
  Object.fromEntries(Object.entries(positions).filter(([id]) => ids.includes(id)));

/** A new board's material: thin boards (back panels, drawer bottoms: 6 mm or less) are usually plywood or HDF. */
export const defaultMaterial = (thickness: number, material: MaterialKey): MaterialKey =>
  thickness <= 6 && material !== 'mdf' ? 'plywood' : material;

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
    // The same id every time for the same thickness: until the boards are saved (the Boards step), every change to the
    // job makes them afresh, and a new id would make them new boards (planned again, the one shown gone).
    else out = [...out, newBoard(out, t, defaultMaterial(t, material), [inst.id], `auto-${t}mm`)];
  }
  return out;
}

export interface BoardNest extends NestResult {
  gap: number;
  margin: number;
  /** Areas parts stay out of: around the hold points placed by hand. */
  keepOuts: Rect[];
  /** Where the board is screwed or clamped: suggested, or as the user moved them. Empty when taped. */
  holds: HoldPoint[];
  /** A frame of stock for the holds around the parts: kept, off, or left out because the parts don't fit with it. */
  frame: 'kept' | 'off' | 'no-room';
  /** The holds are the ones the user moved, not suggested. */
  holdsMoved: boolean;
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
/** Up to whole mm, ignoring float noise (571.0000001 stays 571). */
const ceilMm = (v: number) => Math.ceil(v - 1e-6);

/**
 * A board's size for people: "571 × 739", or "–" for a fitted board with nothing on it yet (its size is only the
 * edge margins).
 */
export function boardSizeLabel(board: Pick<BoardV1, 'size'>, nest: Pick<BoardNest, 'board' | 'placements'>): string {
  if (board.size.fit && !nest.placements.length) return '–';
  return `${+nest.board.w.toFixed(1)} × ${+nest.board.h.toFixed(1)}`;
}
/** At least `gap` apart. */
const apart = (a: Rect, b: Rect, gap: number) =>
  a.x + a.w + gap <= b.x + EPS || b.x + b.w + gap <= a.x + EPS || a.y + a.h + gap <= b.y + EPS || b.y + b.h + gap <= a.y + EPS;
/** Inside the board's edge margin (a fitted board grows: only its lower and left edge). */
const insideMargin = (r: Rect, margin: number, board?: { w: number; h: number }) =>
  r.x >= margin - EPS && r.y >= margin - EPS && (!board || (r.x + r.w <= board.w - margin + EPS && r.y + r.h <= board.h - margin + EPS));

/**
 * Lay out a board's bodies: the ones placed by hand (`positions`) first, at their spot, then rectangle nesting of the
 * rest around them. A board held by screws or clamps keeps a frame of stock around the parts for them (when the parts
 * still fit), and gets hold points: suggested clear of the parts, or where the user moved them.
 */
export function nestBoard(
  board: BoardV1,
  instances: PartInstance[],
  bit: number,
  /**
   * `holds: false`: only where the parts go, no hold points. `packing`: also without the frame (packing picks the
   * sheets; the frame is then kept where the parts still fit with it).
   */
  opts: { holds?: boolean; packing?: boolean } = {}
): BoardNest {
  const byId = new Map(instances.map(i => [i.id, i]));
  const ids = board.items.filter(id => byId.has(id));
  const gap = board.gap ?? boardGap(bit, partsHoldOf(board));
  const baseMargin = board.margin ?? defaultMargin(bit, partsHoldOf(board));
  const points = boardHoldOf(board) === 'points';
  const hold = holdsOf(board);
  const size = board.size.fit ? undefined : { w: board.size.w, h: board.size.h };
  // Holds the user moved: parts keep clear of them, while the board keeps the size they were moved on.
  const sameSize = (b: { w: number; h: number }) =>
    !board.holdPointsOn || (Math.abs(board.holdPointsOn.w - b.w) < 0.5 && Math.abs(board.holdPointsOn.h - b.h) < 0.5);
  let moved = points && board.holdPoints?.length && (!size || sameSize(size)) ? board.holdPoints : undefined;
  const movedOn = board.holdPointsOn ?? size;
  const holdAt = (p: { x: number; y: number }, on?: { w: number; h: number }): HoldPoint => ({
    // A clamp grips at the edge, however far it reaches in now: its toe would otherwise be checked off the board.
    ...(hold.w !== undefined && on ? snapClamp(p, hold.d, on) : { x: p.x, y: p.y }),
    kind: hold.kind,
    d: hold.d,
    height: hold.height,
    ...(hold.w !== undefined && { w: hold.w, ...(on && { dir: edgeDir(p, on) }) }),
  });
  const keepOutOf = (h: HoldPoint): Rect => {
    const b = holdBox(h);
    const keep = pathClearance(h, bit / 2) - bit / 2;
    return { x: b.x - keep, y: b.y - keep, w: b.w + 2 * keep, h: b.h + 2 * keep };
  };
  let keepOuts: Rect[] = (moved ?? []).map(p => keepOutOf(holdAt(p, movedOn)));
  // Packing picks the sheets without the frame: it's only kept where it costs no part (and so no extra board).
  const wantFrame = points && board.frame !== false && !opts.packing;
  const framed = wantFrame ? Math.max(baseMargin, frameMargin(hold.d, bit, hold.kind, hold.height)) : baseMargin;

  const layout = (margin: number) => {
    // Placed by hand: kept at their spot while it is inside the margin and clear of the others and the holds.
    const fixed: Placement[] = [];
    const fixedRects: Rect[] = [];
    for (const id of ids) {
      const pos = board.positions?.[id];
      if (!pos) continue;
      const r = placedRect(pos, byId.get(id)!);
      if (!insideMargin(r, margin, size) || ![...fixedRects, ...keepOuts].every(o => apart(r, o, gap))) continue;
      fixed.push({ id, x: pos.x, y: pos.y, rotated: pos.rotated });
      fixedRects.push(r);
    }
    const items = ids.filter(id => !fixed.some(p => p.id === id)).map(id => ({ id, w: byId.get(id)!.size[0], h: byId.get(id)!.size[1] }));
    const n = size
      ? nestRects(items, { gap, margin, keepOuts: [...keepOuts, ...fixedRects], board: size })
      : fitCompact(items, gap, margin, [...keepOuts, ...fixedRects]);
    return { n, fixed };
  };

  let margin = framed;
  let { n, fixed } = layout(framed);
  // A fitted board that came out another size (parts added, frame changed): the moved holds no longer fit it.
  if (moved && !size && !sameSize({ w: ceilMm(n.board.w), h: ceilMm(n.board.h) })) {
    moved = undefined;
    keepOuts = [];
    ({ n, fixed } = layout(framed));
  }
  let frame: BoardNest['frame'] = wantFrame ? 'kept' : 'off';
  // On a fixed board, the frame only where it costs no part.
  if (wantFrame && size && framed > baseMargin && n.unplaced.length) {
    const plain = layout(baseMargin);
    if (plain.n.unplaced.length < n.unplaced.length) {
      ({ n, fixed } = plain);
      margin = baseMargin;
      frame = 'no-room';
    }
  }
  const order = new Map(ids.map((id, i) => [id, i]));
  const placements = [...fixed, ...n.placements].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const area = placements.reduce((a, p) => a + byId.get(p.id)!.size[0] * byId.get(p.id)!.size[1], 0);
  // A fitted board is cut from a sheet: whole mm, rounded up (570.4 × 738.9 -> 571 × 739).
  const out = size ? n.board : { w: ceilMm(n.board.w), h: ceilMm(n.board.h) };
  const { w, h } = out;
  const rects = placements.map(p => placedRect(p, byId.get(p.id)!));
  const holds: HoldPoint[] =
    !points || opts.holds === false
      ? []
      : moved
        ? moved.map(p => holdAt(p, out))
        : suggestHoldPoints(out, rects, { kind: hold.kind, d: hold.d, w: hold.w, height: hold.height, bit, spacing: hold.spacing });
  return {
    ...n,
    board: out,
    placements,
    yield: w * h > 0 ? area / (w * h) : 0,
    gap,
    margin,
    keepOuts,
    holds,
    frame,
    holdsMoved: !!moved,
  };
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
  const nestAt = nestBoard(nested, instances, bit, { holds: false }).placements.find(p => p.id === item);
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
    const after = nestBoard(placed, instances, bit, { holds: false });
    const lands = after.placements.find(p => p.id === item);
    const lost = after.unplaced.filter(id => !now.unplaced.includes(id));
    if (lands && lands.x === at.x && lands.y === at.y && !lost.length) return { at, exact: true, board: placed };
  }
  return snapped();
}

/** The board's second side: as chosen, else re-align with the camera when a part on it has features underneath. */
export function flipOf(board: BoardV1, instances: PartInstance[]): FlipRegistration | 'off' {
  if (board.flip) return board.flip;
  return instances.some(i => board.items.includes(i.id) && i.needsFlip) ? 'camera' : 'off';
}

export function boardRequest(
  board: BoardV1,
  nest: BoardNest,
  instances: PartInstance[],
  hold: { tabFallback?: TabFallback; skin?: number } = {}
): BoardRequest {
  const byId = new Map(instances.map(i => [i.id, i]));
  return {
    id: board.id,
    name: board.name,
    w: nest.board.w,
    h: nest.board.h,
    thickness: board.thickness,
    stockTop: stockTopOf(board),
    holdDown: partsHoldOf(board),
    // Held by points: all of them, none too (then nothing holds it, which blocks the job, not "held at its edges").
    ...(boardHoldOf(board) === 'points' && { holdPoints: nest.holds }),
    tabs: board.tabs,
    ...(flipOf(board, instances) !== 'off' && {
      flip: { registration: flipOf(board, instances) as FlipRegistration, dowelDiameter: board.dowelDiameter },
    }),
    ...(hold.tabFallback && { tabFallback: hold.tabFallback }),
    ...(hold.skin !== undefined && { skin: hold.skin }),
    parts: nest.placements.map(p => ({
      id: p.id,
      partId: byId.get(p.id)!.partId,
      name: byId.get(p.id)!.name,
      x: p.x,
      y: p.y,
      rotated: p.rotated,
      ...(board.tabFallbacks?.[p.id] && { tabFallback: board.tabFallbacks[p.id] }),
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
    const template = { ...newBoard([], t, old[0]?.material ?? defaultMaterial(t, material)) };
    if (old[0]) Object.assign(template, holdSettingsOf(old[0]));
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
      const placed = new Set(nestBoard({ ...b, items: [...b.items, ...free] }, instances, bit, { holds: false }).placements.map(p => p.id));
      const items = [...b.items, ...free.filter(id => placed.has(id))];
      if (!b.items.every(id => placed.has(id)) || nestBoard({ ...b, items }, instances, bit, { holds: false }).unplaced.length) continue;
      b.items = items;
      free = free.filter(id => !placed.has(id));
    }

    const pack: SheetPacker = (ids, sheet) => {
      const nest = nestBoard(fresh(ids, { fit: false, w: sheet.w, h: sheet.h }), instances, bit, { holds: false, packing: true });
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

/** "2 boards, 81 % yield": boards with parts on them, and part area over their board area. */
export function layoutSummary(boards: { nest: Pick<BoardNest, 'board' | 'yield' | 'placements'> }[]) {
  const used = boards.filter(b => b.nest.placements.length);
  if (!used.length) return 'No part placed yet.';
  const area = used.reduce((a, b) => a + b.nest.board.w * b.nest.board.h, 0);
  const parts = used.reduce((a, b) => a + b.nest.yield * b.nest.board.w * b.nest.board.h, 0);
  return `${used.length} ${used.length === 1 ? 'board' : 'boards'}, ${Math.round((100 * parts) / Math.max(area, 1e-9))} % yield`;
}
