import { getCncApi } from '@/lib/fluidnc/machine';
import { errorText, stopJob } from '@/lib/machine/jobs';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { Pause, Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { OverridesPanel, PositionLine } from './controls';
import { Section } from './SetupView';

function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Rough time left from progress so far. FluidNC reports bytes read, which runs a bit ahead of the tool. */
function useTimeLeft(percent: number | undefined, startedAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  if (percent === undefined || !startedAt || percent < 2) return null;
  const elapsed = now - startedAt;
  return { elapsed, left: (elapsed * (100 - percent)) / percent };
}

/** While a job runs: progress, pause/resume, stop and overrides. Jogging and zeroing are not possible now. */
export function RunningView() {
  'use no memo';
  const api = getCncApi();
  const job = api.jobProgress.value;
  const state = api.state.value;
  const holding = state === 'Hold' || state === 'Door';
  const time = useTimeLeft(job?.percent, api.jobStartedAt.value);
  const file = job?.file.split('/').pop();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-row justify-between items-baseline gap-2">
          <span className="font-medium truncate" title={job?.file}>
            {file ?? 'Running'}
          </span>
          {job && <span className="text-2xl font-semibold tabular-nums">{job.percent.toFixed(1)}%</span>}
        </div>
        <div className="h-2.5 w-full rounded bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${job?.percent ?? 0}%` }} />
        </div>
        <div className="text-xs text-muted-foreground">
          {time ? `${formatDuration(time.elapsed)} elapsed · about ${formatDuration(time.left)} left` : holding ? '' : 'Estimating…'}
        </div>
      </div>

      {holding && (
        <p className="text-sm rounded-md bg-amber-100 text-amber-900 p-2">
          {state === 'Door' ? 'Safety door open.' : 'Paused.'} Resume continues the job; Stop ends it.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {holding ? (
          <Button size="lg" onClick={() => api.resume().catch(err => toast.error('Resume failed', { description: errorText(err) }))}>
            <Play /> Resume
          </Button>
        ) : (
          <Button size="lg" variant="outline" onClick={() => api.feedHold()}>
            <Pause /> Pause
          </Button>
        )}
        <Button size="lg" variant="destructive" onClick={() => void stopJob()}>
          <Square /> Stop
        </Button>
      </div>

      <Section title="Overrides">
        <OverridesPanel />
      </Section>

      <PositionLine showFeed />
    </div>
  );
}
