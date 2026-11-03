import type { BoardNest, PartInstance } from '../boards';
import type { CamPartInfo, Outline2D, PlanResult } from '../camTypes';

/** Part frame -> board frame, as in @wbcnc/cam partToBoard. */
const place = (p: { x: number; y: number; rotated: boolean }, size: number[]) => (q: [number, number]) =>
  p.rotated ? [p.x + size[1] - q[1], p.y + q[0]] : [p.x + q[0], p.y + q[1]];

const toD = (paths: Outline2D, f: (q: [number, number]) => number[]) =>
  paths
    .map(
      path =>
        `M${path
          .map(q =>
            f(q)
              .map(v => v.toFixed(1))
              .join(',')
          )
          .join('L')}Z`
    )
    .join('');

/**
 * Top view of a board: its parts at their nested positions (outline, pockets, holes), clamp keep-outs, tabs from the
 * generated program, XY zero at the lower left. Y up, like the machine.
 */
export function NestView({
  nest,
  instances,
  parts,
  plan,
  tabHeight,
  selectedPart,
  className,
  onPartPointerDown,
}: {
  nest: BoardNest;
  instances: PartInstance[];
  parts: CamPartInfo[];
  plan?: PlanResult;
  tabHeight?: number;
  selectedPart?: string | null;
  className?: string;
  /** Start dragging a body (instance id) to another board. */
  onPartPointerDown?: (item: string, e: React.PointerEvent) => void;
}) {
  const { w, h } = nest.board;
  const pad = Math.max(w, h) * 0.05;
  const stroke = Math.max(w, h) / 600;
  const byInst = new Map(instances.map(i => [i.id, i]));
  const byPart = new Map(parts.map(p => [p.id, p]));
  const tabSegments =
    tabHeight !== undefined && plan
      ? plan.path.filter(([a, b]) => Math.abs(a[2] - tabHeight) < 1e-3 && Math.abs(b[2] - tabHeight) < 1e-3)
      : [];
  return (
    <svg
      viewBox={`${-pad} ${-h - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      className={className}
      role="img"
      aria-label={`Board ${w} by ${h} mm with ${nest.placements.length} parts`}>
      <g transform="scale(1,-1)">
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          className="fill-amber-700/15 stroke-muted-foreground"
          strokeWidth={stroke}
          strokeDasharray={`${stroke * 6} ${stroke * 4}`}
        />
        {nest.keepOuts.map((k, i) => (
          <rect key={i} x={k.x} y={k.y} width={k.w} height={k.h} className="fill-red-500/20" />
        ))}
        {nest.placements.map(p => {
          const inst = byInst.get(p.id);
          const part = inst && byPart.get(inst.partId);
          if (!inst || !part) return null;
          const f = place(p, inst.size);
          const selected = inst.partId === selectedPart;
          return (
            <g
              key={p.id}
              data-part={inst.name}
              onPointerDown={onPartPointerDown && (e => onPartPointerDown(p.id, e))}
              className={onPartPointerDown ? 'cursor-grab active:cursor-grabbing' : undefined}>
              <path
                d={toD(part.shape.outlines, f)}
                className={selected ? 'fill-violet-500/25 stroke-violet-500' : 'fill-amber-600/30 stroke-violet-400'}
                strokeWidth={stroke * 1.5}
              />
              {part.shape.pockets.map(pk => (
                <path key={pk.depth} d={toD(pk.region, f)} className="fill-violet-600/70" fillRule="evenodd" />
              ))}
              <path d={toD(part.shape.holes, f)} className="fill-background" />
            </g>
          );
        })}
        {tabSegments.map(([a, b], i) => (
          <line
            key={i}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            className="stroke-amber-500"
            strokeWidth={stroke * 5}
            strokeLinecap="square"
          />
        ))}
        <circle cx={0} cy={0} r={stroke * 6} className="fill-emerald-500" />
      </g>
      {nest.placements.map(p => {
        const inst = byInst.get(p.id);
        if (!inst) return null;
        const pw = p.rotated ? inst.size[1] : inst.size[0];
        const ph = p.rotated ? inst.size[0] : inst.size[1];
        return (
          <text
            key={p.id}
            x={p.x + pw / 2}
            y={-(p.y + ph / 2)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={Math.max(w, h) / 45}
            className="fill-foreground">
            {inst.name}
          </text>
        );
      })}
      <text x={0} y={pad * 0.8} fontSize={Math.max(w, h) / 50} className="fill-emerald-600">
        XY zero · lower left
      </text>
    </svg>
  );
}
