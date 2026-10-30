import { getCncApi } from '@/lib/fluidnc/machine';
import { isCamncJobFile } from '@/lib/machine/jobs';
import { cn } from '@wbcnc/ui/lib/utils';
import { Pause, Play, Radio, SkipBack } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useDepthView } from '../depthViewStore';
import { ParsedToolpath } from '../gcodeParsing';
import { motionLineEnds, progressPointIndex } from '../jobProgress';
import { formatDuration, getJobTimeline, playheadAt } from './jobTimeline';

const kSpeeds = [1, 10, 50, 200];

/** Time of the next or previous mark (tool change or depth level), for stepping with Shift+arrow. */
function adjacentMark(marks: number[], t: number, direction: 1 | -1) {
  if (direction > 0) return marks.find(m => m > t + 1e-6);
  return [...marks].reverse().find(m => m < t - 1e-6);
}

/** Playback bar for the material removal simulation: play, scrub, speed, and the G-code line at the playhead. */
export function SimTimeline({ toolpath }: { toolpath: ParsedToolpath }) {
  'use no memo';
  const { times, total, marks } = getJobTimeline(toolpath);
  const simTime = useDepthView(s => s.simTime);
  const playing = useDepthView(s => s.simPlaying);
  const speed = useDepthView(s => s.simSpeed);
  const follow = useDepthView(s => s.simFollowJob);
  const { setSimTime, setSimPlaying, setSimSpeed, setSimFollowJob } = useDepthView.getState();
  const t = Math.min(simTime ?? total, total);
  const sourceLines = useMemo(() => toolpath.gcode.split('\n'), [toolpath]);
  const markTimes = useMemo(() => marks.map(m => m.time), [marks]);

  // Running camNC job: its progress can drive the playhead.
  const job = getCncApi().jobProgress.value;
  const jobActive = !!job && isCamncJobFile(job.file);
  const lineEnds = useMemo(() => motionLineEnds(toolpath.gcode), [toolpath]);
  const jobIndex = jobActive ? progressPointIndex(toolpath, lineEnds, job.percent) : null;
  useEffect(() => {
    if (follow && jobIndex !== null) setSimTime(times[Math.min(Math.max(jobIndex - 1, 0), times.length - 1)] ?? 0);
  }, [follow, jobIndex, times, setSimTime]);

  // Playback.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const state = useDepthView.getState();
      const next = Math.min((state.simTime ?? total) + ((now - last) / 1000) * state.simSpeed, total);
      last = now;
      state.setSimTime(next);
      if (next >= total) state.setSimPlaying(false);
      else frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, total]);

  // Keyboard: Space plays, arrows step one segment, Shift+arrows jump between marks, Home/End.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range'))) return;
      if (target?.tagName === 'TEXTAREA') return;
      const state = useDepthView.getState();
      const now = Math.min(state.simTime ?? total, total);
      let next: number | undefined;
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
        return;
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const direction = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) next = adjacentMark(markTimes, now, direction) ?? (direction > 0 ? total : 0);
        else {
          const { index, fraction } = playheadAt(times, now);
          const at = fraction >= 1 ? index : index - 1;
          next = times[Math.min(Math.max(at + direction, 0), times.length - 1)];
        }
      } else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = total;
      if (next === undefined) return;
      e.preventDefault();
      state.setSimPlaying(false);
      state.setSimFollowJob(false);
      state.setSimTime(next);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function togglePlay() {
    const state = useDepthView.getState();
    if (state.simPlaying) return state.setSimPlaying(false);
    if ((state.simTime ?? total) >= total) state.setSimTime(0);
    state.setSimFollowJob(false);
    state.setSimPlaying(true);
  }

  const { index } = playheadAt(times, t);
  const line = toolpath.lines[Math.min(index, toolpath.lines.length - 1)];
  const lineText = line ? sourceLines[line - 1]?.trim() : '';

  return (
    <div
      className="dark pointer-events-auto grid gap-1 rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-foreground shadow-xl shadow-black/30 backdrop-blur-md"
      role="region"
      aria-label="Job timeline">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-white/10"
          aria-label="Back to start"
          onClick={() => {
            setSimPlaying(false);
            setSimFollowJob(false);
            setSimTime(0);
          }}>
          <SkipBack className="size-4" />
        </button>
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded-md bg-white/90 text-slate-900 hover:bg-white"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={togglePlay}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <div className="relative min-w-0 flex-1">
          <input
            type="range"
            aria-label="Job time"
            className="block w-full accent-sky-400"
            min={0}
            max={total || 1}
            step="any"
            value={t}
            onChange={e => {
              setSimPlaying(false);
              setSimFollowJob(false);
              setSimTime(Number(e.target.value));
            }}
          />
          <div className="pointer-events-none relative mx-2 h-1.5" aria-hidden>
            {marks.map((mark, i) => (
              <span
                key={i}
                title={mark.label}
                className={cn('absolute top-0 h-1.5 w-px', mark.kind === 'tool' ? 'bg-amber-300' : 'bg-slate-400/70')}
                style={{ left: `${(mark.time / (total || 1)) * 100}%` }}
              />
            ))}
          </div>
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-slate-200">
          {formatDuration(t)} <span className="text-muted-foreground">/ ≈{formatDuration(total)}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={lineText}>
          {line ? `${line}: ${lineText}` : 'Start'}
        </span>
        <div className="flex items-center gap-1">
          {jobActive && (
            <button
              type="button"
              aria-pressed={follow}
              className={cn(
                'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
                follow ? 'bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/50' : 'text-muted-foreground hover:bg-white/10'
              )}
              onClick={() => setSimFollowJob(!follow)}>
              <Radio className="size-3" /> Follow job
            </button>
          )}
          <div className="flex gap-0.5" role="group" aria-label="Playback speed">
            {kSpeeds.map(s => (
              <button
                key={s}
                type="button"
                aria-pressed={speed === s}
                className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[10px]',
                  speed === s ? 'bg-white/15 text-foreground' : 'text-muted-foreground hover:bg-white/10'
                )}
                onClick={() => setSimSpeed(s)}>
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
