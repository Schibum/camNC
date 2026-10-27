import { ConnectionState } from '@/lib/fluidnc/cnc-api';
import { getCncApi } from '@/lib/fluidnc/machine';
import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@wbcnc/ui/components/tooltip';
import { cn } from '@wbcnc/ui/lib/utils';
import { Home, LockOpen, OctagonX, Pause, Play } from 'lucide-react';

const kConnectionLabels: Record<ConnectionState, string> = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  'permission-denied': 'Permission denied',
  'needs-permission': 'Waiting for permission',
  unreachable: 'Unreachable',
  'other-tab': 'In use by another tab',
  'taken-over': 'Taken over by another tab',
};

export function ConnectionBadge() {
  'use no memo';
  const connection = getCncApi().connection.value;
  const color =
    connection === 'connected'
      ? 'bg-green-500'
      : connection === 'connecting' || connection === 'other-tab' || connection === 'needs-permission'
        ? 'bg-yellow-500 animate-pulse'
        : connection === 'disconnected'
          ? 'bg-gray-400'
          : 'bg-red-500';
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" data-testid="machine-connection">
      <span className={cn('inline-block size-2 rounded-full', color)} />
      {kConnectionLabels[connection]}
    </span>
  );
}

const kStateColors: Record<string, string> = {
  Idle: 'bg-green-100 text-green-900',
  Run: 'bg-blue-100 text-blue-900',
  Jog: 'bg-blue-100 text-blue-900',
  Hold: 'bg-yellow-100 text-yellow-900',
  Alarm: 'bg-red-600 text-white',
  Door: 'bg-orange-100 text-orange-900',
  Home: 'bg-purple-100 text-purple-900',
  Check: 'bg-gray-100 text-gray-900',
  Sleep: 'bg-gray-100 text-gray-900',
};

export function MachineStateBadge() {
  'use no memo';
  const api = getCncApi();
  const status = api.status.value;
  const alarm = api.alarm.value;
  if (!status) return null;
  const badge = (
    <span
      className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', kStateColors[status.state] ?? 'bg-gray-100')}
      data-testid="machine-state">
      {status.state}
      {status.subState !== undefined ? `:${status.subState}` : ''}
    </span>
  );
  if (!alarm) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>
        ALARM:{alarm.code} {alarm.message}
      </TooltipContent>
    </Tooltip>
  );
}

function report(promise: Promise<unknown>, what: string) {
  promise.catch(err => toast.error(`${what} failed`, { description: err instanceof Error ? err.message : String(err) }));
}

/** Feed hold, resume and soft reset (realtime, always available while connected), plus unlock and home. */
export function RealtimeButtons({ compact = false }: { compact?: boolean }) {
  'use no memo';
  const api = getCncApi();
  if (!api.isConnected.value) return null;
  const state = api.state.value;
  const holding = state === 'Hold' || state === 'Door';
  const size = compact ? 'icon' : 'sm';
  return (
    <div className="flex flex-row gap-1 items-center">
      {holding ? (
        <Button size={size} variant="outline" title="Resume (~)" onClick={() => report(api.resume(), 'Resume')}>
          <Play /> {!compact && 'Resume'}
        </Button>
      ) : (
        <Button size={size} variant="outline" title="Feed hold (!)" onClick={() => api.feedHold()}>
          <Pause /> {!compact && 'Hold'}
        </Button>
      )}
      <Button size={size} variant="destructive" title="Soft reset (Ctrl-X): stops everything immediately" onClick={() => api.softReset()}>
        <OctagonX /> {!compact && 'Reset'}
      </Button>
      {state === 'Alarm' && (
        <Button size={size} variant="outline" title="Unlock ($X)" onClick={() => report(api.unlock(), 'Unlock')}>
          <LockOpen /> {!compact && 'Unlock'}
        </Button>
      )}
      {(state === 'Alarm' || state === 'Idle') && (
        <Button size={size} variant="outline" title="Home all axes ($H)" onClick={() => report(api.home(), 'Homing')}>
          <Home /> {!compact && 'Home'}
        </Button>
      )}
    </div>
  );
}

export function JobProgressBadge() {
  'use no memo';
  const job = getCncApi().jobProgress.value;
  if (!job) return null;
  return (
    <span className="text-xs tabular-nums text-muted-foreground" title={job.file}>
      Job {job.percent.toFixed(1)}%
    </span>
  );
}

export function MachineStatusBar() {
  'use no memo';
  const api = getCncApi();
  const panelOpen = useStore(s => s.machinePanelOpen);
  if (api.connection.value === 'disconnected') return null;
  return (
    <div className="flex flex-row gap-2 items-center pl-2" data-testid="machine-status-bar">
      <button
        type="button"
        className="flex flex-row gap-2 items-center rounded-md px-1 hover:bg-accent"
        title="Machine panel (J)"
        onClick={() => useStore.getState().setMachinePanelOpen(!useStore.getState().machinePanelOpen)}>
        <ConnectionBadge />
        <MachineStateBadge />
        <JobProgressBadge />
      </button>
      {/* The open panel has its own Hold/Reset buttons. */}
      {!panelOpen && <RealtimeButtons compact />}
    </div>
  );
}
