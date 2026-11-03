import { Link } from '@tanstack/react-router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@wbcnc/ui/components/tooltip';
import { cn } from '@wbcnc/ui/lib/utils';
import type { ReactNode } from 'react';

const kSteps = ['Model', 'Boards', 'Plan', 'Check'] as const;
export type CamStep = (typeof kSteps)[number];

// Check comes in a later milestone.
const kRoutes: Partial<Record<CamStep, '/cam/$jobId/model' | '/cam/$jobId/boards' | '/cam/$jobId/plan'>> = {
  Model: '/cam/$jobId/model',
  Boards: '/cam/$jobId/boards',
  Plan: '/cam/$jobId/plan',
};

/** Job name, the prepare steps (Model → Boards → Plan → Check), and the step's actions. */
export function CamJobBar({ jobId, fileName, step, actions }: { jobId: string; fileName: string; step: CamStep; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2">
      <span className="max-w-64 truncate text-sm text-muted-foreground" title={fileName}>
        {fileName}
      </span>
      <nav aria-label="Steps" className="flex flex-wrap items-center gap-1">
        {kSteps.map((s, i) => {
          const to = kRoutes[s];
          return to && s !== step ? (
            <Link
              key={s}
              to={to}
              params={{ jobId }}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
              {i + 1} {s}
            </Link>
          ) : (
            <StepLink key={s} active={s === step} enabled={!!to}>
              {i + 1} {s}
            </StepLink>
          );
        })}
        <span className="mx-2 h-5 w-px bg-border" />
        <StepLink active={false} enabled={false}>
          At the machine
        </StepLink>
      </nav>
      <span className="grow" />
      {actions}
    </div>
  );
}

function StepLink({ active, enabled, children }: { active: boolean; enabled: boolean; children: ReactNode }) {
  const el = (
    <span
      aria-current={active ? 'step' : undefined}
      aria-disabled={!enabled}
      className={cn(
        'whitespace-nowrap rounded-md px-3 py-1.5 text-sm',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
        // Not there yet: lighter than the step links, but still 3:1 (opacity on the text alone, not the whole chip).
        !enabled && !active && 'cursor-default text-muted-foreground/75'
      )}>
      {children}
    </span>
  );
  if (enabled || active) return el;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent>Coming next</TooltipContent>
    </Tooltip>
  );
}
