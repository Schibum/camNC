import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { MATERIALS } from '@wbcnc/cam/settings';
import { Maximize, Minus, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usesTabs } from '@wbcnc/cam/board';
import { boardSizeLabel, dropPart, partsHoldOf, placedRect, type PartDrop, type PartInstance, type PartPosition } from '../boards';
import type { CamPartInfo, PlanResult } from '../camTypes';
import type { JobBoard } from '../useJobBoards';
import { useBoardDrag } from './boardDrag';
import { NestView } from './NestView';
import { place, toD } from './outline';

const fmt = (v: number) => `${+v.toFixed(1)}`;
const sameThickness = (a: number, b: number) => +a.toFixed(1) === +b.toFixed(1);
/** Drop points in 0.1 mm. */
const round = (v: number) => Math.round(v * 10) / 10;
/** Pointer travel (px) before a press on a part becomes a drag. */
const kDragStart = 4;
/** Zoom range over the fitted scale. */
const kMinZoom = 0.5;
const kMaxZoom = 8;
/** Within this many px of the nest's spot, a dropped part snaps to it. */
const kSnapPx = 14;

export type DrawingTarget =
  | { kind: 'drawing'; board: string; at: PartPosition; drop: PartDrop | null }
  | { kind: 'card'; board: string }
  | { kind: 'new' };

interface ShapeDrag {
  item: string;
  from: string;
  rotated: boolean;
  /** Pointer minus the part's lower left corner, mm. */
  grab: { x: number; y: number };
  start: { x: number; y: number };
  pointer: { x: number; y: number };
  moved: boolean;
  target: DrawingTarget | null;
}

/** Client point -> board frame (mm, Y up) of a drawing. */
function toBoard(frame: SVGGraphicsElement, x: number, y: number) {
  const m = frame.getScreenCTM();
  return m ? new DOMPoint(x, y).matrixTransform(m.inverse()) : null;
}

/**
 * Every board drawn at one scale, so parts can be dragged between them: drag a part's outline out of one board and
 * drop it on another of the same thickness (or on "New board"). While dragging, the outline follows the pointer and
 * the target board shows where the part lands: exactly at the drop point when there is room, else where the board's
 * nest puts it, in red when it doesn't fit. A focused part moves with the arrow keys (Shift: 10 mm).
 */
export function BoardDrawings({
  boards,
  instances,
  parts,
  plans,
  fetching,
  bit,
  selectedId,
  onSelect,
  onDrop,
  onMove,
  onNewBoard,
  onNudge,
  onHoldsMove,
  onTabsMove,
}: {
  boards: JobBoard[];
  instances: PartInstance[];
  parts: CamPartInfo[];
  plans: (PlanResult | undefined)[];
  fetching: boolean[];
  bit: number;
  selectedId: string;
  onSelect: (id: string) => void;
  /** Dropped on a board drawing: `drop` is null when it doesn't fit there or has another thickness. */
  onDrop: (item: string, board: string, drop: PartDrop | null) => void;
  /** Dropped on a board card in the list. */
  onMove: (item: string, board: string) => void;
  onNewBoard: (item: string) => void;
  /** Arrow keys: move a part on its board to this spot. */
  onNudge: (item: string, board: string, at: PartPosition) => void;
  /** A hold point dragged: the board's hold points as they are now. */
  onHoldsMove?: (board: string, points: { x: number; y: number }[]) => void;
  /** A tab dragged: all tabs of that body (instance id), part frame (mm). */
  onTabsMove?: (board: string, item: string, tabs: { x: number; y: number }[]) => void;
}) {
  const byId = new Map(instances.map(i => [i.id, i]));
  const byPart = new Map(parts.map(p => [p.id, p]));
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  // One scale for all boards: the widest fits the column, the tallest takes at most half its height, so several
  // boards are in view to drag between.
  const unit = Math.max(...boards.map(b => Math.max(b.nest.board.w, b.nest.board.h)));
  const pad = 2 * unit * 0.05;
  const maxW = Math.max(...boards.map(b => b.nest.board.w)) + pad;
  const maxH = Math.max(...boards.map(b => b.nest.board.h)) + pad;
  const fitPxPerMm = Math.min(1.5, Math.max(0.15, Math.min(((view.w || 600) - 34) / maxW, ((view.h || 800) * 0.5 - 40) / maxH)));
  // Zoom on top of the fitted scale (Ctrl/⌘ + wheel, a trackpad or touch pinch, the buttons); scrolling or dragging
  // the background pans.
  const [zoom, setZoom] = useState(1);
  const pxPerMm = fitPxPerMm * zoom;
  // The content point that stays under the pointer while zooming, applied once the new scale is laid out.
  const anchor = useRef<{ cx: number; cy: number; vx: number; vy: number; ratio: number } | null>(null);
  const zoomTo = (next: number, at?: { x: number; y: number }) => {
    const el = scroller.current;
    const z = Math.min(kMaxZoom, Math.max(kMinZoom, next));
    if (!el || z === zoom) return;
    const box = el.getBoundingClientRect();
    const vx = at ? at.x - box.left : el.clientWidth / 2,
      vy = at ? at.y - box.top : el.clientHeight / 2;
    anchor.current = { cx: el.scrollLeft + vx, cy: el.scrollTop + vy, vx, vy, ratio: z / zoom };
    setZoom(z);
  };
  useLayoutEffect(() => {
    const a = anchor.current,
      el = scroller.current;
    if (!a || !el) return;
    anchor.current = null;
    el.scrollLeft = a.cx * a.ratio - a.vx;
    el.scrollTop = a.cy * a.ratio - a.vy;
  }, [zoom]);
  const zoomRef = useRef({ zoom, zoomTo });
  zoomRef.current = { zoom, zoomTo };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Not passive: Ctrl + wheel (and a trackpad pinch, which the browser sends as one) zooms the drawing, not the page.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { zoom, zoomTo } = zoomRef.current;
      zoomTo(zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002)), { x: e.clientX, y: e.clientY });
    };
    // Safari (and the Mac app's web view) sends a trackpad pinch as gesture events, not as Ctrl + wheel.
    type Gesture = UIEvent & { scale: number; clientX: number; clientY: number };
    let start = 1;
    const gestureStart = (e: Event) => {
      e.preventDefault();
      start = zoomRef.current.zoom;
    };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Gesture;
      zoomRef.current.zoomTo(start * g.scale, { x: g.clientX, y: g.clientY });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', gestureStart, { passive: false });
    el.addEventListener('gesturechange', gestureChange, { passive: false });
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('gesturestart', gestureStart);
      el.removeEventListener('gesturechange', gestureChange);
    };
  }, []);
  // Panning: one pointer dragged on the background; pinching: two touches.
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const panned = useRef(false);
  const onBackgroundDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as Element;
    if (t.closest('[data-item],[data-hold],[data-tab],button,input,[role="button"]')) return;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
        pan.current = null;
        return;
      }
    }
    if (e.button !== 0 && e.button !== 1) return;
    const el = scroller.current!;
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
    panned.current = false;
  };
  const onBackgroundMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        zoomTo(pinch.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch.current.dist)), {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
        });
        return;
      }
    }
    const p = pan.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < kDragStart) return;
    if (!p.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    p.moved = true;
    panned.current = true;
    scroller.current!.scrollLeft = p.left - dx;
    scroller.current!.scrollTop = p.top - dy;
  };
  const onBackgroundUp = (e: React.PointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (pan.current?.id === e.pointerId) pan.current = null;
  };

  const [drag, setDrag] = useState<ShapeDrag | null>(null);
  const latest = useRef({ boards, instances, bit, pxPerMm, onDrop, onMove, onNewBoard, onSelect });
  latest.current = { boards, instances, bit, pxPerMm, onDrop, onMove, onNewBoard, onSelect };
  const dragRef = useRef<ShapeDrag | null>(null);
  const update = (d: ShapeDrag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const targetAt = (d: ShapeDrag, x: number, y: number): DrawingTarget | null => {
    const { boards, instances, bit, pxPerMm } = latest.current;
    const el = document.elementFromPoint(x, y);
    if (el?.closest('[data-new-board-drop]')) return { kind: 'new' };
    const card = el?.closest<HTMLElement>('[data-board-drop]');
    const id = card?.dataset.boardDrop;
    const board = boards.find(b => b.board.id === id)?.board;
    if (!card || !board) return null;
    if (!card.hasAttribute('data-board-drawing')) return { kind: 'card', board: board.id };
    const frame = card.querySelector<SVGGraphicsElement>('[data-board-frame]');
    const p = frame && toBoard(frame, x, y);
    if (!p) return null;
    const at = { x: round(p.x - d.grab.x), y: round(p.y - d.grab.y), rotated: d.rotated };
    const prev = d.target;
    if (prev?.kind === 'drawing' && prev.board === board.id && prev.at.x === at.x && prev.at.y === at.y) return prev;
    const inst = instances.find(i => i.id === d.item)!;
    const drop = sameThickness(inst.thickness, board.thickness) ? dropPart(board, instances, bit, d.item, at, kSnapPx / pxPerMm) : null;
    return { kind: 'drawing', board: board.id, at, drop };
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > kDragStart;
      if (moved && !d.moved) {
        const inst = latest.current.instances.find(i => i.id === d.item);
        useBoardDrag.getState().start(d.item, inst?.thickness ?? 0);
      }
      // Near the column's top or bottom edge: scroll, so every board can be reached.
      const box = moved && scroller.current?.getBoundingClientRect();
      if (box && e.clientX >= box.left && e.clientX <= box.right) {
        if (e.clientY < box.top + 48) scroller.current!.scrollBy(0, -24);
        else if (e.clientY > box.bottom - 48) scroller.current!.scrollBy(0, 24);
      }
      const next = { ...d, moved, pointer: { x: e.clientX, y: e.clientY } };
      update(moved ? { ...next, target: targetAt(next, e.clientX, e.clientY) } : next);
    };
    const finish = (e: PointerEvent | null) => {
      const d = dragRef.current;
      update(null);
      useBoardDrag.getState().end();
      if (!d?.moved || !e) return;
      const target = targetAt(d, e.clientX, e.clientY);
      const on = latest.current;
      if (target?.kind === 'new') on.onNewBoard(d.item);
      else if (target?.kind === 'card') on.onMove(d.item, target.board);
      else if (target?.kind === 'drawing') on.onDrop(d.item, target.board, target.drop?.at ? target.drop : null);
    };
    const up = (e: PointerEvent) => finish(e);
    const cancel = () => finish(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
    };
    // Listeners for the whole drag; they read the latest state from refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!drag]);

  const startDrag = (board: JobBoard, item: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as SVGGElement).focus({ preventScroll: true });
    onSelect(board.board.id);
    const placed = board.nest.placements.find(p => p.id === item);
    const frame = (e.currentTarget as SVGGElement).closest('svg')?.querySelector<SVGGraphicsElement>('[data-board-frame]');
    const p = frame && toBoard(frame, e.clientX, e.clientY);
    if (!placed || !p) return;
    const pointer = { x: e.clientX, y: e.clientY };
    update({
      item,
      from: board.board.id,
      rotated: placed.rotated,
      grab: { x: p.x - placed.x, y: p.y - placed.y },
      start: pointer,
      pointer,
      moved: false,
      target: null,
    });
  };

  const nudge = (board: JobBoard, item: string, e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    const placed = board.nest.placements.find(p => p.id === item);
    if (!d || !placed) return;
    e.preventDefault();
    onNudge(item, board.board.id, { x: round(placed.x + d[0]), y: round(placed.y + d[1]), rotated: placed.rotated });
  };

  const dragging = drag?.moved ? drag : null;
  const dragInst = dragging && byId.get(dragging.item);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="absolute top-1 right-5 z-10 flex items-center gap-0.5 rounded-md border bg-background/90 p-0.5 shadow-sm">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out (Ctrl/⌘ + wheel)"
          onClick={() => zoomTo(zoom / 1.25)}
          disabled={zoom <= kMinZoom}
          className="rounded p-1 hover:bg-muted disabled:opacity-40">
          <Minus className="size-3.5" />
        </button>
        <span className="w-10 text-center font-mono text-[11px] text-muted-foreground" aria-live="polite">
          {Math.round(zoom * 100)} %
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in (Ctrl/⌘ + wheel)"
          onClick={() => zoomTo(zoom * 1.25)}
          disabled={zoom >= kMaxZoom}
          className="rounded p-1 hover:bg-muted disabled:opacity-40">
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Fit boards to view"
          title="Fit to view"
          onClick={() => {
            setZoom(1);
            scroller.current?.scrollTo({ left: 0, top: 0 });
          }}
          className="rounded p-1 hover:bg-muted">
          <Maximize className="size-3.5" />
        </button>
      </div>
      <div
        ref={scroller}
        data-board-scroller
        className="relative min-h-0 flex-1 overflow-auto px-4 pt-1 pb-4"
        onPointerDown={onBackgroundDown}
        onPointerMove={onBackgroundMove}
        onPointerUp={onBackgroundUp}
        onPointerCancel={onBackgroundUp}
        onClickCapture={e => {
          // The end of a pan is not a click on the board under the pointer.
          if (panned.current) {
            panned.current = false;
            e.stopPropagation();
          }
        }}>
        <div className="flex flex-wrap items-start gap-4">
          {boards.map((b, i) => {
            const { board, nest } = b;
            const target = dragging?.target?.kind === 'drawing' && dragging.target.board === board.id ? dragging.target : null;
            const fits = dragInst && sameThickness(dragInst.thickness, board.thickness);
            const tabHeight = usesTabs(partsHoldOf(board)) ? board.tabs.height : undefined;
            return (
              <section
                key={board.id}
                aria-label={`Board ${board.name} drawing`}
                data-board-drop={board.id}
                data-board-drawing
                onClick={() => onSelect(board.id)}
                className={cn(
                  'flex w-fit min-w-[220px] shrink-0 flex-col gap-1 rounded-lg border border-transparent bg-background/60 p-2 transition-colors',
                  board.id === selectedId && 'border-primary/60',
                  dragging && fits && 'border-dashed border-primary/60',
                  dragging && !fits && 'opacity-50',
                  target && fits && 'border-solid border-primary bg-primary/5 ring-2 ring-primary',
                  target && !target.drop?.at && 'border-red-500 ring-red-500'
                )}>
                <div className="flex w-0 min-w-full flex-wrap items-center gap-x-2 px-1 text-sm">
                  <span className="font-medium">Board {board.name}</span>
                  <span className="whitespace-nowrap text-muted-foreground">
                    {MATERIALS[board.material].name[0].toUpperCase() + MATERIALS[board.material].name.slice(1)} {fmt(board.thickness)} mm ·{' '}
                    <span className="font-mono text-xs">{boardSizeLabel(board, nest)}</span>
                  </span>
                  <span className="grow" />
                  {fetching[i] && <LoadingSpinner className="size-3" />}
                  <DropStatus dragging={!!dragging} fits={!!fits} target={target} from={dragging?.from === board.id} />
                </div>
                <NestView
                  nest={nest}
                  instances={instances}
                  parts={parts}
                  plan={plans[i]}
                  tabHeight={tabHeight}
                  unit={unit}
                  pxPerMm={pxPerMm}
                  label={
                    boardSizeLabel(board, nest) === '–'
                      ? `Board ${board.name}, empty`
                      : `Board ${board.name}, ${fmt(nest.board.w)} by ${fmt(nest.board.h)} mm, with ${nest.placements.length} parts`
                  }
                  className={cn('shrink-0 touch-none transition-opacity', fetching[i] && plans[i] && 'opacity-70')}
                  dragging={dragging?.from === board.id ? dragging.item : null}
                  preview={
                    target && dragging
                      ? target.drop?.at
                        ? { item: dragging.item, at: target.drop.at, fits: true }
                        : { item: dragging.item, at: target.at, fits: false }
                      : null
                  }
                  onPartPointerDown={(item, e) => startDrag(b, item, e)}
                  onPartKeyDown={(item, e) => nudge(b, item, e)}
                  onPartFocus={() => onSelect(board.id)}
                  onHoldsChange={onHoldsMove && (pts => onHoldsMove(board.id, pts))}
                  onTabsChange={onTabsMove && usesTabs(partsHoldOf(board)) ? (item, tabs) => onTabsMove(board.id, item, tabs) : undefined}
                />
              </section>
            );
          })}
          {dragging && (
            <div
              data-new-board-drop
              aria-label="New board"
              className={cn(
                'flex h-32 w-56 items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-background/60 text-sm text-muted-foreground',
                dragging.target?.kind === 'new' && 'border-primary bg-primary/5 text-foreground'
              )}>
              <Plus className="size-4" /> New board: drop here
            </div>
          )}
        </div>
        {dragging && dragInst && (
          <Ghost
            inst={dragInst}
            part={byPart.get(dragInst.partId)}
            drag={dragging}
            pxPerMm={pxPerMm}
            bad={dragging.target?.kind === 'drawing' && !dragging.target.drop?.at}
          />
        )}
      </div>
    </div>
  );
}

function DropStatus({
  dragging,
  fits,
  target,
  from,
}: {
  dragging: boolean;
  fits: boolean;
  target: Extract<DrawingTarget, { kind: 'drawing' }> | null;
  from: boolean;
}) {
  if (!dragging) return null;
  const text = !fits
    ? 'Different thickness'
    : !target
      ? from
        ? 'Moving from here'
        : 'Drop here'
      : !target.drop?.at
        ? 'Doesn’t fit on this board'
        : target.drop.exact
          ? 'Lands where you drop it'
          : 'Snaps into the nest';
  return (
    <span
      className={cn(
        'text-xs',
        target && !target.drop?.at
          ? 'font-medium text-red-600 dark:text-red-400'
          : target
            ? 'font-medium text-primary'
            : 'text-muted-foreground'
      )}>
      {text}
    </span>
  );
}

/** The dragged part's outline under the pointer, at the drawings' scale. */
function Ghost({
  inst,
  part,
  drag,
  pxPerMm,
  bad,
}: {
  inst: PartInstance;
  part: CamPartInfo | undefined;
  drag: ShapeDrag;
  pxPerMm: number;
  bad: boolean;
}) {
  if (!part) return null;
  const r = placedRect({ x: 0, y: 0, rotated: drag.rotated }, inst);
  const f = place({ x: 0, y: 0, rotated: drag.rotated }, inst.size);
  return (
    <svg
      aria-hidden
      data-drag-ghost
      viewBox={`0 ${-r.h} ${r.w} ${r.h}`}
      width={r.w * pxPerMm}
      height={r.h * pxPerMm}
      className="pointer-events-none fixed z-50 overflow-visible drop-shadow-lg"
      style={{ left: drag.pointer.x - drag.grab.x * pxPerMm, top: drag.pointer.y - (r.h - drag.grab.y) * pxPerMm }}>
      <g transform="scale(1,-1)">
        <path
          d={toD(part.shape.outlines, f)}
          className={bad ? 'fill-red-500/25 stroke-red-500' : 'fill-violet-500/35 stroke-violet-500'}
          strokeWidth={1.5 / pxPerMm}
        />
        <path d={toD(part.shape.holes, f)} className="fill-background/80" />
      </g>
      <text
        x={r.w / 2}
        y={-r.h / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={12 / pxPerMm}
        className="fill-foreground font-medium">
        {inst.name}
      </text>
    </svg>
  );
}
