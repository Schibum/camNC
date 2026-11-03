import { cn } from '@wbcnc/ui/lib/utils';
import type { BoardNest, PartInstance, PartPosition } from '../boards';
import type { CamPartInfo, PlanResult } from '../camTypes';
import { place, toD } from './outline';

/** Where a dragged part would land on this board; `fits` false: it fits nowhere, drawn in red at the pointer. */
export interface NestPreview {
  item: string;
  at: PartPosition;
  fits: boolean;
}

/**
 * Top view of a board: its parts at their nested positions (outline, pockets, holes), clamp keep-outs, tabs from the
 * generated program, XY zero at the lower left. Y up, like the machine. With `pxPerMm`, drawn at that scale (so
 * several boards can share one); `unit` then sets the padding, line and text size for all of them.
 */
export function NestView({
  nest,
  instances,
  parts,
  plan,
  tabHeight,
  selectedPart,
  className,
  unit,
  pxPerMm,
  dragging,
  preview,
  label,
  onPartPointerDown,
  onPartKeyDown,
  onPartFocus,
}: {
  nest: BoardNest;
  instances: PartInstance[];
  parts: CamPartInfo[];
  plan?: PlanResult;
  tabHeight?: number;
  selectedPart?: string | null;
  className?: string;
  /** Reference size in mm for padding, lines and text; default the board's longer side. */
  unit?: number;
  pxPerMm?: number;
  /** The body being dragged out of this board: drawn faint. */
  dragging?: string | null;
  preview?: NestPreview | null;
  label?: string;
  /** Start dragging a body (instance id). */
  onPartPointerDown?: (item: string, e: React.PointerEvent) => void;
  /** Arrow keys on a focused body. */
  onPartKeyDown?: (item: string, e: React.KeyboardEvent) => void;
  onPartFocus?: (item: string) => void;
}) {
  const { w, h } = nest.board;
  const u = unit ?? Math.max(w, h);
  const pad = u * 0.05;
  const stroke = u / 600;
  const byInst = new Map(instances.map(i => [i.id, i]));
  const byPart = new Map(parts.map(p => [p.id, p]));
  const tabSegments =
    tabHeight !== undefined && plan
      ? plan.path.filter(([a, b]) => Math.abs(a[2] - tabHeight) < 1e-3 && Math.abs(b[2] - tabHeight) < 1e-3)
      : [];
  const interactive = !!onPartPointerDown;
  const previewInst = preview && byInst.get(preview.item);
  const previewPart = previewInst && byPart.get(previewInst.partId);
  return (
    <svg
      viewBox={`${-pad} ${-h - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      width={pxPerMm && (w + 2 * pad) * pxPerMm}
      height={pxPerMm && (h + 2 * pad) * pxPerMm}
      className={className}
      role={interactive ? 'group' : 'img'}
      aria-label={label ?? `Board ${w} by ${h} mm with ${nest.placements.length} parts`}>
      <g transform="scale(1,-1)" data-board-frame>
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          className="fill-amber-700/15 stroke-muted-foreground dark:fill-amber-400/10"
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
              data-item={p.id}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? `${inst.name}: drag, or move with the arrow keys` : undefined}
              onPointerDown={onPartPointerDown && (e => onPartPointerDown(p.id, e))}
              onKeyDown={onPartKeyDown && (e => onPartKeyDown(p.id, e))}
              onFocus={onPartFocus && (() => onPartFocus(p.id))}
              className={cn(
                interactive && 'cursor-grab outline-none active:cursor-grabbing [&:focus-visible>path:first-child]:stroke-primary',
                dragging === p.id && 'opacity-30'
              )}>
              <path
                d={toD(part.shape.outlines, f)}
                className={
                  selected
                    ? 'fill-violet-500/25 stroke-violet-500'
                    : 'fill-amber-600/30 stroke-violet-500 dark:fill-amber-400/40 dark:stroke-violet-400'
                }
                strokeWidth={stroke * 1.5}
              />
              {part.shape.pockets.map(pk => (
                <path key={pk.depth} d={toD(pk.region, f)} className="fill-violet-600/70 dark:fill-violet-500/80" fillRule="evenodd" />
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
            className="stroke-amber-600 dark:stroke-amber-500"
            strokeWidth={stroke * 5}
            strokeLinecap="square"
          />
        ))}
        {/* Tabs that hold nothing (the stock beyond them is too narrow): a red ring on each. */}
        {plan?.hold?.flatMap(h =>
          h.tabs
            .filter(t => !t.anchored)
            .map((t, i) => (
              <circle
                key={`${h.part}-${i}`}
                cx={t.at.x}
                cy={t.at.y}
                r={stroke * 9}
                className="fill-none stroke-red-600 dark:stroke-red-500"
                strokeWidth={stroke * 2.5}>
                <title>{`${h.part}: this tab holds nothing`}</title>
              </circle>
            ))
        )}
        {preview && previewInst && previewPart && (
          <path
            data-preview={preview.fits ? 'fits' : 'no-room'}
            d={toD(previewPart.shape.outlines, place(preview.at, previewInst.size))}
            className={cn('pointer-events-none', preview.fits ? 'fill-primary/20 stroke-primary' : 'fill-red-500/15 stroke-red-500')}
            strokeWidth={stroke * 2.5}
            strokeDasharray={preview.fits ? `${stroke * 8} ${stroke * 5}` : undefined}
          />
        )}
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
            fontSize={u / 45}
            className={cn('pointer-events-none fill-foreground', dragging === p.id && 'opacity-30')}>
            {inst.name}
          </text>
        );
      })}
      <text x={0} y={pad * 0.8} fontSize={u / 50} className="pointer-events-none fill-emerald-700 dark:fill-emerald-400">
        XY zero · lower left
      </text>
    </svg>
  );
}
