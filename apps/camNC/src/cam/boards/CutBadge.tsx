import { cutLabel, isCut, type BoardV1 } from '../boards';

/** "Cut" or "Partly cut": the board's programs ran at the machine, its layout and holds are kept. */
export function CutBadge({ board }: { board: Pick<BoardV1, 'cut'> }) {
  if (!isCut(board)) return null;
  return (
    <span
      title="Programs of this board ran at the machine: its parts and holds stay as they were cut."
      className="ml-1.5 inline-block rounded-full bg-amber-500/15 px-1.5 py-px align-middle text-[11px] font-medium text-amber-700 dark:text-amber-400">
      {cutLabel(board)}
    </span>
  );
}
