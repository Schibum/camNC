import { kColletClearance, kHoldClearance, nutReaches, pathClearance, type HoldKind } from '@wbcnc/cam/holdPoints';
import { useId } from 'react';

const fmt = (v: number) => `${+v.toFixed(1)}`;

/** The collet nut in the drawing (mm): its radius (the clearance less the margin past it) and height. */
const kNutR = kColletClearance - kHoldClearance,
  kNutH = 9;

/**
 * A side view at the board's edge, to scale: the hold and the bit in its collet nut and spindle at the deepest cut, each
 * number on what it measures. It is redrawn from the numbers, so changing a field moves what it means.
 */
export function HoldDiagram({
  hold,
  bit,
  stockTop,
  nutAbove,
  stickout,
}: {
  hold: { kind: HoldKind; d: number; w?: number; height: number };
  bit: number;
  stockTop: number;
  nutAbove: number;
  stickout: number;
}) {
  const arrow = useId();
  const clamp = hold.kind === 'clamp';
  const h = { ...hold, nutAbove };
  const r = bit / 2;
  const keep = pathClearance(h, r);
  const nut = nutReaches(h);
  const cut = stockTop + 0.3;

  // In mm, x from the board's edge inwards and y up from the board's top.
  const reach = clamp ? hold.d : hold.d + 2;
  const bitC = reach + keep;
  const body = clamp ? -10 : 0;
  const spindleH = 10;
  const xMin = Math.min(body, 0) - 4,
    xMax = bitC + kNutR + 2;
  const yMin = -cut - 3,
    yMax = Math.max(hold.height, nutAbove + kNutH + spindleH, 0);
  // One scale for both directions, so the clearances look as they are; room left for the labels around it.
  const left = 34,
    right = 92,
    head = 30,
    foot = 8,
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
  const marker = `url(#${CSS.escape(arrow)})`;
  // The names and the stick-out beside the bit, kept apart from each other however short it is.
  const side = [
    { y: (Y(yMax) + nutHigh) / 2, text: 'spindle', strong: false },
    { y: (nutHigh + nutLow) / 2, text: 'collet nut', strong: nut },
    { y: (nutLow + tip) / 2, text: `stick-out ${fmt(stickout)}`, strong: false },
    { y: tip, text: `bit ⌀${fmt(bit)}`, strong: false },
  ];
  for (let k = 1; k < side.length; k++) side[k].y = Math.max(side[k].y, side[k - 1].y + 12);
  const sideX = nutR + 10;

  return (
    <figure className="flex flex-col gap-1" aria-label={`What the ${clamp ? 'clamp' : 'screw'} sizes mean`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        <title>{`Side view at the board's edge, to scale: the ${clamp ? 'clamp' : 'screw'} and the bit with its collet nut at the deepest cut.`}</title>
        <defs>
          <marker id={arrow} viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
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
          height={Math.max(0, nutHigh - Y(yMax))}
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
          height={Math.max(0, tip - nutLow)}
          className="fill-sky-600/80 dark:fill-sky-400/80"
        />

        <g className={dim} strokeWidth={0.75} fill="none">
          {/* Along the top: reach (or head) and the clearance to the bit's centre. */}
          <path
            d={`M${X(0)},${dimY - 4} V${top} M${X(reach)},${dimY - 4} V${Math.min(holdTop, top)} M${X(bitC)},${dimY - 4} V${Y(yMax)}`}
            strokeDasharray="2 2"
          />
          <path d={`M${X(0)},${dimY} H${X(reach)}`} markerStart={marker} markerEnd={marker} />
          <path d={`M${X(reach)},${dimY} H${X(bitC)}`} markerStart={marker} markerEnd={marker} />
          {/* Left: the hold's height over the board. Right: stick-out, from the nut to the tip. */}
          {hold.height > 0 && <path d={`M${X(xMin) - 4},${holdTop} V${top}`} markerStart={marker} markerEnd={marker} />}
          <path d={`M${nutR + 5},${nutLow} V${tip}`} markerStart={marker} markerEnd={marker} />
        </g>
        {/* Either side of the line between them, so they never run into each other, however small the reach. */}
        <text x={X(reach) - 3} y={dimY - 6} textAnchor="end" className={label}>
          {clamp ? `reach ${fmt(hold.d)}` : `⌀${fmt(hold.d)}+2`}
        </text>
        <text x={X(reach) + 3} y={dimY - 6} textAnchor="start" className={label}>
          {nut ? `nut room ${fmt(keep)}` : fmt(keep)}
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
      {clamp && (
        <svg viewBox="0 0 320 40" className="w-full" role="img">
          <title>{`From above: a clamp ${fmt(hold.w ?? 0)} mm wide along the board's edge.`}</title>
          {/* From above, not to scale: the board's edge at the top, the clamp's toe on it. */}
          <rect x={0} y={14} width={320} height={26} className="fill-amber-200/60 dark:fill-amber-900/40" />
          <rect x={92} y={14} width={36} height={10} className="fill-rose-800/70 dark:fill-rose-400/60" />
          <path d="M92,7 H128" className={dim} strokeWidth={0.75} fill="none" markerStart={marker} markerEnd={marker} />
          <text x={133} y={10} className={label}>
            {`width ${fmt(hold.w ?? 0)}`}
          </text>
        </svg>
      )}
      {nutAbove < 0 && (
        <p role="alert" className="text-xs leading-relaxed text-destructive">
          {`The stick-out (${fmt(stickout)} mm) is shorter than the deepest cut (${fmt(cut)} mm): the collet nut would hit the board. Mount the bit further out, or check the stick-out.`}
        </p>
      )}
      <figcaption className="text-xs leading-relaxed text-muted-foreground">
        {nut
          ? `The ${clamp ? 'clamp' : 'screw'} stands ${fmt(hold.height)} mm over the board and the collet nut comes down to ${fmt(nutAbove)} mm over the board on the deepest cut (stick-out ${fmt(stickout)} less ${fmt(cut)}), so cuts keep ${fmt(keep)} mm from it for the nut.`
          : `The collet nut stays ${fmt(nutAbove - hold.height)} mm above the ${clamp ? 'clamp' : 'screw'} even on the deepest cut, so only the bit needs room: its radius + ${kHoldClearance} mm.`}
      </figcaption>
    </figure>
  );
}
