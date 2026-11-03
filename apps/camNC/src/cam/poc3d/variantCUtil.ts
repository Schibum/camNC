/** THROWAWAY concept C helpers. */
import { Vector3 } from 'three';
import type { PocBoard } from './usePocBoard';

/** Consecutive ops with the same label, shown as one step. */
export interface OpGroup {
  label: string;
  kind: 'pocket' | 'profile';
  from: number;
  to: number;
  count: number;
  timeMin: number;
}

export function groupOps(board: PocBoard): OpGroup[] {
  const groups: OpGroup[] = [];
  for (const op of board.ops) {
    const last = groups[groups.length - 1];
    if (last && last.label === op.label) {
      last.to = op.to;
      last.count++;
      last.timeMin += op.timeMin;
    } else groups.push({ label: op.label, kind: op.kind, from: op.from, to: op.to, count: 1, timeMin: op.timeMin });
  }
  return groups;
}

/** Camera position looking at the board from the front, scaled to fit the board. */
export function viewFor(board: PocBoard, aspect: number, fov: number) {
  const [w, h, t] = board.size;
  const center = new Vector3(w / 2, h / 2, t / 2);
  const dir = new Vector3(0.35, -1, 1.25).normalize();
  const halfFov = (fov / 2) * (Math.PI / 180);
  // Rough fit of the board's width and height, ignores the perspective of the tilt.
  const fitH = Math.max(h * 0.62, t) / Math.tan(halfFov);
  const fitW = w / 2 / (Math.tan(halfFov) * aspect);
  const dist = Math.max(fitH, fitW) * 1.12;
  return { center, position: center.clone().addScaledVector(dir, dist), dist };
}
