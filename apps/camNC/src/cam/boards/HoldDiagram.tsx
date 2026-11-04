import { frameMargin, kHoldClearance, nutReaches, pathClearance, type HoldKind } from '@wbcnc/cam/holdPoints';

const fmt = (v: number) => `${+v.toFixed(1)}`;

/**
 * A side view at the board's edge, not to scale: the hold, the frame it needs, and the bit with its collet nut at the
 * deepest cut. Each length is labelled with the board's numbers, so the fields above read as what they are.
 */
export function HoldDiagram({
  hold,
  bit,
  stockTop,
  nutAbove,
}: {
  hold: { kind: HoldKind; d: number; height: number; stickout: number };
  bit: number;
  stockTop: number;
  nutAbove: number;
}) {
  const clamp = hold.kind === 'clamp';
  const h = { ...hold, nutAbove };
  const keep = pathClearance(h, bit / 2);
  const nut = nutReaches(h);
  const margin = frameMargin(hold.d, bit, hold.kind, hold.height, nutAbove);

  // Drawing frame (px), not to scale: the board's top at y = 92, its edge at x = 48.
  const top = 92,
    bottom = 118,
    edge = 48;
  const holdTop = clamp ? 46 : 84;
  const reachX = edge + (clamp ? 34 : 30);
  const bitX = reachX + (nut ? 64 : 30);
  const bitW = 8;
  const marginX = bitX + bitW / 2 + 10;
  const nutW = 34;
  const tip = bottom + 3;
  // The nut's bottom: beside the clamp when it comes down that low, well above it when not.
  const nutBottom = nut ? holdTop + 12 : holdTop - 16;
  const dimY = 22;
  const dim = 'stroke-muted-foreground';
  const label = 'fill-muted-foreground text-[11px]';

  return (
    <figure className="flex flex-col gap-1" aria-label="What the hold settings mean">
      <svg viewBox="0 0 320 168" className="w-full max-w-[360px]" role="img">
        <title>{`Side view at the board's edge: the ${clamp ? 'clamp' : 'screw'}, the frame of ${margin} mm it needs, and the bit with its collet nut.`}</title>
        <defs>
          <marker id="hold-dim-arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L6,3 L0,6 Z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {/* Spoilboard and board. */}
        <rect x={0} y={bottom} width={320} height={8} className="fill-muted" />
        <rect x={edge} y={top} width={272} height={bottom - top} className="fill-amber-200/60 stroke-amber-700/50 dark:fill-amber-900/40" />
        {/* The hold. */}
        {clamp ? (
          <path
            d={`M${edge - 16},${bottom} V${holdTop} H${reachX} V${top} H${edge} V${holdTop + 10} H${edge - 7} V${bottom} Z`}
            className="fill-rose-800/70 stroke-rose-900 dark:fill-rose-400/60"
          />
        ) : (
          <rect x={edge + 8} y={holdTop} width={reachX - edge - 8} height={top - holdTop} rx={2} className="fill-foreground/70" />
        )}
        {/* Bit, collet nut and shank. */}
        <rect x={bitX - bitW / 2} y={nutBottom} width={bitW} height={tip - nutBottom} className="fill-slate-400 dark:fill-slate-500" />
        <rect x={bitX - nutW / 2} y={nutBottom - 16} width={nutW} height={16} rx={3} className="fill-slate-600 dark:fill-slate-400" />
        <rect x={bitX - 9} y={nutBottom - 34} width={18} height={18} className="fill-slate-500/60" />

        <g className={dim} strokeWidth={0.75} fill="none">
          {/* Along the top: reach (or head) and the clearance to the bit's centre. */}
          <path
            d={`M${edge},${dimY - 4} V${top} M${reachX},${dimY - 4} V${holdTop - 2} M${bitX},${dimY - 4} V${nutBottom - 36}`}
            strokeDasharray="2 2"
          />
          <path d={`M${edge},${dimY} H${reachX}`} markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
          <path d={`M${reachX},${dimY} H${bitX}`} markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
          {/* Below: the frame. */}
          <path d={`M${marginX},${bottom - 6} V${bottom + 22}`} strokeDasharray="2 2" />
          <path d={`M${edge},${bottom + 18} H${marginX}`} markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
          {/* Left: the hold's height over the board. Right: stick-out. */}
          <path d={`M${edge - 26},${holdTop} V${top}`} markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
          <path d={`M${bitX + nutW / 2 + 8},${nutBottom} V${tip}`} markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
        </g>
        <text x={(edge + reachX) / 2} y={dimY - 6} textAnchor="middle" className={label}>
          {clamp ? `reach ${fmt(hold.d)}` : `⌀${fmt(hold.d)}+2`}
        </text>
        <text x={(reachX + bitX) / 2} y={dimY - 6} textAnchor="middle" className={label}>
          {nut ? `nut room ${fmt(keep)}` : fmt(keep)}
        </text>
        <text x={(edge + marginX) / 2} y={bottom + 32} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
          frame {margin} mm
        </text>
        <text x={edge - 30} y={(holdTop + top) / 2 + 3} textAnchor="end" className={label}>
          {fmt(hold.height)}
        </text>
        <text x={bitX + nutW / 2 + 12} y={nutBottom + 10} className={label}>
          stick-out {fmt(hold.stickout)}
        </text>
        <text x={bitX + nutW / 2 + 12} y={nutBottom + 22} className={label}>
          deepest cut {fmt(stockTop + 0.3)}
        </text>
      </svg>
      <figcaption className="text-xs leading-relaxed text-muted-foreground">
        {nut
          ? `The ${clamp ? 'clamp' : 'screw'} stands ${fmt(hold.height)} mm over the board and the collet nut comes down to ${fmt(nutAbove)} mm over the board on the deepest cut (stick-out ${fmt(hold.stickout)} less ${fmt(stockTop + 0.3)}), so cuts keep ${fmt(keep)} mm from it for the nut.`
          : `The collet nut stays ${fmt(nutAbove - hold.height)} mm above the ${clamp ? 'clamp' : 'screw'} even on the deepest cut, so only the bit needs room: its radius + ${kHoldClearance} mm.`}{' '}
        {`Frame = ${clamp ? `${fmt(hold.d)} reach` : `${fmt(hold.d)} head + 2 stock`} + ${fmt(keep)} + ${fmt(bit / 2)} bit radius + 1, rounded up.`}
      </figcaption>
    </figure>
  );
}
