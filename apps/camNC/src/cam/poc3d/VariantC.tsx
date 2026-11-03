import type { PocBoard } from './usePocBoard';

/** THROWAWAY concept C: placeholder until built. */
export function VariantC({ board }: { board: PocBoard }) {
  return (
    <div className="p-6 text-sm">
      Variant C: {board.ops.length} operations, {board.toolpath.pathPoints.length} toolpath points.
      <ul className="mt-2 list-disc pl-5">
        {board.ops.map(o => (
          <li key={o.index}>
            {o.label} ({o.from}–{o.to})
          </li>
        ))}
      </ul>
    </div>
  );
}
