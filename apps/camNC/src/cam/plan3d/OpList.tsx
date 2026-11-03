import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { ChevronRight, Eye, EyeOff } from 'lucide-react';
import { formatDuration } from '@/visualize/stockSim/jobTimeline';
import { Hint } from '../Hint';
import { groupOpsOf, type PlanOpGroup } from './planModel';
import type { Plan3dMode } from './plan3dViewStore';
import type { PlanPlayback } from './planPlayback';

/**
 * The board's operations, identical ones grouped, in their colors: one list for both modes. Clicking one selects it
 * (Result: colors what it removes; Toolpath: isolates it), frames it in the view and opens its numbers below it.
 */
export function OpList({
  name,
  playback,
  mode,
  details,
}: {
  /** The list's accessible name. */
  name: string;
  playback: PlanPlayback;
  mode: Plan3dMode;
  /** The selected group's numbers, shown under its row. */
  details: (group: PlanOpGroup) => React.ReactNode;
}) {
  const { model, selected, select, hidden, toggleHidden, setPlaying, setTime } = playback;
  const time = mode === 'result' ? playback.time : model.total;
  const jump = (t: number) => {
    setPlaying(false);
    setTime(t);
  };
  return (
    <ul aria-label={name} className="flex flex-col gap-0.5">
      {model.groups.map((g, n) => {
        const ops = groupOpsOf(model, n);
        const start = ops[0]?.start ?? 0;
        const end = ops.at(-1)?.end ?? 0;
        const isSelected = selected === n;
        const isHidden = mode === 'toolpath' && hidden.has(n);
        const status = time >= end ? 'done' : time > start ? 'cutting' : null;
        const firstProgram = !!g.note && !model.groups[n - 1]?.note;
        return (
          <li key={g.key} className={cn('rounded-md', isSelected && 'bg-muted')}>
            {firstProgram && (
              <p className="mt-1 border-t px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">After the cutting, at the machine</p>
            )}
            <div className="flex items-center">
              <button
                aria-expanded={isSelected}
                onClick={() => select(isSelected ? null : n)}
                className={cn(
                  'flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left text-[13px]',
                  !isSelected && 'hover:bg-muted/60',
                  (isHidden || (selected !== null && !isSelected)) && 'opacity-60'
                )}>
                <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ background: g.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {g.label}
                    {g.count > 1 && !g.note && <span className="text-muted-foreground"> ×{g.count}</span>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    ⌀{g.op.tool.diameter} · {formatDuration(ops.reduce((t, o) => t + o.end - o.start, 0))} sim
                    {mode === 'result' && status && ` · ${status}`}
                  </span>
                  {g.note && <span className="block text-xs text-muted-foreground">{g.note}</span>}
                </span>
                <ChevronRight
                  aria-hidden
                  className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', isSelected && 'rotate-90')}
                />
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
                    className="mr-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => toggleHidden(n)}>
                    {isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </Hint>
              )}
            </div>
            {isSelected && (
              <div className="flex flex-col gap-2 pr-2 pb-2.5 pl-7">
                {details(g)}
                {mode === 'result' && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => jump(start)}>
                      Jump to start
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => jump(end)}>
                      Jump to end
                    </Button>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
