import { DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@wbcnc/ui/components/dropdown-menu';
import { Pin, PinOff, Plus } from 'lucide-react';
import type { BoardV1 } from '../boards';
import { Hint } from '../Hint';

/** How a body is held on its board (tabs placed where they hold, or nothing that holds it); undefined without tabs. */
export type PartHolding = 'placed' | 'skin' | 'unheld';

export interface PartMenuProps {
  name: string;
  /** Other boards of its thickness. */
  targets: BoardV1[];
  onMoveTo: (board: string | 'new') => void;
  pinned: boolean;
  onUnpin: () => void;
  /** Its tabs were placed by hand: back to picked ones. */
  onTabsReset?: () => void;
}

/** A body's menu, the non-drag way to move it: to another board or a new one, unpin. */
export function PartMenuContent({ name, targets, onMoveTo, pinned, onUnpin, onTabsReset }: PartMenuProps) {
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
    </DropdownMenuContent>
  );
}

/** What the drawing doesn't show of a body: placed by hand (pinned), and that its tabs can't hold it. */
export function PartBadges({ pinned, holding }: { pinned: boolean; holding?: PartHolding }) {
  return (
    <>
      {holding === 'unheld' && (
        <span
          className="rounded bg-destructive/15 px-1 text-[10px] text-destructive"
          title="No edge where tabs would hold it: move it, or switch the board to a bottom skin">
          can’t hold
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
