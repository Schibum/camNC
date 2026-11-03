import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { Check, RotateCcw, RotateCw, X } from 'lucide-react';
import { useEffect } from 'react';
import { loadIntoMachineView } from '../showOnMachine';
import { stockTopOf } from '../boards';
import { entryTitle, useCamMachine, type QueueEntry } from './camMachine';
import { useMachineQueue } from './useMachineQueue';

const fmt = (v: number) => `${+v.toFixed(2)}`;

/**
 * The CAM job at the machine, in the machine panel: the queue of programs (boards in an order that keeps the bit in
 * the collet, one program per bit, guided tab removal), and for the current one what to do before running it.
 */
export function CamQueueCard() {
  const { jobId, active, setActive, markDone, setRotation, rotation, leave, setOverlay } = useCamMachine();
  const { job, queue, current, done, tabRemoval, loading } = useMachineQueue();
  const gcodeOf = (e: QueueEntry) => (e.kind === 'tabs' ? tabRemoval?.gcode : e.plan.programs[e.program].gcode);
  const load = (e: QueueEntry) => {
    setActive(e.key);
    const gcode = gcodeOf(e);
    if (!gcode) return;
    const bit = e.kind === 'tabs' ? e.plan.bits.at(-1)! : e.plan.programs[e.program].diameter;
    loadIntoMachineView({ gcode, size: e.plan.size, bits: [bit] }, `${job?.name} ${entryTitle(e)}.gcode`);
    setOverlay({
      w: e.plan.size[0],
      h: e.plan.size[1],
      rotationDeg: rotation[e.board.board.id] ?? 0,
      tabs: e.kind === 'tabs' ? tabRemoval?.tabs : undefined,
    });
  };
  // Turning the board (or the tab program arriving) makes a new program: reload the one that's loaded.
  const loadedGcode = current && current.key === active ? gcodeOf(current) : undefined;
  useEffect(() => {
    if (current && loadedGcode) load(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedGcode]);
  if (!jobId) return null;
  const next = () => {
    if (!current) return;
    markDone(current.key);
    const after = queue[queue.indexOf(current) + 1];
    if (after) load(after);
    else setActive(null);
  };
  const board = current?.board.board;
  const deg = board ? (rotation[board.id] ?? 0) : 0;
  const turn = (d: number) => board && setRotation(board.id, Math.round((deg + d) * 10) / 10);

  return (
    <section aria-label="CAM job" className="flex flex-col gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">CAM job{job ? `: ${job.name}` : ''}</h3>
        <span className="grow" />
        <Button size="icon" variant="ghost" className="size-6" aria-label="Leave the CAM job" onClick={leave}>
          <X className="size-3.5" />
        </Button>
      </div>
      {loading && !queue.length && <p className="text-xs text-muted-foreground">Making the programs…</p>}
      <ol className="flex flex-col gap-1 text-[13px]" aria-label="Board queue">
        {queue.map(e => {
          const isDone = done.includes(e.key);
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
                <span className="w-4">{isDone ? <Check className="size-3.5 text-emerald-600" /> : isNow ? '●' : ''}</span>
                <span className="grow">{entryTitle(e)}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {e.kind === 'tabs'
                    ? `${tabRemoval && isNow ? tabRemoval.tabs.length : '…'} tabs`
                    : `${Math.ceil(e.plan.programs[e.program].timeMin)} min`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {current && board && (
        <div className="flex flex-col gap-2 border-t pt-3 text-[13px]">
          {current.firstOfBoard && (
            <>
              <p>
                <span className="font-medium">1. Place board {board.name}</span> ({fmt(current.plan.size[0])} × {fmt(current.plan.size[1])}{' '}
                mm, {fmt(stockTopOf(board))} mm thick) on the bed.
              </p>
              <div className="flex flex-col gap-1.5">
                <p>
                  <span className="font-medium">2. Align:</span> drag the dashed board outline onto the board in the camera view. If it lies
                  askew, turn the program:
                </p>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" aria-label="Turn 0.5° clockwise" onClick={() => turn(-0.5)}>
                    <RotateCw />
                  </Button>
                  <span className="w-16 text-center font-mono" aria-label="Rotation">
                    {deg.toFixed(1)}°
                  </span>
                  <Button size="sm" variant="outline" aria-label="Turn 0.5° counterclockwise" onClick={() => turn(0.5)}>
                    <RotateCcw />
                  </Button>
                  <span className="text-xs text-muted-foreground">about the XY zero (lower left)</span>
                </div>
              </div>
              <p>
                <span className="font-medium">3. Zero Z</span> on the spoilboard: Z0 is the bottom of the board (Zero section below).
              </p>
            </>
          )}
          {current.kind === 'bit' && !current.firstOfBoard && (
            <p>
              <span className="font-medium">Swap the bit</span> to ⌀{current.plan.programs[current.program].diameter} mm, then zero Z again.
              Don’t move the board: XY stays.
            </p>
          )}
          {current.kind === 'tabs' && (
            <p>
              <span className="font-medium">Remove the tabs:</span> the program stops before each tab. Hold the part at the green mark in
              the camera view, away from the bit, then press Resume.
            </p>
          )}
          <p className="text-muted-foreground">Then load and run it below. When it’s done:</p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => load(current)}>
              Load {current.kind === 'tabs' ? 'tab removal' : 'program'}
            </Button>
            <Button size="sm" onClick={next}>
              Done, next
            </Button>
          </div>
        </div>
      )}
      {!current && queue.length > 0 && <p className="text-[13px]">All boards are cut.</p>}
    </section>
  );
}
