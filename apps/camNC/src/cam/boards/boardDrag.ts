import { create } from 'zustand';

/**
 * The body being dragged between boards, from a chip in the board list (HTML5 drag) or its outline in a board drawing
 * (pointer drag, works with touch). Boards highlight as drop targets while it's set.
 */
export const useBoardDrag = create<{
  item: string | null;
  thickness: number | null;
  start: (item: string, thickness: number) => void;
  end: () => void;
}>(set => ({
  item: null,
  thickness: null,
  start: (item, thickness) => set({ item, thickness }),
  end: () => set({ item: null, thickness: null }),
}));

export const kDragType = 'application/x-camnc-board-item';
