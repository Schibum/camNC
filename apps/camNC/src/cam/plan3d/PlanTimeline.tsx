import { Button } from '@wbcnc/ui/components/button';
import { cn } from '@wbcnc/ui/lib/utils';
import { Pause, Play } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { formatDuration } from '@/visualize/stockSim/jobTimeline';
import { Hint } from '../Hint';
import { timelineLayout, timeToX, xToTime, type PlanModel } from './planModel';

const kSpeeds = [5, 20, 60, 200];

/**
 * Play, scrub and speed for the simulation. One band per op in its color; the playhead is a thin line across the
 * bands with a handle. Clicking a band selects its op, dragging anywhere scrubs.
 */
export function PlanTimeline({
  model,
  time,
  onTime,
  playing,
  onPlaying,
  speed,
  onSpeed,
  selected,
  onSelect,
}: {
  model: PlanModel;
  time: number;
  onTime: (t: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  speed: number;
  onSpeed: (s: number) => void;
  /** Selected group. */
  selected: number | null;
  onSelect: (group: number) => void;
}) {
  const { bands, knots } = useMemo(() => timelineLayout(model.ops, model.total), [model]);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; moved: boolean; group?: string } | null>(null);
  const at = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return xToTime(knots, Math.min(Math.max((clientX - r.left) / Math.max(r.width, 1), 0), 1));
  };
  const x = timeToX(knots, time);
  const step = model.total / 200;

  return (
    <div className="flex items-center gap-3 border-t border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950">
      <Hint text={playing ? 'Pause the simulated cut.' : 'Play the cut in the view, at the speed on the right.'}>
        <Button
          size="icon"
          variant="outline"
          className="size-8 shrink-0"
          onClick={() => onPlaying(!playing)}
          aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
      </Hint>
      <div
        ref={track}
        className="relative h-7 min-w-0 flex-1 cursor-pointer touch-none select-none"
        onPointerDown={e => {
          e.currentTarget.setPointerCapture(e.pointerId);
          // A click on a band selects its op; anywhere else the playhead goes there.
          const group = (e.target as HTMLElement).dataset.group;
          drag.current = { x: e.clientX, moved: false, group };
          if (group === undefined) onTime(at(e.clientX));
        }}
        onPointerMove={e => {
          if (!drag.current) return;
          if (Math.abs(e.clientX - drag.current.x) > 3) drag.current.moved = true;
          if (drag.current.moved) onTime(at(e.clientX));
        }}
        onPointerUp={() => {
          const group = drag.current?.moved ? undefined : drag.current?.group;
          if (group !== undefined) onSelect(Number(group));
          drag.current = null;
        }}>
        <div className="absolute inset-x-0 top-1.5 h-4 rounded-sm bg-zinc-200 dark:bg-zinc-800" />
        {model.ops.map((op, i) => (
          <div
            key={op.index}
            data-group={op.group}
            title={`${model.groups[op.group].label} · ${formatDuration(op.end - op.start)}`}
            className={cn(
              'absolute top-1.5 h-4 border-x border-white/70 dark:border-zinc-950/70',
              selected !== null && selected !== op.group && 'opacity-25'
            )}
            style={{ left: `${bands[i].left * 100}%`, width: `${bands[i].width * 100}%`, background: model.groups[op.group].color }}
          />
        ))}
        {model.pauses.map((p, i) => (
          <div
            key={i}
            role="img"
            aria-label={`Pause: ${p.label}`}
            title={`Pause: ${p.label}`}
            data-pause
            className="pointer-events-none absolute top-0.5 h-6 w-0.5 -translate-x-1/2 rounded-full bg-amber-500"
            style={{ left: `${timeToX(knots, p.time) * 100}%` }}
          />
        ))}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={Math.round(model.total)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={formatDuration(time)}
          onKeyDown={e => {
            const d = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
            if (d !== undefined) onTime(Math.min(Math.max(time + d, 0), model.total));
            else if (e.key === 'Home') onTime(0);
            else if (e.key === 'End') onTime(model.total);
            else return;
            e.preventDefault();
          }}
          className="pointer-events-none absolute inset-y-0 w-0 outline-none [&:focus-visible>span]:ring-2 [&:focus-visible>span]:ring-zinc-400"
          style={{ left: `${x * 100}%` }}>
          <span className="absolute inset-y-0.5 -left-px w-0.5 rounded-full bg-zinc-900 shadow-[0_0_0_1px_rgba(255,255,255,0.8)] dark:bg-white dark:shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" />
          <span className="absolute -top-0.5 -left-1.5 size-3 rounded-full border-2 border-white bg-zinc-900 shadow dark:border-zinc-950 dark:bg-white" />
        </div>
      </div>
      <div className="w-24 shrink-0 text-right text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
        {formatDuration(time)} / {formatDuration(model.total)}
      </div>
      <Hint text="Simulation speed: 20× plays 20 seconds of cutting each second.">
        <select
          className="h-8 rounded-md border border-zinc-200 bg-white px-1 text-xs dark:border-zinc-800 dark:bg-zinc-950"
          value={speed}
          onChange={e => onSpeed(Number(e.target.value))}
          aria-label="Speed">
          {kSpeeds.map(s => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </Hint>
    </div>
  );
}
