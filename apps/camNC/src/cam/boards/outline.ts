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

type Segment = number[][];

/** The segments of the bar the tab at this point is drawn with: those through the point and all that connect to them. */
export function tabBar(segments: Segment[], at: { x: number; y: number }): Segment[] {
  const near = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3;
  const through = ([a, b]: Segment) => {
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.min(1, Math.max(0, ((at.x - a[0]) * dx + (at.y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a[0] + t * dx - at.x, a[1] + t * dy - at.y) < 0.5;
  };
  const bar = segments.filter(through);
  for (let k = 0; k < bar.length; k++)
    for (const s of segments) if (!bar.includes(s) && s.some(p => bar[k].some(q => near(p, q)))) bar.push(s);
  return bar;
}

/** Board frame -> the body's own frame (as laid flat), the inverse of `place`. */
export const toPartFrame = (p: { x: number; y: number; rotated: boolean }, size: number[], q: { x: number; y: number }) =>
  p.rotated
    ? { x: +(q.y - p.y).toFixed(1), y: +(p.x + size[1] - q.x).toFixed(1) }
    : { x: +(q.x - p.x).toFixed(1), y: +(q.y - p.y).toFixed(1) };

/** A body's tabs as the program has them (one per spot, though each pass through lists it), board frame. */
export const tabSpots = (tabs: { at: { x: number; y: number } }[]) =>
  tabs.map(t => t.at).filter((q, k, list) => !list.slice(0, k).some(o => Math.hypot(o.x - q.x, o.y - q.y) < 1));
