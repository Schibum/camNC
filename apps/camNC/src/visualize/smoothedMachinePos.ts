import { getCncApi } from '@/lib/fluidnc/machine';
import type { MachineStatus, Position } from '@wbcnc/fluidnc';
import { useFrame } from '@react-three/fiber';
import { RefObject, useEffect, useRef } from 'react';
import { Object3D } from 'three';

export interface PositionSample {
  pos: Position;
  /** `performance.now()` when the report arrived. */
  at: number;
}

/** Report intervals outside this range are clamped: shorter would jitter, longer would lag too much. */
const kMinIntervalMs = 50;
const kMaxIntervalMs = 1000;
/** Jumps larger than this (mm) are shown at once instead of animated, e.g. after a reconnect. */
export const kSnapDistance = 50;

function distance(a: Position, b: Position) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Smoothed position at `now`, given the previous and the latest report. Plays the motion back one report interval
 * late, interpolating between the two, so it is continuous and never overshoots a stop or a corner.
 */
export function interpolatePosition(prev: PositionSample | null, last: PositionSample, now: number): Position {
  if (!prev || distance(prev.pos, last.pos) > kSnapDistance) return last.pos;
  const interval = Math.min(kMaxIntervalMs, Math.max(kMinIntervalMs, last.at - prev.at));
  const t = Math.min(1, Math.max(0, (now - last.at) / interval));
  return {
    x: prev.pos.x + (last.pos.x - prev.pos.x) * t,
    y: prev.pos.y + (last.pos.y - prev.pos.y) * t,
    z: prev.pos.z + (last.pos.z - prev.pos.z) * t,
  };
}

/** Keeps the last two machine positions; snaps (no animation) when the machine is idle or reports resume after a gap. */
export class PositionSmoother {
  prev: PositionSample | null = null;
  last: PositionSample | null = null;

  push(status: MachineStatus | null, at: number) {
    if (!status) {
      // Disconnected: start fresh on the next report.
      this.prev = this.last = null;
      return;
    }
    const sample = { pos: status.mpos, at };
    const idle = status.state === 'Idle' || status.state === 'Alarm';
    const stale = this.last !== null && at - this.last.at > kMaxIntervalMs * 2;
    if (this.last && this.last.pos.x === sample.pos.x && this.last.pos.y === sample.pos.y && this.last.pos.z === sample.pos.z) {
      // Unchanged (e.g. an idle poll): keep animating towards it from where we are.
      return;
    }
    this.prev = idle || stale ? null : this.last;
    this.last = sample;
  }

  at(now: number): Position | null {
    return this.last ? interpolatePosition(this.prev, this.last, now) : null;
  }
}

/**
 * Moves `ref`'s object to the smoothed machine position every frame, without re-rendering React.
 * `place` maps the machine position to the object's position in its parent (e.g. machine → work coordinates).
 */
export function useSmoothedMachinePos(ref: RefObject<Object3D | null>, place: (mpos: Position, target: Object3D) => void) {
  'use no memo';
  const smoother = useRef(new PositionSmoother());
  useEffect(() => {
    const api = getCncApi();
    return api.status.subscribe(status => smoother.current.push(status, performance.now()));
  }, []);
  useFrame(() => {
    const object = ref.current;
    const pos = smoother.current.at(performance.now());
    if (!object || !pos) return;
    place(pos, object);
  });
}
