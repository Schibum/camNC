import { useRef, useState } from 'react';
import { cn } from '@wbcnc/ui/lib/utils';
import { holdBox } from '@wbcnc/cam/holdPoints';
import { placedRect, roomBelow, type BoardNest, type PartInstance } from '../boards';
import { Hint } from '../Hint';
import { NumberInput } from '../NumberInput';

/** A size dragged to lands on whole 10 mm (Shift: 1 mm). */
const kSnap = 10;

type Grip = 'w' | 'h' | 'wh';

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
 * corner stays, XY zero goes with the bottom edge), the edge margin and the gap between parts by their labels. While dragging,
 * nothing else moves: the new outline is drawn over the board at the same scale, and the board changes on the drop.
 */
export function BoardOverlay({
  nest,
  instances,
  pxPerMm,
  padPx,
  bit,
  machine,
  onResize,
  onResizing,
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
  onResize: (w: number, h: number) => void;
  /** The size being dragged to, and what it would give. */
  onResizing: (note: string) => void;
  onMargin: (margin: number) => void;
  onGap: (gap: number) => void;
}) {
  const { w, h } = nest.board;
  const [draft, setDraft] = useState<{ w: number; h: number } | null>(null);
  const start = useRef<{ grip: Grip; x: number; y: number } | null>(null);
  const shown = draft ?? { w, h };
  const px = (mm: number) => mm * pxPerMm;
  const right = padPx + px(shown.w);
  const bottom = padPx + px(shown.h);

  const edges = nest.placements.flatMap(p => {
    const inst = instances.find(i => i.id === p.id);
    return inst ? [placedRect(p, inst)] : [];
  });
  // Not over the parts, nor the screws and the clamps along the edges that would stay: dragging takes none of them off.
  const holds = nest.holds.map(hp => ({ hp, box: holdBox(hp) }));
  const leastW = Math.max(
    10,
    ...edges.map(r => Math.ceil(r.x + r.w + nest.margin)),
    ...holds.filter(({ hp }) => hp.kind === 'screw' || hp.dir?.x === 0).map(({ box }) => Math.ceil(box.x + box.w))
  );
  // Going up, the bottom edge pushes what's in its way along, until that reaches the top edge.
  const below = roomBelow(nest, instances);
  const leastH = Math.max(
    10,
    ...edges.map(r => Math.ceil(r.y + r.h + nest.margin - below)),
    ...holds.filter(({ hp }) => hp.kind === 'screw' || hp.dir?.y === 0).map(({ box }) => Math.ceil(box.y + box.h - below))
  );
  /** On the machine, either way round, as a board may lie on it. */
  const fits = (s: { w: number; h: number }) =>
    !machine || (s.w <= machine.w && s.h <= machine.h) || (s.w <= machine.h && s.h <= machine.w);
  const parts = nest.yield * w * h;

  const handle = (grip: Grip) => ({
    'data-resize': grip,
    'aria-hidden': true,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      start.current = { grip, x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (!s) return;
      const step = e.shiftKey ? 1 : kSnap;
      const snap = (v: number) => Math.round(v / step) * step;
      const next = {
        w: s.grip === 'h' ? w : Math.max(Math.min(leastW, w), snap(w + (e.clientX - s.x) / pxPerMm)),
        h: s.grip === 'w' ? h : Math.max(Math.min(leastH, h), snap(h + (e.clientY - s.y) / pxPerMm)),
      };
      // Past the machine it stops growing, where it was; a board that's already too big can still shrink.
      if ((next.w > shown.w || next.h > shown.h) && !fits(next)) return;
      setDraft(next);
      onResizing(
        `${next.w} × ${next.h} mm · ${((next.w * next.h) / 1e6).toFixed(2)} m² · ${Math.min(100, Math.round((100 * parts) / (next.w * next.h)))} % yield`
      );
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!start.current) return;
      e.stopPropagation();
      start.current = null;
      setDraft(null);
      if (draft && (draft.w !== w || draft.h !== h)) onResize(draft.w, draft.h);
    },
    onPointerCancel: () => {
      start.current = null;
      setDraft(null);
    },
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  });
  const gap = nest.placements.length > 1 ? gapSpot(nest, instances) : null;
  return (
    <div data-board-overlay className="pointer-events-none absolute inset-0 *:pointer-events-auto">
      {/* The edge margin, inside which the parts go. */}
      {!draft && (
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
      {draft && (
        <div
          data-resize-outline
          className="!pointer-events-none absolute border-2 border-dashed border-primary bg-primary/5"
          style={{ left: padPx, top: padPx, width: px(draft.w), height: px(draft.h) }}
        />
      )}
      {!draft && (
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
        style={{ left: right + kGripOff, top: padPx + px(shown.h) / 2 }}
      />
      <div
        {...handle('h')}
        title="Drag to change the board's height"
        className="absolute h-1.5 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize touch-none rounded-full bg-primary ring-1 ring-background"
        style={{ left: padPx + px(shown.w) / 2, top: bottom + kGripOff }}
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
