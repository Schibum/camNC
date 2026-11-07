import type { CadPoint } from '@wbcnc/cad';
import { tangentArcFrom, threePointArc } from './geometry';

export interface ArcPreviewInput {
  mode: 'threePoint' | 'tangent';
  pending: readonly CadPoint[];
  cursor: CadPoint;
  tangent?: CadPoint;
}

function provisionalArc(start: CadPoint, end: CadPoint, tangent?: CadPoint) {
  const fromTangent = tangent && tangentArcFrom(start, tangent, end);
  if (fromTangent) return fromTangent;
  const dx = end.x - start.x,
    dy = end.y - start.y;
  if (Math.hypot(dx, dy) < 1e-7) return null;
  // Native endpoint-stage feedback is a shallow curved suggestion, not an assumed radius or tangent.
  return threePointArc(start, end, { x: (start.x + end.x) / 2 - dy * 0.1, y: (start.y + end.y) / 2 + dx * 0.1 });
}

export function buildArcPreview({ mode, pending, cursor, tangent }: ArcPreviewInput) {
  const start = pending[0];
  if (!start) return null;
  const end = mode === 'threePoint' ? (pending[1] ?? cursor) : cursor;
  const phase = mode === 'tangent' ? 'tangent' : pending[1] ? 'through' : 'end';
  const actualArc =
    mode === 'tangent' ? tangent && tangentArcFrom(start, tangent, cursor) : pending[1] ? threePointArc(start, pending[1], cursor) : null;
  const arc = actualArc || (mode === 'threePoint' ? provisionalArc(start, end, tangent) : null);
  const instruction =
    phase === 'end'
      ? 'Click arc end'
      : actualArc
        ? phase === 'tangent'
          ? 'Click tangent arc end'
          : 'Click point on arc'
        : phase === 'tangent'
          ? 'Move away from tangent line'
          : 'Move off chord to shape arc';
  return { phase, start, end, cursor, arc, provisional: !actualArc, instruction };
}

export function arcPreviewPath(arc: NonNullable<ReturnType<typeof threePointArc>>): string {
  const tau = Math.PI * 2;
  const sweep = (((arc.endAngle - arc.startAngle) % tau) + tau) % tau;
  return `M ${arc.cx + arc.radius * Math.cos(arc.startAngle)} ${-(arc.cy + arc.radius * Math.sin(arc.startAngle))} A ${arc.radius} ${arc.radius} 0 ${sweep > Math.PI ? 1 : 0} 0 ${arc.cx + arc.radius * Math.cos(arc.endAngle)} ${-(arc.cy + arc.radius * Math.sin(arc.endAngle))}`;
}
