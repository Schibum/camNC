import { withLayout, type BoardNest, type BoardV1 } from '@/cam/boards';

/** A fitted board fixed at its size, with its parts stored where the plan has them: the copy can't pack them differently. */
export function freezeRehearsalBoard(board: BoardV1, nest: BoardNest): BoardV1 {
  if (!board.size.fit) return { ...board };
  return {
    ...withLayout(board, nest),
    size: { fit: false, ...nest.board },
    gap: nest.gap,
    margin: nest.margin,
    pinned: nest.placements.map(p => p.id),
  };
}
