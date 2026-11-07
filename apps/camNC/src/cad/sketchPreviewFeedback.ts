import type { CadPoint } from '@wbcnc/cad';
import { buildArcPreview } from './arcPreviewGeometry';
import type { SketchTool } from './sketchTools';
import { formatCadValue } from './valueExpressions';

export interface SketchToolPreviewInput {
  tool: SketchTool;
  pending: readonly CadPoint[];
  cursor: CadPoint;
  curvePreview?: readonly CadPoint[] | null;
  tangent?: CadPoint;
  pixelScale: number;
  construction?: boolean;
}

interface PreviewValue {
  kind: string;
  text: string;
  at: CadPoint;
}

/** Native measurements use source millimetres; annotation offsets and markers use CSS pixels. */
export function sketchPreviewFeedback({ tool, pending, cursor, tangent, pixelScale }: SketchToolPreviewInput) {
  const start = pending[0],
    scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const values: PreviewValue[] = [],
    markers: CadPoint[] = [];
  if (!start) return { values, markers };
  if (tool === 'line') {
    markers.push(start, cursor);
    const dx = cursor.x - start.x,
      dy = cursor.y - start.y,
      length = Math.hypot(dx, dy),
      sign = dx < 0 || (dx === 0 && dy > 0) ? -1 : 1;
    if (length > 1e-7)
      values.push({
        kind: 'length',
        text: formatCadValue(length),
        at: {
          x: (start.x + cursor.x) / 2 - (sign * dy * 20) / scale / length,
          y: (start.y + cursor.y) / 2 + (sign * dx * 20) / scale / length,
        },
      });
  } else if (tool === 'rectangle' || tool === 'centerRectangle') {
    const left = tool === 'centerRectangle' ? start.x - Math.abs(cursor.x - start.x) : Math.min(start.x, cursor.x);
    const right = tool === 'centerRectangle' ? start.x + Math.abs(cursor.x - start.x) : Math.max(start.x, cursor.x);
    const bottom = tool === 'centerRectangle' ? start.y - Math.abs(cursor.y - start.y) : Math.min(start.y, cursor.y);
    const top = tool === 'centerRectangle' ? start.y + Math.abs(cursor.y - start.y) : Math.max(start.y, cursor.y);
    markers.push({ x: left, y: bottom }, { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom });
    if (tool === 'centerRectangle') markers.push(start);
    if (right - left > 1e-7 || top - bottom > 1e-7) {
      values.push({ kind: 'width', text: formatCadValue(right - left), at: { x: (left + right) / 2, y: top + 16 / scale } });
      const text = formatCadValue(top - bottom);
      values.push({ kind: 'height', text, at: { x: left - (text.length * 3.5 + 12) / scale, y: (top + bottom) / 2 } });
    }
  } else if (tool === 'circle') {
    markers.push(start);
    const radius = Math.hypot(cursor.x - start.x, cursor.y - start.y),
      dx = cursor.x - start.x,
      dy = cursor.y - start.y;
    const text = `⌀${formatCadValue(radius * 2)}`;
    const offset = radius + (text.length * 3.5 + 14) / scale;
    if (radius > 1e-7)
      values.push({ kind: 'diameter', text, at: { x: start.x - (dx / radius) * offset, y: start.y - (dy / radius) * offset } });
  } else if (tool === 'arc' || tool === 'tangentArc') {
    const preview = buildArcPreview({ mode: tool === 'arc' ? 'threePoint' : 'tangent', pending, cursor, tangent });
    // A suggested endpoint-stage curve is not a chosen radius.
    if (preview?.arc && !preview.provisional) {
      const { cx, cy, radius } = preview.arc;
      values.push({ kind: 'radius', text: `R${formatCadValue(radius)}`, at: { x: cx, y: cy + 20 / scale } });
    }
  } else if (tool === 'spline' || tool === 'bezier' || tool === 'conic') {
    markers.push(...pending);
    if (!pending.some(point => Math.hypot(point.x - cursor.x, point.y - cursor.y) < 1e-8)) markers.push(cursor);
  }
  return { values, markers };
}
