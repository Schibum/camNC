import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { cn } from '@wbcnc/ui/lib/utils';
import { MATERIALS } from '@wbcnc/cam/settings';
import { DropdownMenu, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { Maximize, Minus, MoreHorizontal, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HoldKind } from '@wbcnc/cam/holdPoints';
import { clampPlay, edgeBands, largestOffcut, reserved, screwPlay, type Fixture } from '@wbcnc/cam/settle';
import { Button } from '@wbcnc/ui/components/button';
import {
  boardSizeLabel,
  dropPart,
  fixtureAt,
  isCut,
  layoutChange,
  nestBoard,
  placedRect,
  settleBoard,
  settleInputOf,
  suggestFixtures,
  type BoardNest,
  type BoardV1,
  type NestOptions,
  type PartDrop,
  type PartInstance,
  type PartPosition,
} from '../boards';
import type { CamPartInfo, PlanResult } from '../camTypes';
import type { JobBoard } from '../useJobBoards';
import { PartBadges, PartMenuContent, type PartMenuProps } from './PartMenu';
import { Hint } from '../Hint';
import { NestView } from './NestView';
import { CutBadge } from './CutBadge';
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

export type DrawingTarget = { kind: 'drawing'; board: string; at: PartPosition; drop: PartDrop | null } | { kind: 'new' };

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
  partMenu,
  onNewBoard,
  onNudge,
  onBoardEdit,
  onNote,
  onUndo,
  nestOptions,
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
  /** A body's menu (move it, unpin it, what holds it): opened from the ⋯ on the part, right-click, or Enter. */
  partMenu: (board: JobBoard, item: string) => PartMenuProps;
  onNewBoard: (item: string) => void;
  /** Arrow keys: move a part on its board to this spot. */
  onNudge: (item: string, board: string, at: PartPosition) => void;
  /** Fixtures placed, moved or removed, and the parts moved aside for them: the board as it is now. */
  onBoardEdit: (board: BoardV1, note: string) => void;
  /** What's happening to a fixture being placed, or why it can't be. */
  onNote: (note: string) => void;
  /** Back one step; undefined when there's nothing to undo. */
  onUndo?: () => void;
  /** The bit's stick-out and the clamps' and screws' sizes. */
  nestOptions: NestOptions;
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
    if (t.closest('[data-item],[data-hold],[data-remove],[data-tab],button,input,[role="button"]')) return;
    setActive(null);
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
  const latest = useRef({ boards, instances, bit, pxPerMm, onDrop, onNewBoard, onSelect, nestOptions });
  latest.current = { boards, instances, bit, pxPerMm, onDrop, onNewBoard, onSelect, nestOptions };
  // The part last clicked or focused: its ⋯ menu button shows on it. `menu`: that menu is open.
  const [active, setActive] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const dragRef = useRef<ShapeDrag | null>(null);
  const update = (d: ShapeDrag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const targetAt = (d: ShapeDrag, x: number, y: number): DrawingTarget | null => {
    const { boards, instances, bit, pxPerMm, nestOptions } = latest.current;
    const el = document.elementFromPoint(x, y);
    if (el?.closest('[data-new-board-drop]')) return { kind: 'new' };
    const card = el?.closest<HTMLElement>('[data-board-drop]');
    const id = card?.dataset.boardDrop;
    const board = boards.find(b => b.board.id === id)?.board;
    if (!card || !board) return null;
    const frame = card.querySelector<SVGGraphicsElement>('[data-board-frame]');
    const p = frame && toBoard(frame, x, y);
    if (!p) return null;
    const at = { x: round(p.x - d.grab.x), y: round(p.y - d.grab.y), rotated: d.rotated };
    const prev = d.target;
    if (prev?.kind === 'drawing' && prev.board === board.id && prev.at.x === at.x && prev.at.y === at.y) return prev;
    const inst = instances.find(i => i.id === d.item)!;
    const drop = sameThickness(inst.thickness, board.thickness)
      ? dropPart(board, instances, bit, d.item, at, kSnapPx / pxPerMm, nestOptions)
      : null;
    return { kind: 'drawing', board: board.id, at, drop };
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > kDragStart;
      // Near the column's top or bottom edge: scroll, so every board can be reached. Not when it's so short that it's
      // all edge: it would run away from the board under the pointer.
      const box = moved && scroller.current?.getBoundingClientRect();
      if (box && box.height > 200 && e.clientX >= box.left && e.clientX <= box.right) {
        if (e.clientY < box.top + 48) scroller.current!.scrollBy(0, -24);
        else if (e.clientY > box.bottom - 48) scroller.current!.scrollBy(0, 24);
      }
      const next = { ...d, moved, pointer: { x: e.clientX, y: e.clientY } };
      update(moved ? { ...next, target: targetAt(next, e.clientX, e.clientY) } : next);
    };
    const finish = (e: PointerEvent | null) => {
      const d = dragRef.current;
      update(null);
      if (!d?.moved || !e) return;
      const target = targetAt(d, e.clientX, e.clientY);
      const on = latest.current;
      if (target?.kind === 'new') on.onNewBoard(d.item);
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

  // Placing fixtures: the tool in hand, what's previewed under the pointer or being dragged, the one selected.
  const [tool, setTool] = useState<HoldKind | null>(null);
  const [edit, setEdit] = useState<{
    board: string;
    i: number | null;
    fixtures: Fixture[];
    nest: BoardNest;
    settled: BoardV1 | null;
    key: string;
  } | null>(null);
  const [selectedHold, setSelectedHold] = useState<{ board: string; i: number } | null>(null);
  const selectedBoard = boards.find(b => b.board.id === selectedId);
  const canPlace = !!selectedBoard && !isCut(selectedBoard.board);
  // Esc puts the tool down.
  useEffect(() => {
    if (!tool) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setTool(null);
      setEdit(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [tool]);

  // Nothing to place on a cut board: the tool can't stay in hand with its buttons off.
  useEffect(() => {
    if (!canPlace) {
      setTool(null);
      setEdit(null);
    }
  }, [canPlace]);

  /** The fixture at a point: previewed on its board with the parts moved aside for it, or refused. */
  const preview = ({ board, nest }: JobBoard, kind: HoldKind, p: { x: number; y: number }, i: number | null) => {
    const f = fixtureAt(kind, p, board, nest, instances, bit, { ...nestOptions, exact: i !== null });
    const key = `${board.id}:${i}:${JSON.stringify(f)}`;
    if (edit?.key === key) return;
    const current = board.fixtures ?? [];
    const fixtures = i === null ? [...current, f] : current.map((x, j) => (j === i ? f : x));
    const settled = settleBoard(board, instances, bit, fixtures, { ...nestOptions, budget: 80 });
    const shown = nestBoard(settled ?? { ...board, fixtures }, instances, bit, nestOptions);
    setEdit({ board: board.id, i, fixtures, nest: shown, settled, key });
    const input = settleInputOf(board, nest, instances, bit, nestOptions).input;
    onNote(
      settled
        ? layoutChange(nest, shown, instances)
        : reserved(f, input)
          ? 'That spot is kept clear: the XY zero corner is where you probe.'
          : `No room here on a ${nest.board.w} × ${nest.board.h} board. Slide along the edge, or use a bigger board.`
    );
  };
  /** Keep what's previewed: looked at harder than while the pointer was moving. */
  const commit = ({ board, nest }: JobBoard) => {
    const e = edit;
    setEdit(null);
    if (!e || e.board !== board.id) return;
    const settled = settleBoard(board, instances, bit, e.fixtures, nestOptions) ?? e.settled;
    if (!settled) return;
    onBoardEdit(settled, layoutChange(nest, nestBoard(settled, instances, bit, nestOptions), instances));
  };
  const suggest = () => {
    if (!selectedBoard) return;
    const { board, nest } = selectedBoard;
    const before = board.fixtures?.length ?? 0;
    const next = suggestFixtures(board, instances, bit, nestOptions);
    const added = (next.fixtures?.length ?? 0) - before;
    setTool(null);
    if (!added) {
      onNote(
        before
          ? 'These holds already surround the middle, so there’s nothing to add.'
          : 'No clamp spot has room on this layout. Try a bigger board, tape or screws.'
      );
      return;
    }
    onBoardEdit(
      next,
      `Suggested ${added} clamp${added > 1 ? 's' : ''}. ${layoutChange(nest, nestBoard(next, instances, bit, nestOptions), instances)} Drag or remove any of them.`
    );
  };
  // Where clamps fit on the selected board, once its layout has settled: a moment's work, so not on every render.
  const [bands, setBands] = useState<ReturnType<typeof edgeBands> | undefined>();
  const bandsKey =
    tool === 'clamp' && selectedBoard
      ? JSON.stringify([selectedBoard.nest.board, selectedBoard.board.layout, selectedBoard.board.fixtures])
      : '';
  useEffect(() => {
    setBands(undefined);
    if (!bandsKey || !selectedBoard) return;
    const t = setTimeout(() => {
      const { input, spots } = settleInputOf(selectedBoard.board, selectedBoard.nest, instances, bit, nestOptions);
      setBands(edgeBands(input, spots, selectedBoard.board.fixtures ?? [], selectedBoard.board.size.fit));
    }, 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandsKey]);

  const startDrag = (board: JobBoard, item: string, e: React.PointerEvent) => {
    if (e.button !== 0 || tool) return;
    e.preventDefault();
    (e.currentTarget as SVGGElement).focus({ preventScroll: true });
    onSelect(board.board.id);
    setActive(item);
    const placed = board.nest.placements.find(p => p.id === item);
    const inst = byId.get(item);
    const frame = (e.currentTarget as SVGGElement).closest('svg')?.querySelector<SVGGraphicsElement>('[data-board-frame]');
    const p = frame && toBoard(frame, e.clientX, e.clientY);
    // A part that doesn't fit has no spot on the board: it's held at its middle, as laid flat.
    const grab =
      placed && p ? { x: p.x - placed.x, y: p.y - placed.y } : !placed && inst ? { x: inst.size[0] / 2, y: inst.size[1] / 2 } : null;
    if (!grab) return;
    const pointer = { x: e.clientX, y: e.clientY };
    update({
      item,
      from: board.board.id,
      rotated: placed?.rotated ?? false,
      grab,
      start: pointer,
      pointer,
      moved: false,
      target: null,
    });
  };

  const nudge = (board: JobBoard, item: string, e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      setActive(item);
      setMenu(true);
      return;
    }
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
      <div role="toolbar" aria-label="Fixtures" className="flex flex-wrap items-center gap-1.5 px-4 pb-1.5">
        {(['clamp', 'screw'] as const).map(kind => (
          <Hint
            key={kind}
            text={
              kind === 'clamp'
                ? 'Click near an edge of the board: only the parts in the way move aside. Esc puts it down.'
                : 'Click in the waste: it lands on the most forgiving spot nearby. Esc puts it down.'
            }>
            <Button
              size="sm"
              variant={tool === kind ? 'default' : 'outline'}
              aria-pressed={tool === kind}
              disabled={!canPlace}
              onClick={() => {
                setTool(tool === kind ? null : kind);
                setEdit(null);
              }}>
              {kind === 'clamp' ? 'Clamp' : 'Screw'}
            </Button>
          </Hint>
        ))}
        <Hint text="Adds clamps around the board’s middle, spread out, where they need the least moved. Drag or remove any of them.">
          <Button size="sm" variant="outline" disabled={!canPlace} onClick={suggest}>
            Suggest holds
          </Button>
        </Hint>
        <Button size="sm" variant="outline" disabled={!onUndo} onClick={onUndo}>
          Undo
        </Button>
        <div className="ml-auto flex items-center gap-0.5 rounded-md border bg-background/90 p-0.5 shadow-sm">
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
            const { board } = b;
            const editing = edit?.board === board.id ? edit : null;
            const nest = editing?.nest ?? b.nest;
            const here = !isCut(board);
            const held = selectedHold?.board === board.id ? selectedHold.i : null;
            const shownFixtures = editing?.fixtures ?? board.fixtures ?? [];
            const pointed = editing ? (editing.i ?? shownFixtures.length - 1) : held;
            // Measured on what's shown, on the selected board only: these are a little work per pointer move.
            const input = board.id === selectedId ? settleInputOf(board, nest, instances, bit, nestOptions) : null;
            const pointedAt = pointed === null ? undefined : shownFixtures[pointed];
            const offcut = input && largestOffcut(input.input, input.spots, shownFixtures);
            const play =
              !input || !pointedAt || editing?.settled === null
                ? null
                : pointedAt.kind === 'clamp'
                  ? { kind: 'clamp' as const, side: pointedAt.side, ...clampPlay(input.input, input.spots, pointedAt) }
                  : { kind: 'screw' as const, x: pointedAt.x, y: pointedAt.y, r: screwPlay(input.input, input.spots, pointedAt) };
            const target = dragging?.target?.kind === 'drawing' && dragging.target.board === board.id ? dragging.target : null;
            const fits = dragInst && sameThickness(dragInst.thickness, board.thickness);
            const tabHeight = board.retention === 'tabs' ? board.tabs.height : undefined;
            // Only on tab boards: the badges are about parts whose tabs can't hold.
            const holdingOf = (id: string) =>
              board.retention === 'tabs' ? plans[i]?.holding?.find(h => h.name === byId.get(id)?.name)?.how : undefined;
            const unheld = new Set(nest.placements.filter(p => holdingOf(p.id) === 'unheld').map(p => p.id));
            const nutHits = nest.nutAbove < 0;
            const padPx = unit * 0.05 * pxPerMm;
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
                  {isCut(board) && <CutBadge board={board} />}
                  <span className="whitespace-nowrap text-muted-foreground">
                    {MATERIALS[board.material].name[0].toUpperCase() + MATERIALS[board.material].name.slice(1)} {fmt(board.thickness)} mm ·{' '}
                    <span className="font-mono text-xs">{boardSizeLabel(board, nest)}</span>
                  </span>
                  {nest.unplaced.length > 0 && (
                    <span className="text-xs font-medium whitespace-nowrap text-destructive">{nest.unplaced.length} don’t fit</span>
                  )}
                  {unheld.size > 0 && (
                    <span className="text-xs font-medium whitespace-nowrap text-destructive">{unheld.size} can’t hold</span>
                  )}
                  {nutHits && <span className="text-xs font-medium whitespace-nowrap text-destructive">collet nut hits</span>}
                  <span className="grow" />
                  {fetching[i] && <LoadingSpinner className="size-3" />}
                  <DropStatus dragging={!!dragging} fits={!!fits} target={target} from={dragging?.from === board.id} />
                </div>
                {/* Its own row on every board, so selecting one doesn't move the drawing. */}
                <div
                  className="h-4 w-0 min-w-full shrink-0 truncate px-1 font-mono text-xs leading-4 text-muted-foreground"
                  data-offcut-row>
                  {board.id === selectedId && (
                    <span data-offcut-label>
                      {offcut ? `Offcut ${Math.round(offcut.w)} × ${Math.round(offcut.h)}` : 'No offcut over 60 mm'}
                    </span>
                  )}
                </div>
                <div className="relative shrink-0">
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
                    onPartFocus={item => {
                      onSelect(board.id);
                      setActive(item);
                    }}
                    onPartContextMenu={(item, e) => {
                      e.preventDefault();
                      onSelect(board.id);
                      setActive(item);
                      setMenu(true);
                    }}
                    unheld={unheld}
                    fixtures={
                      here
                        ? {
                            tool,
                            preview: editing && editing.i === null ? pointed : null,
                            moving: editing?.i ?? null,
                            refused: editing?.settled === null,
                            selected: held,
                            bands: board.id === selectedId ? bands : undefined,
                            offcut,
                            play,
                            onHover: p => {
                              if (p && tool) preview(b, tool, p, null);
                              else if (edit?.i === null) setEdit(null);
                            },
                            onPlace: p => {
                              if (!tool) return;
                              onSelect(board.id);
                              // A click without hovering first (a finger): where it landed.
                              const f = fixtureAt(tool, p, board, b.nest, instances, bit, nestOptions);
                              const fixtures = [...(board.fixtures ?? []), f];
                              const settled = settleBoard(board, instances, bit, fixtures, nestOptions);
                              setEdit(null);
                              if (!settled) {
                                onNote(
                                  reserved(f, settleInputOf(board, b.nest, instances, bit, nestOptions).input)
                                    ? 'That spot is kept clear: the XY zero corner is where you probe.'
                                    : `No room here on a ${b.nest.board.w} × ${b.nest.board.h} board. Slide along the edge, or use a bigger board.`
                                );
                                return;
                              }
                              setSelectedHold({ board: board.id, i: fixtures.length - 1 });
                              onBoardEdit(settled, layoutChange(b.nest, nestBoard(settled, instances, bit, nestOptions), instances));
                            },
                            onSelect: k => {
                              onSelect(board.id);
                              setSelectedHold(k === null ? null : { board: board.id, i: k });
                            },
                            onDrag: (k, p) => {
                              const f = board.fixtures?.[k];
                              if (f) preview(b, f.kind, p, k);
                            },
                            onDrop: () => commit(b),
                            onRemove: k => {
                              setSelectedHold(null);
                              onBoardEdit(
                                { ...board, fixtures: (board.fixtures ?? []).filter((_, j) => j !== k) },
                                'Removed. Parts stay where they are; Tighten layout closes the gaps.'
                              );
                            },
                          }
                        : undefined
                    }
                    onTabsChange={
                      onTabsMove && board.retention === 'tabs' && !tool ? (item, tabs) => onTabsMove(board.id, item, tabs) : undefined
                    }
                  />
                  {/* On each part's upper right corner: its pin and holding badges, and the ⋯ menu of the part last touched. */}
                  {!dragging &&
                    !tool &&
                    nest.placements.map(p => {
                      const inst = byId.get(p.id);
                      if (!inst) return null;
                      const r = placedRect(p, inst);
                      const pinned = !!board.pinned?.includes(p.id);
                      const holding = holdingOf(p.id);
                      const mine = active === p.id;
                      if (!pinned && (!holding || holding === 'placed') && !mine) return null;
                      return (
                        <div
                          key={p.id}
                          data-part-marks={inst.name}
                          className="pointer-events-none absolute flex -translate-x-full items-center gap-0.5 p-0.5 *:pointer-events-auto"
                          style={{ left: (r.x + r.w) * pxPerMm + padPx, top: (nest.board.h - r.y - r.h) * pxPerMm + padPx }}>
                          <PartBadges pinned={pinned} holding={holding} />
                          {mine && (
                            <DropdownMenu open={menu} onOpenChange={setMenu}>
                              <DropdownMenuTrigger asChild>
                                <button
                                  aria-label={`${inst.name} menu`}
                                  title="Move it to another board, or unpin it"
                                  className="rounded-full border bg-background px-1 text-muted-foreground shadow-sm hover:text-foreground">
                                  <MoreHorizontal className="size-3.5" />
                                </button>
                              </DropdownMenuTrigger>
                              <PartMenuContent {...partMenu(b, p.id)} />
                            </DropdownMenu>
                          )}
                        </div>
                      );
                    })}
                </div>
                {nest.unplaced.length > 0 && (
                  <div
                    role="group"
                    aria-label={`Doesn’t fit on board ${board.name}`}
                    className="flex w-0 min-w-full flex-col gap-1 rounded-md border border-dashed border-destructive/60 bg-destructive/5 p-1.5">
                    <span className="text-xs text-destructive">
                      Doesn’t fit on this board: drag onto another {fmt(board.thickness)} mm board, or use its ⋯ menu.
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {nest.unplaced.map(id => {
                        const name = byId.get(id)?.name ?? id;
                        return (
                          <span
                            key={id}
                            data-item={id}
                            data-unplaced={name}
                            tabIndex={-1}
                            onPointerDown={e => startDrag(b, id, e)}
                            className={cn(
                              'inline-flex cursor-grab touch-none items-center gap-0.5 rounded-full bg-background py-0.5 pr-0.5 pl-2 text-xs text-destructive ring-1 ring-destructive outline-none active:cursor-grabbing',
                              dragging?.item === id && 'opacity-30'
                            )}>
                            {name}
                            <PartBadges pinned={!!board.pinned?.includes(id)} holding={holdingOf(id)} />
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  aria-label={`${name} menu`}
                                  onPointerDown={e => e.stopPropagation()}
                                  className="ml-0.5 rounded-full px-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                                  <MoreHorizontal className="size-3" />
                                </button>
                              </DropdownMenuTrigger>
                              <PartMenuContent {...partMenu(b, id)} />
                            </DropdownMenu>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
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
