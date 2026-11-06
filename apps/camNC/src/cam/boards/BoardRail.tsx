import { cn } from '@wbcnc/ui/lib/utils';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useRef } from 'react';
import { boardLabel, holdVerdict, placedRect, type PartInstance } from '../boards';
import type { CamPartInfo } from '../camTypes';
import type { HoldHardware } from '../holdHardware';
import type { JobBoard } from '../useJobBoards';
import { place, toD } from './outline';

/** Thumbnails' longest side, px: all at one scale, so they still compare the boards' sizes. */
const kThumb = 112;
/** The list's width, px. */
const kOpenWidth = 148;

const dotClass = (tone: 'ok' | 'warn' | 'none') =>
  tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-muted-foreground';

function Thumb({ job, instances, parts, scale }: { job: JobBoard; instances: PartInstance[]; parts: CamPartInfo[]; scale: number }) {
  const { w, h } = job.nest.board;
  return (
    <svg aria-hidden width={w * scale} height={h * scale} viewBox={`0 ${-h} ${w} ${h}`} className="max-w-full">
      <g transform="scale(1,-1)">
        <rect width={w} height={h} className="fill-amber-700/15 dark:fill-amber-400/10" />
        {job.nest.placements.map(p => {
          const inst = instances.find(i => i.id === p.id);
          const part = inst && parts.find(x => x.id === inst.partId);
          if (!inst) return null;
          const r = placedRect(p, inst);
          return part ? (
            <path key={p.id} d={toD(part.shape.outlines, place(p, inst.size))} className="fill-amber-600/40 dark:fill-amber-400/50" />
          ) : (
            <rect key={p.id} x={r.x} y={r.y} width={r.w} height={r.h} className="fill-amber-600/40 dark:fill-amber-400/50" />
          );
        })}
      </g>
    </svg>
  );
}

/**
 * Every board, small, beside the one being edited: click one to edit it, drop a part on one to move it there. Collapsed, a
 * strip of status dots and letters; a part dragged to it opens the list over the drawing, without moving the board under the
 * pointer, and moved on along the board it stays out of the way.
 */
export function BoardRail({
  boards,
  instances,
  parts,
  selectedId,
  hardware,
  closed,
  dragging,
  dropOn,
  pointerX,
  onOpen,
  onToggle,
}: {
  boards: JobBoard[];
  instances: PartInstance[];
  parts: CamPartInfo[];
  selectedId: string;
  hardware: HoldHardware;
  closed: boolean;
  /** A part is being dragged: the boards are drop targets, with a new board among them. */
  dragging: boolean;
  /** The board under a part being dragged, and whether it can take it. */
  dropOn?: { board: string; ok: boolean } | 'new' | null;
  /** Where a part being dragged is: over the strip, the list opens. */
  pointerX?: number;
  onOpen: (id: string) => void;
  /** Open or close it; undefined where it stays a strip (a small screen has no width for more). */
  onToggle?: () => void;
}) {
  const unit = Math.max(...boards.map(b => Math.max(b.nest.board.w, b.nest.board.h)), 1);
  const scale = kThumb / unit;
  const strip = useRef<HTMLElement>(null);
  const opened = useRef(false);
  const edge = strip.current?.getBoundingClientRect().right ?? 44;
  opened.current = dragging && pointerX !== undefined && pointerX <= edge + (opened.current ? kOpenWidth : 8);
  const toneOf = ({ board, nest }: JobBoard) => holdVerdict(board, nest, hardware, instances).tone;
  const full = (
    <nav
      aria-label="Boards"
      className={cn(
        'flex w-[148px] shrink-0 flex-col gap-1 overflow-y-auto border-r bg-background p-2',
        closed && 'absolute inset-y-0 left-11 z-30 shadow-lg'
      )}>
      {!closed && (
        <button
          type="button"
          aria-label="Collapse board list"
          aria-expanded
          onClick={onToggle}
          className="flex shrink-0 items-center gap-1 rounded-md px-1 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronLeft className="size-3.5" /> Boards
        </button>
      )}
      {boards.map(job => {
        const { board, nest } = job;
        const over = dropOn && dropOn !== 'new' && dropOn.board === board.id ? dropOn : null;
        return (
          <button
            key={board.id}
            type="button"
            data-rail-drop={board.id}
            aria-label={boardLabel(board)}
            aria-current={board.id === selectedId ? 'true' : undefined}
            onClick={() => onOpen(board.id)}
            className={cn(
              'flex w-full shrink-0 flex-col items-start gap-1 rounded-md border border-transparent p-1.5 text-xs hover:bg-muted',
              board.id === selectedId && 'border-primary/60 bg-muted',
              dragging && board.id !== selectedId && 'border-dashed border-primary/60',
              over?.ok && 'border-solid border-primary bg-primary/10 ring-1 ring-primary',
              over && !over.ok && 'border-solid border-red-500 ring-1 ring-red-500'
            )}>
            <span className="flex w-full items-center gap-1.5">
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dotClass(toneOf(job)))} />
              <span className="truncate">{board.name}</span>
              {nest.unplaced.length > 0 && <span className="font-medium text-destructive">{nest.unplaced.length}!</span>}
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {nest.placements.length ? `${Math.round(nest.yield * 100)} %` : '–'}
              </span>
            </span>
            <Thumb job={job} instances={instances} parts={parts} scale={scale} />
          </button>
        );
      })}
      {dragging && (
        <div
          data-new-board-drop
          aria-label="New board"
          className={cn(
            'flex shrink-0 items-center justify-center gap-1 rounded-md border-2 border-dashed p-3 text-xs text-muted-foreground',
            dropOn === 'new' && 'border-primary bg-primary/5 text-foreground'
          )}>
          <Plus className="size-3" /> New board
        </div>
      )}
    </nav>
  );
  if (!closed) return full;
  return (
    <>
      <nav
        ref={strip}
        aria-label={opened.current ? 'Boards, collapsed' : 'Boards'}
        className="flex w-11 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r bg-background px-1 py-2">
        {onToggle && (
          <button
            type="button"
            aria-label="Show board list"
            aria-expanded={false}
            onClick={onToggle}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight className="size-3.5" />
          </button>
        )}
        {boards.map(job => (
          <button
            key={job.board.id}
            type="button"
            aria-label={boardLabel(job.board)}
            aria-current={job.board.id === selectedId ? 'true' : undefined}
            title={boardLabel(job.board)}
            onClick={() => onOpen(job.board.id)}
            className={cn(
              'flex w-9 shrink-0 flex-col items-center gap-0.5 rounded-md border border-transparent py-1 text-xs hover:bg-muted',
              job.board.id === selectedId && 'border-primary/60 bg-muted'
            )}>
            <span aria-hidden className={cn('size-2 rounded-full', dotClass(toneOf(job)))} />
            {job.board.name.charAt(0)}
          </button>
        ))}
      </nav>
      {opened.current && full}
    </>
  );
}
