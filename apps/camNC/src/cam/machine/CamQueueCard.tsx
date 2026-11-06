import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@wbcnc/ui/components/popover';
import { cn } from '@wbcnc/ui/lib/utils';
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SetupStep } from '@/components/machine/SetupStep';
import { Hint } from '../Hint';
import { NumberInput } from '../NumberInput';
import { clearMachineView, loadIntoMachineView } from '../showOnMachine';
import { kStockAllowance, stockTopOf } from '../boards';
import { Vector3 } from 'three';
import { entryHolds, entryProgram, entryRotation, entrySide, entryTitle, nextEntry, useCamMachine, type QueueEntry } from './camMachine';
import { entryGhost } from './partGhost';
import { useMachineBusy } from './useMachineBusy';
import { useMachineQueue } from './useMachineQueue';

const fmt = (v: number) => `${+v.toFixed(2)}`;

/** "Clamp it", "Screw it down": what the board is held with. */
const holdKindName = (e: QueueEntry) => (e.board.request?.holdPoints?.[0]?.kind === 'clamp' ? 'Clamp it' : 'Screw it down');

/**
 * The CAM job at the machine, in the machine panel: one line for the current entry of the queue of programs (boards in
 * an order that keeps the bit in the collet, one program per bit, guided tab removal) with the whole queue behind it,
 * and what to do before running it. Once an entry is active the machine view holds its program or nothing, never the
 * program of another entry.
 */
export function CamQueueCard() {
  const [queueOpen, setQueueOpen] = useState(false);
  const { jobId, active, setActive, markDone, rotation, leave, setOverlay, pauseEachTab, setPauseEachTab } = useCamMachine();
  const spindle = useStore(s => s.machinePrefs.spindleSwitch ?? 'hand');
  const { job, queue, current, done, stale, loading, modelError, setStockThickness, parts } = useMachineQueue();
  const gcodeOf = (e: QueueEntry) => (e.blocked || stale?.has(e.board.board.id) ? undefined : entryProgram(e)?.gcode);
  /** The machine view for this entry. `force`: load it even if the same program seems to be there. */
  const show = (e: QueueEntry, force: boolean) => {
    const program = entryProgram(e);
    const gcode = gcodeOf(e);
    if (program && gcode) {
      if (force || useStore.getState().toolpath?.gcode !== gcode)
        loadIntoMachineView({ gcode, size: e.plan!.size, bits: [program.diameter] }, `${job?.name} ${entryTitle(e)}.gcode`);
    } else clearMachineView();
    // Where this board was placed on the bed before: its program goes there again.
    const spot = e.board.board.bed?.[entrySide(e)];
    const offset = useStore.getState().toolpathOffset;
    if (spot && (spot.x !== offset.x || spot.y !== offset.y)) useStore.getState().setToolpathOffset(new Vector3(spot.x, spot.y, offset.z));
    // The outline stays while there's no program: it shows where the board goes and at what angle.
    setOverlay(
      e.plan
        ? {
            w: e.plan.size[0],
            h: e.plan.size[1],
            rotationDeg: entryRotation(e, rotation),
            ...(gcode && { tabs: e.release?.tabs, tabsPerPart: !!e.release?.perPart, freeParts: e.release?.parts }),
            ...entryHolds(e),
            ...entryGhost(e, parts, entryRotation(e, rotation)),
          }
        : null
    );
  };
  const load = (e: QueueEntry) => {
    setActive(e.key);
    show(e, true);
  };
  const gcode = current ? gcodeOf(current) : undefined;
  const shownDeg = current ? entryRotation(current, rotation) : 0;
  const busy = useMachineBusy();
  const loadedGcode = useStore(s => s.toolpath?.gcode);
  // Planned again (a hold moved, the board turned), blocked, gone: what's loaded follows the active entry. Never while a
  // program runs or is paused partway: it follows once that's done.
  useEffect(() => {
    if (!jobId || !active || busy) return;
    if (!current) {
      clearMachineView();
      setOverlay(null);
      if (!loading) setActive(null);
      return;
    }
    // The active entry's board is being planned: its entry comes back then.
    if (current.key !== active && current.kind !== 'pending') setActive(current.key);
    show(current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, active, current?.key, gcode, shownDeg, loading, busy, parts]);
  if (!jobId) return null;
  const next = () => {
    if (!current) return;
    markDone(current.doneId);
    const after = nextEntry(queue, current, done);
    if (after) load(after);
    else {
      setActive(null);
      clearMachineView();
      setOverlay(null);
    }
  };
  const board = current?.board.board;
  const bit = current && entryProgram(current)?.diameter;
  // The previous entry in the queue left another bit in the collet, on any kind of entry.
  const swap = bit !== undefined && bit !== current?.bitBefore;
  const swapText = current?.bitBefore === undefined ? `Put in the ⌀${bit} mm bit` : `Swap the bit to ⌀${bit} mm`;
  const onCamera = current?.flip?.registration === 'camera';
  const at = current ? queue.indexOf(current) : -1;
  const blockedCount = queue.filter(e => e.kind !== 'pending' && e.blocked).length;
  const stripTitle = current ? entryTitle(current) : (job?.name ?? 'CAM job');
  // Loaded already: there's nothing for the button to do, and the panel needs the room.
  const loaded = !!current && active === current.key && !!loadedGcode && loadedGcode === gcodeOf(current);

  return (
    <section aria-label="CAM job" className="flex flex-col gap-2">
      <div className="flex items-center gap-1 rounded-lg border p-1">
        <Popover open={queueOpen} onOpenChange={setQueueOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 flex-1 justify-start gap-1 px-1.5 text-[13px] font-medium"
              aria-label={`Board queue: ${stripTitle}`}>
              <span className="truncate">{stripTitle}</span>
              {at >= 0 && (
                <span className="shrink-0 font-mono text-xs font-normal text-muted-foreground">
                  {at + 1}/{queue.length}
                </span>
              )}
              {blockedCount > 0 && (
                <span className="flex shrink-0 items-center gap-0.5 text-xs text-destructive" title={`${blockedCount} blocked`}>
                  <AlertTriangle className="size-3.5" />
                  {blockedCount}
                </span>
              )}
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          {/* Not onto Leave, the first button: Enter would close the job. */}
          <PopoverContent align="start" className="flex w-80 flex-col gap-1 p-2" onOpenAutoFocus={e => e.preventDefault()}>
            <div className="flex items-center gap-2 px-1">
              <h3 className="truncate text-sm font-semibold">{job ? job.name : 'CAM job'}</h3>
              <span className="grow" />
              <Hint text="Closes the queue here. Which boards are done is forgotten; the job itself stays.">
                <Button size="icon" variant="ghost" className="size-6" aria-label="Leave the CAM job" onClick={leave}>
                  <X className="size-3.5" />
                </Button>
              </Hint>
            </div>
            <ol className="flex flex-col gap-0.5 rounded-lg border p-1 text-[13px]" aria-label="Board queue">
              {queue.map(e => {
                const isDone = done.includes(e.doneId);
                const isNow = e === current;
                return (
                  <li key={e.key}>
                    <button
                      disabled={busy}
                      onClick={() => {
                        load(e);
                        setQueueOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted',
                        isNow && 'bg-primary/10 font-medium',
                        isDone && !isNow && 'text-muted-foreground'
                      )}>
                      <span className="w-4">
                        {e.kind !== 'pending' && e.blocked ? (
                          <AlertTriangle aria-label="Blocked" className="size-3.5 text-destructive" />
                        ) : isDone ? (
                          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : isNow ? (
                          '●'
                        ) : (
                          ''
                        )}
                      </span>
                      <span className="grow">{entryTitle(e)}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {!e.plan || e.kind === 'flip'
                          ? ''
                          : e.release
                            ? `${e.release.parts ? `${e.release.parts.length} parts` : `${e.release.tabs?.length ?? 0} tabs`} · ≈${Math.ceil(e.release.timeMin)} min auto`
                            : `≈${Math.ceil(e.plan.programs[e.program].timeMin)} min auto`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </PopoverContent>
        </Popover>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Previous board"
          disabled={busy || at <= 0}
          onClick={() => load(queue[at - 1]!)}>
          <ChevronLeft />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Next board"
          disabled={busy || at < 0 || at >= queue.length - 1}
          onClick={() => load(queue[at + 1]!)}>
          <ChevronRight />
        </Button>
        {current && (
          <Hint text="Marks this one as cut and loads the next program in the queue.">
            {/* Only for what could be loaded: a program not there yet, or blocked, wasn't cut. Not while one runs: what's loaded stays. */}
            <Button
              size="sm"
              className="shrink-0"
              variant={current.kind === 'flip' ? 'default' : 'outline'}
              disabled={busy || !!current.blocked || !!stale?.has(current.board.board.id)}
              onClick={next}>
              {current.kind === 'flip' ? 'Turned over, next' : 'Done, next'}
            </Button>
          </Hint>
        )}
      </div>
      {loading && !queue.length && <p className="text-xs text-muted-foreground">Making the programs…</p>}
      {modelError && (
        <p role="alert" className="text-[13px] text-destructive">
          {modelError}
        </p>
      )}
      {busy && <p className="text-xs text-muted-foreground">A program is running or paused: the queue goes on when it’s done.</p>}

      {current && board && (
        <div className="flex flex-col gap-2 text-[13px]">
          {current.blocked && (
            <p
              role={current.kind === 'pending' ? 'status' : 'alert'}
              className={cn('flex gap-2', current.kind !== 'pending' && 'text-destructive')}>
              {current.kind !== 'pending' && <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
              <span>
                {current.blocked}
                {current.kind !== 'pending' && ' Fix it on the Plan step: this can’t be loaded until then.'}
              </span>
            </p>
          )}
          {current.firstOfBoard && current.plan && (
            <SetupStep
              key={board.id}
              state="todo"
              startFolded={board.measuredThickness !== undefined}
              label="Board"
              title={<span className="whitespace-nowrap">{`Board ${board.name} on the bed`}</span>}
              summary={`${fmt(current.plan.size[0])} × ${fmt(current.plan.size[1])} × ${fmt(stockTopOf(board))} mm`}>
              <div className="flex flex-col gap-1.5">
                <p>
                  <span className="font-medium">1. Measure its thickness</span>
                  {board.measuredThickness === undefined ? ` (assumed parts + ${kStockAllowance} mm):` : ':'}
                </p>
                <div className="flex w-40 flex-col gap-1">
                  <NumberInput
                    id={`queue-stock-${board.id}`}
                    aria-label={`Stock thickness of board ${board.name}, mm`}
                    value={stockTopOf(board)}
                    min={board.thickness}
                    unit="mm"
                    onCommit={t => setStockThickness(board.id, t)}
                  />
                </div>
              </div>
              <p>
                <span className="font-medium">2. Place it</span> on the bed.
              </p>
              <p>
                <span className="font-medium">3. Line up the outline</span> with the board in the camera view.
              </p>
              {!!current.board.request?.holdPoints?.length && (
                <p>
                  <span className="font-medium">4. {holdKindName(current)}</span> on the blue marks.
                </p>
              )}
              {!swap && <p className="text-muted-foreground">Z0 is the bottom of the board: zero Z on the spoilboard below.</p>}
            </SetupStep>
          )}
          {current.kind === 'flip' && (
            <SetupStep state="todo" label="Turn over" title={`Turn board ${board.name} over`} summary="top to bottom">
              <p>
                The front edge goes to the back.{' '}
                {current.flip?.registration === 'dowels'
                  ? `Put the ⌀${current.flip.dowelDiameter} dowel pins into the holes side A drilled, and drop the board onto them.`
                  : current.flip?.registration === 'fence'
                    ? 'Push it against the fence and the stop again, as for side A.'
                    : 'You’ll drag the dashed outline onto it in the camera view on the next step, with side B’s program loaded.'}
              </p>
              <p>
                <span className="font-medium">Refit the screws, clamps or tape</span> where side B needs them: they have to stay clear of
                side B’s cuts, which the checks don’t know about.
              </p>
              <p className="text-muted-foreground">
                {onCamera
                  ? 'Z stays: it’s measured from the spoilboard.'
                  : 'Don’t touch the XY zero: side B is mirrored to it. Z stays: it’s measured from the spoilboard.'}
              </p>
            </SetupStep>
          )}
          {current.kind === 'bit' && current.sideB && current.program === 0 && (
            <SetupStep state="todo" label="Side B" title="Side B" summary={`⌀${current.plan.programs[0].diameter} mm, the undersides`}>
              <p>The parts’ undersides, not cut through.</p>
              {onCamera && (
                <p>
                  <span className="font-medium">Line up the outline</span> with the turned board in the camera view.
                </p>
              )}
            </SetupStep>
          )}
          {swap && (
            <SetupStep
              state="todo"
              startFolded={current.firstOfBoard}
              label="Bit"
              title={<span className="whitespace-nowrap">{swapText}</span>}
              summary={current.firstOfBoard ? 'Z0: board bottom' : undefined}>
              <p>
                {current.firstOfBoard
                  ? 'Then zero Z on the spoilboard below: Z0 is the bottom of the board.'
                  : 'Then zero Z again below. Don’t move the board: XY stays.'}
              </p>
            </SetupStep>
          )}
          {current.kind === 'free' && current.board.request?.holdDown === 'fixture-tape' && (
            <SetupStep state="todo" label="Cut the parts free" title="Cut the parts free" summary="no pauses">
              <p>Cuts the bottom skin of all parts in one go, smallest first. Take the parts off the tape when it’s done.</p>
            </SetupStep>
          )}
          {current.kind === 'free' && current.board.request?.holdDown !== 'fixture-tape' && (
            <SetupStep
              state="todo"
              label="Cut the parts free"
              title="Cut the parts free"
              summary={current.release?.parts ? `one per pause, ${current.release.parts.length} parts` : 'one per pause'}>
              <p>
                Hold down the part ringed green while it’s cut free. At each pause, take out the amber one, hold down the next green one,
                then Resume.
              </p>
              <HowItWorks>
                The program cuts one part’s bottom skin at a time, then lifts the bit, stops the spindle and pauses. The spindle starts
                again on Resume, before the next one. A router you switch by hand: switch it off at each pause, back on before Resume.
              </HowItWorks>
            </SetupStep>
          )}
          {current.kind === 'tabs' && (
            <SetupStep
              state="todo"
              label="Remove the tabs"
              title="Remove the tabs"
              summary={pauseEachTab ? 'a pause before each tab' : 'a pause per part'}>
              <p>
                {pauseEachTab
                  ? 'At each pause, hold the part at the green ring, away from the bit, then Resume.'
                  : 'At each pause, take out the part marked amber, then Resume.'}
              </p>
              <HowItWorks>
                {pauseEachTab
                  ? 'The program lifts the bit, stops the spindle and pauses before each tab. The spindle starts again on Resume.'
                  : 'The program cuts all of a part’s tabs in a row, the last one slower, then lifts the bit, stops the spindle and pauses. The spindle starts again on Resume, before the next part.'}{' '}
                {spindle === 'hand' && ' A router you switch by hand: switch it off at each pause, back on before Resume.'}
              </HowItWorks>
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={pauseEachTab} onCheckedChange={v => setPauseEachTab(v === true)} aria-label="Pause before each tab" />
                Pause before each tab
              </label>
            </SetupStep>
          )}
          {current.plan && current.kind !== 'flip' && !loaded && (
            <Hint text="Puts this program in the machine view, ready to run.">
              <Button size="sm" className="self-start" disabled={busy || !gcodeOf(current)} onClick={() => load(current)}>
                Load {current.kind === 'tabs' ? 'tab removal' : current.kind === 'free' ? 'parts freeing' : 'program'}
              </Button>
            </Hint>
          )}
        </div>
      )}
      {!current && queue.length > 0 && <p className="text-[13px]">All boards are cut.</p>}
    </section>
  );
}

/** The long explanation of a guided program, folded. */
function HowItWorks({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="self-start text-xs text-muted-foreground underline"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}>
        How it works
      </button>
      {open && <p className="text-xs text-muted-foreground">{children}</p>}
    </div>
  );
}
