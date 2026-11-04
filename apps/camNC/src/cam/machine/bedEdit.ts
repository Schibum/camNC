import { edgeDir, holdBox, holdClashes, snapClamp, type HoldPoint } from '@wbcnc/cam/holdPoints';
import { create } from 'zustand';
import { dropPart, type BedSpot, type BoardNest, type BoardV1, type PartInstance, type PartPosition } from '../boards';

type P2 = { x: number; y: number };

/** What a tap on the board in the top view does: select what's there, or add a hold there. */
export type BedEditMode = 'move' | 'add';

/** A change to a board made in the top view, as the board's new fields. */
export type BoardPatch = Partial<Pick<BoardV1, 'holdPoints' | 'holdPointsOn' | 'bed' | 'size' | 'positions' | 'pinned'>>;

export interface BedEdit {
  boardId: string;
  /** What it does, for the toast and Undo: "Clamp 2 moved". */
  what: string;
  patch: BoardPatch;
}

export type Axis = 'x' | 'y' | null;

/**
 * Shift held: the move is locked to one axis, the one moved along first (once past 3 mm), until Shift is let go. For
 * fine moves along X or Y only.
 */
export function lockAxis(d: P2, shift: boolean, axis: Axis): { d: P2; axis: Axis } {
  if (!shift) return { d, axis: null };
  const a = axis ?? (Math.hypot(d.x, d.y) > 3 ? (Math.abs(d.x) >= Math.abs(d.y) ? 'x' : 'y') : null);
  return { d: a === 'x' ? { x: d.x, y: 0 } : a === 'y' ? { x: 0, y: d.y } : { x: 0, y: 0 }, axis: a };
}

export type BedSelection = { kind: 'hold'; i: number } | { kind: 'part'; id: string };

/** The arrow key's step, mm: 1, with Shift 10, with Alt 0.1. */
export const nudgeStep = (e: { shiftKey: boolean; altKey: boolean }) => (e.altKey ? 0.1 : e.shiftKey ? 10 : 1);

/** Of the machine's four axis directions, the one whose screen direction (`screen`, y down) is nearest `want`. */
export function nearestAxis(screen: { x: P2; y: P2 }, want: P2): P2 {
  const options: [P2, P2][] = [
    [{ x: 1, y: 0 }, screen.x],
    [
      { x: -1, y: 0 },
      { x: -screen.x.x, y: -screen.x.y },
    ],
    [{ x: 0, y: 1 }, screen.y],
    [
      { x: 0, y: -1 },
      { x: -screen.y.x, y: -screen.y.y },
    ],
  ];
  const score = (v: P2) => (v.x * want.x + v.y * want.y) / (Math.hypot(v.x, v.y) || 1);
  return options.reduce((a, b) => (score(b[1]) > score(a[1]) ? b : a))[0];
}

/** A part of the board in the top view: where it lies on the board (board frame), to drag elsewhere. */
export interface BedPart {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
  /** There's room to move it: other parts to trade places with, or a board bigger than its parts. Else a drag on it moves the board. */
  movable: boolean;
}

/** What the top view can do with the board shown, beyond its holds (`CamBedEditor` sets it). */
export interface BedContext {
  boardId: string;
  parts: BedPart[];
  /** Why parts and holds can't be changed (the board is cut), or null. */
  locked: string | null;
  /** While moving a part: the spot is free, taken (it goes to a free spot instead), or off the board. */
  check: (item: string, at: PartPosition) => 'free' | 'taken' | 'off';
  /** A part moved there: exactly, to the nearest free spot, or not at all (it fits nowhere). */
  drop: (item: string, at: PartPosition) => 'exact' | 'moved' | 'none';
  /**
   * The board turned to `deg` about its middle (its XY zero moves), or with its XY zero at `at` when the caller moved
   * it already (the knob, while dragging).
   */
  rotate: (deg: number, at?: { x: number; y: number }) => void;
  /** The selected item's board in the CAM job: its layout (Boards step) or its toolpaths (Plan step). */
  openInCam: (where: 'layout' | 'toolpaths') => void;
}

/** A short note next to what was just moved or selected, in the board frame: gone after a moment. */
export interface BedNote {
  at: P2;
  text: string;
  tone: 'info' | 'warn' | 'bad';
}

/**
 * Edits in the machine's top view: the mode, what can be undone, and where an edit goes. The overlay draws in the 3D
 * canvas; the job is saved outside it (`CamBedEditor` registers `apply` and the board's context).
 */
export const useBedEdit = create<{
  mode: BedEditMode;
  setMode: (mode: BedEditMode) => void;
  /** Saves an edit to the job; set while the top view shows a CAM job. */
  apply: ((edit: BedEdit) => void) | null;
  setApply: (apply: ((edit: BedEdit) => void) | null) => void;
  bed: BedContext | null;
  setBed: (bed: BedContext | null) => void;
  /** Tapped (or reached with Tab): the arrow keys nudge it, Delete removes a hold. Nothing: the keys nudge the board. */
  selected: BedSelection | null;
  setSelected: (selected: BedSelection | null) => void;
  note: BedNote | null;
  setNote: (note: BedNote | null) => void;
  /** The machine axis (+X, -X, +Y, -Y) that points most nearly the way an arrow key points on screen; set by the canvas. */
  arrowAxis: ((key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown') => P2) | null;
}>(set => ({
  selected: null,
  setSelected: selected => set({ selected }),
  note: null,
  setNote: note => set({ note }),
  arrowAxis: null,
  mode: 'move',
  setMode: mode => set({ mode }),
  apply: null,
  setApply: apply => set({ apply }),
  bed: null,
  setBed: bed => set({ bed }),
}));

/** A point turned by `deg` (counterclockwise) about the origin. */
export function turn(p: P2, deg: number): P2 {
  const a = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) };
}

/** A point on the bed (machine X/Y) in the board frame of a board whose XY zero lies at `at`, turned by `deg`. */
export const bedToBoard = (p: P2, at: P2, deg: number): P2 => turn({ x: p.x - at.x, y: p.y - at.y }, -deg);

/** A point in the board frame on the bed (machine X/Y). */
export function boardToBed(p: P2, at: P2, deg: number): P2 {
  const q = turn(p, deg);
  return { x: q.x + at.x, y: q.y + at.y };
}

/** Where a hold goes when dropped or added at `p` (board frame): a clamp grips the nearest edge, a screw stays put. */
export function placeHold(h: Pick<HoldPoint, 'kind' | 'd' | 'w' | 'height'>, p: P2, board: { w: number; h: number }): HoldPoint {
  const clamp = h.kind === 'clamp' && h.w !== undefined;
  const at = clamp ? snapClamp(p, h.d, board) : { x: p.x, y: p.y };
  return { ...h, ...at, ...(clamp && { dir: edgeDir(p, board) }) } as HoldPoint;
}

/** On the board, or near enough to grip it (a clamp dragged just past the edge). */
export const onBoard = (p: P2, board: { w: number; h: number }, slack = 0) =>
  p.x >= -slack && p.y >= -slack && p.x <= board.w + slack && p.y <= board.h + slack;

const kindName = (h: Pick<HoldPoint, 'kind'>) => (h.kind === 'clamp' ? 'Clamp' : 'Screw');

/** The board's holds with one moved: its new fields, kept on the size they were moved on. */
export function moveHold(holds: HoldPoint[], i: number, to: P2, board: { w: number; h: number }, boardId: string): BedEdit {
  const points = holds.map((h, j) => (j === i ? placeHold(h, to, board) : h));
  return { boardId, what: `${kindName(holds[i])} ${i + 1} moved`, patch: holdPatch(points, board) };
}

/** The board's holds with one more, like the others (or a clamp, the first). */
export function addHold(
  holds: HoldPoint[],
  like: Pick<HoldPoint, 'kind' | 'd' | 'w' | 'height'>,
  at: P2,
  board: { w: number; h: number },
  boardId: string
): BedEdit {
  const points = [...holds, placeHold(like, at, board)];
  return { boardId, what: `${kindName(like)} ${points.length} added`, patch: holdPatch(points, board) };
}

/** The board's holds without one. The last one gone, the board has none (not the suggested ones again). */
export function removeHold(holds: HoldPoint[], i: number, board: { w: number; h: number }, boardId: string): BedEdit {
  const points = holds.filter((_, j) => j !== i);
  return { boardId, what: `${kindName(holds[i])} ${i + 1} removed`, patch: holdPatch(points, board) };
}

const round = (v: number) => Math.round(v * 10) / 10;

function holdPatch(points: P2[], board: { w: number; h: number }): BoardPatch {
  return { holdPoints: points.map(p => ({ x: round(p.x), y: round(p.y) })), holdPointsOn: { w: board.w, h: board.h } };
}

/** The board's spot on the bed for one side: saved so that its programs go there again. */
export function placeBoard(board: Pick<BoardV1, 'id' | 'bed'>, side: 'a' | 'b', at: BedSpot): BedEdit {
  const deg = board.bed?.[side]?.deg;
  const spot = { x: round(at.x), y: round(at.y), ...(deg !== undefined && { deg }) };
  return { boardId: board.id, what: 'Board placed', patch: { bed: { ...board.bed, [side]: spot } } };
}

/** Where a board's XY zero goes when it turns from `from` to `to` degrees about its middle, so it stays where it lies. */
export function turnAboutMiddle(at: P2, size: { w: number; h: number }, from: number, to: number): P2 {
  const mid = { x: size.w / 2, y: size.h / 2 };
  const a = turn(mid, from);
  const b = turn(mid, to);
  return { x: at.x + a.x - b.x, y: at.y + a.y - b.y };
}

/** The board's angle on the bed for one side, and its spot at that angle (`at`, its XY zero), saved with the job. */
export function turnBoard(board: Pick<BoardV1, 'id' | 'bed'>, side: 'a' | 'b', deg: number, at: { x: number; y: number }): BedEdit {
  const spot = { x: round(at.x), y: round(at.y), deg };
  return { boardId: board.id, what: `Board turned to ${deg}°`, patch: { bed: { ...board.bed, [side]: spot } } };
}

/**
 * An angle dragged with the corner handle: to a tenth of a degree, and onto a quarter turn within 1.5°. Between -180°
 * and 180°.
 */
export function snapAngle(deg: number): number {
  let d = ((((deg + 180) % 360) + 360) % 360) - 180;
  const quarter = Math.round(d / 90) * 90;
  if (Math.abs(d - quarter) <= 1.5) d = quarter;
  const r = Math.round(d * 10) / 10;
  return r === -180 ? 180 : r === 0 ? 0 : r;
}

/**
 * At the machine the board is a real sheet: once something is changed on it there, it keeps its size (when fitted to
 * its parts) and every part stays where it is (pinned), unless the change moves that part. The board doesn't grow
 * around a hold (which would bring the suggested holds back) and the parts don't shuffle.
 */
export function freezeAtMachine(board: BoardV1, nest: Pick<BoardNest, 'board' | 'placements'>): BoardPatch {
  const positions = Object.fromEntries(nest.placements.map(p => [p.id, { x: p.x, y: p.y, rotated: p.rotated }]));
  return {
    ...(board.size.fit && { size: { fit: false, w: nest.board.w, h: nest.board.h } }),
    positions: { ...positions, ...board.positions },
    pinned: [...new Set([...(board.pinned ?? []), ...Object.keys(positions)])],
  };
}

/**
 * A part dragged on the board at the machine: exactly where it was dropped when that spot is free, else to the free
 * spot the nest finds for it (the other parts stay put). `null` when it fits nowhere on the board.
 */
export function movePart(
  board: BoardV1,
  nest: Pick<BoardNest, 'board' | 'placements'>,
  instances: PartInstance[],
  bit: number,
  item: string,
  at: PartPosition
): (BedEdit & { exact: boolean }) | null {
  const frozen = { ...board, ...freezeAtMachine(board, nest) };
  const at1 = { x: round(at.x), y: round(at.y), rotated: at.rotated };
  const drop = dropPart(frozen, instances, bit, item, at1);
  if (!drop.at) return null;
  const name = instances.find(i => i.id === item)?.name ?? item;
  const { size, positions, pinned } = drop.board;
  return {
    boardId: board.id,
    what: drop.exact ? `${name} moved` : `${name} moved to a free spot`,
    exact: drop.exact,
    patch: { size, positions: { ...positions, [item]: drop.at }, pinned },
  };
}

/**
 * A hold being dragged, checked at once against the program's path (program coordinates: the board frame turned by
 * `deg`): would the bit hit it? The plan's own check follows when it's dropped.
 */
export function hitsPath(h: HoldPoint, deg: number, path: [number, number, number][][] | undefined, bit: number, stockTop: number) {
  if (!path?.length) return false;
  const c = turn(h, deg);
  // A small turn keeps the toe's box about the same; a quarter turn swaps its sides.
  const quarter = Math.round(deg / 90) % 2 !== 0;
  const dir = h.dir && (quarter ? { x: h.dir.y, y: h.dir.x } : h.dir);
  return (
    holdClashes(
      [{ ...h, x: c.x, y: c.y, dir }],
      path.map(pts => ({ r: bit / 2, pts })),
      stockTop
    ).length > 0
  );
}

/**
 * What a tap at `q` (board frame) selects: a hold within `slack` mm of its footprint (the nearest), else the part
 * under it, else nothing (the board).
 */
export function pickAt(
  q: P2,
  holds: HoldPoint[] | undefined,
  parts: Pick<BedPart, 'id' | 'x' | 'y' | 'w' | 'h'>[],
  slack = 6
): BedSelection | null {
  let best: { i: number; d: number } | null = null;
  (holds ?? []).forEach((h, i) => {
    const b = holdBox(h);
    const d = Math.hypot(Math.max(b.x - q.x, 0, q.x - b.x - b.w), Math.max(b.y - q.y, 0, q.y - b.y - b.h));
    if (d <= slack && (!best || d < best.d)) best = { i, d };
  });
  if (best) return { kind: 'hold', i: (best as { i: number }).i };
  const part = parts.find(p => q.x >= p.x && q.x <= p.x + p.w && q.y >= p.y && q.y <= p.y + p.h);
  return part ? { kind: 'part', id: part.id } : null;
}
