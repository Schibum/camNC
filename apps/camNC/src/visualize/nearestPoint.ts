import { Vector3 } from 'three';
import { ParsedToolpath } from './gcodeParsing';

function closestPointOnSegment(a: Vector3, b: Vector3, p: Vector3): Vector3 {
  // Compute the closest point ignoring the z-axis (operate in the XY-plane only)
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const abLenSq = abX * abX + abY * abY;

  if (abLenSq === 0) {
    return a.clone();
  }

  const t = ((p.x - a.x) * abX + (p.y - a.y) * abY) / abLenSq;
  const clamped = Math.max(0, Math.min(1, t));

  // Interpolate x & y; keep z interpolated along the original segment (does not affect distance)
  return new Vector3(a.x + abX * clamped, a.y + abY * clamped, a.z + (b.z - a.z) * clamped);
}

export function nearestPointOnToolpath(toolpath: ParsedToolpath, point: Vector3, offset: Vector3): Vector3 {
  const nearest = new Vector3();
  let minDist = Infinity;
  for (let i = 1; i < toolpath.pathPoints.length; i++) {
    const p0 = toolpath.pathPoints[i - 1].clone().add(offset);
    const p1 = toolpath.pathPoints[i].clone().add(offset);
    const c = closestPointOnSegment(p0, p1, point);
    // Distance in the XY-plane only (ignore z)
    const dx = c.x - point.x;
    const dy = c.y - point.y;
    const d = dx * dx + dy * dy;
    if (d < minDist) {
      minDist = d;
      nearest.copy(c);
    }
  }
  return nearest;
}
