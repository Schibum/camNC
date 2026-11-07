import { isDemoMode } from '@/lib/demo/demo-mode';
import type { CamJobV1 } from '../jobDb';
import { openAtMachine } from '@/cam/machine/openAtMachine';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { MouseEvent, ReactNode } from 'react';
import { useCamJob, useSaveCamJob } from '../camQueries';
import { hasDesignDraft } from '../cadDesign';
import { discardMissingHoleChoices } from '../holeChoices';
import { kDefaultPlan } from '../planSettings';

const kSteps = ['Model', 'Boards', 'Plan'] as const;
export type CamStep = (typeof kSteps)[number] | 'Design';
export interface CamStageDestination {
  stage: 'boards' | 'plan' | 'machine';
  board?: string;
  newTab?: boolean;
}

const kRoutes: Record<CamStep, '/cam/$jobId/model' | '/cam/$jobId/design' | '/cam/$jobId/boards' | '/cam/$jobId/plan'> = {
  Design: '/cam/$jobId/design',
  Model: '/cam/$jobId/model',
  Boards: '/cam/$jobId/boards',
  Plan: '/cam/$jobId/plan',
};

/** Job name, the prepare steps (Model → Boards → Plan), the way to the machine, and the step's actions. */
export function CamJobBar({
  jobId,
  fileName,
  step,
  actions,
  origin,
  onStageNavigate,
  navigationPending,
}: {
  jobId: string;
  fileName: string;
  step: CamStep;
  actions?: ReactNode;
  origin?: CamJobV1['origin'];
  onStageNavigate?: (destination: CamStageDestination) => void;
  navigationPending?: boolean;
}) {
  const { data: job } = useCamJob(jobId);
  const save = useSaveCamJob(job);
  const search = useSearch({ strict: false }) as { board?: string; part?: string };
  const board = search.board ?? job?.boards?.[0]?.id;
  const part = search.part ?? job?.boards?.find(b => b.id === board)?.items[0]?.split('#')[0];
  const steps: CamStep[] = job?.design ? ['Design', 'Boards', 'Plan'] : [...kSteps];
  const guardStageLink = (event: MouseEvent<HTMLAnchorElement>, stage: CamStep) => {
    if (!onStageNavigate || (stage !== 'Boards' && stage !== 'Plan')) return;
    event.preventDefault();
    if (!navigationPending)
      onStageNavigate({
        stage: stage === 'Boards' ? 'boards' : 'plan',
        board: search.board,
        newTab: event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey,
      });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2">
      <span className="max-w-64 truncate text-sm text-muted-foreground" title={fileName}>
        {fileName}
      </span>
      {origin?.kind === 'sample' && (
        <span className="text-xs text-muted-foreground">
          {isDemoMode() ? 'Temporary rehearsal copy' : 'Sample copy · saved in this browser'}
        </span>
      )}
      <nav aria-label="Steps" className="flex flex-wrap items-center gap-1">
        {steps.map((s, i) =>
          s === step ? (
            <span
              key={s}
              aria-current="step"
              className="whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              {i + 1} {s}
            </span>
          ) : (
            <Link
              key={s}
              to={kRoutes[s]}
              params={{ jobId }}
              search={
                s === 'Design'
                  ? { returnTo: step === 'Plan' ? 'plan' : 'boards', board, part }
                  : (s === 'Plan' || s === 'Boards') && search.board
                    ? { board: search.board }
                    : undefined
              }
              onClick={event => guardStageLink(event, s)}
              onAuxClick={event => {
                if (event.button === 1) guardStageLink(event, s);
              }}
              aria-disabled={onStageNavigate && navigationPending ? true : undefined}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
              {i + 1} {s}
            </Link>
          )
        )}
        {job?.design && hasDesignDraft(job) && step !== 'Design' && (
          <span className="px-2 text-xs text-amber-700 dark:text-amber-300">Design draft · CAM uses finished sketch</span>
        )}
        <span className="mx-2 h-5 w-px bg-border" />
        <AtTheMachine jobId={jobId} onStageNavigate={onStageNavigate} navigationPending={navigationPending} />
      </nav>
      <span className="grow" />
      {actions}
      {!!job?.plan?.leaveOut?.length && step !== 'Design' && (
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
      {!!job?.design?.holeChoiceIssues?.length && step !== 'Design' && (
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
    </div>
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
