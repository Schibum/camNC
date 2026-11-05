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
import { AlertTriangle, Check, ChevronRight, CirclePlay, FolderOpen, Home, MoveRight, Pencil, Wrench } from 'lucide-react';
import { useState } from 'react';
import { AlarmCard } from './AlarmCard';
import { JogPanel, ProbeSettings } from './controls';
import { useProbeZ } from './useProbeZ';
import { MacroButtons } from './macros';
import { ResumeJobCard } from './ResumeJobCard';
import { CamQueueCard } from '@/cam/machine/CamQueueCard';
import { useCamMachine } from '@/cam/machine/camMachine';
import { SetupStep } from './SetupStep';

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

function HomeStep() {
  'use no memo';
  const api = getCncApi();
  const connected = api.isConnected.value;
  const state = api.state.value;
  if (!connected || state === 'Alarm') return null;
  const homed = api.homed.value;
  return (
    <SetupStep
      state={homed ? 'done' : 'warn'}
      title={homed ? 'Homed' : 'Not homed since connecting'}
      action={
        <Button size="sm" variant={homed ? 'ghost' : 'outline'} disabled={state !== 'Idle'} onClick={() => report(api.home(), 'Homing')}>
          <Home /> Home
        </Button>
      }
    />
  );
}

/** Without a CAM job: the G-code file and the stock it's cut from. */
function JobStep() {
  const name = useStore(s => s.toolpathName);
  const hasToolpath = useStore(s => !!s.toolpath);
  const stockHeight = useStore(s => s.stockHeight);
  const setStockHeight = useStore(s => s.setStockHeight);
  const offset = useStore(s => s.toolpathOffset);
  return (
    <SetupStep
      label="Job"
      state={hasToolpath && stockHeight > 0 ? 'done' : 'todo'}
      title={<span className="truncate">{hasToolpath ? (name ?? 'Program loaded') : 'Open a G-code file'}</span>}
      summary={hasToolpath && stockHeight > 0 ? `stock ${stockHeight} mm` : undefined}
      action={
        <Button size="sm" variant="outline" onClick={openGcodeFile}>
          <FolderOpen /> Open…
        </Button>
      }>
      <div className="flex flex-row items-center gap-2">
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
      </div>
      {hasToolpath && (
        <p className="text-xs text-muted-foreground">
          Placed at X {offset.x.toFixed(2)} Y {offset.y.toFixed(2)}. Drag it on the camera view to place it roughly.
        </p>
      )}
    </SetupStep>
  );
}

function ZeroRow({ ok, label, children }: { ok: boolean; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-row flex-wrap items-center gap-2 min-h-8">
      {ok ? <Check className="size-4 shrink-0 text-green-600" /> : <AlertTriangle className="size-4 shrink-0 text-amber-500" />}
      <span className="flex-1">{label}</span>
      {children}
    </div>
  );
}

/** XY from where the toolpath sits on the camera view, Z by probing; done when both match the job. */
function ZeroStep() {
  'use no memo';
  const api = getCncApi();
  const idle = api.isConnected.value && api.state.value === 'Idle';
  const hasToolpath = useStore(s => !!s.toolpath);
  const checklist = useJobChecklist();
  const { probe, disabled, prefs } = useProbeZ();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const xy = checklist.find(i => i.id === 'xy-zero');
  const z = checklist.find(i => i.id === 'z-zero');
  const zOk = z?.ok ?? api.zZeroedAt.value !== null;
  return (
    <SetupStep
      label="Zero"
      state={xy?.ok && zOk ? 'done' : 'todo'}
      title="Zero"
      summary={xy?.ok && zOk ? 'XY = toolpath · Z set' : undefined}>
      <ZeroRow ok={!!xy?.ok} label={xy ? (xy.ok ? 'XY = toolpath' : 'XY not at the toolpath') : 'XY: load a job first'}>
        <Button
          size="sm"
          variant={xy?.ok ? 'ghost' : 'default'}
          disabled={!idle || !hasToolpath}
          onClick={() => setXYZeroFromToolpath()}
          title="G10 L2 at the toolpath position">
          Set XY zero = toolpath
        </Button>
      </ZeroRow>
      <ZeroRow ok={zOk} label={zOk ? (z?.label ?? 'Z zeroed') : 'Z not set yet'}>
        <Button size="sm" variant={zOk ? 'ghost' : 'default'} disabled={disabled} onClick={probe}>
          Probe Z
        </Button>
        <Button size="sm" variant="outline" disabled={!idle} onClick={() => report(api.zeroAxes(['z']), 'Zeroing')}>
          Zero Z here
        </Button>
      </ZeroRow>
      <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
        <CollapsibleTrigger asChild>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground">
            Plate {prefs.probePlateThickness} mm · travel {prefs.probeMaxTravel} mm · feed {prefs.probeFeed}{' '}
            <span className="underline">{settingsOpen ? 'done' : 'change'}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">{settingsOpen && <ProbeSettings />}</CollapsibleContent>
      </Collapsible>
    </SetupStep>
  );
}

/** Checklist items the steps above already show, by a short name. */
const kShownInSteps = new Map([
  ['homed', 'Home'],
  ['xy-zero', 'XY zero'],
  ['z-zero', 'Z zero'],
]);

/** Pinned under the steps: what still blocks or warns, and Run. */
function RunFooter() {
  'use no memo';
  const api = getCncApi();
  const checklist = useJobChecklist();
  const hasToolpath = useStore(s => !!s.toolpath);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const idle = api.isConnected.value && api.state.value === 'Idle';
  const warnings = checklist.filter(item => !item.ok);
  const blocked = checklist.some(item => item.blocking);
  const outside = checklist.some(item => item.id === 'position' && !item.ok);
  if (!hasToolpath) return null;
  const others = warnings.filter(w => !kShownInSteps.has(w.id));
  const open = warnings.filter(w => kShownInSteps.has(w.id));
  return (
    <section
      aria-label="Run"
      className="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto flex flex-col gap-2 border-t bg-background px-3 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.25)]">
      {others.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-testid="job-checklist">
          {others.map(item => (
            <li key={item.id} className="flex flex-row gap-2 items-start text-sm">
              <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', item.blocking ? 'text-red-600' : 'text-amber-500')} />
              <span className={cn('text-amber-700 dark:text-amber-400', item.blocking && 'text-red-700 dark:text-red-400')}>
                {item.label}
                {item.details && (
                  <ul className="list-disc pl-4 text-xs">
                    {item.details.map((detail, i) => (
                      <li key={i}>{detail}</li>
                    ))}
                  </ul>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {open.length > 0 && (
        <p className="text-xs text-muted-foreground">Not done yet: {open.map(w => kShownInSteps.get(w.id)).join(' · ')}</p>
      )}
      <Button size="lg" disabled={!idle || blocked} onClick={() => setConfirmOpen(true)}>
        <CirclePlay /> Run job
      </Button>
      {outside && (
        <Button
          size="sm"
          variant="outline"
          disabled={!idle}
          title="Jog the axes outside the travel 0.5 mm into it"
          onClick={() => report(api.moveIntoTravel(), 'Moving into the travel')}>
          <MoveRight /> Move into the travel
        </Button>
      )}
      {blocked && (
        <p className="text-xs text-red-700 dark:text-red-400">
          {outside
            ? 'Move the machine into its travel first: FluidNC 3.9 stops any move from outside it, even a Z lift.'
            : 'Fix the travel problem above first: with soft limits on, the controller would stop this job with an alarm.'}
        </p>
      )}
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
    </section>
  );
}

/** Manual tools, out of the way of the job: macros, zeroing at the bit, jogging. */
function ToolsDrawer({ onEditMacros, defaultOpen }: { onEditMacros: () => void; defaultOpen: boolean }) {
  'use no memo';
  const api = getCncApi();
  const idle = api.isConnected.value && api.state.value === 'Idle';
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="-ml-1 self-start px-1 text-muted-foreground">
          <ChevronRight className={cn('transition-transform', open && 'rotate-90')} /> <Wrench /> Tools: macros, jog, zero here
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4">
        {open && (
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
            <Section title="Zero here">
              <div className="flex flex-row flex-wrap gap-1">
                <Button size="sm" variant="outline" disabled={!idle} onClick={() => report(api.zeroAxes(['x', 'y']), 'Zeroing')}>
                  Zero XY here
                </Button>
                <Button size="sm" variant="outline" disabled={!idle} onClick={() => report(api.send('G90 G0 X0 Y0'), 'Move')}>
                  Go to XY zero
                </Button>
              </div>
            </Section>
            <Section title="Jog">
              <JogPanel />
            </Section>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Everything before a job, as steps: home, the job (a CAM job's queue and board, or a G-code file), zero, run. Run
 * stays pinned at the bottom; manual tools are folded away.
 */
export function SetupView({ onEditMacros, onShowConsole }: { onEditMacros: () => void; onShowConsole?: () => void }) {
  'use no memo';
  const connected = getCncApi().isConnected.value;
  const camJob = !!useCamMachine(s => s.jobId);
  const hasToolpath = useStore(s => !!s.toolpath);
  return (
    <div className="flex min-h-full flex-col gap-3">
      <AlarmCard onShowConsole={onShowConsole} />
      <ResumeJobCard />
      <HomeStep />
      {camJob ? <CamQueueCard /> : <JobStep />}
      {connected && (
        <>
          <ZeroStep />
          <ToolsDrawer onEditMacros={onEditMacros} defaultOpen={!hasToolpath && !camJob} />
          <RunFooter />
        </>
      )}
    </div>
  );
}
