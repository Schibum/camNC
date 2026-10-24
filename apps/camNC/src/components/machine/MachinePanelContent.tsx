import { getCncApi } from '@/lib/fluidnc/machine';
import { machineSupport } from '@/lib/fluidnc/machine-support';
import { machineView, MachineView } from '@/lib/machine/workflow';
import { useStore } from '@/store/store';
import { Link } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@wbcnc/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { cn } from '@wbcnc/ui/lib/utils';
import { FileCog, HardDrive, MoreHorizontal, Pencil, Plug, SquareTerminal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ConfigView } from './ConfigView';
import { ConsolePanel } from './ConsolePanel';
import { PositionLine } from './controls';
import { FileManager } from './FileManager';
import { ConnectionBadge, JobProgressBadge, MachineStateBadge, RealtimeButtons } from './MachineStatusBar';
import { MacroManager } from './macros';
import { RunningView } from './RunningView';
import { SetupView } from './SetupView';

type DialogKind = 'files' | 'macros' | 'config' | null;

const kDialogs: Record<Exclude<DialogKind, null>, { title: string; description: string }> = {
  files: { title: 'SD card', description: 'Files on the controller’s SD card.' },
  macros: { title: 'Edit macros', description: 'Macros run line by line and stop at the first error.' },
  config: { title: 'Configuration', description: 'The running FluidNC configuration ($CD), read-only.' },
};

/** The view follows the machine (setup ↔ running); a manual choice holds until the machine changes phase. */
function useMachineView() {
  'use no memo';
  const api = getCncApi();
  const auto = machineView({ state: api.state.value, jobActive: api.jobProgress.value !== null || api.jobStartedAt.value !== null });
  const [manual, setManual] = useState<MachineView | null>(null);
  useEffect(() => setManual(null), [auto]);
  return [manual ?? auto, setManual] as const;
}

/**
 * The machine panel, organised by what you are doing: preparing the machine and the job, then running it.
 * Rarely used tools (console, SD card, macro editing, config) live in the ⋯ menu.
 */
export function MachinePanelContent({ onClose, className }: { onClose?: () => void; className?: string }) {
  'use no memo';
  const api = getCncApi();
  const machine = useStore(s => s.machine);
  const support = machineSupport();
  const [view, setView] = useMachineView();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const connected = api.isConnected.value;

  return (
    <div className={cn('flex flex-col h-full min-h-0', className)} data-testid="machine-panel">
      <div className="flex flex-col gap-2 p-3 border-b">
        <div className="flex flex-row items-center gap-2">
          <h2 className="font-semibold">Machine</h2>
          <MachineStateBadge />
          <JobProgressBadge />
          <div className="ml-auto flex flex-row items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="size-8" aria-label="More machine tools">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!connected} onClick={() => setConsoleOpen(o => !o)}>
                  <SquareTerminal /> {consoleOpen ? 'Hide console' : 'Console'}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!connected} onClick={() => setDialog('files')}>
                  <HardDrive /> SD card files
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDialog('macros')}>
                  <Pencil /> Edit macros
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!connected} onClick={() => setDialog('config')}>
                  <FileCog /> Configuration ($CD)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/setup/fluidnc">
                    <Plug /> Connection settings
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {onClose && (
              <Button size="icon" variant="ghost" className="size-8" aria-label="Close machine panel" onClick={onClose}>
                <X />
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-row items-center gap-2 text-xs text-muted-foreground">
          <ConnectionBadge />
          {machine?.host && <span>{machine.host}</span>}
          {api.firmware.value && <span>FluidNC {api.firmware.value.version}</span>}
        </div>
        {connected && (
          <div className="flex flex-row items-center justify-between gap-2">
            <RealtimeButtons compact />
            <div className="flex flex-row rounded-md border p-0.5 text-xs" role="tablist">
              {(['setup', 'running'] as const).map(v => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  className={cn('px-2 py-1 rounded', view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
                  onClick={() => setView(v)}>
                  {v === 'setup' ? 'Setup' : 'Running'}
                </button>
              ))}
            </div>
          </div>
        )}
        {connected && view === 'setup' && <PositionLine />}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {!support.supported && <p className="text-sm text-muted-foreground mb-4">{support.reason}</p>}
        {support.supported && !machine?.host && (
          <p className="text-sm mb-4">
            No machine connected.{' '}
            <Button asChild variant="link" className="p-0 h-auto">
              <Link to="/setup/fluidnc">Connect one</Link>
            </Button>
          </p>
        )}
        {view === 'running' && connected ? <RunningView /> : <SetupView onEditMacros={() => setDialog('macros')} />}
      </div>

      {consoleOpen && (
        <div className="border-t p-2 flex flex-col gap-1">
          <div className="flex flex-row items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Console</span>
            <Button size="icon" variant="ghost" className="size-6" aria-label="Close console" onClick={() => setConsoleOpen(false)}>
              <X className="size-3.5" />
            </Button>
          </div>
          <ConsolePanel />
        </div>
      )}

      <Dialog open={dialog !== null} onOpenChange={open => !open && setDialog(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {dialog && (
            <>
              <DialogHeader>
                <DialogTitle>{kDialogs[dialog].title}</DialogTitle>
                <DialogDescription>{kDialogs[dialog].description}</DialogDescription>
              </DialogHeader>
              {dialog === 'files' && <FileManager />}
              {dialog === 'macros' && <MacroManager />}
              {dialog === 'config' && <ConfigView />}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
