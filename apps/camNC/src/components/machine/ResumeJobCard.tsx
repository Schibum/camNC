import { getCncApi } from '@/lib/fluidnc/machine';
import { dismissInterruptedJob, interruptedJob } from '@/lib/machine/jobRecovery';
import { errorText, kResumeFileName, prepareResume, runResume } from '@/lib/machine/jobs';
import { findRestartLine, parseProgram } from '@/lib/machine/resume';
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
import { Input } from '@wbcnc/ui/components/input';
import { toast } from '@wbcnc/ui/components/sonner';
import { AlertTriangle, Check, Home, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const fmt = (n: number) => n.toFixed(2);
/** Work offsets closer than this (mm) count as the same zero. */
const kZeroTolerance = 0.01;

function report(promise: Promise<unknown>, what: string) {
  return promise.catch(err => toast.error(`${what} failed`, { description: errorText(err) }));
}

function Step({ ok, title, children }: { ok: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex flex-row gap-2">
      {ok ? (
        <Check className="size-4 mt-0.5 text-green-600 shrink-0" />
      ) : (
        <AlertTriangle className="size-4 mt-0.5 text-amber-500 shrink-0" />
      )}
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="font-medium">{title}</span>
        {children}
      </div>
    </li>
  );
}

/**
 * After a job camNC started stopped part way (power cycle, reset, alarm, Stop): home, get the same work zero back,
 * pick where to restart, and run the rest of the job from there (see resume.ts).
 */
export function ResumeJobCard() {
  'use no memo';
  const api = getCncApi();
  const job = interruptedJob.value;
  const connected = api.isConnected.value;
  const state = api.state.value;
  const idle = connected && state === 'Idle';
  const status = api.status.value;
  const [skipHoming, setSkipHoming] = useState(false);
  const [line, setLine] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const program = useMemo(() => (job ? parseProgram(job.record.gcode) : null), [job]);
  const lastWorkPos = useMemo(() => {
    if (!job) return null;
    const { mpos, wco } = job.progress;
    return { x: mpos.x - wco.x, y: mpos.y - wco.y, z: mpos.z - wco.z };
  }, [job]);
  const found = useMemo(
    () => (program && job && lastWorkPos ? findRestartLine(program, job.progress.percent, lastWorkPos) : null),
    [program, job, lastWorkPos]
  );
  useEffect(() => setLine(found?.line ?? null), [found]);
  // The resume moves are checked against the travel, and the retract height comes from it.
  useEffect(() => {
    if (job && idle) api.ensureTravel();
  }, [api, job, idle]);

  const preview = useMemo(() => {
    if (!job || line === null || !confirmOpen) return null;
    try {
      return { ok: true as const, ...prepareResume(job, line) };
    } catch (err) {
      return { ok: false as const, error: errorText(err) };
    }
  }, [job, line, confirmOpen]);

  if (!job || !program || !lastWorkPos || !connected || api.host.value !== job.record.host || state === 'Alarm') return null;

  const homedOk = api.homed.value || skipHoming;
  const wco = status?.wco;
  const saved = job.progress.wco;
  const delta = wco && { x: wco.x - saved.x, y: wco.y - saved.y, z: wco.z - saved.z };
  const xyOk = !!delta && Math.abs(delta.x) <= kZeroTolerance && Math.abs(delta.y) <= kZeroTolerance;
  const zReZeroed = api.zZeroedAt.value !== null && api.zZeroedAt.value > job.progress.at;
  const zOk = !!delta && (Math.abs(delta.z) <= kZeroTolerance || zReZeroed);
  const wcs = api.currentOffsetModal.value ?? 'G54';
  const p = Number(wcs.slice(1)) - 53;
  const restore = (axes: ('x' | 'y' | 'z')[]) =>
    report(api.send(`G10 L2 P${p} ${axes.map(a => `${a.toUpperCase()}${saved[a].toFixed(3)}`).join(' ')}`), 'Restoring the zero').then(() =>
      api.getCurrentZero().catch(() => {})
    );
  const restartLine = line !== null ? program.lines[line] : null;
  const ready = idle && homedOk && xyOk && zOk && !!restartLine?.motion;
  const name = job.record.toolpathName ?? 'Job';

  return (
    <div
      className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm flex flex-col gap-3"
      data-testid="resume-card">
      <div className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5 min-w-0">
          <b className="truncate" title={name}>
            Resume {name}?
          </b>
          <span>{job.reason}</span>
          <span className="text-xs text-muted-foreground font-mono">
            Last seen {new Date(job.progress.at).toLocaleTimeString()} at work X {fmt(lastWorkPos.x)} Y {fmt(lastWorkPos.y)} Z{' '}
            {fmt(lastWorkPos.z)}
          </span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0"
          aria-label="Dismiss interrupted job"
          onClick={dismissInterruptedJob}>
          <X />
        </Button>
      </div>

      <ol className="flex flex-col gap-3">
        <Step ok={homedOk} title={homedOk ? 'Homed' : 'Home the machine'}>
          {!homedOk && (
            <>
              <span className="text-xs text-muted-foreground">
                After a power cycle or reset the machine position is only known again after homing.
              </span>
              <div className="flex flex-row flex-wrap gap-1">
                <Button size="sm" disabled={!idle} onClick={() => report(api.home(), 'Homing')}>
                  <Home /> Home
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSkipHoming(true)}>
                  No homing switches
                </Button>
              </div>
            </>
          )}
        </Step>

        <Step ok={xyOk && zOk} title={xyOk && zOk ? 'Same work zero as the job' : 'Get the job’s work zero back'}>
          {delta && !(xyOk && zOk) && (
            <>
              <span className="text-xs text-muted-foreground font-mono">
                Now off by X {fmt(delta.x)} Y {fmt(delta.y)} Z {zReZeroed ? '(re-zeroed)' : fmt(delta.z)}
              </span>
              <div className="flex flex-row flex-wrap gap-1">
                <Button
                  size="sm"
                  disabled={!idle || !homedOk}
                  onClick={() => restore(['x', 'y', 'z'])}
                  title={`G10 L2 P${p} with the job's offset`}>
                  Restore XY and Z
                </Button>
                {!xyOk && (
                  <Button size="sm" variant="outline" disabled={!idle || !homedOk} onClick={() => restore(['x', 'y'])}>
                    Restore XY only
                  </Button>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                Restoring needs the machine homed the same way as for the job. If Z may have changed (bit slipped, tool swapped), restore XY
                only and probe or zero Z below.
              </span>
            </>
          )}
        </Step>

        <Step ok={!!restartLine?.motion} title="Restart point">
          <div className="flex flex-row items-center gap-2">
            <span className="text-xs">Line</span>
            <Input
              type="number"
              min={1}
              max={program.lines.length}
              className="h-7 w-24"
              aria-label="Restart line"
              value={line !== null ? line + 1 : ''}
              onChange={e => {
                const value = Number(e.target.value);
                if (Number.isInteger(value) && value >= 1 && value <= program.lines.length) setLine(value - 1);
              }}
            />
            <span className="text-xs text-muted-foreground">of {program.lines.length}</span>
          </div>
          {restartLine && (
            <code className="text-xs truncate" title={restartLine.raw}>
              {restartLine.raw || '(empty line)'}
            </code>
          )}
          <span className="text-xs text-muted-foreground">
            {found && line === found.line
              ? `The move the tool was on (${fmt(found.distance)} mm from the last position). Restarting at its start re-cuts a little air.`
              : found
                ? `camNC suggested line ${found.line + 1}.`
                : 'camNC could not tell where the tool was. Pick the line to restart at.'}
            {restartLine && !restartLine.motion && ' This line is not a move: pick a line with a move.'}
          </span>
        </Step>
      </ol>

      <Button disabled={!ready} onClick={() => setConfirmOpen(true)}>
        <RotateCcw /> Preview and resume…
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {/* A single column that may shrink: otherwise the long G-code lines widen the grid past the dialog. */}
        <AlertDialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Resume from line {line !== null ? line + 1 : '?'}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-sm">
                {preview?.ok === false && <p className="text-red-700 dark:text-red-400">{preview.error}</p>}
                {preview?.ok && (
                  <>
                    <p>
                      Uploads <code>{kResumeFileName}</code> and starts it. It retracts Z, moves over the restart point and pauses: check
                      the bit is clear, then press Resume to start the spindle, plunge and continue.
                    </p>
                    <pre className="text-xs bg-muted rounded p-2 whitespace-pre-wrap break-words overflow-y-auto max-h-48">
                      {preview.gcode
                        .split('\n')
                        .slice(0, preview.preambleLines + 3)
                        .join('\n')}
                      {'\n…'}
                    </pre>
                    {[
                      ...preview.warnings,
                      ...(preview.travel && !preview.travel.ok ? [preview.travel.label, ...(preview.travel.details ?? [])] : []),
                    ].map((warning, i) => (
                      <p key={i} className="text-amber-700 dark:text-amber-400">
                        {warning}
                      </p>
                    ))}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!preview?.ok || !!preview.travel?.blocking}
              onClick={() => line !== null && runResume(job, line).catch(err => console.error('resume failed', err))}>
              Resume job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
