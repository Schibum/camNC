import { useStore } from '@/store/store';
import { Button } from '@wbcnc/ui/components/button';
import { Checkbox } from '@wbcnc/ui/components/checkbox';
import { cn } from '@wbcnc/ui/lib/utils';
import { AlertTriangle, Check, RotateCcw, RotateCw, X } from 'lucide-react';
import { useEffect } from 'react';
import { Hint } from '../Hint';
import { NumberInput } from '../NumberInput';
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

/** Turns the program of the current entry, to match a board lying askew. */
function RotationControl({ deg, onTurn }: { deg: number; onTurn: (d: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Hint text="Turn the program 0.5° clockwise, to match a board that lies askew.">
        <Button size="sm" variant="outline" aria-label="Turn 0.5° clockwise" onClick={() => onTurn(-0.5)}>
          <RotateCw />
        </Button>
      </Hint>
      <span className="w-16 text-center font-mono" aria-label="Rotation">
        {deg.toFixed(1)}°
      </span>
      <Hint text="Turn the program 0.5° counterclockwise, to match a board that lies askew.">
        <Button size="sm" variant="outline" aria-label="Turn 0.5° counterclockwise" onClick={() => onTurn(0.5)}>
          <RotateCcw />
        </Button>
      </Hint>
      <span className="text-xs text-muted-foreground">about the XY zero (lower left)</span>
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
  const turn = (d: number) => current && setRotation(rotationKey(current), Math.round((deg + d) * 10) / 10);
  const bit = current && entryProgram(current)?.diameter;
  // The previous entry in the queue left another bit in the collet, on any kind of entry.
  const swap = bit !== undefined && bit !== current?.bitBefore;
  const swapText = current?.bitBefore === undefined ? `Put in the ⌀${bit} mm bit` : `Swap the bit to ⌀${bit} mm`;
  const onCamera = current?.flip?.registration === 'camera';

  return (
    <section aria-label="CAM job" className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">CAM job{job ? `: ${job.name}` : ''}</h3>
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
      <ol className="flex flex-col gap-1 text-[13px]" aria-label="Board queue">
        {queue.map(e => {
          const isDone = done.includes(e.doneId);
          const isNow = e === current;
          return (
            <li key={e.key}>
              <button
                onClick={() => load(e)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted',
                  isNow && 'bg-background font-medium ring-1 ring-primary/50',
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
        <div className="flex flex-col gap-2 border-t pt-3 text-[13px]">
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
            <>
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
                <span className="font-medium">2. Place board {board.name}</span> ({fmt(current.plan.size[0])} × {fmt(current.plan.size[1])}{' '}
                mm, {fmt(stockTopOf(board))} mm thick) on the bed.
              </p>
              <div className="flex flex-col gap-1.5">
                <p>
                  <span className="font-medium">3. Align:</span> drag the dashed board outline onto the board in the camera view. If it lies
                  askew, turn the program:
                </p>
                <RotationControl deg={deg} onTurn={turn} />
              </div>
              {!!current.board.request?.holdPoints && (
                <p>
                  <span className="font-medium">4. {holdKindName(current)}:</span> fit one on each blue mark in the camera view. Elsewhere
                  works better? Drag the mark there, or add or remove marks in the top view: the program follows.
                </p>
              )}
              <p>
                <span className="font-medium">
                  {current.board.request?.holdPoints ? 5 : 4}. {swap ? `${swapText}, then zero Z` : 'Zero Z'}
                </span>{' '}
                on the spoilboard: Z0 is the bottom of the board (Zero section below).
              </p>
            </>
          )}
          {current.kind === 'flip' && (
            <div className="flex flex-col gap-1.5">
              <p>
                <span className="font-medium">Turn board {board.name} over</span>, top to bottom (the front edge goes to the back):{' '}
                {current.flip?.registration === 'dowels'
                  ? `put the ⌀${current.flip.dowelDiameter} dowel pins into the holes side A drilled, and drop the board onto them.`
                  : current.flip?.registration === 'fence'
                    ? 'push it against the fence and the stop again, as for side A.'
                    : 'you’ll drag the dashed outline onto it in the camera view on the next step, with side B’s program loaded.'}
              </p>
              <p>
                <span className="font-medium">Refit the screws, clamps or tape</span> where side B needs them: they have to stay clear of
                side B’s cuts, which the checks don’t know about.
              </p>
              {onCamera && (
                <>
                  <p>If it lies at another angle now, turn side B’s program (dashed outline):</p>
                  <RotationControl deg={deg} onTurn={turn} />
                </>
              )}
              <p className="text-muted-foreground">
                {onCamera
                  ? 'Z stays: it’s measured from the spoilboard.'
                  : 'Don’t touch the XY zero: side B is mirrored to it. Z stays: it’s measured from the spoilboard.'}
              </p>
            </div>
          )}
          {current.kind === 'bit' && current.sideB && current.program === 0 && (
            <>
              <p>
                <span className="font-medium">Side B</span> with the ⌀{current.plan.programs[0].diameter} mm bit: the parts’ undersides, not
                cut through.
              </p>
              {onCamera && (
                <div className="flex flex-col gap-1.5">
                  <p>
                    <span className="font-medium">Align:</span> drag the dashed board outline onto the turned board in the camera view. If
                    it lies askew, turn the program:
                  </p>
                  <RotationControl deg={deg} onTurn={turn} />
                </div>
              )}
            </>
          )}
          {!current.firstOfBoard && swap && (
            <p>
              <span className="font-medium">{swapText}</span>, then zero Z again. Don’t move the board: XY stays.
            </p>
          )}
          {current.kind === 'free' && current.board.request.holdDown === 'fixture-tape' && (
            <p>
              <span className="font-medium">Cut the parts free:</span> the last layer on the tape, for all parts in one go, smallest first.
              No pauses: take the parts off the tape when it’s done.
            </p>
          )}
          {current.kind === 'free' && current.board.request.holdDown !== 'fixture-tape' && (
            <>
              <p>
                <span className="font-medium">Free the parts:</span> the program cuts one part’s bottom skin at a time, then lifts the bit,
                stops the spindle and pauses. Take out the part ringed green in the camera view, then press Resume: the spindle starts again
                before the next one. A router you switch by hand: switch it off at each pause, back on before Resume.
              </p>
              <p className="text-xs text-muted-foreground">Green ring: the part being freed, then taken out.</p>
            </>
          )}
          {current.kind === 'tabs' && (
            <>
              <p>
                {pauseEachTab ? (
                  <>
                    <span className="font-medium">Remove the tabs:</span> the program lifts the bit, stops the spindle and pauses before
                    each tab. Hold the part at the green ring in the camera view, away from the bit, then press Resume: the spindle starts
                    again. A router you switch by hand: switch it off at each pause, back on before Resume.
                  </>
                ) : (
                  <>
                    <span className="font-medium">Remove the tabs:</span> the program cuts all of a part’s tabs in a row, the last one
                    slower, then lifts the bit, stops the spindle and pauses. Take out the part, then press Resume: the spindle starts again
                    before the next one. A router you switch by hand: switch it off at each pause, back on before Resume.
                  </>
                )}
              </p>
              <label className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={pauseEachTab} onCheckedChange={v => setPauseEachTab(v === true)} aria-label="Pause after each tab" />
                Pause after each tab
              </label>
              <p className="text-xs text-muted-foreground">
                {pauseEachTab ? 'Orange: next tab · Green ring: hold the part here' : 'Orange: the part’s tabs being cut'}
              </p>
            </>
          )}
          {current.plan && current.kind !== 'flip' && <p className="text-muted-foreground">Then load and run it below. When it’s done:</p>}
          <div className="flex gap-2">
            {current.plan && current.kind !== 'flip' && (
              <Hint text="Puts this program in the machine view, ready to run.">
                <Button size="sm" variant="outline" disabled={!gcodeOf(current)} onClick={() => load(current)}>
                  Load {current.kind === 'tabs' ? 'tab removal' : current.kind === 'free' ? 'parts freeing' : 'program'}
                </Button>
              </Hint>
            )}
            <Hint text="Marks this one as cut and loads the next program in the queue.">
              {/* Only for what could be loaded: a program not there yet, or blocked, wasn't cut. */}
              <Button size="sm" disabled={!!current.blocked || !!stale?.has(current.board.board.id)} onClick={next}>
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
