import type { TabFallback } from '@wbcnc/cam';
import { usesTabs } from '@wbcnc/cam/board';
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
import { Check, GripVertical, MoreHorizontal, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { nutReaches } from '@wbcnc/cam/holdPoints';
import {
  isCut,
  boardHoldOf,
  boardSizeLabel,
  holdLabel,
  holdsOf,
  stockTopOf,
  type BoardV1,
  type PartInstance,
  type StockBoardV1,
} from '../boards';
import type { PlanResult } from '../camTypes';
import { Hint } from '../Hint';
import { numberProblem, parseDecimal } from '../numberFormat';
import type { JobBoard } from '../useJobBoards';
import { kDragType, useBoardDrag } from './boardDrag';
import { CutBadge } from './CutBadge';

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
  onTabFallback,
  onBoardChange,
  stock,
  onStockChange,
}: {
  /** A body's own fallback if its tabs can't hold (undefined: the job's default). */
  onTabFallback: (itemId: string, fallback: TabFallback | undefined) => void;
  onBoardChange: (board: BoardV1) => void;
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
                {isCut(board) && <CutBadge board={board} />}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {fits ? 'Drop here' : dragging ? 'different thickness' : boardSizeLabel(board, nest)}
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
                  // Only on tab boards: the chips and the menu are about parts whose tabs can't hold.
                  holding={usesTabs(board.holdDown) ? plans[i]?.holding?.find(h => h.name === byId.get(id)?.name)?.how : undefined}
                  fallback={board.tabFallbacks?.[id]}
                  onFallback={f => onTabFallback(id, f)}
                  onTabsReset={
                    board.tabsAt?.[id]
                      ? () => {
                          const rest = { ...board.tabsAt };
                          delete rest[id];
                          onBoardChange({ ...board, tabsAt: Object.keys(rest).length ? rest : undefined });
                        }
                      : undefined
                  }
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
              {holdLabel(board)} · {bits.length || 1} {bits.length > 1 ? 'bits' : 'bit'}
              {nest.unplaced.length > 0 && <span className="text-destructive"> · {nest.unplaced.length} don’t fit</span>}
            </span>
            {boardHoldOf(board) === 'points' && nest.nutAbove < 0 && (
              <span role="alert" className="text-xs text-destructive">
                {`The bit's stick-out (${nest.stickout} mm) is shorter than the deepest cut (${+(stockTopOf(board) + 0.3).toFixed(1)} mm): the collet nut would hit the board. Check it in the board's settings or with the bit.`}
              </span>
            )}
            {usesTabs(board.holdDown) && (
              <HoldingNotes
                holding={plans[i]?.holding}
                board={board}
                itemOf={name => board.items.find(id => byId.get(id)?.name === name)}
                onFallback={(ids, f) =>
                  onBoardChange({ ...board, tabFallbacks: { ...board.tabFallbacks, ...Object.fromEntries(ids.map(id => [id, f])) } })
                }
                noFrame={
                  nest.frame === 'no-room'
                    ? { width: nest.frameWidth, nut: nutReaches({ ...holdsOf(board, nest.stickout), nutAbove: nest.nutAbove }) }
                    : undefined
                }
                onFrame={
                  boardHoldOf(board) === 'points' && board.frame === false ? () => onBoardChange({ ...board, frame: true }) : undefined
                }
              />
            )}
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
  holding,
  fallback,
  onFallback,
  targets,
  onDragStart,
  onDragEnd,
  onMoveTo,
  onTabsReset,
}: {
  name: string;
  dragId: string;
  unplaced: boolean;
  pinned: boolean;
  onUnpin: () => void;
  /** How it's held on its board (tabs placed where they hold, or a fallback); undefined without tabs. */
  holding?: 'placed' | TabFallback | 'unheld';
  fallback?: TabFallback;
  onFallback: (f: TabFallback | undefined) => void;
  targets: BoardV1[];
  onDragStart: () => void;
  onDragEnd: () => void;
  onMoveTo: (board: string | 'new') => void;
  /** Its tabs were placed by hand: back to picked ones. */
  onTabsReset?: () => void;
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
      {holding === 'skin' && (
        <span
          className="ml-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground"
          title="Held by a bottom skin: no edge where tabs would hold">
          skin
        </span>
      )}
      {holding === 'unheld' && (
        <span
          className="ml-0.5 rounded bg-destructive/15 px-1 text-[10px] text-destructive"
          title="No edge where tabs would hold it: choose what holds it (⋯ menu or the note below)">
          not held
        </span>
      )}
      {holding === 'tabs' && (
        <span
          className="ml-0.5 rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-400"
          title="Tabs anyway: they may not hold">
          tabs?
        </span>
      )}
      {pinned && (
        <Hint text="Pinned: you placed it by hand, so auto-fill leaves it on this board. ⋯ › Unpin lets it move again.">
          <span role="img" aria-label="Placed by hand" tabIndex={0} className="rounded-full">
            <Pin className="size-3 text-muted-foreground" aria-hidden />
          </span>
        </Hint>
      )}
      <DropdownMenu>
        <Hint text={pinned ? 'Move it to another board or a new one, or unpin it.' : 'Move it to another board or a new one.'}>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={`Move ${name}`}
              className="ml-0.5 rounded-full px-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <MoreHorizontal className="size-3" />
            </button>
          </DropdownMenuTrigger>
        </Hint>
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
                <PinOff className="size-3" /> Unpin (auto-fill may move it)
              </DropdownMenuItem>
            </>
          )}
          {onTabsReset && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onTabsReset}>Place its tabs automatically again</DropdownMenuItem>
            </>
          )}
          {holding && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">If its tabs can’t hold it</DropdownMenuLabel>
              {(
                [
                  [undefined, 'As the job says'],
                  ['skin', 'Bottom skin'],
                  ['tabs', 'Tabs anyway'],
                  ['self', 'Hold it down myself'],
                ] as const
              ).map(([f, label]) => (
                <DropdownMenuItem key={label} onSelect={() => onFallback(f)}>
                  <Check className={cn('size-3', fallback !== f && 'invisible')} /> {label}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** The stock list's new-board fields: id, visible label, accessible name, placeholder, range. */
const kStockFields = [
  {
    key: 'thickness',
    label: 'Thickness',
    name: 'Stock thickness',
    placeholder: 'mm',
    range: { min: 0, minExclusive: true, max: 200, unit: 'mm' },
  },
  { key: 'w', label: 'Width', name: 'Stock width', placeholder: 'mm', range: { min: 0, minExclusive: true, unit: 'mm' } },
  { key: 'h', label: 'Height', name: 'Stock height', placeholder: 'mm', range: { min: 0, minExclusive: true, unit: 'mm' } },
  { key: 'quantity', label: 'Count', name: 'Stock quantity', placeholder: 'any', range: { min: 1, integer: true } },
] as const;

function StockList({ stock, onChange }: { stock: StockBoardV1[]; onChange: (s: StockBoardV1[]) => void }) {
  const [draft, setDraft] = useState({ thickness: '', w: '', h: '', quantity: '' });
  // Only what was typed is checked: an empty size field just isn't done yet, an empty count means "as many as needed".
  const problems = kStockFields.flatMap(f => {
    const p = draft[f.key].trim() ? numberProblem(draft[f.key], f.range) : null;
    return p ? [{ ...f, problem: p }] : [];
  });
  const quantity = draft.quantity.trim() ? parseDecimal(draft.quantity) : undefined;
  const valid = !problems.length && [draft.thickness, draft.w, draft.h].every(v => v.trim());
  return (
    <section aria-label="Stock list" className="mt-2 flex flex-col gap-2 border-t pt-3">
      <h3 className="text-[13px] font-semibold">Stock list</h3>
      {stock.map(s => (
        <div key={s.id} className="flex items-center justify-between font-mono text-xs">
          <span>
            {fmt(s.thickness)} mm · {fmt(s.w)} × {fmt(s.h)}
            {s.quantity !== undefined && ` · ${s.quantity} pcs`}
          </span>
          <Hint text="Remove it from the stock list. Boards already laid out stay as they are.">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Remove stock board"
              onClick={() => onChange(stock.filter(x => x !== s))}>
              <Trash2 className="size-3" />
            </Button>
          </Hint>
        </div>
      ))}
      <form
        className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-x-1 gap-y-0.5"
        onSubmit={e => {
          e.preventDefault();
          if (!valid) return;
          onChange([
            ...stock,
            {
              id: crypto.randomUUID(),
              thickness: parseDecimal(draft.thickness),
              w: parseDecimal(draft.w),
              h: parseDecimal(draft.h),
              ...(quantity && { quantity }),
            },
          ]);
          setDraft({ thickness: '', w: '', h: '', quantity: '' });
        }}>
        {kStockFields.map(f => (
          <label key={f.key} htmlFor={`stock-${f.key}`} className="text-[11px] text-muted-foreground">
            {f.label}
          </label>
        ))}
        <span />
        {kStockFields.map(f => (
          <Input
            key={f.key}
            id={`stock-${f.key}`}
            aria-label={f.name}
            inputMode={f.key === 'quantity' ? 'numeric' : 'decimal'}
            autoComplete="off"
            placeholder={f.placeholder}
            aria-invalid={problems.some(p => p.key === f.key) ? true : undefined}
            aria-describedby={problems.some(p => p.key === f.key) ? `stock-${f.key}-error` : undefined}
            className="h-7 px-1.5 font-mono text-xs"
            value={draft[f.key]}
            onChange={e => setDraft({ ...draft, [f.key]: e.target.value })}
          />
        ))}
        <Hint text="Add this board to the stock list: thickness, width and height in mm, count optional." wrap>
          <Button type="submit" variant="outline" size="icon" className="size-7" aria-label="Add stock board" disabled={!valid}>
            <Plus className="size-3" />
          </Button>
        </Hint>
      </form>
      {problems.map(p => (
        <p key={p.key} id={`stock-${p.key}-error`} className="text-xs text-destructive">
          {p.label}: {p.problem}
        </p>
      ))}
      <p className="text-xs text-muted-foreground">
        Boards you have, in mm, and how many (empty count: as many as needed). “Auto-fill from stock” puts the parts on as little of them as
        it can and keeps parts you moved by hand where they are.
      </p>
    </section>
  );
}

/** What fixes a part whose tabs can't hold: one click each, nothing switched without asking. */
const kFixes: [TabFallback, string][] = [
  ['skin', 'Bottom skin'],
  ['tabs', 'Tabs anyway'],
  ['self', 'I hold it down'],
];

const kFallbackNote: Record<TabFallback, string> = {
  skin: 'keeps a bottom skin, freed at the machine',
  tabs: 'gets tabs anyway (they may not hold)',
  self: 'gets no tabs: hold it down yourself',
};

const names = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);

/**
 * Where tabs fell short on a board, grouped so each reason is said once: the parts with no two opposite edges to hold
 * them (which block the job until one choice fixes them all), the parts that get the fallback chosen for them, and
 * the parts where fewer tabs fit than asked. A single part can still be set apart from its chip's menu.
 */
export function HoldingNotes({
  holding,
  board,
  itemOf,
  onFallback,
  onFrame,
  noFrame,
}: {
  holding: PlanResult['holding'];
  board: BoardV1;
  /** The board item of a part name, for its own fallback. */
  itemOf: (name: string) => string | undefined;
  /** One fallback for all of these items, in one change. */
  onFallback: (itemIds: string[], f: TabFallback) => void;
  /** Turns the frame on, when it's off: the usual reason tabs have nothing to hold on to. */
  onFrame?: () => void;
  /** The frame was left out: the parts don't fit this board with it. Its width, and whether room for the nut is in it. */
  noFrame?: { width: number; nut: boolean };
}) {
  const all = holding ?? [];
  const unheld = all.filter(h => h.how === 'unheld').map(h => h.name);
  const ids = unheld.map(itemOf).filter((id): id is string => !!id);
  const short = all.filter(h => h.how === 'placed' && h.wanted);
  const chosen = (Object.keys(kFallbackNote) as TabFallback[])
    .map(f => [f, all.filter(h => h.how === f).map(h => h.name)] as const)
    .filter(([, list]) => list.length);
  if (!unheld.length && !short.length && !chosen.length) return null;
  const one = unheld.length === 1;
  return (
    <ul aria-label={`Tabs on board ${board.name}`} className="flex flex-col gap-1 text-xs">
      {unheld.length > 0 && (
        <li className="flex flex-col gap-1 text-destructive" onClick={e => e.stopPropagation()}>
          {noFrame && (
            <span>
              {`The frame for the holds (${fmt(noFrame.width)} mm${noFrame.nut ? ', with room for the collet nut' : ''}) doesn't fit on this board with all the parts, so it was left out. Without it, the board's edge is too close for tabs. A larger board, fewer parts on it${noFrame.nut ? ', or a stick-out long enough for the nut to clear the holds (see the drawing)' : ''} brings it back.`}
            </span>
          )}
          <span>
            {`${names(unheld)} ${one ? 'has' : 'have'} no two opposite edges where tabs would hold ${one ? 'it' : 'them'}, so ${
              one ? 'it' : 'they'
            } would come loose. The job waits until you choose${one ? '' : ' (for all of them; set one apart from its chip)'}:`}
          </span>
          <span className="flex flex-wrap gap-1">
            {onFrame && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onFrame}>
                Keep a frame
              </Button>
            )}
            {ids.length > 0 &&
              kFixes.map(([f, label]) => (
                <Button key={f} size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => onFallback(ids, f)}>
                  {label}
                </Button>
              ))}
          </span>
        </li>
      )}
      {chosen.map(([f, list]) => (
        <li key={f} className="text-amber-700 dark:text-amber-400">
          {`${names(list)}: no two opposite edges where tabs hold, so ${list.length > 1 ? 'each' : 'it'} ${kFallbackNote[f]}, as you chose.`}
        </li>
      ))}
      {short.map(h => (
        <li key={h.name} className="text-amber-700 dark:text-amber-400">
          {`${h.name}: ${h.tabs} of ${h.wanted} tabs fit (short edges or little stock that holds around it).`}
        </li>
      ))}
    </ul>
  );
}
