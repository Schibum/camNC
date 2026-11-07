import { DemoHeaderMark } from '@/lib/demo/DemoHeaderMark';
import { isDemoMode } from '@/lib/demo/demo-mode';
import { RailButtonSlot } from '@/components/nav/RailButtonSlot';
import { cn } from '@wbcnc/ui/lib/utils';
import type { ReactNode } from 'react';
import type { CamJobV1 } from './jobDb';

/**
 * A job's top bar, the same through its prepare steps and at the machine: the job on the left, then the step's own
 * `tools`, and its `actions` on the right with the way on last. The steps themselves are in the left panel.
 */
export function CamJobBar({
  job,
  board,
  tools,
  actions,
  hideDemoMark,
  className,
}: {
  /** Not there yet while it loads. */
  job?: Pick<CamJobV1, 'name' | 'fileName' | 'origin'> | null;
  /** The board at the machine. */
  board?: string;
  tools?: ReactNode;
  actions?: ReactNode;
  /** For the machine view, which has the full demo bar. */
  hideDemoMark?: boolean;
  className?: string;
}) {
  const note =
    job?.origin?.kind === 'sample' ? (isDemoMode() ? 'Temporary rehearsal copy' : 'Sample copy · saved in this browser') : undefined;
  return (
    <header
      className={cn(
        'z-10 flex min-h-11 w-full shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-black/5 bg-background/75 px-3 py-px shadow-sm backdrop-blur-md dark:border-white/10',
        className
      )}>
      <RailButtonSlot />
      {/* A fixed width, for the tools to start at the same place whatever the name and board. */}
      <div className="flex w-full min-w-0 flex-col leading-tight md:w-28 min-[1680px]:w-44" title={job?.fileName}>
        <span className="flex min-w-0 gap-1 text-sm text-muted-foreground">
          <span className="truncate">{job?.name ?? 'CAM job'}</span>
          {board && <span className="shrink-0 whitespace-nowrap text-foreground">· Board {board}</span>}
        </span>
        {note && <span className="truncate text-[11px] text-muted-foreground">{note}</span>}
      </div>
      {tools}
      <div className="flex min-w-0 grow flex-wrap items-center justify-end gap-2">{actions}</div>
      {!hideDemoMark && <DemoHeaderMark />}
    </header>
  );
}
