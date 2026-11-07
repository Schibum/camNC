import type { CadPoint, CadSketch } from '@wbcnc/cad';
import type { CadDrawingInference } from './drawingInference';
import type { InlineConstraintKind } from './inlineConstraintLayout';
import { ConstraintSymbol } from './inlineConstraints';

export function DrawingInferencePreview({
  inference,
  orientation,
  axis,
  start,
  sketch,
  pixelScale,
}: {
  inference: CadDrawingInference;
  orientation?: 'horizontal' | 'vertical' | 'tangent' | null;
  axis?: 'horizontal' | 'vertical' | null;
  start?: CadPoint;
  sketch: CadSketch;
  pixelScale: number;
}) {
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const kinds: InlineConstraintKind[] = [];
  if (orientation) kinds.push(orientation);
  if (axis) kinds.push(axis);
  kinds.push(...inference.alignments.map(a => a.type));
  const snap = inference.snap;
  if (snap) {
    const curve = sketch.entities.find(e => e.id === snap.entityId);
    kinds.push(
      snap.kind === 'midpoint'
        ? 'midpoint'
        : snap.kind === 'pointOnCurve'
          ? curve?.type === 'line'
            ? 'pointOnLine'
            : 'pointOnCircle'
          : 'coincident'
    );
  }
  const guides = [...inference.guides];
  const direction = axis ?? (orientation === 'horizontal' || orientation === 'vertical' ? orientation : null);
  if (start && direction) guides.push({ axis: direction, from: start, to: inference.point, sourcePointId: '' });
  return (
    <g data-drawing-inference pointerEvents="none">
      {guides.map((guide, index) => (
        <g key={`${guide.axis}:${guide.sourcePointId}:${index}`}>
          <line
            data-inference-guide={guide.axis}
            x1={guide.from.x}
            y1={-guide.from.y}
            x2={guide.to.x}
            y2={-guide.to.y}
            stroke="#e5a121"
            strokeWidth={1.25}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          {guide.sourcePointId && (
            <g data-inference-source={guide.sourcePointId}>
              <circle
                cx={guide.from.x}
                cy={-guide.from.y}
                r={5.5 / scale}
                fill="#ffb849"
                fillOpacity={0.2}
                stroke="#ffb849"
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </g>
      ))}
      {[...new Set(kinds)].map((kind, index) => (
        <g
          key={kind}
          data-inferred-constraint={kind}
          aria-label={`Infer ${kind}`}
          transform={`translate(${inference.point.x + (18 + index * 22) / scale} ${-inference.point.y + 24 / scale}) scale(${1 / scale})`}
          stroke="#3d4043"
          strokeWidth={1.5}
          strokeLinecap="square"
          strokeLinejoin="round"
          fill="none"
          color="#3d4043">
          <rect x={-10} y={-10} width={20} height={20} fill="white" fillOpacity={0.9} stroke="none" />
          <ConstraintSymbol kind={kind} />
        </g>
      ))}
    </g>
  );
}
