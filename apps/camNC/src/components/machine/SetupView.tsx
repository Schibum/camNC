import { getCncApi } from '@/lib/fluidnc/machine';
import { errorText, kJobFileName, setXYZeroFromToolpath, uploadAndRun, useJobChecklist } from '@/lib/machine/jobs';
import { useStore } from '@/store/store';
import { openGcodeFile } from '@/visualize/openGcodeFile';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@wbcnc/ui/components/alert-dialog';
import { Button } from '@wbcnc/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@wbcnc/ui/components/collapsible';
import { Input } from '@wbcnc/ui/components/input';
import { toast } from '@wbcnc/ui/components/sonner';
import { cn } from '@wbcnc/ui/lib/utils';
import { AlertTriangle, Check, ChevronRight, CirclePlay, FolderOpen, Home, LockOpen, Pencil } from 'lucide-react';
import { useState } from 'react';
import { JogPanel, ProbePanel } from './controls';
import { MacroButtons } from './macros';

function report(promise: Promise<unknown>, what: string) {
  return promise.catch(err => toast.error(`${what} failed`, { description: errorText(err) }));
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-row items-center justify-between min-h-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function AlarmCard() {
  'use no memo';
  const api = getCncApi();
  const alarm = api.alarm.value;
  if (api.state.value !== 'Alarm') return null;
  return (
    <div className="rounded-md bg-red-600 text-white p-3 text-sm flex flex-col gap-2" role="alert">
      <div>
        <b>{alarm ? `ALARM:${alarm.code}` : 'Alarm'}</b> {alarm?.message ?? 'The machine is locked.'}
      </div>
      <div className="flex flex-row gap-2">
        <Button size="sm" variant="secondary" onClick={() => report(api.home(), 'Homing')}>
          <Home /> Home all
        </Button>
        <Button size="sm" variant="secondary" onClick={() => report(api.unlock(), 'Unlock')}>
          <LockOpen /> Unlock
        </Button>
      </div>
    </div>
  );
}

function StatusRow({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-row gap-2 items-center text-sm min-h-8">
      {ok ? <Check className="size-4 text-green-600 shrink-0" /> : <AlertTriangle className="size-4 text-amber-500 shrink-0" />}
      {children}
    </div>
  );
}

function MachineSection() {
  'use no memo';
  const api = getCncApi();
  const connected = api.isConnected.value;
  const state = api.state.value;
  if (!connected || state === 'Alarm') return null;
  return (
    <Section title="Machine">
      <StatusRow ok={api.homed.value}>
        <span className="flex-1">{api.homed.value ? 'Homed' : 'Not homed since connecting'}</span>
        <Button
          size="sm"
          variant={api.homed.value ? 'ghost' : 'outline'}
          disabled={state !== 'Idle'}
          onClick={() => report(api.home(), 'Homing')}>
          <Home /> Home
        </Button>
      </StatusRow>
    </Section>
  );
}

function JobSection() {
  const name = useStore(s => s.toolpathName);
  const hasToolpath = useStore(s => !!s.toolpath);
  const stockHeight = useStore(s => s.stockHeight);
  const setStockHeight = useStore(s => s.setStockHeight);
  const offset = useStore(s => s.toolpathOffset);
  return (
    <Section title="Job">
      <StatusRow ok={hasToolpath}>
        <span className="flex-1 truncate" title={name ?? undefined}>
          {hasToolpath ? (name ?? 'G-code loaded') : 'No G-code loaded'}
        </span>
        <Button size="sm" variant="outline" onClick={openGcodeFile}>
          <FolderOpen /> Open…
        </Button>
      </StatusRow>
      <StatusRow ok={stockHeight > 0}>
        <span className="flex-1">Stock height</span>
        <Input
          type="number"
          step="0.1"
          min={0}
          className="h-7 w-20"
          aria-label="Stock height (mm)"
          value={stockHeight}
          onChange={e => {
            const value = Number(e.target.value);
            if (!Number.isNaN(value) && value >= 0) setStockHeight(value);
          }}
        />
        <span className="text-xs text-muted-foreground">mm</span>
      </StatusRow>
      {hasToolpath && (
        <p className="text-xs text-muted-foreground">
          Toolpath placed at X {offset.x.toFixed(2)} Y {offset.y.toFixed(2)}. Drag it on the camera view to place it roughly.
        </p>
      )}
    </Section>
  );
}

function ZeroSection() {
  'use no memo';
  const api = getCncApi();
  const idle = api.isConnected.value && api.state.value === 'Idle';
  const hasToolpath = useStore(s => !!s.toolpath);
  const [jogOpen, setJogOpen] = useState(false);
  return (
    <Section title="Zero">
      <div className="flex flex-row flex-wrap gap-1">
        <Button size="sm" disabled={!idle || !hasToolpath} onClick={() => setXYZeroFromToolpath()} title="G10 L2 at the toolpath position">
          Set XY zero = toolpath
        </Button>
        <Button size="sm" variant="outline" disabled={!idle} onClick={() => report(api.zeroAxes(['x', 'y']), 'Zeroing')}>
          Zero XY here
        </Button>
        <Button size="sm" variant="outline" disabled={!idle} onClick={() => report(api.zeroAxes(['z']), 'Zeroing')}>
          Zero Z here
        </Button>
        <Button size="sm" variant="outline" disabled={!idle} onClick={() => report(api.send('G90 G0 X0 Y0'), 'Move')}>
          Go to XY zero
        </Button>
      </div>
      <ProbePanel />
      <Collapsible open={jogOpen} onOpenChange={setJogOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="px-1 -ml-1 text-muted-foreground">
            <ChevronRight className={cn('transition-transform', jogOpen && 'rotate-90')} /> Jog (fine tuning)
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">{jogOpen && <JogPanel />}</CollapsibleContent>
      </Collapsible>
    </Section>
  );
}

function RunSection() {
  'use no memo';
  const api = getCncApi();
  const checklist = useJobChecklist();
  const hasToolpath = useStore(s => !!s.toolpath);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const idle = api.isConnected.value && api.state.value === 'Idle';
  const warnings = checklist.filter(item => !item.ok);
  if (!hasToolpath) return null;
  return (
    <Section title="Run">
      <ul className="flex flex-col gap-0.5" data-testid="job-checklist">
        {checklist.map(item => (
          <li key={item.id} className="flex flex-row gap-2 items-center text-sm">
            {item.ok ? <Check className="size-4 text-green-600 shrink-0" /> : <AlertTriangle className="size-4 text-amber-500 shrink-0" />}
            <span className={cn(!item.ok && 'text-amber-700 dark:text-amber-400')}>{item.label}</span>
          </li>
        ))}
      </ul>
      <Button size="lg" disabled={!idle} onClick={() => setConfirmOpen(true)}>
        <CirclePlay /> Run job
      </Button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run job?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p>
                  Uploads the G-code to the SD card as <code>{kJobFileName}</code> and starts it from the current work zero.
                </p>
                {warnings.length > 0 && (
                  <ul className="list-disc pl-5 text-amber-700 dark:text-amber-400">
                    {warnings.map(w => (
                      <li key={w.id}>{w.label}</li>
                    ))}
                  </ul>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => uploadAndRun().catch(err => console.error('upload and run failed', err))}>
              {warnings.length ? 'Run anyway' : 'Run'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}

/** Everything before a job: make the machine ready, load and place the job, zero, run. */
export function SetupView({ onEditMacros }: { onEditMacros: () => void }) {
  'use no memo';
  const connected = getCncApi().isConnected.value;
  return (
    <div className="flex flex-col gap-5">
      <AlarmCard />
      <MachineSection />
      <JobSection />
      {connected && (
        <>
          <Section
            title="Macros"
            action={
              <Button size="icon" variant="ghost" className="size-6" title="Edit macros" onClick={onEditMacros}>
                <Pencil className="size-3.5" />
              </Button>
            }>
            <MacroButtons />
          </Section>
          <ZeroSection />
          <RunSection />
        </>
      )}
    </div>
  );
}
