import { useRef, useState } from 'react';
import { cn } from '@wbcnc/ui/lib/utils';
import { placedRect, type BoardNest, type PartInstance } from '../boards';
import { Hint } from '../Hint';
import { NumberInput } from '../NumberInput';

/** A size dragged to lands on whole 10 mm (Shift: 1 mm). */
const kSnap = 10;
/** Within this many px of the size where every part just fits, a size dragged to lands on it. */
const kTightSnap = 14;
/** No board comes out smaller than this, mm. */
const kLeast = 50;

type Grip = 'w' | 'h' | 'wh';
/** The sizes where every part just fits, on the sides being dragged. */
export type TightSizes = { w?: number | null; h?: number | null };

/** The grips stand this far (px) off the edge they move, past the clamps' bodies, so they never cover a clamp. */
const kGripOff = 10;

/** The middle of the narrowest gap between two parts that face each other, board frame. */
function gapSpot(nest: BoardNest, instances: PartInstance[]) {
  const rects = nest.placements.flatMap(p => {
    const inst = instances.find(i => i.id === p.id);
    return inst ? [placedRect(p, inst)] : [];
  });
  if (rects.length < 2) return null;
  // Two parts always have a gap, even if they don't face each other: between their middles then.
  let best: { x: number; y: number; gap: number } | null = null;
  for (const a of rects)
    for (const b of rects) {
      const [lo, hi] = [Math.max(a.y, b.y), Math.min(a.y + a.h, b.y + b.h)];
      const [l, r] = [Math.max(a.x, b.x), Math.min(a.x + a.w, b.x + b.w)];
      if (b.x >= a.x + a.w && hi > lo && (!best || b.x - a.x - a.w < best.gap))
        best = { x: (a.x + a.w + b.x) / 2, y: (lo + hi) / 2, gap: b.x - a.x - a.w };
      if (b.y >= a.y + a.h && r > l && (!best || b.y - a.y - a.h < best.gap))
        best = { x: (l + r) / 2, y: (a.y + a.h + b.y) / 2, gap: b.y - a.y - a.h };
    }
  if (best) return best;
  const [a, b] = rects;
  return { x: (a.x + a.w / 2 + b.x + b.w / 2) / 2, y: (a.y + a.h / 2 + b.y + b.h / 2) / 2, gap: 0 };
}

function Chip({
  id,
  label,
  name,
  hint,
  value,
  min,
  left,
  top,
  onCommit,
}: {
  id: string;
  label: string;
  name: string;
  hint: string;
  value: number;
  min?: number;
  left: number;
  top: number;
  onCommit: (v: number) => void;
}) {
  return (
    <div className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left, top }}>
      <Hint text={hint} id={`${id}-hint`}>
        <label className="flex h-5 items-center gap-1 rounded border border-primary/70 bg-background px-1 font-mono text-[11px] whitespace-nowrap shadow-sm">
          {label}
          <NumberInput
            id={id}
            aria-label={name}
            aria-describedby={`${id}-hint`}
            value={value}
            digits={1}
            min={min ?? 0}
            unit="mm"
            className="h-4 w-9 rounded-none border-0 bg-transparent p-0 text-center text-[11px] shadow-none focus-visible:ring-0 dark:bg-transparent"
            onCommit={onCommit}
          />
        </label>
      </Hint>
    </div>
  );
}

/**
 * What's edited right on the selected board's drawing: its size by the handles on its right and bottom edge (the upper left
 * corner stays, XY zero goes with the bottom edge), the edge margin and the gap between parts by their labels. An edge drags
 * right through the parts: while dragging, the board is laid out for that size and what has no room goes off it, undone by
 * dragging back. A line shows the size where every part just fits, and the edge snaps to it.
 */
export function BoardOverlay({
  nest,
  instances,
  pxPerMm,
  padPx,
  bit,
  machine,
  compact,
  tight,
  onResize,
  onDraft,
  onMargin,
  onGap,
}: {
  nest: BoardNest;
  instances: PartInstance[];
  pxPerMm: number;
  /** From the drawing's corner to the board's. */
  padPx: number;
  bit: number;
  machine?: { w: number; h: number };
  /** Too small on screen for the margin and gap labels. */
  compact?: boolean;
  /** Worked out when an edge is picked up. */
  tight: (grip: Grip) => TightSizes;
  onResize: (w: number, h: number) => void;
  /** The size being dragged to; null: none any more. */
  onDraft: (size: { w: number; h: number } | null) => void;
  onMargin: (margin: number) => void;
  onGap: (gap: number) => void;
}) {
  const { w, h } = nest.board;
  const [draft, setDraft] = useState<{ w: number; h: number } | null>(null);
  const start = useRef<{ grip: Grip; x: number; y: number; w: number; h: number; tight: TightSizes } | null>(null);
  const px = (mm: number) => mm * pxPerMm;
  const right = padPx + px(w);
  const bottom = padPx + px(h);
  /** On the machine, either way round, as a board may lie on it. */
  const fits = (s: { w: number; h: number }) =>
    !machine || (s.w <= machine.w && s.h <= machine.h) || (s.w <= machine.h && s.h <= machine.w);

  const handle = (grip: Grip) => ({
    'data-resize': grip,
    'aria-hidden': true,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      start.current = { grip, x: e.clientX, y: e.clientY, w, h, tight: tight(grip) };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s) return;
      const step = e.shiftKey ? 1 : kSnap;
      const to = (from: number, by: number, near?: number | null) => {
        const v = Math.max(kLeast, Math.round((from + by / pxPerMm) / step) * step);
        return !e.shiftKey && near && Math.abs(near - v) * pxPerMm < kTightSnap ? near : v;
      };
      const next = {
        w: s.grip === 'h' ? s.w : to(s.w, e.clientX - s.x, s.tight.w),
        h: s.grip === 'w' ? s.h : to(s.h, e.clientY - s.y, s.tight.h),
      };
      if (next.w === (draft ?? s).w && next.h === (draft ?? s).h) return;
      // Past the machine it stops growing, where it was; a board that's already too big can still shrink.
      if ((next.w > (draft ?? s).w || next.h > (draft ?? s).h) && !fits(next)) return;
      setDraft(next);
      onDraft(next);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s) return;
      e.stopPropagation();
      start.current = null;
      setDraft(null);
      if (draft && (draft.w !== s.w || draft.h !== s.h)) onResize(draft.w, draft.h);
      onDraft(null);
    },
    onPointerCancel: () => {
      start.current = null;
      setDraft(null);
      onDraft(null);
    },
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  });
  const gap = nest.placements.length > 1 ? gapSpot(nest, instances) : null;
  return (
    <div data-board-overlay className="pointer-events-none absolute inset-0 *:pointer-events-auto">
      {/* The edge margin, inside which the parts go. */}
      {!draft && !compact && (
        <div
          data-margin-line
          className="!pointer-events-none absolute border border-dotted border-primary/70"
          style={{
            left: padPx + px(nest.margin),
            top: padPx + px(nest.margin),
            width: px(w - 2 * nest.margin),
            height: px(h - 2 * nest.margin),
          }}
        />
      )}
      {draft && start.current?.tight.w && (
        <div
          data-tight="w"
          className="!pointer-events-none absolute border-l border-dashed border-emerald-500"
          style={{ left: padPx + px(start.current.tight.w), top: padPx - 24, height: px(h) + 72 }}>
          <span className="absolute top-full ml-1 whitespace-nowrap text-[11px] text-emerald-600 dark:text-emerald-400">
            Every part fits down to {start.current.tight.w}
          </span>
        </div>
      )}
      {draft && start.current?.tight.h && (
        <div
          data-tight="h"
          className="!pointer-events-none absolute border-t border-dashed border-emerald-500"
          style={{ top: padPx + px(start.current.tight.h), left: padPx - 24, width: px(w) + 72 }}>
          <span className="absolute left-full ml-1 -translate-y-1/2 whitespace-nowrap text-[11px] text-emerald-600 dark:text-emerald-400">
            Every part fits down to {start.current.tight.h}
          </span>
        </div>
      )}
      {!draft && !compact && (
        <>
          <Chip
            id="board-margin"
            label="margin"
            name="Edge margin"
            hint="Free border inside the board edge, so the outline cut and its lead-in stay on the board: about the bit plus 2 mm, more with tabs."
            value={nest.margin}
            left={padPx + 44}
            top={padPx + px(nest.margin)}
            onCommit={onMargin}
          />
          {gap && (
            <Chip
              id="board-gap"
              label="gap"
              name="Gap between parts"
              hint="Space between parts, so neighbouring outline cuts never meet. At least the bit; with tabs, room for a strip of stock that holds them."
              value={nest.gap}
              min={bit}
              left={padPx + px(gap.x)}
              top={padPx + px(h - gap.y)}
              onCommit={onGap}
            />
          )}
        </>
      )}
      <div
        {...handle('w')}
        title="Drag to change the board's width"
        className={cn(
          'absolute h-9 w-1.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-full bg-primary ring-1 ring-background'
        )}
        style={{ left: right + kGripOff, top: padPx + px(h) / 2 }}
      />
      <div
        {...handle('h')}
        title="Drag to change the board's height"
        className="absolute h-1.5 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize touch-none rounded-full bg-primary ring-1 ring-background"
        style={{ left: padPx + px(w) / 2, top: bottom + kGripOff }}
      />
      <div
        {...handle('wh')}
        title="Drag to change the board's size"
        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize touch-none rounded-full bg-primary ring-1 ring-background"
        style={{ left: right + kGripOff, top: bottom + kGripOff }}
      />
    </div>
  );
}
