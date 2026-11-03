import { useEffect, useMemo, useState } from 'react';
import type { PlanResult } from '../camTypes';
import { buildPlanModel, type PlanModel } from './planModel';

/**
 * What the 3D view, its timeline and the op list share for one program: the playhead, the selected op group and the
 * ops hidden in the toolpath view. Per program: a new one starts at the end (the finished board), nothing selected
 * or hidden.
 */
export interface PlanPlayback {
  model: PlanModel;
  time: number;
  setTime: (t: number) => void;
  /** Index into model.groups. */
  selected: number | null;
  select: (group: number | null) => void;
  hidden: ReadonlySet<number>;
  toggleHidden: (group: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: number;
  setSpeed: (s: number) => void;
}

/** The shared view state of `plan`'s program, or null while there is none. */
export function usePlanPlayback(plan: PlanResult | undefined): PlanPlayback | null {
  const model = useMemo(() => (plan ? buildPlanModel(plan) : null), [plan]);
  const fresh = (m: PlanModel | null) => ({ model: m, time: m?.total ?? 0, selected: null as number | null, hidden: new Set<number>() });
  const [ui, setUi] = useState(() => fresh(model));
  const current = ui.model === model ? ui : fresh(model);
  const update = (patch: Partial<typeof current>) => setUi({ ...current, ...patch });
  const [playingState, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(20);
  const playing = playingState && !!model;

  useEffect(() => {
    if (!playing || !model) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const dt = (now - last) / 1000;
      last = now;
      setUi(s => {
        if (s.model !== model) return s;
        const next = Math.min(s.time + dt * speed, model.total);
        if (next >= model.total) setPlaying(false);
        return { ...s, time: next };
      });
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, model]);

  if (!model) return null;
  const { time, selected, hidden } = current;
  return {
    model,
    time,
    setTime: t => update({ time: t }),
    selected,
    select: g => update({ selected: g }),
    hidden,
    toggleHidden: g => update({ hidden: new Set(hidden.has(g) ? [...hidden].filter(h => h !== g) : [...hidden, g]) }),
    playing,
    setPlaying,
    speed,
    setSpeed,
  };
}
