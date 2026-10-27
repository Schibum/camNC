import { getCncApi } from '@/lib/fluidnc/machine';
import { errorText, isCamncJobFile, stopJob } from '@/lib/machine/jobs';
import { pauseHint } from '@/lib/machine/pauseHints';
import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { Pause, Play, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AlarmCard } from './AlarmCard';
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

/** Why the job is on hold and what Resume does next, as far as the uploaded G-code tells. */
function HoldExplanation() {
  'use no memo';
  const api = getCncApi();
  const status = api.status.value;
  const job = api.jobProgress.value;
  const gcode = useStore(s => s.toolpath?.gcode);
  const lastMessage = api.lastMessage.value;
  // Only the file camNC uploaded corresponds to the loaded toolpath.
  const ours = !!gcode && !!job && isCamncJobFile(job.file);
  const percent = job?.percent;
  const hint = useMemo(() => (ours && percent !== undefined ? pauseHint(gcode!, percent) : null), [ours, gcode, percent]);
  if (status?.state === 'Door')
    return <p className="text-sm rounded-md bg-amber-100 text-amber-900 p-2">Safety door open. Close it, then Resume.</p>;
  if (status?.state === 'Hold' && status.subState === 1) {
    return <p className="text-sm rounded-md bg-amber-100 text-amber-900 p-2">Pausing… the machine is slowing down.</p>;
  }
  return (
    <div className="text-sm rounded-md bg-amber-100 text-amber-900 p-2 flex flex-col gap-1" data-testid="hold-explanation">
      {hint ? (
        <>
          <p>{hint.reason}</p>
          {hint.next && <p className="font-medium">{hint.next}</p>}
        </>
      ) : (
        <p>{ours ? 'Paused with Hold.' : 'Paused.'} Resume continues the job; Stop ends it.</p>
      )}
      {lastMessage && !hint?.reason.includes(lastMessage.replace(/^INFO:\s*(MSG,)?/i, '')) && (
        <p className="text-xs font-mono text-amber-800">Controller: {lastMessage}</p>
      )}
    </div>
  );
}

/** While a job runs: progress, pause/resume, stop and overrides. Jogging and zeroing are not possible now. */
export function RunningView({ onShowConsole }: { onShowConsole?: () => void } = {}) {
  'use no memo';
  const api = getCncApi();
  const job = api.jobProgress.value;
  const state = api.state.value;
  const holding = state === 'Hold' || state === 'Door';
  const time = useTimeLeft(job?.percent, api.jobStartedAt.value);
  const file = job?.file.split('/').pop();

  return (
    <div className="flex flex-col gap-5">
      <AlarmCard onShowConsole={onShowConsole} />
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

      {holding && <HoldExplanation />}

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
