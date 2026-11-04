import { frameMargin, kColletClearance, kHoldClearance, nutReaches, pathClearance, type HoldKind } from '@wbcnc/cam/holdPoints';

const fmt = (v: number) => `${+v.toFixed(1)}`;

/** The collet nut in the drawing (mm): its radius (the clearance less the margin past it) and height. */
const kNutR = kColletClearance - kHoldClearance,
  kNutH = 9;

/**
 * A side view at the board's edge, to scale: the hold, the frame it needs, and the bit in its collet nut and spindle
 * at the deepest cut. It is redrawn from the board's numbers, so changing a field moves what it means.
 */
export function HoldDiagram({
  hold,
  bit,
  stockTop,
  nutAbove,
}: {
  hold: { kind: HoldKind; d: number; w?: number; height: number; stickout: number; spacing: number };
  bit: number;
  stockTop: number;
  nutAbove: number;
}) {
  const clamp = hold.kind === 'clamp';
  const h = { ...hold, nutAbove };
  const r = bit / 2;
  const keep = pathClearance(h, r);
  const nut = nutReaches(h);
  const margin = frameMargin(hold.d, bit, hold.kind, hold.height, nutAbove);
  const cut = stockTop + 0.3;

  // In mm, x from the board's edge inwards and y up from the board's top.
  const reach = clamp ? hold.d : hold.d + 2;
  const bitC = reach + keep;
  const body = clamp ? -10 : 0;
  const spindleH = 10;
  const xMin = Math.min(body, 0) - 4,
    xMax = Math.max(margin, bitC + kNutR) + 2;
  const yMin = -cut - 3,
    yMax = Math.max(hold.height, nutAbove + kNutH + spindleH, 0);
  // One scale for both directions, so the clearances look as they are; room left for the labels around it.
  const left = 34,
    right = 92,
    head = 30,
    foot = 34,
    W = 320;
  const s = Math.min((W - left - right) / (xMax - xMin), 150 / (yMax - yMin));
  const X = (x: number) => left + (x - xMin) * s;
  const Y = (y: number) => head + (yMax - y) * s;
  const H = head + (yMax - yMin) * s + foot;

  const top = Y(0),
    bottom = Y(-stockTop),
    tip = Y(-cut);
  const holdTop = Y(hold.height);
  const nutLow = Y(nutAbove),
    nutHigh = Y(nutAbove + kNutH);
  const nutL = X(bitC - kNutR),
    nutR = X(bitC + kNutR);
  const dimY = 18;
  const dim = 'stroke-muted-foreground';
  const label = 'fill-muted-foreground text-[11px]';
  // The names and the stick-out beside the bit, kept apart from each other however short it is.
  const side = [
    { y: (Y(yMax) + nutHigh) / 2, text: 'spindle', strong: false },
    { y: (nutHigh + nutLow) / 2, text: 'collet nut', strong: nut },
    { y: (nutLow + tip) / 2, text: `stick-out ${fmt(hold.stickout)}`, strong: false },
    { y: tip, text: `bit ⌀${fmt(bit)}`, strong: false },
  ];
  for (let k = 1; k < side.length; k++) side[k].y = Math.max(side[k].y, side[k - 1].y + 12);
  const sideX = nutR + 10;

  return (
    <figure className="flex flex-col gap-1" aria-label="What the hold settings mean">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[360px]" role="img">
        <title>{`Side view at the board's edge, to scale: the ${clamp ? 'clamp' : 'screw'}, the frame of ${margin} mm it needs, and the bit with its collet nut at the deepest cut.`}</title>
        <defs>
          <marker id="hold-dim-arrow" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L6,3 L0,6 Z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {/* Spoilboard and board. */}
        <rect x={0} y={bottom} width={W} height={Y(yMin) - bottom} className="fill-muted" />
        <rect
          x={X(0)}
          y={top}
          width={W - X(0)}
          height={bottom - top}
          className="fill-amber-200/60 stroke-amber-700/50 dark:fill-amber-900/40"
        />
        {/* The hold. */}
        {clamp ? (
          <path
            d={`M${X(body)},${bottom} V${holdTop} H${X(hold.d)} V${top} H${X(0)} V${bottom} Z`}
            className="fill-rose-800/70 stroke-rose-900 dark:fill-rose-400/60"
          />
        ) : (
          <rect x={X(1)} y={holdTop} width={hold.d * s} height={Math.max(1, top - holdTop)} rx={1} className="fill-foreground/70" />
        )}
        {/* Spindle (its nose, narrower than the nut), collet nut and bit, the bit at the deepest cut. */}
        <rect
          x={X(bitC - kNutR + 2)}
          y={Y(yMax)}
          width={(2 * kNutR - 4) * s}
          height={nutHigh - Y(yMax)}
          className="fill-slate-300 stroke-slate-500 dark:fill-slate-700"
        />
        <rect
          x={nutL}
          y={nutHigh}
          width={nutR - nutL}
          height={nutLow - nutHigh}
          rx={2}
          className={nut ? 'fill-red-600/80 dark:fill-red-500/80' : 'fill-slate-500 dark:fill-slate-400'}
        />
        <rect
          x={X(bitC - r)}
          y={nutLow}
          width={Math.max(1, bit * s)}
          height={tip - nutLow}
          className="fill-sky-600/80 dark:fill-sky-400/80"
        />

        <g className={dim} strokeWidth={0.75} fill="none">
          {/* Along the top: reach (or head) and the clearance to the bit's centre. */}
          <path
            d={`M${X(0)},${dimY - 4} V${top} M${X(reach)},${dimY - 4} V${Math.min(holdTop, top)} M${X(bitC)},${dimY - 4} V${Y(yMax)}`}
            strokeDasharray="2 2"
          />
          <path d={`M${X(0)},${dimY} H${X(reach)}`} markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
          <path d={`M${X(reach)},${dimY} H${X(bitC)}`} markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
          {/* Below: the frame. */}
          <path d={`M${X(margin)},${top} V${Y(yMin) + 14}`} strokeDasharray="2 2" />
          <path d={`M${X(0)},${Y(yMin) + 10} H${X(margin)}`} markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
          {/* Left: the hold's height over the board. Right: stick-out, from the nut to the tip. */}
          {hold.height > 0 && (
            <path d={`M${X(xMin) - 4},${holdTop} V${top}`} markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
          )}
          <path d={`M${nutR + 5},${nutLow} V${tip}`} markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
        </g>
        {/* Either side of the line between them, so they never run into each other, however small the reach. */}
        <text x={X(reach) - 3} y={dimY - 6} textAnchor="end" className={label}>
          {clamp ? `reach ${fmt(hold.d)}` : `⌀${fmt(hold.d)}+2`}
        </text>
        <text x={X(reach) + 3} y={dimY - 6} textAnchor="start" className={label}>
          {nut ? `nut room ${fmt(keep)}` : fmt(keep)}
        </text>
        <text x={(X(0) + X(margin)) / 2} y={Y(yMin) + 24} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
          frame {margin} mm
        </text>
        <text x={X(xMin) - 8} y={(holdTop + top) / 2 + 4} textAnchor="end" className={label}>
          {fmt(hold.height)}
        </text>
        {side.map(l => (
          <text key={l.text} x={sideX} y={l.y + 4} className={l.strong ? 'fill-destructive text-[11px] font-medium' : label}>
            {l.text}
          </text>
        ))}
      </svg>
      <svg viewBox="0 0 320 66" className="w-full max-w-[360px]" role="img">
        <title>{`From above: ${clamp ? `clamps ${fmt(hold.w ?? 0)} mm wide, ` : 'screws '}at most ${fmt(hold.spacing)} mm apart along each edge.`}</title>
        {/* From above, not to scale: the board's edge at the top, two holds along it, the parts inside. */}
        <rect x={0} y={14} width={320} height={52} className="fill-amber-200/60 dark:fill-amber-900/40" />
        <rect x={0} y={44} width={320} height={22} className="fill-muted-foreground/25" />
        {[70, 210].map(c =>
          clamp ? (
            <rect key={c} x={c - 18} y={14} width={36} height={10} className="fill-rose-800/70 dark:fill-rose-400/60" />
          ) : (
            <circle key={c} cx={c} cy={22} r={6} className="fill-foreground/70" />
          )
        )}
        <g className={dim} strokeWidth={0.75} fill="none">
          <path d="M70,34 H210" markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />
          {clamp && <path d="M192,7 H228" markerStart="url(#hold-dim-arrow)" markerEnd="url(#hold-dim-arrow)" />}
        </g>
        <text x={140} y={58} textAnchor="middle" className={label}>
          {`spacing ${fmt(hold.spacing)} at most`}
        </text>
        {clamp && (
          <text x={233} y={10} className={label}>
            {`width ${fmt(hold.w ?? 0)}`}
          </text>
        )}
        <text x={4} y={58} className={label}>
          parts
        </text>
      </svg>
      {nutAbove < 0 && (
        <p role="alert" className="text-xs leading-relaxed text-destructive">
          {`The stick-out (${fmt(hold.stickout)} mm) is shorter than the deepest cut (${fmt(stockTop + 0.3)} mm): the collet nut would hit the board. Mount the bit further out, or check the stick-out.`}
        </p>
      )}
      <figcaption className="text-xs leading-relaxed text-muted-foreground">
        {nut
          ? `The ${clamp ? 'clamp' : 'screw'} stands ${fmt(hold.height)} mm over the board and the collet nut comes down to ${fmt(nutAbove)} mm over the board on the deepest cut (stick-out ${fmt(hold.stickout)} less ${fmt(stockTop + 0.3)}), so cuts keep ${fmt(keep)} mm from it for the nut.`
          : `The collet nut stays ${fmt(nutAbove - hold.height)} mm above the ${clamp ? 'clamp' : 'screw'} even on the deepest cut, so only the bit needs room: its radius + ${kHoldClearance} mm.`}{' '}
        {`Frame = ${clamp ? `${fmt(hold.d)} reach` : `${fmt(hold.d)} head + 2 stock`} + ${fmt(keep)} + ${fmt(bit / 2)} bit radius + 1, rounded up.`}
      </figcaption>
    </figure>
  );
}
