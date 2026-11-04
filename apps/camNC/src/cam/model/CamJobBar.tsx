import { openAtMachine } from '@/cam/machine/openAtMachine';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';

const kSteps = ['Model', 'Boards', 'Plan'] as const;
export type CamStep = (typeof kSteps)[number];

const kRoutes: Record<CamStep, '/cam/$jobId/model' | '/cam/$jobId/boards' | '/cam/$jobId/plan'> = {
  Model: '/cam/$jobId/model',
  Boards: '/cam/$jobId/boards',
  Plan: '/cam/$jobId/plan',
};

/** Job name, the prepare steps (Model → Boards → Plan), the way to the machine, and the step's actions. */
export function CamJobBar({ jobId, fileName, step, actions }: { jobId: string; fileName: string; step: CamStep; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2">
      <span className="max-w-64 truncate text-sm text-muted-foreground" title={fileName}>
        {fileName}
      </span>
      <nav aria-label="Steps" className="flex flex-wrap items-center gap-1">
        {kSteps.map((s, i) =>
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
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
              {i + 1} {s}
            </Link>
          )
        )}
        <span className="mx-2 h-5 w-px bg-border" />
        <AtTheMachine jobId={jobId} />
      </nav>
      <span className="grow" />
      {actions}
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
      className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
      onClick={() => {
        const to = openAtMachine(jobId, board);
        void navigate(to === '/start' ? { to, search: { for: 'cam' } } : { to });
      }}>
      At the machine
    </button>
  );
}
