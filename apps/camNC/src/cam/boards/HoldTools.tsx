import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@wbcnc/ui/components/dropdown-menu';
import { cn } from '@wbcnc/ui/lib/utils';
import { CircleMinus, CirclePlus, MousePointer2, Redo2, Undo2, WandSparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Hint } from '../Hint';
import type { HoldEditing, HoldTool } from './useHoldEditing';

const strokes = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const ClampIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="size-[18px]" {...strokes}>
    <path d="M6 4h9a3 3 0 0 1 3 3v3M6 4v16M3 20h6M18 10v4M15 14h6" />
  </svg>
);
const ScrewIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="size-[18px]" {...strokes}>
    <circle cx="12" cy="12" r="8" />
    <path d="M8 8l8 8M16 8l-8 8" />
  </svg>
);
const TabIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="size-[18px]" {...strokes}>
    <path d="M3 16h6v-4h6v4h6M3 20h18" />
  </svg>
);

const kButton =
  'relative flex items-center justify-center rounded-md text-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-35 aria-pressed:bg-primary aria-pressed:text-primary-foreground';

/** The tools for the selected board, in a row above the table, as in a drawing app: select, what to place, Suggest holds, Undo and Redo. */
export function HoldTools({ holds, onUndo, onRedo }: { holds: HoldEditing; onUndo?: () => void; onRedo?: () => void }) {
  const { tool, setTool, setEdit, canPlace, tabsOn, holdCount, suggest, nudgeHolds, setSelectedHold } = holds;
  const size = 'size-8';
  const pick = (next: HoldTool | null) => {
    setTool(next);
    setEdit(null);
    setSelectedHold(null);
  };
  const toolButton = (id: HoldTool, label: string, key: string, hint: string, icon: ReactNode, disabled = false) => (
    <Hint key={id} text={hint} side="bottom" wrap>
      <button
        type="button"
        aria-label={label}
        aria-pressed={tool === id}
        disabled={!canPlace || disabled}
        onClick={() => pick(tool === id ? null : id)}
        className={cn(kButton, size)}>
        {icon}
        <kbd aria-hidden className="absolute right-0.5 bottom-0 font-mono text-[8px] opacity-60">
          {key}
        </kbd>
      </button>
    </Hint>
  );
  return (
    <div role="toolbar" aria-label="Fixtures" className="flex flex-wrap items-center gap-0.5">
      <Hint text="Select and move what's on the drawing." side="bottom" wrap>
        <button type="button" aria-label="Select" aria-pressed={!tool} onClick={() => pick(null)} className={cn(kButton, size)}>
          <MousePointer2 className="size-[18px]" />
          <kbd aria-hidden className="absolute right-0.5 bottom-0 font-mono text-[8px] opacity-60">
            V
          </kbd>
        </button>
      </Hint>
      {toolButton(
        'clamp',
        'Clamp',
        'C',
        'Click near an edge of the board: only the parts in the way move aside. Esc puts it down.',
        <ClampIcon />
      )}
      {toolButton(
        'screw',
        'Screw',
        'S',
        'Click in the waste: it lands on the most forgiving spot nearby. Esc puts it down.',
        <ScrewIcon />
      )}
      {toolButton(
        'tab',
        'Tab',
        'T',
        tabsOn
          ? 'Click on a part’s outline to add a tab. Esc puts it down.'
          : 'This board doesn’t use tabs: choose Tabs under “Parts stay in place with”.',
        <TabIcon />,
        !tabsOn
      )}
      <DropdownMenu modal={false}>
        <Hint text="Suggest holds, or one clamp fewer or more." side="bottom" wrap>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Suggest holds" disabled={!canPlace} className={cn(kButton, size)}>
              <WandSparkles className="size-[18px]" />
            </button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent side="bottom" align="start">
          <DropdownMenuItem onSelect={suggest}>
            <WandSparkles className="size-4" /> Suggest holds
          </DropdownMenuItem>
          <DropdownMenuItem disabled={holdCount <= 3} onSelect={() => nudgeHolds(false)}>
            <CircleMinus className="size-4" /> One clamp fewer
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!holdCount} onSelect={() => nudgeHolds(true)}>
            <CirclePlus className="size-4" /> One clamp more
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button type="button" aria-label="Undo" title="Undo (⌘Z)" disabled={!onUndo} onClick={onUndo} className={cn(kButton, size)}>
        <Undo2 className="size-[18px]" />
      </button>
      <button type="button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!onRedo} onClick={onRedo} className={cn(kButton, size)}>
        <Redo2 className="size-[18px]" />
      </button>
    </div>
  );
}
