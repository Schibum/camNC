import { cn } from '@wbcnc/ui/lib/utils';
import { useState } from 'react';
import type { BoardNest, PartInstance, PartPosition } from '../boards';
import type { CamPartInfo, PlanResult } from '../camTypes';
import { place, toD } from './outline';
import { edgeDir, holdBox, snapClamp } from '@wbcnc/cam/holdPoints';

/** Where a dragged part would land on this board; `fits` false: it fits nowhere, drawn in red at the pointer. */
export interface NestPreview {
  item: string;
  at: PartPosition;
  fits: boolean;
}

/**
 * Top view of a board: its parts at their nested positions (outline, pockets, holes), its hold points (screws or
 * clamps, draggable), tabs from the generated program, what comes loose during the job, XY zero at the lower left. Y up, like the machine. With `pxPerMm`, drawn at that scale (so
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
  onHoldsChange,
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
  /** A hold point dragged to a new spot: all of the board's hold points, board frame (mm). */
  onHoldsChange?: (points: { x: number; y: number }[]) => void;
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
  // A hold point being dragged: its index and where it is now.
  const [holdDrag, setHoldDrag] = useState<{ i: number; x: number; y: number } | null>(null);
  // A clamp being moved slides along the nearest edge, pushed against it.
  const holds = nest.holds.map((h, i) =>
    holdDrag?.i !== i
      ? h
      : h.kind === 'clamp' && h.w !== undefined
        ? { ...h, ...snapClamp(holdDrag, h.d, nest.board), dir: edgeDir(holdDrag, nest.board) }
        : { ...h, x: holdDrag.x, y: holdDrag.y }
  );
  const clash = new Set((plan?.holdClash ?? []).map(p => `${p.x},${p.y}`));
  const toFrame = (e: React.PointerEvent) => {
    const frame = (e.currentTarget as SVGElement).closest('[data-board-frame]') as SVGGraphicsElement | null;
    const m = frame?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.round(Math.min(w, Math.max(0, p.x)) * 10) / 10, y: Math.round(Math.min(h, Math.max(0, p.y)) * 10) / 10 };
  };
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
        {nest.frame === 'kept' && nest.holds.length > 0 && (
          <rect
            x={nest.margin / 2}
            y={nest.margin / 2}
            width={Math.max(0, w - nest.margin)}
            height={Math.max(0, h - nest.margin)}
            className="pointer-events-none fill-none stroke-emerald-600/40 dark:stroke-emerald-400/40"
            strokeWidth={stroke}
            strokeDasharray={`${stroke * 3} ${stroke * 3}`}
          />
        )}
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
        {/* What comes loose during the job: stock with too few holds (amber), parts with nothing holding them (red). */}
        {plan?.timeline?.map((ev, i) => (
          <g key={`ev-${i}`} className="pointer-events-none" data-hold-event={ev.kind}>
            <circle
              cx={ev.at.x}
              cy={ev.at.y}
              r={stroke * 14}
              className={cn('fill-none', ev.block ? 'stroke-red-600 dark:stroke-red-500' : 'stroke-amber-500')}
              strokeWidth={stroke * 3}
              strokeDasharray={ev.kind === 'pivot' ? `${stroke * 4} ${stroke * 3}` : undefined}
            />
            <title>{ev.message}</title>
          </g>
        ))}
        {holds.map((hp, i) => {
          const bad = clash.has(`${hp.x},${hp.y}`) && holdDrag?.i !== i;
          const r = hp.d / 2;
          const box = holdBox(hp);
          return (
            <g
              key={`hold-${i}`}
              data-hold={hp.kind}
              role={onHoldsChange ? 'button' : undefined}
              aria-label={onHoldsChange ? `${hp.kind === 'screw' ? 'Screw' : 'Clamp'} ${i + 1}: drag to move` : undefined}
              className={cn(onHoldsChange && 'cursor-move')}
              onPointerDown={
                onHoldsChange &&
                (e => {
                  e.stopPropagation();
                  e.preventDefault();
                  (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
                  setHoldDrag({ i, x: hp.x, y: hp.y });
                })
              }
              onPointerMove={
                onHoldsChange &&
                (e => {
                  if (holdDrag?.i !== i) return;
                  const p = toFrame(e);
                  if (p) setHoldDrag({ i, ...p });
                })
              }
              onPointerUp={
                onHoldsChange &&
                (e => {
                  if (holdDrag?.i !== i) return;
                  e.stopPropagation();
                  const moved = holds.map(q => ({ x: q.x, y: q.y }));
                  setHoldDrag(null);
                  if (moved[i].x !== nest.holds[i].x || moved[i].y !== nest.holds[i].y) onHoldsChange(moved);
                })
              }
              onClick={e => e.stopPropagation()}>
              {hp.kind === 'clamp' ? (
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.w}
                  height={box.h}
                  rx={Math.min(box.w, box.h) * 0.2}
                  className={bad ? 'fill-red-500/60 stroke-red-600' : 'fill-rose-800/70 stroke-rose-900 dark:fill-rose-400/70'}
                  strokeWidth={stroke}
                />
              ) : (
                <>
                  <circle
                    cx={hp.x}
                    cy={hp.y}
                    r={r}
                    className={bad ? 'fill-red-500/40 stroke-red-600' : 'fill-background stroke-foreground'}
                    strokeWidth={stroke * 1.5}
                  />
                  <path
                    d={`M${hp.x - r * 0.55},${hp.y}H${hp.x + r * 0.55}M${hp.x},${hp.y - r * 0.55}V${hp.y + r * 0.55}`}
                    className={bad ? 'stroke-red-600' : 'stroke-foreground'}
                    strokeWidth={stroke * 1.5}
                  />
                </>
              )}
              {/* A bigger target than a 10 mm screw for the pointer. */}
              <circle cx={hp.x} cy={hp.y} r={Math.max(Math.max(box.w, box.h) / 2, u / 60)} className="fill-transparent" />
              <title>
                {bad
                  ? 'The bit would hit this: move it into the waste.'
                  : hp.kind === 'clamp' && hp.w !== undefined
                    ? `Clamp: ${hp.w} mm wide, reaching ${hp.d} mm in`
                    : `${hp.kind === 'screw' ? 'Screw' : 'Clamp'} ⌀${hp.d} mm`}
              </title>
            </g>
          );
        })}
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
