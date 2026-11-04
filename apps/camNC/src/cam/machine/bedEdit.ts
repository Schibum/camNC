import { edgeDir, holdClashes, snapClamp, type HoldPoint } from '@wbcnc/cam/holdPoints';
import { create } from 'zustand';
import type { BedSpot, BoardV1 } from '../boards';

type P2 = { x: number; y: number };

/** What a tap or drag on the board in the top view does: move a hold, add one, remove one. */
export type BedEditMode = 'move' | 'add' | 'remove';

/** A change to a board made in the top view, as the board's new fields. */
export type BoardPatch = Partial<Pick<BoardV1, 'holdPoints' | 'holdPointsOn' | 'bed' | 'size' | 'positions' | 'pinned'>>;

export interface BedEdit {
  boardId: string;
  /** What it does, for the toast and Undo: "Clamp 2 moved". */
  what: string;
  patch: BoardPatch;
}

/**
 * Edits in the machine's top view: the mode, what can be undone, and where an edit goes. The overlay draws in the 3D
 * canvas; the job is saved outside it (`CamBedEditor` registers `apply`).
 */
export const useBedEdit = create<{
  mode: BedEditMode;
  setMode: (mode: BedEditMode) => void;
  /** Saves an edit to the job; set while the top view shows a CAM job. */
  apply: ((edit: BedEdit) => void) | null;
  setApply: (apply: ((edit: BedEdit) => void) | null) => void;
}>(set => ({
  mode: 'move',
  setMode: mode => set({ mode }),
  apply: null,
  setApply: apply => set({ apply }),
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
  return { boardId: board.id, what: 'Board placed', patch: { bed: { ...board.bed, [side]: { x: round(at.x), y: round(at.y) } } } };
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
