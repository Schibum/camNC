import { cn } from '@wbcnc/ui/lib/utils';
import { AlertTriangle, Check, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';

export type StepState = 'done' | 'todo' | 'warn';

function StepIcon({ state, n }: { state: StepState; n?: number }) {
  if (state === 'done')
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-green-600 text-white" aria-label="Done">
        <Check className="size-3" strokeWidth={3} />
      </span>
    );
  if (state === 'warn') return <AlertTriangle aria-label="To do" className="size-5 shrink-0 text-amber-500" />;
  return (
    <span
      aria-label="To do"
      className="grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] border-primary text-[11px] font-semibold text-primary">
      {n ?? ''}
    </span>
  );
}

/**
 * One step of getting a job ready, as a row: done steps fold to their title and a one-line summary, the others show
 * what to do. A click on the title folds or unfolds it either way.
 */
export function SetupStep({
  state,
  title,
  summary,
  action,
  n,
  children,
  label,
  startFolded = false,
}: {
  state: StepState;
  title: React.ReactNode;
  /** Beside the title, e.g. what was set: "8.3 mm", "4 of 4". */
  summary?: React.ReactNode;
  /** A button beside the title that works folded too. */
  action?: React.ReactNode;
  /** Number shown in the circle of a step to do. */
  n?: number;
  /** Accessible name of the step, when the title isn't plain text. */
  label?: string;
  /** A step to do that's already known by heart: its title is enough until asked for more. */
  startFolded?: boolean;
  children?: React.ReactNode;
}) {
  const opensByItself = state !== 'done' && !startFolded;
  const [open, setOpen] = useState(opensByItself);
  // A step that gets done folds; one that needs doing again opens.
  useEffect(() => setOpen(opensByItself), [opensByItself]);
  const foldable = !!children;
  return (
    <section
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className={cn('flex flex-col gap-2 rounded-lg border px-3 py-2', open && state !== 'done' && 'border-primary/30 bg-primary/[0.03]')}>
      <div className="flex min-h-7 flex-row items-center gap-2.5">
        <StepIcon state={state} n={n} />
        <button
          type="button"
          disabled={!foldable}
          aria-expanded={foldable ? open : undefined}
          onClick={() => setOpen(o => !o)}
          className="flex min-w-0 flex-1 flex-row items-center gap-2 text-left text-sm disabled:cursor-default">
          <span className="font-medium">{title}</span>
          {summary && <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span>}
          {foldable && (
            <ChevronRight className={cn('ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          )}
        </button>
        {action}
      </div>
      {foldable && open && <div className="flex flex-col gap-2 pb-1 pl-7.5 text-[13px]">{children}</div>}
    </section>
  );
}
