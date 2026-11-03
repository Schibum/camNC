import { MATERIALS } from '@wbcnc/cam/settings';
import { Button } from '@wbcnc/ui/components/button';
import { Input } from '@wbcnc/ui/components/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { cn } from '@wbcnc/ui/lib/utils';
import { GripVertical, MoreHorizontal, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { kHoldDownLabels, type BoardV1, type PartInstance, type StockBoardV1 } from '../boards';
import type { PlanResult } from '../camTypes';
import type { JobBoard } from '../useJobBoards';
import { kDragType, useBoardDrag } from './boardDrag';

const fmt = (v: number) => `${+v.toFixed(1)}`;
const sameThickness = (a: number, b: number) => +a.toFixed(1) === +b.toFixed(1);

/**
 * Boards with their bodies, and the stock list. A body moves to another board of the same thickness by dragging its
 * chip (or the part in the nest view) onto that board, or with its "Move to…" menu; dropping on "New board" splits it
 * onto a board of its own. Parts moved by hand are pinned (auto-fill leaves them on their board) until unpinned.
 */
export function BoardList({
  boards,
  instances,
  plans,
  selectedId,
  onSelect,
  onMove,
  onNewBoard,
  onUnpin,
  stock,
  onStockChange,
}: {
  boards: JobBoard[];
  instances: PartInstance[];
  plans: (PlanResult | undefined)[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Move a body to another board; false if it can't go there (other thickness). */
  onMove: (itemId: string, boardId: string) => boolean;
  /** Put a body on a new board of its thickness. */
  onNewBoard: (itemId: string) => void;
  /** Let auto-fill move a body again. */
  onUnpin: (itemId: string) => void;
  stock: StockBoardV1[];
  onStockChange: (stock: StockBoardV1[]) => void;
}) {
  const byId = new Map(instances.map(i => [i.id, i]));
  const drag = useBoardDrag();
  const [over, setOver] = useState<string | null>(null);
  const dropped = (id: string | null, target: string | 'new') => {
    drag.end();
    setOver(null);
    if (!id) return;
    if (target === 'new') onNewBoard(id);
    else onMove(id, target);
  };
  const lonely = boards.some(b => boards.filter(x => sameThickness(x.board.thickness, b.board.thickness)).length === 1);
  return (
    <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-r p-4">
      <h2 className="text-[15px] font-semibold">Boards</h2>
      {boards.map(({ board, nest }, i) => {
        const bits = plans[i]?.bits ?? [];
        const dragging = drag.item !== null && !board.items.includes(drag.item);
        const fits = dragging && sameThickness(drag.thickness!, board.thickness);
        return (
          <section
            key={board.id}
            aria-label={`Board ${board.name}`}
            data-board-drop={board.id}
            onClick={() => onSelect(board.id)}
            onDragOver={e => {
              if (drag.item || e.dataTransfer.types.includes(kDragType)) {
                e.preventDefault();
                setOver(board.id);
              }
            }}
            onDragLeave={() => setOver(o => (o === board.id ? null : o))}
            onDrop={e => {
              e.preventDefault();
              dropped(e.dataTransfer.getData(kDragType) || drag.item, board.id);
            }}
            className={cn(
              'flex cursor-pointer flex-col gap-1.5 rounded-lg border border-transparent bg-muted/40 p-3 hover:bg-muted',
              board.id === selectedId && 'border-primary bg-muted',
              fits && 'border-dashed border-primary',
              dragging && !fits && 'opacity-50',
              over === board.id && fits && 'ring-2 ring-primary'
            )}>
            <div className="flex justify-between gap-2">
              <span className="font-medium">
                {board.name} · {MATERIALS[board.material].name[0].toUpperCase() + MATERIALS[board.material].name.slice(1)}{' '}
                {fmt(board.thickness)} mm
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {fits ? 'Drop here' : dragging ? 'different thickness' : `${fmt(nest.board.w)} × ${fmt(nest.board.h)}`}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {board.items.map(id => (
                <PartChip
                  key={id}
                  name={byId.get(id)?.name ?? id}
                  unplaced={nest.unplaced.includes(id)}
                  pinned={!!board.pinned?.includes(id)}
                  onUnpin={() => onUnpin(id)}
                  onDragStart={() => drag.start(id, byId.get(id)?.thickness ?? board.thickness)}
                  onDragEnd={() => {
                    drag.end();
                    setOver(null);
                  }}
                  dragId={id}
                  targets={boards
                    .filter(b => b.board.id !== board.id && sameThickness(b.board.thickness, board.thickness))
                    .map(b => b.board)}
                  onMoveTo={target => (target === 'new' ? onNewBoard(id) : onMove(id, target))}
                />
              ))}
              {!board.items.length && <span className="text-xs text-muted-foreground">Empty: drag parts here</span>}
            </div>
            <span className="text-xs text-muted-foreground">
              {kHoldDownLabels[board.holdDown]} · {bits.length || 1} {bits.length > 1 ? 'bits' : 'bit'}
              {nest.unplaced.length > 0 && <span className="text-destructive"> · {nest.unplaced.length} don’t fit</span>}
            </span>
          </section>
        );
      })}
      {drag.item && (
        <div
          data-new-board-drop
          aria-label="New board"
          onDragOver={e => {
            e.preventDefault();
            setOver('new');
          }}
          onDragLeave={() => setOver(o => (o === 'new' ? null : o))}
          onDrop={e => {
            e.preventDefault();
            dropped(e.dataTransfer.getData(kDragType) || drag.item, 'new');
          }}
          className={cn(
            'flex h-14 items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm text-muted-foreground',
            over === 'new' && 'border-primary text-foreground'
          )}>
          <Plus className="size-4" /> Drop here for a new board
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Drag a part (here or in the board view) onto another board of the same thickness, or use its ⋯ menu.
        {lonely && ' To split parts onto another board: ⋯ › Move to › New board.'}
      </p>
      <StockList stock={stock} onChange={onStockChange} />
    </aside>
  );
}

/** A body on a board: drag handle, name, and a "Move to…" menu as the non-drag way. */
function PartChip({
  name,
  dragId,
  unplaced,
  pinned,
  onUnpin,
  targets,
  onDragStart,
  onDragEnd,
  onMoveTo,
}: {
  name: string;
  dragId: string;
  unplaced: boolean;
  pinned: boolean;
  onUnpin: () => void;
  targets: BoardV1[];
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoveTo: (board: string | 'new') => void;
}) {
  return (
    <span
      draggable
      onDragStart={e => {
        e.dataTransfer.setData(kDragType, dragId);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={e => e.stopPropagation()}
      title="Drag onto another board of the same thickness"
      className={cn(
        'inline-flex cursor-grab items-center gap-0.5 rounded-full bg-background py-0.5 pl-1 pr-0.5 text-xs ring-1 ring-border active:cursor-grabbing',
        unplaced && 'text-destructive ring-destructive'
      )}>
      <GripVertical className="size-3 text-muted-foreground" aria-hidden />
      {name}
      {pinned && (
        <span role="img" aria-label="Placed by hand" title="Placed by hand: auto-fill keeps it on this board">
          <Pin className="size-3 text-muted-foreground" aria-hidden />
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Move ${name}`}
            className="ml-0.5 rounded-full px-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <MoreHorizontal className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel className="text-xs">Move {name} to</DropdownMenuLabel>
          {targets.map(b => (
            <DropdownMenuItem key={b.id} onSelect={() => onMoveTo(b.id)}>
              Board {b.name}
            </DropdownMenuItem>
          ))}
          {targets.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => onMoveTo('new')}>
            <Plus className="size-3" /> New board
          </DropdownMenuItem>
          {pinned && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onUnpin}>
                <PinOff className="size-3" /> Let auto-fill move it
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function StockList({ stock, onChange }: { stock: StockBoardV1[]; onChange: (s: StockBoardV1[]) => void }) {
  const [draft, setDraft] = useState({ thickness: '', w: '', h: '', quantity: '' });
  const quantity = draft.quantity.trim() ? Number(draft.quantity) : undefined;
  const valid =
    [draft.thickness, draft.w, draft.h].every(v => parseFloat(v) > 0) &&
    (quantity === undefined || (Number.isInteger(quantity) && quantity > 0));
  return (
    <section aria-label="Stock list" className="mt-2 flex flex-col gap-2 border-t pt-3">
      <h3 className="text-[13px] font-semibold">Stock list</h3>
      {stock.map(s => (
        <div key={s.id} className="flex items-center justify-between font-mono text-xs">
          <span>
            {fmt(s.thickness)} mm · {fmt(s.w)} × {fmt(s.h)}
            {s.quantity !== undefined && ` · ${s.quantity} pcs`}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="Remove stock board"
            onClick={() => onChange(stock.filter(x => x !== s))}>
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}
      <form
        className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-1"
        onSubmit={e => {
          e.preventDefault();
          if (!valid) return;
          onChange([
            ...stock,
            { id: crypto.randomUUID(), thickness: +draft.thickness, w: +draft.w, h: +draft.h, ...(quantity && { quantity }) },
          ]);
          setDraft({ thickness: '', w: '', h: '', quantity: '' });
        }}>
        <Input
          aria-label="Stock thickness"
          placeholder="t"
          className="h-7 px-1.5 font-mono text-xs"
          value={draft.thickness}
          onChange={e => setDraft({ ...draft, thickness: e.target.value })}
        />
        <Input
          aria-label="Stock width"
          placeholder="W"
          className="h-7 px-1.5 font-mono text-xs"
          value={draft.w}
          onChange={e => setDraft({ ...draft, w: e.target.value })}
        />
        <Input
          aria-label="Stock height"
          placeholder="H"
          className="h-7 px-1.5 font-mono text-xs"
          value={draft.h}
          onChange={e => setDraft({ ...draft, h: e.target.value })}
        />
        <Input
          aria-label="Stock quantity"
          placeholder="pcs"
          className="h-7 px-1.5 font-mono text-xs"
          value={draft.quantity}
          onChange={e => setDraft({ ...draft, quantity: e.target.value })}
        />
        <Button type="submit" variant="outline" size="icon" className="size-7" aria-label="Add stock board" disabled={!valid}>
          <Plus className="size-3" />
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Boards you have, in mm, and how many (empty: as many as needed). “Auto-fill from stock” puts the parts on as little of them as it
        can and keeps parts you moved by hand where they are.
      </p>
    </section>
  );
}
