import type { BoardNest, BoardV1 } from '@/cam/boards';

/** Fix a fitted board's size without asking the fixed-size packer to choose a different layout on bootstrap. */
export function freezeRehearsalBoard(board: BoardV1, nest: BoardNest): BoardV1 {
  if (!board.size.fit) return { ...board };
  return {
    ...board,
    size: { fit: false, ...nest.board },
    gap: nest.gap,
    margin: nest.margin,
    frame: nest.frame === 'kept',
    positions: Object.fromEntries(nest.placements.map(({ id, x, y, rotated }) => [id, { x, y, rotated }])),
    pinned: nest.placements.map(p => p.id),
  };
}
