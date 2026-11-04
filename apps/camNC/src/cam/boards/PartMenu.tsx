import type { TabFallback } from '@wbcnc/cam';
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@wbcnc/ui/components/dropdown-menu';
import { cn } from '@wbcnc/ui/lib/utils';
import { Check, Pin, PinOff, Plus } from 'lucide-react';
import type { BoardV1 } from '../boards';
import { Hint } from '../Hint';

/** How a body is held on its board (tabs placed where they hold, or a fallback); undefined without tabs. */
export type PartHolding = 'placed' | TabFallback | 'unheld';

export interface PartMenuProps {
  name: string;
  /** Other boards of its thickness. */
  targets: BoardV1[];
  onMoveTo: (board: string | 'new') => void;
  pinned: boolean;
  onUnpin: () => void;
  holding?: PartHolding;
  fallback?: TabFallback;
  onFallback: (f: TabFallback | undefined) => void;
  /** Its tabs were placed by hand: back to picked ones. */
  onTabsReset?: () => void;
}

/** A body's menu, the non-drag way to move it: to another board or a new one, unpin, what holds it if tabs can't. */
export function PartMenuContent({ name, targets, onMoveTo, pinned, onUnpin, holding, fallback, onFallback, onTabsReset }: PartMenuProps) {
  return (
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
  );
}

/** What the drawing doesn't show of a body: placed by hand (pinned), and how it's held where tabs fell short. */
export function PartBadges({ pinned, holding }: { pinned: boolean; holding?: PartHolding }) {
  return (
    <>
      {holding === 'skin' && (
        <span
          className="rounded bg-muted px-1 text-[10px] text-muted-foreground"
          title="Held by a bottom skin: no edge where tabs would hold">
          skin
        </span>
      )}
      {holding === 'unheld' && (
        <span
          className="rounded bg-destructive/15 px-1 text-[10px] text-destructive"
          title="No edge where tabs would hold it: choose what holds it (its ⋯ menu or the board’s settings)">
          not held
        </span>
      )}
      {holding === 'tabs' && (
        <span
          className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-400"
          title="Tabs anyway: they may not hold">
          tabs?
        </span>
      )}
      {pinned && (
        <Hint text="Pinned: you placed it by hand, so auto-fill leaves it on this board. ⋯ › Unpin lets it move again.">
          <span role="img" aria-label="Placed by hand" tabIndex={0} className="rounded-full bg-background/80 p-0.5">
            <Pin className="size-3 text-muted-foreground" aria-hidden />
          </span>
        </Hint>
      )}
    </>
  );
}
