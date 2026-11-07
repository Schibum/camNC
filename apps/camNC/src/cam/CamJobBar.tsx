import { PageHeader } from '@/components/page-header';
import { isDemoMode } from '@/lib/demo/demo-mode';
import type { CamJobV1 } from './jobDb';
import { openAtMachine } from '@/cam/machine/openAtMachine';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { cn } from '@wbcnc/ui/lib/utils';
import type { ReactNode } from 'react';

const kSteps = [
  { step: 'Model', label: '1 Model', to: '/cam/$jobId/model' },
  { step: 'Boards', label: '2 Boards', to: '/cam/$jobId/boards' },
  { step: 'Plan', label: '3 Plan', to: '/cam/$jobId/plan' },
] as const;
export type CamStep = (typeof kSteps)[number]['step'] | 'Machine';

const kStep = 'whitespace-nowrap rounded-md px-2.5 py-1 text-sm';
const kOtherStep = cn(kStep, 'text-muted-foreground hover:bg-muted hover:text-foreground');
const kCurrentStep = cn(kStep, 'bg-primary text-primary-foreground');

/**
 * A job's top bar, the same through its prepare steps and at the machine. The first row is where you are: the job and
 * its steps stay put, so going from step to step moves nothing. The second row is the step's own: `tools` from the
 * left, `actions` from the right with the way on last. Its height doesn't depend on what the step puts there.
 */
export function CamJobBar({
  jobId,
  job,
  step,
  board,
  tools,
  actions,
  className,
}: {
  jobId: string;
  /** Not there yet while it loads. */
  job?: Pick<CamJobV1, 'name' | 'fileName' | 'origin'> | null;
  step: CamStep;
  /** The board at the machine: named here, and Plan opens on it. */
  board?: { id: string; name: string };
  tools?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('z-10 flex shrink-0 flex-col', className)}>
      {/* The machine view has the full demo bar. */}
      <PageHeader title="CAM (beta)" className="h-auto min-h-10 flex-wrap gap-y-0 max-md:pt-1" hideDemoMark={step === 'Machine'}>
        {/* A fixed width, for the steps to start at the same place whatever the name and board. */}
        <span
          className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground max-md:max-w-[calc(100%-9rem)] md:w-56"
          title={job?.fileName}>
          <span className="truncate">{job?.name ?? 'CAM job'}</span>
          {board && <span className="shrink-0 whitespace-nowrap text-foreground">· Board {board.name}</span>}
        </span>
        <nav aria-label="Steps" className="flex flex-wrap items-center gap-1 max-md:w-full max-md:px-3 max-md:pb-1">
          {kSteps.map(s =>
            s.step === step ? (
              <span key={s.step} aria-current="step" className={kCurrentStep}>
                {s.label}
              </span>
            ) : (
              <Link
                key={s.step}
                to={s.to}
                params={{ jobId }}
                search={s.step === 'Plan' && board ? { board: board.id } : undefined}
                className={kOtherStep}>
                {s.label}
              </Link>
            )
          )}
          <span className="mx-1 h-5 w-px bg-border" />
          {step === 'Machine' ? (
            <span aria-current="step" className={kCurrentStep}>
              At the machine
            </span>
          ) : (
            <AtTheMachine jobId={jobId} />
          )}
        </nav>
        <span className="grow" />
        {job?.origin?.kind === 'sample' && (
          <span className="px-2 text-xs whitespace-nowrap text-muted-foreground">
            {isDemoMode() ? 'Temporary rehearsal copy' : 'Sample copy · saved in this browser'}
          </span>
        )}
      </PageHeader>
      <div
        role="group"
        aria-label="This step's tools"
        className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-black/5 bg-background/75 px-4 py-px backdrop-blur-md dark:border-white/10">
        {tools}
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}

/** The job on the bed, the board shown here selected (Plan step): place, clamp, zero and cut it, and come back. */
function AtTheMachine({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const { board } = useSearch({ strict: false }) as { board?: string };
  return (
    <button
      type="button"
      className={kOtherStep}
      onClick={() => {
        const to = openAtMachine(jobId, board);
        void navigate(to === '/start' ? { to, search: { for: 'cam', job: jobId, board } } : { to });
      }}>
      At the machine
    </button>
  );
}
