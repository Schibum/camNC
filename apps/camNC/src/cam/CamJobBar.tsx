import { useEffect } from 'react';
import { useStageNavigation, type CamStageDestination } from '@/components/nav/stageNavigation';
import { useCamJob, useSaveCamJob } from './camQueries';
import { hasDesignDraft } from './cadDesign';
import { discardMissingHoleChoices } from './holeChoices';
import { kDefaultPlan } from './planSettings';
import { openAtMachine } from './machine/openAtMachine';
import { useNavigate, useSearch } from '@tanstack/react-router';
export type { CamStageDestination } from '@/components/nav/stageNavigation';
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
  onStageNavigate,
  navigationPending,
}: {
  /** Not there yet while it loads. */
  job?: (Pick<CamJobV1, 'name' | 'fileName' | 'origin'> & Partial<Pick<CamJobV1, 'id'>>) | null;
  /** The board at the machine. */
  board?: string;
  tools?: ReactNode;
  actions?: ReactNode;
  /** For the machine view, which has the full demo bar. */
  hideDemoMark?: boolean;
  className?: string;
  onStageNavigate?: (destination: CamStageDestination) => void;
  navigationPending?: boolean;
}) {
  useEffect(() => {
    if (!job?.id || !onStageNavigate) return;
    const guard = { jobId: job.id, navigate: onStageNavigate, pending: !!navigationPending };
    useStageNavigation.setState({ guard });
    return () => {
      if (useStageNavigation.getState().guard === guard) useStageNavigation.setState({ guard: null });
    };
  }, [job?.id, onStageNavigate, navigationPending]);
  const note =
    job?.origin?.kind === 'sample' ? (isDemoMode() ? 'Temporary rehearsal copy' : 'Sample copy · saved in this browser') : undefined;
  return (
    <>
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
        <div className="flex min-w-0 grow flex-wrap items-center justify-end gap-2">
          {actions ??
            (job?.id && onStageNavigate ? (
              <AtTheMachine jobId={job.id} onStageNavigate={onStageNavigate} navigationPending={navigationPending} />
            ) : null)}
        </div>
        {!hideDemoMark && <DemoHeaderMark />}
      </header>
      {job?.id && !onStageNavigate && (
        <div className={cn('pointer-events-auto bg-background text-foreground', className)}>
          <CamJobNotices jobId={job.id} />
        </div>
      )}
    </>
  );
}

function CamJobNotices({ jobId }: { jobId: string }) {
  const { data: job } = useCamJob(jobId);
  const save = useSaveCamJob(job);
  return (
    <>
      {job?.design && hasDesignDraft(job) && (
        <span className="px-3 text-xs text-amber-700 dark:text-amber-300">Design draft · CAM uses finished sketch</span>
      )}
      {!!job?.plan?.leaveOut?.length && (
        <div role="status" className="flex basis-full flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <p>
            Excluded from CAM: {job.plan.leaveOut.map(id => job.parts.find(part => part.id === id.split('#')[0])?.name ?? id).join(', ')}.
            These parts stay excluded until included again.
          </p>
          <button
            type="button"
            className="rounded-md border px-2 py-1"
            disabled={save.isPending}
            onClick={() => {
              save.mutate({ ...job, plan: { ...job.plan!, leaveOut: [] } });
            }}>
            Include again
          </button>
        </div>
      )}
      {!!job?.design?.holeChoiceIssues?.length && (
        <div role="alert" className="flex basis-full flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
          <span>
            A hole with CAM settings was removed or replaced. Its settings are retained for Undo and are not applied to another hole.
          </span>
          <button
            type="button"
            className="rounded-md border px-2 py-1"
            disabled={save.isPending}
            onClick={() => {
              const plan = job.plan ?? kDefaultPlan;
              save.mutate({
                ...job,
                plan: { ...plan, holes: discardMissingHoleChoices(plan.holes, job.design!.holeChoiceIssues!) },
                design: { ...job.design!, holeChoiceIssues: undefined },
              });
            }}>
            Discard removed hole settings
          </button>
        </div>
      )}
    </>
  );
}

/** The job on the bed, the board shown here selected (Plan step): place, clamp, zero and cut it, and come back. */
function AtTheMachine({
  jobId,
  onStageNavigate,
  navigationPending,
}: {
  jobId: string;
  onStageNavigate?: (destination: CamStageDestination) => void;
  navigationPending?: boolean;
}) {
  const navigate = useNavigate();
  const { board } = useSearch({ strict: false }) as { board?: string };
  return (
    <button
      type="button"
      disabled={navigationPending}
      className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
      onClick={event => {
        if (onStageNavigate) {
          onStageNavigate({ stage: 'machine', board, newTab: event.ctrlKey || event.metaKey || event.shiftKey || event.altKey });
          return;
        }
        const to = openAtMachine(jobId, board);
        void navigate(to === '/start' ? { to, search: { for: 'cam', job: jobId, board } } : { to });
      }}>
      At the machine
    </button>
  );
}
