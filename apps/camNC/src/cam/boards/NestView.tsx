import { cn } from '@wbcnc/ui/lib/utils';
import { useId, useState } from 'react';
import type { BoardNest, PartInstance, PartPosition } from '../boards';
import type { CamPartInfo, PlanResult } from '../camTypes';
import { place, toD } from './outline';
import { holdBox, pathClearance, type HoldKind } from '@wbcnc/cam/holdPoints';
import type { BoardSide, EdgeFit } from '@wbcnc/cam/settle';

/** Where a dragged part would land on this board; `fits` false: it fits nowhere, drawn in red at the pointer. */
export interface NestPreview {
  item: string;
  at: PartPosition;
  fits: boolean;
}

type P2 = { x: number; y: number };

/** Placing and moving the board's fixtures on its drawing. */
export interface FixtureEditing {
  /** A fixture to place: a click puts it there, whatever is under the pointer. */
  tool: HoldKind | null;
  /** The one in `nest.holds` being placed: a preview, it doesn't take the pointer. */
  preview: number | null;
  /** The one being dragged: it keeps the pointer it has captured. */
  moving: number | null;
  /** The one placed or dragged has no room there. */
  refused?: boolean;
  selected: number | null;
  /** Where clamps fit along the edges. */
  bands?: { side: BoardSide; at: number; step: number; fit: EdgeFit }[];
  offcut?: { x: number; y: number; w: number; h: number } | null;
  /** How far off the previewed or selected fixture can be: a clamp along its edge, a screw all round. */
  play?: { kind: 'clamp'; lo: number; hi: number; side: BoardSide } | { kind: 'screw'; x: number; y: number; r: number } | null;
  onHover: (p: P2 | null) => void;
  onPlace: (p: P2) => void;
  onSelect: (i: number | null) => void;
  onDrag: (i: number, p: P2) => void;
  onDrop: (i: number) => void;
  onRemove: (i: number) => void;
  /** Right-click on one: its menu. */
  onMenu?: (i: number) => void;
}

/**
 * Top view of a board: its parts at their positions (outline, pockets, holes), its hold points (screws or
 * clamps, placed and dragged here), tabs from the generated program, what comes loose during the job, XY zero at the lower left. Y up, like the machine. With `pxPerMm`, drawn at that scale (so
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
  onPartContextMenu,
  unheld,
  fixtures,
  onTabsChange,
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
  /** Right-click on a body: its menu. */
  onPartContextMenu?: (item: string, e: React.MouseEvent) => void;
  /** Bodies (instance id) whose tabs can't hold them: drawn red. */
  unheld?: Set<string>;
  fixtures?: FixtureEditing;
  /** A tab dragged along a part's outline: all of that body's tabs (instance id), part frame (mm). */
  onTabsChange?: (item: string, tabs: { x: number; y: number }[]) => void;
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
  // The fixture being dragged, once it has moved.
  const [holdDrag, setHoldDrag] = useState<{ i: number; moved: boolean; start: P2 } | null>(null);
  const hatch = useId();
  // A tab being dragged: its part, which of its tabs, and where it is now (on the part's outline).
  const [tabDrag, setTabDrag] = useState<{ part: string; i: number; x: number; y: number } | null>(null);
  const placedOf = (name: string) => {
    const p = nest.placements.find(q => byInst.get(q.id)?.name === name);
    const inst = p && byInst.get(p.id);
    const part = inst && byPart.get(inst.partId);
    return p && inst && part ? { p, inst, part } : undefined;
  };
  // Board frame -> the body's own frame (as laid flat), the inverse of `place`.
  const toPart = (p: PartPosition, size: number[], q: { x: number; y: number }) =>
    p.rotated
      ? { x: +(q.y - p.y).toFixed(1), y: +(p.x + size[1] - q.x).toFixed(1) }
      : { x: +(q.x - p.x).toFixed(1), y: +(q.y - p.y).toFixed(1) };
  // The point of the body's outlines nearest to `q`, board frame: where a dragged tab goes.
  const onOutline = (name: string, q: { x: number; y: number }) => {
    const at = placedOf(name);
    if (!at) return q;
    const f = place(at.p, at.inst.size);
    let best = q,
      d = Infinity;
    for (const path of at.part.shape.outlines)
      for (let k = 0; k < path.length; k++) {
        const [ax, ay] = f(path[k]),
          [bx, by] = f(path[(k + 1) % path.length]);
        const dx = bx - ax,
          dy = by - ay;
        const l2 = dx * dx + dy * dy;
        const t = l2 ? Math.min(1, Math.max(0, ((q.x - ax) * dx + (q.y - ay) * dy) / l2)) : 0;
        const p = { x: ax + t * dx, y: ay + t * dy };
        const e = Math.hypot(p.x - q.x, p.y - q.y);
        if (e < d) [best, d] = [p, e];
      }
    return best;
  };
  // A body's tabs as the program has them (one per spot, though each pass through lists it), board frame.
  const tabsOf = (h: NonNullable<PlanResult['hold']>[number]) =>
    h.tabs.map(t => t.at).filter((q, k, list) => !list.slice(0, k).some(o => Math.hypot(o.x - q.x, o.y - q.y) < 1));
  const saveTabs = (name: string, tabs: { x: number; y: number }[]) => {
    const at = placedOf(name);
    if (at && onTabsChange)
      onTabsChange(
        at.p.id,
        tabs.map(q => toPart(at.p, at.inst.size, q))
      );
  };
  // Never the last one: a part with none is cut free; "I hold it down" says that.
  const remove = (h: NonNullable<PlanResult['hold']>[number], i: number) => {
    const gone = h.tabs[i].at;
    const rest = tabsOf(h).filter(q => Math.hypot(q.x - gone.x, q.y - gone.y) >= 1);
    if (rest.length) saveTabs(h.part, rest);
  };
  /** A double-click on a body: a tab on its outline nearest the pointer. */
  const addTab = (name: string, e: React.MouseEvent) => {
    const h = plan?.hold?.find(x => x.part === name);
    const p = toFrame(e);
    if (!h || !p) return;
    saveTabs(name, [...tabsOf(h), onOutline(name, p)]);
  };
  const clash = new Set((plan?.holdClash ?? []).map(p => `${p.x},${p.y}`));
  const toFrame = (e: React.MouseEvent) => {
    const frame = (e.currentTarget as SVGElement).closest('[data-board-frame]') as SVGGraphicsElement | null;
    const m = frame?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.round(Math.min(w, Math.max(0, p.x)) * 10) / 10, y: Math.round(Math.min(h, Math.max(0, p.y)) * 10) / 10 };
  };
  /** Pointer -> board frame, off the board too: a clamp grips the nearest edge from outside it. */
  const toBoard = (e: React.MouseEvent<SVGSVGElement>) => {
    const m = e.currentTarget.querySelector<SVGGraphicsElement>('[data-board-frame]')?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const onHold = (e: React.MouseEvent) => !!(e.target as Element).closest('[data-hold],[data-remove]');
  return (
    <svg
      onPointerMove={
        fixtures?.tool
          ? e => {
              // Over a fixture that's there, the tool steps aside: its hand cursor, and a drag moves it.
              const p = onHold(e) ? null : toBoard(e);
              fixtures.onHover(p);
            }
          : undefined
      }
      onPointerLeave={fixtures?.tool ? () => fixtures.onHover(null) : undefined}
      onClick={
        fixtures?.tool
          ? e => {
              if (onHold(e)) return;
              const p = toBoard(e);
              if (p) fixtures.onPlace(p);
            }
          : undefined
      }
      style={fixtures?.tool ? { cursor: 'crosshair' } : undefined}
      viewBox={`${-pad} ${-h - pad} ${w + 2 * pad} ${h + 2 * pad}`}
      width={pxPerMm && (w + 2 * pad) * pxPerMm}
      height={pxPerMm && (h + 2 * pad) * pxPerMm}
      className={className}
      role={interactive ? 'group' : 'img'}
      aria-label={label ?? `Board ${w} by ${h} mm with ${nest.placements.length} parts`}>
      <defs>
        <pattern id={hatch} width={u / 120} height={u / 120} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={u / 120} height={u / 120} className="fill-red-500/10" />
          <line x1={0} y1={0} x2={0} y2={u / 120} className="stroke-red-500/60" strokeWidth={u / 400} />
        </pattern>
      </defs>
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
        {/* Where a clamp fits: outside the edge, while placing one. */}
        {fixtures?.tool === 'clamp' &&
          fixtures.preview === null &&
          fixtures.moving === null &&
          fixtures.bands?.map(b => {
            const t = stroke * 5,
              off = stroke * 5,
              a = b.at - b.step / 2;
            const r =
              b.side === 'left'
                ? { x: -off - t, y: a, width: t, height: b.step }
                : b.side === 'right'
                  ? { x: w + off, y: a, width: t, height: b.step }
                  : b.side === 'bottom'
                    ? { x: a, y: -off - t, width: b.step, height: t }
                    : { x: a, y: h + off, width: b.step, height: t };
            return (
              <rect
                key={`${b.side}-${b.at}`}
                {...r}
                data-edge-fit={b.fit}
                className={cn(
                  'pointer-events-none',
                  b.fit === 'free' ? 'fill-emerald-500/80' : b.fit === 'moves' ? 'fill-amber-400/80' : 'fill-red-500/70'
                )}
              />
            );
          })}
        {/* The largest piece left over: worth keeping in one piece. */}
        {fixtures?.offcut && (
          <rect
            data-offcut
            {...{ x: fixtures.offcut.x, y: fixtures.offcut.y, width: fixtures.offcut.w, height: fixtures.offcut.h }}
            className="pointer-events-none fill-emerald-500/5 stroke-emerald-500/70"
            strokeWidth={stroke}
            strokeDasharray={`${stroke * 6} ${stroke * 4}`}
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
              aria-label={interactive ? `${inst.name}: drag, or move with the arrow keys; Enter opens its menu` : undefined}
              onPointerDown={onPartPointerDown && (e => onPartPointerDown(p.id, e))}
              onDoubleClick={onTabsChange && plan?.hold?.some(x => x.part === inst.name) ? e => addTab(inst.name, e) : undefined}
              onKeyDown={onPartKeyDown && (e => onPartKeyDown(p.id, e))}
              onFocus={onPartFocus && (() => onPartFocus(p.id))}
              onContextMenu={onPartContextMenu && (e => onPartContextMenu(p.id, e))}
              className={cn(
                interactive && 'cursor-grab outline-none active:cursor-grabbing [&:focus-visible>path:first-child]:stroke-primary',
                dragging === p.id && 'opacity-30'
              )}>
              <path
                d={toD(part.shape.outlines, f)}
                className={
                  unheld?.has(p.id)
                    ? 'fill-red-500/30 stroke-red-600'
                    : selected
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
        {/* Tabs to drag along the outline (the planner puts each on the bit's path nearest to where it's dropped). */}
        {onTabsChange &&
          plan?.hold?.flatMap(h => {
            const at = placedOf(h.part);
            if (!at) return [];
            return h.tabs.map((t, i) => {
              const dragged = tabDrag?.part === h.part && tabDrag.i === i;
              const pos = dragged ? tabDrag : t.at;
              return (
                <circle
                  key={`tab-${h.part}-${i}`}
                  data-tab={h.part}
                  role="button"
                  aria-label={`${h.part}: tab ${i + 1}, drag along the outline to move; double-click or Delete removes it`}
                  tabIndex={0}
                  cx={pos.x}
                  cy={pos.y}
                  r={stroke * 6}
                  className={cn(
                    'cursor-move stroke-amber-600 dark:stroke-amber-500',
                    dragged ? 'fill-amber-500/70' : 'fill-amber-500/0 hover:fill-amber-500/40'
                  )}
                  strokeWidth={stroke * 1.5}
                  onPointerDown={e => {
                    e.stopPropagation();
                    e.preventDefault();
                    (e.currentTarget as SVGCircleElement).setPointerCapture(e.pointerId);
                    setTabDrag({ part: h.part, i, x: t.at.x, y: t.at.y });
                  }}
                  onPointerMove={e => {
                    if (!dragged) return;
                    const p = toFrame(e);
                    if (p) setTabDrag({ part: h.part, i, ...onOutline(h.part, p) });
                  }}
                  onPointerUp={e => {
                    if (!dragged) return;
                    e.stopPropagation();
                    setTabDrag(null);
                    if (Math.hypot(tabDrag.x - t.at.x, tabDrag.y - t.at.y) < 0.5) return;
                    const from = t.at;
                    saveTabs(
                      h.part,
                      tabsOf(h).map(q => (Math.hypot(q.x - from.x, q.y - from.y) < 1 ? { x: tabDrag.x, y: tabDrag.y } : q))
                    );
                  }}
                  onClick={e => e.stopPropagation()}
                  onDoubleClick={e => {
                    e.stopPropagation();
                    remove(h, i);
                  }}
                  onKeyDown={e => {
                    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
                    e.preventDefault();
                    e.stopPropagation();
                    remove(h, i);
                  }}>
                  <title>
                    {h.tabs.length > 1
                      ? `${h.part}: drag the tab along the outline; double-click removes it`
                      : `${h.part}: its only tab, drag it along the outline`}
                  </title>
                </circle>
              );
            });
          })}
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
        {/* Where the bit can't come, and how far off a fixture can be. */}
        {fixtures &&
          nest.holds.map((hp, i) => {
            const keep = pathClearance(hp, nest.bit / 2) + nest.bit / 2;
            const box = holdBox(hp);
            return hp.kind === 'screw' ? (
              <circle
                key={`zone-${i}`}
                data-blocked
                cx={hp.x}
                cy={hp.y}
                r={hp.d / 2 + keep}
                fill={`url(#${hatch})`}
                className="pointer-events-none stroke-red-500/40"
                strokeWidth={stroke / 2}
              />
            ) : (
              <rect
                key={`zone-${i}`}
                data-blocked
                x={box.x - keep}
                y={box.y - keep}
                width={box.w + 2 * keep}
                height={box.h + 2 * keep}
                fill={`url(#${hatch})`}
                className="pointer-events-none stroke-red-500/40"
                strokeWidth={stroke / 2}
              />
            );
          })}
        {fixtures?.play?.kind === 'screw' && fixtures.play.r > 0 && (
          <circle
            data-play
            cx={fixtures.play.x}
            cy={fixtures.play.y}
            r={fixtures.play.r}
            className="pointer-events-none fill-none stroke-emerald-500"
            strokeWidth={stroke * 1.5}
          />
        )}
        {fixtures?.play?.kind === 'clamp' &&
          (() => {
            const { lo, hi, side } = fixtures.play;
            const off = stroke * 22;
            const line =
              side === 'left' || side === 'right'
                ? { x1: side === 'left' ? -off : w + off, x2: side === 'left' ? -off : w + off, y1: lo, y2: hi }
                : { y1: side === 'bottom' ? -off : h + off, y2: side === 'bottom' ? -off : h + off, x1: lo, x2: hi };
            return <line data-play {...line} className="pointer-events-none stroke-emerald-500" strokeWidth={stroke * 2.5} />;
          })()}
        {nest.holds.map((hp, i) => {
          const isPreview = fixtures?.preview === i;
          const isMoving = fixtures?.moving === i;
          const bad = (clash.has(`${hp.x},${hp.y}`) && !isPreview && !isMoving) || ((isPreview || isMoving) && !!fixtures?.refused);
          const r = hp.d / 2;
          const box = holdBox(hp);
          const interactive = !!fixtures && !isPreview;
          const post = u / 45;
          // The clamp's body, beside the board.
          const body =
            hp.kind !== 'clamp' || !hp.dir
              ? null
              : hp.dir.x === 1
                ? { x: -post, y: box.y - 3, width: post, height: box.h + 6 }
                : hp.dir.x === -1
                  ? { x: w, y: box.y - 3, width: post, height: box.h + 6 }
                  : hp.dir.y === 1
                    ? { x: box.x - 3, y: -post, width: box.w + 6, height: post }
                    : { x: box.x - 3, y: h, width: box.w + 6, height: post };
          return (
            <g
              key={`hold-${i}`}
              data-hold={isPreview ? undefined : hp.kind}
              data-hold-preview={isPreview ? hp.kind : undefined}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={interactive ? `${hp.kind === 'screw' ? 'Screw' : 'Clamp'} ${i + 1}: drag to move, Delete removes it` : undefined}
              className={cn(interactive && 'cursor-grab outline-none active:cursor-grabbing', isPreview && 'opacity-85')}
              // A preview follows the pointer: if it took the click, nothing could be placed where the pointer is.
              style={isPreview ? { pointerEvents: 'none' } : undefined}
              onPointerDown={
                interactive
                  ? e => {
                      // A right-click is for its menu: it never moves the fixture, however the mouse drifts.
                      if (e.button !== 0 || e.ctrlKey) return;
                      e.stopPropagation();
                      e.preventDefault();
                      (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
                      const p = toFrame(e);
                      setHoldDrag({ i, moved: false, start: p ?? { x: hp.x, y: hp.y } });
                      fixtures!.onSelect(i);
                    }
                  : undefined
              }
              onPointerMove={
                interactive
                  ? e => {
                      if (holdDrag?.i !== i) return;
                      const p = toFrame(e);
                      if (!p || (!holdDrag.moved && Math.hypot(p.x - holdDrag.start.x, p.y - holdDrag.start.y) < u / 300)) return;
                      if (!holdDrag.moved) setHoldDrag({ ...holdDrag, moved: true });
                      fixtures!.onDrag(i, p);
                    }
                  : undefined
              }
              onPointerUp={
                interactive
                  ? e => {
                      if (holdDrag?.i !== i) return;
                      e.stopPropagation();
                      const { moved } = holdDrag;
                      setHoldDrag(null);
                      if (moved) fixtures!.onDrop(i);
                    }
                  : undefined
              }
              onKeyDown={
                interactive
                  ? e => {
                      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
                      e.preventDefault();
                      fixtures!.onRemove(i);
                    }
                  : undefined
              }
              onFocus={interactive ? () => fixtures!.onSelect(i) : undefined}
              onClick={e => e.stopPropagation()}
              onContextMenu={
                interactive && fixtures?.onMenu
                  ? e => {
                      e.preventDefault();
                      fixtures.onMenu!(i);
                    }
                  : undefined
              }>
              {body && (
                <rect
                  {...body}
                  rx={post / 5}
                  className={bad ? 'fill-red-500/50 stroke-red-600' : 'fill-muted-foreground/40 stroke-foreground'}
                  strokeWidth={stroke}
                />
              )}
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
                {bad && !isPreview && !isMoving
                  ? 'The bit would hit this: move it into the waste.'
                  : hp.kind === 'clamp' && hp.w !== undefined
                    ? `Clamp: ${hp.w} mm wide, reaching ${hp.d} mm in`
                    : `${hp.kind === 'screw' ? 'Screw' : 'Clamp'} ⌀${hp.d} mm`}
              </title>
            </g>
          );
        })}
        {fixtures?.selected !== null &&
          fixtures?.selected !== undefined &&
          fixtures.preview === null &&
          fixtures.moving === null &&
          nest.holds[fixtures.selected] &&
          (() => {
            const i = fixtures.selected;
            const hp = nest.holds[i];
            const size = u / 70;
            const inwards = hp.dir ?? { x: 0, y: 1 };
            const [x, y] = [hp.x + inwards.x * size * 2.4, hp.y + inwards.y * size * 2.4];
            return (
              <g
                data-remove
                role="button"
                aria-label={`Remove ${hp.kind === 'screw' ? 'screw' : 'clamp'} ${i + 1}`}
                className="cursor-pointer"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation();
                  fixtures.onRemove(i);
                }}>
                <circle cx={x} cy={y} r={size} className="fill-red-700 stroke-white" strokeWidth={stroke} />
                <path
                  d={`M${x - size * 0.4},${y - size * 0.4}L${x + size * 0.4},${y + size * 0.4}M${x + size * 0.4},${y - size * 0.4}L${x - size * 0.4},${y + size * 0.4}`}
                  className="stroke-white"
                  strokeWidth={stroke * 1.5}
                />
              </g>
            );
          })()}
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
      {fixtures?.offcut && (
        <text
          x={fixtures.offcut.x + fixtures.offcut.w / 2}
          y={-(fixtures.offcut.y + fixtures.offcut.h / 2)}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={u / 50}
          className="pointer-events-none fill-emerald-600 font-mono dark:fill-emerald-400">
          {Math.round(fixtures.offcut.w)} × {Math.round(fixtures.offcut.h)}
        </text>
      )}
      {fixtures?.play?.kind === 'screw' && fixtures.play.r > 0 && (
        <text
          x={fixtures.play.x}
          y={-(fixtures.play.y + fixtures.play.r + u / 100)}
          textAnchor="middle"
          fontSize={u / 55}
          className="pointer-events-none fill-emerald-600 font-mono dark:fill-emerald-400">
          ±{Math.round(fixtures.play.r)} mm
        </text>
      )}
      <text x={0} y={pad * 0.8} fontSize={u / 50} className="pointer-events-none fill-emerald-700 dark:fill-emerald-400">
        XY zero · lower left
      </text>
    </svg>
  );
}
