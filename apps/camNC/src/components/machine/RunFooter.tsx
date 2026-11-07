import { useCamMachine } from '@/cam/machine/camMachine';
import { getCncApi } from '@/lib/fluidnc/machine';
import {
  errorText,
  kJobFileName,
  machineZeroPreview,
  moveTargetPreview,
  moveToolpathToMachineZero,
  setXYZeroFromToolpath,
  uploadAndRun,
  useJobChecklist,
  zeroAndRun,
  zeroXYAtBit,
} from '@/lib/machine/jobs';
import { checkTravel, nextRunStep } from '@/lib/machine/workflow';
import { useStore } from '@/store/store';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wbcnc/ui/components/dropdown-menu';
import { toast } from '@wbcnc/ui/components/sonner';
import { cn } from '@wbcnc/ui/lib/utils';
import { AlertTriangle, Check, Circle, CirclePlay, Ellipsis, MoveRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DoneMenu } from './SetupStep';
import { useProbeZ } from './useProbeZ';

/** How long (ms) the main button stays locked once a step is done: a double press must not start the next one. */
const kSettleMs = 800;

const kStepLabels = { home: 'Home machine', z: 'Probe Z', run: 'Run job' };

/** Checklist items this footer shows as a check of its own, or that Run takes care of. */
const kHandledHere = new Set(['homed', 'xy-zero', 'z-zero']);

function report(promise: Promise<unknown>, what: string) {
  return promise.catch(err => toast.error(`${what} failed`, { description: errorText(err) }));
}

function DoneMark({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={cn('flex items-center gap-1 text-xs', done ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground')}>
      {done ? <Check className="size-3.5" /> : <Circle className="size-3.5" />} {label}
    </span>
  );
}

/** A menu row that's checked once it's done. */
function DoneItem({ done, children, ...item }: { done?: boolean } & React.ComponentProps<typeof DropdownMenuItem>) {
  return (
    <DropdownMenuItem {...item}>
      {children}
      {done && <Check className="ml-auto text-green-600 dark:text-green-400" />}
    </DropdownMenuItem>
  );
}

type Dialog = 'probe' | 'run' | 'keep';

/**
 * Pinned under the steps. The main button always does what's next: home, probe Z, then run, which sets XY zero where the
 * job is drawn. Its menu keeps everything else in one place that doesn't change from step to step.
 */
export function RunFooter() {
  'use no memo';
  const api = getCncApi();
  const checklist = useJobChecklist();
  const toolpath = useStore(s => s.toolpath);
  const offset = useStore(s => s.toolpathOffset);
  const midBoard = useCamMachine(s => s.midBoard);
  const { probe, prefs } = useProbeZ();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [locked, setLocked] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The outline stays up while the dialog about running from there is open: the menu closing behind it mustn't hide it.
  const keepingZero = useRef(false);
  useEffect(
    () => () => {
      clearTimeout(settle.current);
      machineZeroPreview.value = false;
      moveTargetPreview.value = null;
    },
    []
  );

  const hasToolpath = !!toolpath;
  const idle = api.isConnected.value && api.state.value === 'Idle';
  const homed = api.homed.value;
  const zItem = checklist.find(i => i.id === 'z-zero');
  const zZeroed = api.zZeroedAt.value !== null;
  const zOk = zItem?.ok ?? zZeroed;
  const xyOk = !!checklist.find(i => i.id === 'xy-zero')?.ok;
  const step = nextRunStep({ homed, zOk });
  const warnings = checklist.filter(item => !item.ok && !kHandledHere.has(item.id));
  const blocked = warnings.some(item => item.blocking);
  const isAlarm = (item: (typeof checklist)[number]) => item.blocking && !item.zeroFirst;
  const outside = warnings.some(item => item.id === 'position');

  const zero = api.currentZero.value;
  const movedBy = zero ? Math.hypot(offset.x - zero.x, offset.y - zero.y) : null;
  const zeroMoves = movedBy === null || movedBy >= 0.01;
  const wco = api.status.value?.wco;
  const travel = api.travel.value;
  // From the zero on the controller, the place doesn't count: only this run can stop on the old zero.
  const keepZero =
    toolpath && wco && travel
      ? checkTravel({ toolpathBounds: toolpath.getBounds(), workOffset: wco, travel, gcode: toolpath.gcode })
      : null;

  /** Keeps the main button locked while `promise` runs and for a moment after. */
  const work = (promise: Promise<unknown>, what: string) => {
    clearTimeout(settle.current);
    setLocked(true);
    void report(promise, what).finally(() => {
      settle.current = setTimeout(() => setLocked(false), kSettleMs);
    });
  };
  const home = () => work(api.home(), 'Homing');
  const next = () => {
    if (step === 'home') home();
    else if (step === 'z') setDialog('probe');
    else setDialog('run');
  };
  const hideZeroPreview = () => {
    if (!keepingZero.current) machineZeroPreview.value = false;
  };
  const closeDialog = () => {
    keepingZero.current = false;
    hideZeroPreview();
    setDialog(null);
  };
  const previews = (show: () => void, hide: () => void) => ({ onFocus: show, onBlur: hide, onPointerEnter: show, onPointerLeave: hide });
  const zeroPreview = previews(() => (machineZeroPreview.value = true), hideZeroPreview);
  const movePreview = (target: { x: number; y: number } | null | undefined) =>
    previews(
      () => (moveTargetPreview.value = target ?? null),
      () => (moveTargetPreview.value = null)
    );
  const onMenuOpen = (open: boolean) => {
    if (open) return;
    moveTargetPreview.value = null;
    hideZeroPreview();
  };
  const runDescription = zeroMoves
    ? `Sets XY zero where the job is drawn${movedBy === null ? '' : ` (${movedBy.toFixed(0)} mm from the old zero)`}, uploads the G-code to the SD card as ${kJobFileName} and starts it.`
    : `Keeps the XY zero, which is already where the job is drawn. Uploads the G-code to the SD card as ${kJobFileName} and starts it.`;

  return (
    <section
      aria-label="Run"
      className="sticky bottom-0 z-10 -mx-3 -mb-3 mt-auto flex flex-col gap-2 border-t bg-background px-3 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.25)]">
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5" data-testid="job-checklist">
          {warnings.map(item => (
            <li key={item.id} className="flex flex-row gap-2 items-start text-sm">
              <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', isAlarm(item) ? 'text-red-600' : 'text-amber-500')} />
              <span className={cn('text-amber-700 dark:text-amber-400', isAlarm(item) && 'text-red-700 dark:text-red-400')}>
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
      {warnings.some(isAlarm) && (
        <p className="text-xs text-red-700 dark:text-red-400">
          {outside
            ? 'Move the machine into its travel first: FluidNC 3.9 stops any move from outside it, even a Z lift.'
            : 'Fix the travel problem above first: with soft limits on, the controller would stop this job with an alarm.'}
        </p>
      )}
      <div className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <DoneMenu done={homed} label="Home" onChange={done => (api.homed.value = done)}>
          <DoneMark done={homed} label="Home" />
        </DoneMenu>
        <DoneMenu done={zOk} label="Z" disabled={zOk && !zZeroed} onChange={done => (api.zZeroedAt.value = done ? Date.now() : null)}>
          <DoneMark done={zOk} label={zOk && !zZeroed ? 'Z set by the G-code' : 'Z'} />
        </DoneMenu>
        {hasToolpath && <DoneMark done={false} label="XY when you run" />}
      </div>
      <div className="flex flex-row gap-0.5">
        <Button
          size="lg"
          className="flex-1 rounded-r-none"
          disabled={!idle || locked || (step === 'run' && (blocked || !hasToolpath))}
          onClick={next}>
          {step === 'run' && <CirclePlay />} {kStepLabels[step]}
        </Button>
        <DropdownMenu onOpenChange={onMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button size="lg" className="rounded-l-none px-3" aria-label="More actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Setup</DropdownMenuLabel>
            <DoneItem done={homed} disabled={!idle} onClick={home}>
              Home machine
            </DoneItem>
            <DoneItem done={zOk} disabled={!idle} onClick={() => setDialog('probe')}>
              Probe Z
            </DoneItem>
            <DropdownMenuItem disabled={!idle} onClick={() => report(api.zeroAxes(['z']), 'Zeroing')}>
              Zero Z here
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">XY zero</DropdownMenuLabel>
            <DoneItem done={xyOk} disabled={!idle || !hasToolpath} onClick={() => setXYZeroFromToolpath()}>
              Set XY zero
            </DoneItem>
            <DropdownMenuItem
              disabled={!idle || !hasToolpath}
              {...movePreview(offset)}
              onClick={() => work(setXYZeroFromToolpath(true), 'Moving')}>
              Set XY zero and move there
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!idle} {...movePreview(zero)} onClick={() => work(api.goToXYZero(), 'Moving')}>
              Move to XY zero
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!idle} onClick={() => zeroXYAtBit()}>
              Zero XY at the bit
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!idle || !hasToolpath} {...zeroPreview} onClick={() => moveToolpathToMachineZero()}>
              Move job to the machine&apos;s zero
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Run</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={!idle || !hasToolpath || !!keepZero?.blocking}
              title={keepZero?.blocking ? keepZero.details?.join(' ') : undefined}
              {...zeroPreview}
              onClick={() => {
                keepingZero.current = true;
                machineZeroPreview.value = true;
                setDialog('keep');
              }}>
              Run from the machine&apos;s zero
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <AlertDialog open={dialog === 'probe'} onOpenChange={open => !open && closeDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Probe Z?</AlertDialogTitle>
            <AlertDialogDescription>
              Put the probe plate ({prefs.probePlateThickness} mm thick) under the bit. The bit moves down until it touches, up to{' '}
              {prefs.probeMaxTravel} mm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => work(probe(), 'Probing')}>Probe</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={dialog === 'run' || dialog === 'keep'} onOpenChange={open => !open && closeDialog()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run job?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p>
                  {dialog === 'keep'
                    ? `Keeps the XY zero on the machine and cuts at the yellow outline, not where the job is drawn. Uploads the G-code to the SD card as ${kJobFileName} and starts it.`
                    : runDescription}
                </p>
                {dialog === 'run' && midBoard && zeroMoves && (
                  <p className="text-amber-700 dark:text-amber-400">
                    This board already has cuts from the old zero. Unless you moved the board, this one will be out of line with them.
                  </p>
                )}
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
            <AlertDialogAction
              onClick={() => (dialog === 'keep' ? uploadAndRun() : zeroAndRun()).catch(err => console.error('upload and run failed', err))}>
              {warnings.length ? 'Run anyway' : 'Run'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
