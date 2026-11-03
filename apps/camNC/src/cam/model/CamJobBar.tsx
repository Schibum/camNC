import { Button } from '@wbcnc/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@wbcnc/ui/components/tooltip';
import { cn } from '@wbcnc/ui/lib/utils';
import type { ReactNode } from 'react';

const kSteps = ['Model', 'Boards', 'Plan', 'Check'] as const;
export type CamStep = (typeof kSteps)[number];

/** Job name, the prepare steps (Model → Boards → Plan → Check), and the step's actions. */
export function CamJobBar({ fileName, step, actions }: { fileName: string; step: CamStep; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-4 py-2">
      <span className="max-w-64 truncate text-sm text-muted-foreground" title={fileName}>
        {fileName}
      </span>
      <nav aria-label="Steps" className="flex items-center gap-1">
        {kSteps.map((s, i) => (
          <StepLink key={s} active={s === step} enabled={s === 'Model'}>
            {i + 1} {s}
          </StepLink>
        ))}
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
        'rounded-md px-3 py-1.5 text-sm',
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
        !enabled && !active && 'opacity-60'
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

export function NextStepButton({ children }: { children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Disabled buttons don't fire pointer events; the span carries the tooltip. */}
        <span tabIndex={0}>
          <Button size="sm" disabled>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Boards and nesting come next.</TooltipContent>
    </Tooltip>
  );
}
