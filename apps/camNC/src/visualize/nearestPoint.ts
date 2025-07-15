import { Vector3 } from 'three';
import { ParsedToolpath } from './gcodeParsing';

function closestPointOnSegment(a: Vector3, b: Vector3, p: Vector3): Vector3 {
  const ab = new Vector3().subVectors(b, a);
  const t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / ab.lengthSq();
  const clamped = Math.max(0, Math.min(1, t));
  return new Vector3(a.x + ab.x * clamped, a.y + ab.y * clamped, a.z + ab.z * clamped);
}

export function nearestPointOnToolpath(toolpath: ParsedToolpath, point: Vector3, offset: Vector3): Vector3 {
  const nearest = new Vector3();
  let minDist = Infinity;
  for (let i = 1; i < toolpath.pathPoints.length; i++) {
    const p0 = toolpath.pathPoints[i - 1].clone().add(offset);
    const p1 = toolpath.pathPoints[i].clone().add(offset);
    const c = closestPointOnSegment(p0, p1, point);
    const d = c.distanceToSquared(point);
    if (d < minDist) {
      minDist = d;
      nearest.copy(c);
    }
  }
  return nearest;
}
