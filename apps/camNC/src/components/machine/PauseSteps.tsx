import { useCamMachine } from '@/cam/machine/camMachine';
import { pauseSteps } from '@/lib/machine/pauseSteps';
import type { PauseMarker } from '@wbcnc/cam/pauseMarker';
import { cn } from '@wbcnc/ui/lib/utils';

/** Parts of a per-part program as chips: taken out, the one at hand, still to come. */
function PartChips({ n, of }: { n: number; of: number }) {
  const overlay = useCamMachine(s => s.overlay);
  const names = overlay?.freeParts?.map(p => p.name) ?? (overlay?.tabsPerPart ? [...new Set(overlay.tabs?.map(t => t.part))] : []);
  return (
    <div className="flex flex-row flex-wrap items-center gap-1" aria-label="Parts">
      {names.length === of &&
        names.map((name, i) => (
          <span
            key={name}
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs',
              i < n - 1 && 'text-muted-foreground line-through',
              i === n - 1 && 'border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
              i === n && 'border-green-600 bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200'
            )}>
            {name}
          </span>
        ))}
      <span className="ml-auto text-xs text-muted-foreground">
        {n} of {of}
      </span>
    </div>
  );
}

/** One of camNC's own pauses: what it's for, as steps to do before Resume. */
export function PauseSteps({ marker, line }: { marker: PauseMarker; line: number }) {
  const { title, steps } = pauseSteps(marker);
  return (
    <div className="flex flex-col gap-2" data-testid="pause-steps">
      {marker.kind === 'take-out' && <PartChips n={marker.n} of={marker.of} />}
      <div className="rounded-md bg-amber-100 p-3 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100 flex flex-col gap-2">
        <h4 className="sr-only">{title}</h4>
        <ol className="flex flex-col gap-2">
          {steps.map((s, i) => (
            <li key={i} className="flex flex-row gap-2.5 items-start text-sm">
              <span
                className={cn(
                  'mt-px grid size-5 shrink-0 place-items-center rounded-full border-[1.5px] text-[11px] font-semibold',
                  s.hold
                    ? 'border-green-600 bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                    : 'border-amber-600 text-amber-700 dark:text-amber-300'
                )}>
                {i + 1}
              </span>
              <span className="flex flex-col">
                <span className="font-medium">{s.title}</span>
                {s.detail && <span className="text-xs text-amber-900/80 dark:text-amber-200/80">{s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
        <span className="text-[11px] font-mono text-amber-900/60 dark:text-amber-200/60">M0 · line {line}</span>
      </div>
    </div>
  );
}
