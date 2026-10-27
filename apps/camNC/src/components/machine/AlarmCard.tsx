import { getCncApi } from '@/lib/fluidnc/machine';
import { explainAlarm, kUnknownAlarmHelp, TravelBounds } from '@/lib/machine/alarms';
import { useMachineBoundsOrNull } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { Home, LockOpen } from 'lucide-react';

function report(promise: Promise<unknown>, what: string) {
  return promise.catch(err => toast.error(`${what} failed`, { description: err instanceof Error ? err.message : String(err) }));
}

const fmt = (n: number) => n.toFixed(2);

/**
 * Shown while the controller is in Alarm: what happened, where, and how to resolve it, with Home and Unlock.
 * If camNC did not see the alarm happen (before this page or connection), it explains the likely cases instead.
 */
export function AlarmCard({ onShowConsole }: { onShowConsole?: () => void }) {
  'use no memo';
  const api = getCncApi();
  const bounds = useMachineBoundsOrNull();
  // Status reports can show the alarm while (re)connecting, before commands are accepted.
  const connected = api.isConnected.value;
  const lastAlarm = api.lastAlarm.value;
  if (api.state.value !== 'Alarm') return null;

  const travel: TravelBounds = bounds ? { X: { min: bounds.min.x, max: bounds.max.x }, Y: { min: bounds.min.y, max: bounds.max.y } } : {};
  // Only an alarm the controller has not left since is the current one.
  const known = lastAlarm && !lastAlarm.cleared ? lastAlarm : null;
  const help = known ? explainAlarm(known, travel) : { title: 'Alarm', ...kUnknownAlarmHelp };
  const recent = known ? [] : api.consoleLines.value.slice(-5);

  return (
    <div className="rounded-md bg-red-600 text-white p-3 text-sm flex flex-col gap-2" role="alert" data-testid="alarm-card">
      <div className="flex flex-row items-baseline justify-between gap-2">
        <b>{help.title}</b>
        {known && <span className="text-xs text-red-100">{new Date(known.at).toLocaleTimeString()}</span>}
      </div>
      <p>{help.cause}</p>
      <p className="text-red-50">
        <b>Fix:</b> {help.fix}
      </p>
      {known?.mpos && (
        <p className="text-xs text-red-100 font-mono">
          At machine X {fmt(known.mpos.x)} Y {fmt(known.mpos.y)} Z {fmt(known.mpos.z)}
          {known.job && ` · ${known.job.file.split('/').pop()} ${known.job.percent.toFixed(1)} %`}
        </p>
      )}
      {(known?.messages.length ?? 0) > 0 && (
        <ul className="text-xs font-mono bg-red-700/60 rounded p-1.5 flex flex-col gap-0.5">
          {known!.messages.map((message, i) => (
            <li key={i}>[MSG:{message}]</li>
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <ul className="text-xs font-mono bg-red-700/60 rounded p-1.5 flex flex-col gap-0.5" aria-label="Last console lines">
          {recent.map((line, i) => (
            <li key={i} className="truncate">
              {line.text}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-row flex-wrap gap-2 items-center">
        <Button size="sm" variant="secondary" disabled={!connected} onClick={() => report(api.home(), 'Homing')}>
          <Home /> Home all
        </Button>
        <Button size="sm" variant="secondary" disabled={!connected} onClick={() => report(api.unlock(), 'Unlock')}>
          <LockOpen /> Unlock
        </Button>
        {onShowConsole && (
          <Button size="sm" variant="link" className="text-white ml-auto px-0" onClick={onShowConsole}>
            Show console
          </Button>
        )}
      </div>
    </div>
  );
}
