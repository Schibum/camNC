import type { Outline2D } from '../camTypes';

/** Part frame -> board frame, as in @wbcnc/cam partToBoard. */
export const place = (p: { x: number; y: number; rotated: boolean }, size: number[]) => (q: [number, number]) =>
  p.rotated ? [p.x + size[1] - q[1], p.y + q[0]] : [p.x + q[0], p.y + q[1]];

/** SVG path data of closed outlines, mapped through `f`. */
export const toD = (paths: Outline2D, f: (q: [number, number]) => number[]) =>
  paths
    .map(
      path =>
        `M${path
          .map(q =>
            f(q)
              .map(v => v.toFixed(1))
              .join(',')
          )
          .join('L')}Z`
    )
    .join('');
