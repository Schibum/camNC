import { cn } from '@wbcnc/ui/lib/utils';
import { Check } from 'lucide-react';

export type AddCameraStep = 'source' | 'reuse' | 'calibrate' | 'markers';

const kSteps: { step: AddCameraStep; label: string }[] = [
  { step: 'source', label: 'Source' },
  { step: 'reuse', label: 'Reuse setup' },
  { step: 'calibrate', label: 'Calibrate' },
  { step: 'markers', label: 'Markers' },
];

/** Where the person is in adding a camera. "Reuse setup" only shows when another camera is set up. */
export function AddCameraSteps({ current, showReuse }: { current: AddCameraStep; showReuse: boolean }) {
  const steps = kSteps.filter(s => showReuse || s.step !== 'reuse');
  const currentIndex = steps.findIndex(s => s.step === current);
  return (
    <ol className="flex flex-row items-center gap-2 px-1 text-sm" aria-label="Adding a camera">
      {steps.map(({ step, label }, i) => (
        <li key={step} className="flex flex-row items-center gap-2" aria-current={i === currentIndex ? 'step' : undefined}>
          {i > 0 && <span className="h-px w-6 bg-border" />}
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
              i === currentIndex && 'border-primary bg-primary/10 font-semibold',
              i < currentIndex && 'border-primary bg-primary text-primary-foreground'
            )}>
            {i < currentIndex ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn(i === currentIndex ? 'font-semibold' : 'text-muted-foreground')}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
