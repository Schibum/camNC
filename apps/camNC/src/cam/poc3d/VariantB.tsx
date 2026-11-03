import type { PocBoard } from './usePocBoard';

/** THROWAWAY concept B: placeholder until built. */
export function VariantB({ board }: { board: PocBoard }) {
  return (
    <div className="p-6 text-sm">
      Variant B: {board.ops.length} operations, {board.toolpath.pathPoints.length} toolpath points.
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
