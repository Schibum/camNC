import { kColletClearance, nutReaches, type HoldKind } from '@wbcnc/cam/holdPoints';

const fmt = (v: number) => `${+v.toFixed(1)}`;

/** The view's size. */
const kW = 300;
const kSideH = 168;
const kPlanH = 62;
/** Room to the left of the board's edge, for the height and its label. */
const kEdgeX = 86;
/** Room under the board for the two dimension rows. */
const kBelow = 34;
/** The collet nut as drawn: ⌀24, this tall, mm. */
const kNutH = 9;
const kNutR = 12;

interface Hold {
  kind: HoldKind;
  d: number;
  w?: number;
  height: number;
  stickout?: number;
  spacing: number;
}

/** A dimension: a line with end ticks, along x or y. */
function Dim({ x1, y1, x2, y2 }: { x1: number; y1: number; x2: number; y2: number }) {
  const across = x1 === x2 ? [3, 0] : [0, 3];
  return (
    <g className="stroke-muted-foreground" strokeWidth={0.75}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x1 - across[0]} y1={y1 - across[1]} x2={x1 + across[0]} y2={y1 + across[1]} />
      <line x1={x2 - across[0]} y1={y2 - across[1]} x2={x2 + across[0]} y2={y2 + across[1]} />
    </g>
  );
}

function Label({ x, y, anchor = 'start', children }: { x: number; y: number; anchor?: 'start' | 'middle' | 'end'; children: string }) {
  return (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
      {children}
    </text>
  );
}

/**
 * The hold settings drawn: from the side (to scale, the bit where the outline really runs) what the reach, height and
 * stick-out are and how they add up to the margin; from above, the width and the spacing.
 */
export function HoldDiagram({ hold, bit, depth, margin }: { hold: Hold; bit: number; depth: number; margin: number }) {
  const clamp = hold.kind === 'clamp';
  const reaches = nutReaches(hold, depth);
  // Not measured: the nut as it's assumed, beside a tall hold and above a low one.
  const stickout = hold.stickout ?? depth + (reaches ? hold.height / 2 : hold.height + 2);
  const r = bit / 2;
  const above = Math.max(hold.height, stickout - depth + kNutH) + 6;
  const scale = Math.min((kSideH - kBelow - 4) / (depth + above), (kW - kEdgeX - 8) / (margin + kNutR + 20));
  const x = (mm: number) => kEdgeX + mm * scale;
  const top = kSideH - kBelow - depth * scale;
  const y = (mm: number) => top - mm * scale;
  const bottom = y(-depth);
  const path = margin - r;
  const nutBottom = y(stickout - depth);
  const tip = y(-depth - 0.3);
  const holdFrom = clamp ? 0 : 2;
  const holdTo = holdFrom + hold.d;
  const label = `Side view: margin ${fmt(margin)} mm, ${clamp ? `reach ${fmt(hold.d)}` : `head ${fmt(hold.d)}`} mm, height ${fmt(hold.height)} mm, stick-out ${
    hold.stickout === undefined ? 'not set' : `${fmt(hold.stickout)} mm`
  }. From above: ${clamp ? `width ${fmt(hold.w ?? 0)} mm, ` : ''}spacing ${fmt(hold.spacing)} mm.`;
  return (
    <figure className="flex flex-col gap-1.5 rounded-md border p-2" data-testid="hold-diagram">
      <svg viewBox={`0 0 ${kW} ${kSideH}`} className="block h-auto w-full" role="img" aria-label={label}>
        {/* The board, cut through at the bit, and the part inside the cut. */}
        <rect x={x(0)} y={top} width={kW - x(0)} height={bottom - top} className="fill-muted" />
        <rect x={x(margin)} y={top} width={kW - x(margin)} height={bottom - top} className="fill-muted-foreground/30" />
        <Label x={kW - 6} y={(top + bottom) / 2} anchor="end">
          part
        </Label>
        <rect x={x(path - r)} y={top} width={bit * scale} height={bottom - top} className="fill-background" />
        <line x1={x(0) - 8} y1={bottom} x2={kW} y2={bottom} className="stroke-muted-foreground" strokeWidth={0.75} />

        {/* The hold: a clamp's toe gripping at the edge, its body past it; a screw's head. */}
        {clamp ? (
          <rect
            x={x(-5)}
            y={y(hold.height)}
            width={(hold.d + 5) * scale}
            height={Math.max(hold.height * scale, 1)}
            className="fill-amber-500/80"
          />
        ) : (
          <>
            <rect
              x={x(holdFrom)}
              y={y(hold.height)}
              width={hold.d * scale}
              height={Math.max(hold.height * scale, 1)}
              className="fill-amber-500/80"
            />
            <rect x={x(holdFrom + hold.d / 2 - 1.5)} y={top} width={3 * scale} height={bottom - top} className="fill-amber-500/50" />
          </>
        )}

        {/* The bit at the outline's path, and the collet nut at the end of its stick-out. */}
        <rect x={x(path - r)} y={nutBottom} width={bit * scale} height={tip - nutBottom} className="fill-foreground/70" />
        <rect
          x={x(path - kNutR)}
          y={nutBottom - kNutH * scale}
          width={2 * kNutR * scale}
          height={kNutH * scale}
          rx={1.5}
          strokeDasharray={hold.stickout === undefined ? '3 2' : undefined}
          strokeWidth={0.75}
          className={reaches ? 'fill-red-500/60 stroke-red-500' : 'fill-foreground/40 stroke-foreground/60'}
        />

        <Dim x1={x(-5) - 8} y1={top} x2={x(-5) - 8} y2={y(hold.height)} />
        <Label x={x(-5) - 13} y={(top + y(hold.height)) / 2} anchor="end">{`Height ${fmt(hold.height)}`}</Label>

        <Dim x1={x(path + kNutR) + 5} y1={tip} x2={x(path + kNutR) + 5} y2={nutBottom} />
        <Label x={x(path + kNutR) + 10} y={Math.max((tip + nutBottom) / 2 - 12, nutBottom + 4)}>
          {hold.stickout === undefined ? 'Stick-out ?' : `Stick-out ${fmt(hold.stickout)}`}
        </Label>

        <Dim x1={x(holdFrom)} y1={bottom + 9} x2={x(holdTo)} y2={bottom + 9} />
        <Label x={x(holdTo) + 5} y={bottom + 9}>{`${clamp ? 'Reach in' : 'Size ⌀'} ${fmt(hold.d)}`}</Label>
        <Dim x1={x(0)} y1={bottom + 24} x2={x(margin)} y2={bottom + 24} />
        <Label x={x(margin) + 5} y={bottom + 24}>{`Margin ${fmt(margin)}`}</Label>
      </svg>

      <svg viewBox={`0 0 ${kW} ${kPlanH}`} className="block h-auto w-full" role="presentation" aria-hidden>
        {/* From above, not to scale: the board's edge at the top, two holds along it, the parts inside. */}
        <rect x={0} y={12} width={kW} height={kPlanH - 12} className="fill-muted" />
        <rect x={0} y={42} width={kW} height={kPlanH - 42} className="fill-muted-foreground/30" />
        {[62, 192].map(c =>
          clamp ? (
            <rect key={c} x={c - 18} y={12} width={36} height={13} className="fill-amber-500/80" />
          ) : (
            <circle key={c} cx={c} cy={19} r={7} className="fill-amber-500/80" />
          )
        )}
        <Dim x1={62} y1={33} x2={192} y2={33} />
        <Label x={127} y={52} anchor="middle">{`Spacing ${fmt(hold.spacing)} at most`}</Label>
        {clamp && (
          <>
            <Dim x1={174} y1={5} x2={210} y2={5} />
            <Label x={215} y={5}>{`Width ${fmt(hold.w ?? 0)}`}</Label>
          </>
        )}
      </svg>

      <figcaption className="text-xs leading-relaxed text-muted-foreground">
        {reaches
          ? `The nut comes down beside the ${clamp ? 'clamp' : 'screw'} (red), so cuts stay ${kColletClearance} mm from it. `
          : `The nut stays above the ${clamp ? 'clamp' : 'screw'}, so only the bit needs room. `}
        {hold.stickout === undefined && 'Measure the stick-out, tip to nut, to get a smaller margin if the nut stays above it.'}
      </figcaption>
    </figure>
  );
}
