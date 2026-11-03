import { create } from 'zustand';

/**
 * The body being dragged between boards, from a chip in the board list (HTML5 drag) or a part in the nest view
 * (pointer drag, works with touch). Boards highlight as drop targets while it's set.
 */
export const useBoardDrag = create<{
  item: string | null;
  thickness: number | null;
  /** Pointer drags only: where to draw the floating label. */
  pos: { x: number; y: number } | null;
  start: (item: string, thickness: number, pos?: { x: number; y: number }) => void;
  move: (pos: { x: number; y: number }) => void;
  end: () => void;
}>(set => ({
  item: null,
  thickness: null,
  pos: null,
  start: (item, thickness, pos) => set({ item, thickness, pos: pos ?? null }),
  move: pos => set({ pos }),
  end: () => set({ item: null, thickness: null, pos: null }),
}));

export const kDragType = 'application/x-camnc-board-item';

/** Where a pointer drag ended: a board card, the "new board" zone, or nowhere. */
export function dropTargetAt(x: number, y: number): { board: string } | { newBoard: true } | null {
  const el = document.elementFromPoint(x, y);
  const board = el?.closest<HTMLElement>('[data-board-drop]')?.dataset.boardDrop;
  if (board) return { board };
  if (el?.closest('[data-new-board-drop]')) return { newBoard: true };
  return null;
}
