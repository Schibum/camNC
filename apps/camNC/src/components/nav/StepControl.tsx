import { Link } from '@tanstack/react-router';
import type { ComponentProps } from 'react';
import type { AppStep } from './useAppSteps';

/** A step as a link or a button, whichever it takes to get there. */
export function StepControl({ step, children, ...props }: { step: AppStep } & ComponentProps<'button'>) {
  if (step.current)
    return (
      <button {...props} type="button" aria-current="step">
        {children}
      </button>
    );
  if (step.disabled)
    return (
      <button {...props} type="button" disabled title="Open a job in CAM/CAD first">
        {children}
      </button>
    );
  if (step.link)
    return (
      <Link {...(props as object)} to={step.link.to} params={step.link.params} search={step.link.search} preload="intent">
        {children}
      </Link>
    );
  return (
    <button {...props} type="button" onClick={step.onClick} onMouseEnter={step.onPreload} onFocus={step.onPreload}>
      {children}
    </button>
  );
}
