import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { Eye, EyeOff } from 'lucide-react';
import { formatDuration } from '@/visualize/stockSim/jobTimeline';
import { Hint } from '../Hint';
import { groupOpsOf, type PlanModel } from './planModel';
import type { Plan3dMode } from './plan3dViewStore';

/**
 * The board's operations, identical ones grouped, in their colors: one list for both modes. Clicking one selects it
 * (Result: colors what it removes; Toolpath: isolates it); both frame it.
 */
export function OpList({
  model,
  mode,
  time,
  selected,
  onSelect,
  hidden,
  onToggleHidden,
  onTime,
}: {
  model: PlanModel;
  mode: Plan3dMode;
  time: number;
  selected: number | null;
  onSelect: (group: number | null) => void;
  hidden: ReadonlySet<number>;
  onToggleHidden: (group: number) => void;
  onTime: (t: number) => void;
}) {
  return (
    <aside className="flex max-h-72 min-h-0 shrink-0 flex-col border-t border-zinc-200 bg-white md:max-h-none md:w-64 md:border-t-0 md:border-l dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="text-[13px] font-medium">Operations</span>
        {selected !== null && (
          <button className="text-xs text-muted-foreground hover:underline" onClick={() => onSelect(null)}>
            Show all
          </button>
        )}
      </div>
      <ul aria-label="Operations in the 3D view" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {model.groups.map((g, n) => {
          const ops = groupOpsOf(model, n);
          const start = ops[0]?.start ?? 0;
          const end = ops.at(-1)?.end ?? 0;
          const isSelected = selected === n;
          const isHidden = mode === 'toolpath' && hidden.has(n);
          const status = time >= end ? 'done' : time > start ? 'cutting' : null;
          return (
            <li key={g.key} className={cn('rounded-md', isSelected && 'bg-zinc-100 dark:bg-zinc-800/80')}>
              <div className="flex items-center">
                <button
                  aria-pressed={isSelected}
                  onClick={() => onSelect(isSelected ? null : n)}
                  className={cn(
                    'flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                    !isSelected && 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
                    (isHidden || (selected !== null && !isSelected)) && 'opacity-50'
                  )}>
                  <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ background: g.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {g.label}
                      {g.count > 1 && <span className="text-muted-foreground"> ×{g.count}</span>}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      ⌀{g.op.tool.diameter} · {formatDuration(ops.reduce((t, o) => t + o.end - o.start, 0))}
                      {mode === 'result' && status && ` · ${status}`}
                    </span>
                  </span>
                </button>
                {mode === 'toolpath' && (
                  <Hint
                    side="left"
                    text={
                      isHidden
                        ? 'Hidden in this view only: it is still cut. Click to show it.'
                        : 'Hide it in this view only: it is still cut.'
                    }>
                    <button
                      aria-label={`${isHidden ? 'Show' : 'Hide'} ${g.label}`}
                      aria-pressed={!isHidden}
                      className="mr-1 rounded p-1 text-muted-foreground hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-800"
                      onClick={() => onToggleHidden(n)}>
                      {isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </Hint>
                )}
              </div>
              {isSelected && mode === 'result' && (
                <div className="flex gap-1 px-7 pb-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onTime(start)}>
                    Jump to start
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onTime(end)}>
                    Jump to end
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
