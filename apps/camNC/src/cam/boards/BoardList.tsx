import { MATERIALS } from '@wbcnc/cam/settings';
import { Button } from '@wbcnc/ui/components/button';
import { Input } from '@wbcnc/ui/components/input';
import { cn } from '@wbcnc/ui/lib/utils';
import { Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { kHoldDownLabels, type PartInstance, type StockBoardV1 } from '../boards';
import type { PlanResult } from '../camTypes';
import type { JobBoard } from '../useJobBoards';

const kDragType = 'application/x-camnc-board-item';

const fmt = (v: number) => `${+v.toFixed(1)}`;

/** Boards (drop targets) with their bodies (draggable chips), and the stock list. */
export function BoardList({
  boards,
  instances,
  plans,
  selectedId,
  onSelect,
  onMove,
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
  stock: StockBoardV1[];
  onStockChange: (stock: StockBoardV1[]) => void;
}) {
  const byId = new Map(instances.map(i => [i.id, i]));
  const [over, setOver] = useState<string | null>(null);
  // The dragged body, in case the browser hides custom drag data (only text/plain is reliable everywhere).
  const dragged = useRef<string | null>(null);
  return (
    <aside className="flex min-h-0 flex-col gap-2.5 overflow-y-auto border-r p-4">
      <h2 className="text-[15px] font-semibold">Boards</h2>
      {boards.map(({ board, nest }, i) => {
        const bits = plans[i]?.bits ?? [];
        return (
          <section
            key={board.id}
            aria-label={`Board ${board.name}`}
            onClick={() => onSelect(board.id)}
            onDragOver={e => {
              if (dragged.current || e.dataTransfer.types.includes(kDragType)) {
                e.preventDefault();
                setOver(board.id);
              }
            }}
            onDragLeave={() => setOver(o => (o === board.id ? null : o))}
            onDrop={e => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData(kDragType) || dragged.current;
              dragged.current = null;
              if (id) onMove(id, board.id);
            }}
            className={cn(
              'flex cursor-pointer flex-col gap-1.5 rounded-lg border border-transparent bg-muted/40 p-3 hover:bg-muted',
              board.id === selectedId && 'border-primary bg-muted',
              over === board.id && 'ring-2 ring-primary'
            )}>
            <div className="flex justify-between gap-2">
              <span className="font-medium">
                {board.name} · {MATERIALS[board.material].name[0].toUpperCase() + MATERIALS[board.material].name.slice(1)}{' '}
                {fmt(board.thickness)} mm
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {fmt(nest.board.w)} × {fmt(nest.board.h)}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {board.items.map(id => (
                <span
                  key={id}
                  draggable
                  onDragStart={e => {
                    dragged.current = id;
                    e.dataTransfer.setData(kDragType, id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => (dragged.current = null)}
                  title="Drag onto another board of the same thickness"
                  className={cn(
                    'cursor-grab rounded-full bg-background px-2 py-0.5 text-xs ring-1 ring-border active:cursor-grabbing',
                    nest.unplaced.includes(id) && 'text-destructive ring-destructive'
                  )}>
                  {byId.get(id)?.name ?? id}
                </span>
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
      <p className="text-xs leading-relaxed text-muted-foreground">
        Drag a part between boards to regroup. Parts only go on boards of the same thickness.
      </p>
      <StockList stock={stock} onChange={onStockChange} />
    </aside>
  );
}

function StockList({ stock, onChange }: { stock: StockBoardV1[]; onChange: (s: StockBoardV1[]) => void }) {
  const [draft, setDraft] = useState({ thickness: '', w: '', h: '' });
  const valid = [draft.thickness, draft.w, draft.h].every(v => parseFloat(v) > 0);
  return (
    <section aria-label="Stock list" className="mt-2 flex flex-col gap-2 border-t pt-3">
      <h3 className="text-[13px] font-semibold">Stock list</h3>
      {stock.map(s => (
        <div key={s.id} className="flex items-center justify-between font-mono text-xs">
          <span>
            {fmt(s.thickness)} mm · {fmt(s.w)} × {fmt(s.h)}
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
        className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-1"
        onSubmit={e => {
          e.preventDefault();
          if (!valid) return;
          onChange([...stock, { id: crypto.randomUUID(), thickness: +draft.thickness, w: +draft.w, h: +draft.h }]);
          setDraft({ thickness: '', w: '', h: '' });
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
        <Button type="submit" variant="outline" size="icon" className="size-7" aria-label="Add stock board" disabled={!valid}>
          <Plus className="size-3" />
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Boards you have, in mm. “Auto-fill from stock” puts the parts on them.</p>
    </section>
  );
}
