import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { cn } from '@wbcnc/ui/lib/utils';
import { AlertTriangle, Check, RotateCcw, RotateCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SetupStep } from '@/components/machine/SetupStep';
import { Hint } from '../Hint';
import { NumberInput } from '../NumberInput';
import { parseDecimal } from '../numberFormat';
import { Input } from '@wbcnc/ui/components/input';
import { useBedEdit } from './bedEdit';
import { clearMachineView, loadIntoMachineView } from '../showOnMachine';
import { kStockAllowance, stockTopOf } from '../boards';
import { Vector3 } from 'three';
import {
  entryHolds,
  entryProgram,
  entryRotation,
  entrySide,
  entryTitle,
  nextEntry,
  rotationKey,
  useCamMachine,
  type QueueEntry,
} from './camMachine';
import { useMachineBusy } from './useMachineBusy';
import { useMachineQueue } from './useMachineQueue';

const fmt = (v: number) => `${+v.toFixed(2)}`;

/** "Clamp it", "Screw it down": what the board is held with. */
const holdKindName = (e: QueueEntry) =>
  (e.board.request?.holdPoints?.[0]?.kind ?? e.board.board.holds?.kind) === 'clamp' ? 'Clamp it' : 'Screw it down';

/**
 * The board's angle, to match a board lying askew: typed, or in 0.1° steps. It turns about the board's middle (like
 * the knob above the board in the top view), so the outline stays where it lies.
 */
function RotationControl({ deg, onSet }: { deg: number; onSet: (d: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const step = (d: number) => onSet(Math.round((deg + d) * 10) / 10);
  const commit = () => {
    if (text === null) return;
    const v = parseDecimal(text);
    setText(null);
    if (v !== null && Number.isFinite(v)) onSet(Math.round(Math.max(-180, Math.min(180, v)) * 10) / 10);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Hint text="Turn the board 0.1° clockwise, to match a board that lies askew.">
        <Button size="sm" variant="outline" aria-label="Turn 0.1° clockwise" onClick={() => step(-0.1)}>
          <RotateCw />
        </Button>
      </Hint>
      <div className="relative">
        <Input
          aria-label="Rotation in degrees"
          inputMode="decimal"
          className="h-8 w-20 pr-5 text-center font-mono"
          value={text ?? deg.toFixed(1)}
          onChange={e => setText(e.target.value)}
          onFocus={e => e.target.select()}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setText(null);
          }}
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">°</span>
      </div>
      <Hint text="Turn the board 0.1° counterclockwise, to match a board that lies askew.">
        <Button size="sm" variant="outline" aria-label="Turn 0.1° counterclockwise" onClick={() => step(0.1)}>
          <RotateCcw />
        </Button>
      </Hint>
      {deg !== 0 && (
        <Button size="sm" variant="ghost" onClick={() => onSet(0)}>
          Straighten
        </Button>
      )}
    </div>
  );
}

/**
 * The CAM job at the machine, in the machine panel: the queue of programs (boards in an order that keeps the bit in
 * the collet, one program per bit, guided tab removal), and for the current one what to do before running it. Once an
 * entry is active the machine view holds its program or nothing, never the program of another entry.
 */
export function CamQueueCard() {
  const { jobId, active, setActive, markDone, setRotation, rotation, leave, setOverlay, pauseEachTab, setPauseEachTab } = useCamMachine();
  const { job, queue, current, done, stale, loading, modelError, setStockThickness } = useMachineQueue();
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
  }, [jobId, active, current?.key, gcode, shownDeg, loading, busy]);
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
  const deg = current ? entryRotation(current, rotation) : 0;
  // Through the top view's editor when it's there: about the board's middle, the spot saved with the job.
  const setDeg = (d: number) => {
    const bed = useBedEdit.getState().bed;
    if (bed && current && bed.boardId === current.board.board.id) bed.rotate(d);
    else if (current) setRotation(rotationKey(current), d);
  };
  const bit = current && entryProgram(current)?.diameter;
  // The previous entry in the queue left another bit in the collet, on any kind of entry.
  const swap = bit !== undefined && bit !== current?.bitBefore;
  const swapText = current?.bitBefore === undefined ? `Put in the ⌀${bit} mm bit` : `Swap the bit to ⌀${bit} mm`;
  const onCamera = current?.flip?.registration === 'camera';

  return (
    <section aria-label="CAM job" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="truncate text-sm font-semibold">{job ? job.name : 'CAM job'}</h3>
        <span className="grow" />
        <Hint text="Closes the queue here. Which boards are done is forgotten; the job itself stays.">
          <Button size="icon" variant="ghost" className="size-6" aria-label="Leave the CAM job" onClick={leave}>
            <X className="size-3.5" />
          </Button>
        </Hint>
      </div>
      {loading && !queue.length && <p className="text-xs text-muted-foreground">Making the programs…</p>}
      {modelError && (
        <p role="alert" className="text-[13px] text-destructive">
          {modelError}
        </p>
      )}
      <ol className="flex flex-col gap-0.5 rounded-lg border p-1 text-[13px]" aria-label="Board queue">
        {queue.map(e => {
          const isDone = done.includes(e.doneId);
          const isNow = e === current;
          return (
            <li key={e.key}>
              <button
                onClick={() => load(e)}
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
                      ? `${e.release.parts ? `${e.release.parts.length} parts` : `${e.release.tabs?.length ?? 0} tabs`} · ${Math.ceil(e.release.timeMin)} min`
                      : `${Math.ceil(e.plan.programs[e.program].timeMin)} min`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

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
              state="todo"
              label="Board"
              title={`Board ${board.name} on the bed`}
              summary={`${fmt(current.plan.size[0])} × ${fmt(current.plan.size[1])} × ${fmt(stockTopOf(board))} mm`}>
              <div className="flex flex-col gap-1.5">
                <p>
                  <span className="font-medium">1. Measure the board’s thickness</span>
                  {board.measuredThickness === undefined
                    ? ` and enter it. Assumed: ${fmt(stockTopOf(board))} mm (parts + ${kStockAllowance} mm). Thicker than that, the bit moves fast into the wood where it should still be above it.`
                    : `. Measured: ${fmt(board.measuredThickness)} mm.`}
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
              <div className="flex flex-col gap-1.5">
                <p>
                  <span className="font-medium">3. Align:</span> drag the dashed board outline onto the board in the camera view. If it lies
                  askew, turn it with the knob above it, or here:
                </p>
                <RotationControl deg={deg} onSet={setDeg} />
              </div>
              {!!current.board.request?.holdPoints && (
                <p>
                  <span className="font-medium">4. {holdKindName(current)}:</span> fit one on each blue mark in the camera view. Elsewhere
                  works better? Drag the mark there, or add or remove marks in the top view: the program follows.
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
              {onCamera && (
                <>
                  <p>If it lies at another angle now, turn side B’s program (dashed outline):</p>
                  <RotationControl deg={deg} onSet={setDeg} />
                </>
              )}
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
                <div className="flex flex-col gap-1.5">
                  <p>
                    <span className="font-medium">Align:</span> drag the dashed board outline onto the turned board in the camera view. If
                    it lies askew, turn the program:
                  </p>
                  <RotationControl deg={deg} onSet={setDeg} />
                </div>
              )}
            </SetupStep>
          )}
          {swap && (
            <SetupStep state="todo" label="Bit" title={swapText}>
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
                A router you switch by hand: switch it off at each pause, back on before Resume.
              </HowItWorks>
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={pauseEachTab} onCheckedChange={v => setPauseEachTab(v === true)} aria-label="Pause before each tab" />
                Pause before each tab
              </label>
            </SetupStep>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {current.plan && current.kind !== 'flip' && (
              <Hint text="Puts this program in the machine view, ready to run.">
                <Button
                  size="sm"
                  variant={loadedGcode && loadedGcode === gcodeOf(current) ? 'outline' : 'default'}
                  disabled={!gcodeOf(current)}
                  onClick={() => load(current)}>
                  Load {current.kind === 'tabs' ? 'tab removal' : current.kind === 'free' ? 'parts freeing' : 'program'}
                </Button>
              </Hint>
            )}
            <span className="grow" />
            <Hint text="Marks this one as cut and loads the next program in the queue.">
              {/* Only for what could be loaded: a program not there yet, or blocked, wasn't cut. */}
              <Button
                size="sm"
                variant={current.kind === 'flip' ? 'default' : 'outline'}
                disabled={!!current.blocked || !!stale?.has(current.board.board.id)}
                onClick={next}>
                {current.kind === 'flip' ? 'Turned over, next' : 'Done, next'}
              </Button>
            </Hint>
          </div>
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
