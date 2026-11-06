import { bounds2, clipLines, difference, offset, pathLength, polyArea, type PathD, type PathsD, type Vec3 } from './geom';
import type { MotionRole } from './motion';

/** Cutter-centre region; outside profiles use a bounded portion of the waste surrounding the part. */
export function profileEntryRegion(shape: PathD, toolRadius: number, leadRadius: number, inside: boolean): PathsD {
  const positive = polyArea([shape]) > 0 ? shape : [...shape].reverse();
  if (inside) return offset([positive], -toolRadius);
  const { minX, minY, maxX, maxY } = bounds2([shape]);
  const pad = toolRadius + 3 * leadRadius + 1;
  return difference(
    [
      [
        { x: minX - pad, y: minY - pad },
        { x: maxX + pad, y: minY - pad },
        { x: maxX + pad, y: maxY + pad },
        { x: minX - pad, y: maxY + pad },
      ],
    ],
    offset([positive], toolRadius)
  );
}

function containsPoint(p: { x: number; y: number }, region: PathsD): boolean {
  let crossings = 0;
  for (const loop of region)
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i],
        b = loop[(i + 1) % loop.length];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
      if (Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) < 1e-7) return true;
      if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * dx) / dy) crossings++;
    }
  return crossings % 2 === 1;
}

/** Prove containment of the whole polyline, rather than only sampling its vertices. */
export function lineInsideRegion(line: PathD, region: PathsD): boolean {
  const length = pathLength(line, false);
  if (length < 1e-8) return line.every(p => containsPoint(p, region));
  const clipped = clipLines([line], offset(region, 0.0001));
  const kept = clipped.reduce((sum, path) => sum + pathLength(path, false), 0);
  return kept >= length - 0.0002;
}

/** Tangent quarter-circle leads, wholly in a supplied cutter-centre region. No claim of already cleared stock. */
export function tangentLoopPass(loop: PathD, z: number, feed: number, radius: number, free: PathsD, from = loop[0]) {
  if (loop.length < 3 || !free.length || !Number.isFinite(radius) || radius <= 0) return undefined;
  const edges = loop
    .map((a, i) => ({ a, b: loop[(i + 1) % loop.length], i }))
    .map(edge => ({ ...edge, len: Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y) }))
    .filter(edge => edge.len > 1e-5);
  edges.sort(
    (a, b) =>
      b.len - a.len ||
      Math.hypot((a.a.x + a.b.x) / 2 - from.x, (a.a.y + a.b.y) / 2 - from.y) -
        Math.hypot((b.a.x + b.b.x) / 2 - from.x, (b.a.y + b.b.y) / 2 - from.y)
  );
  for (const edge of edges) {
    const p = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
    const t = { x: (edge.b.x - edge.a.x) / edge.len, y: (edge.b.y - edge.a.y) / edge.len };
    for (const side of [1, -1]) {
      const normal = { x: -t.y * side, y: t.x * side };
      if (!containsPoint({ x: p.x + normal.x * 0.01, y: p.y + normal.y * 0.01 }, free)) continue;
      for (const rho of [radius, radius / 2, radius / 4, radius / 8]) {
        const center = { x: p.x + normal.x * rho, y: p.y + normal.y * rho };
        const steps = Math.max(6, Math.ceil(Math.PI / 2 / (2 * Math.acos(Math.max(-1, 1 - Math.min(0.005, rho) / rho)))));
        const arc = (k: number) => {
          const angle = (side * k * Math.PI) / (2 * steps),
            vx = -t.x,
            vy = -t.y;
          return {
            x: center.x + rho * (vx * Math.cos(angle) - vy * Math.sin(angle)),
            y: center.y + rho * (vx * Math.sin(angle) + vy * Math.cos(angle)),
          };
        };
        const entry = Array.from({ length: steps + 1 }, (_, k) => arc(k));
        const exit = Array.from({ length: steps + 1 }, (_, k) => arc(steps + k));
        if (!lineInsideRegion(entry, free) || !lineInsideRegion(exit, free)) continue;
        const lap = [p, ...loop.slice(edge.i + 1), ...loop.slice(0, edge.i + 1), p];
        const points = [...entry.slice(0, -1), ...lap, ...exit.slice(1)];
        const roles: MotionRole[] = points.map((_, i) =>
          i === 0 ? 'approach' : i < entry.length ? 'lead-in' : i < entry.length - 1 + lap.length ? 'cut' : 'lead-out'
        );
        const pts: Vec3[] = points.map(q => [q.x, q.y, z]);
        return { pts, feeds: pts.map(() => feed), roles, link: 'retract' as const };
      }
    }
  }
  return undefined;
}
