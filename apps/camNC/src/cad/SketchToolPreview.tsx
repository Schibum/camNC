import { ArcPreview } from './ArcPreview';
import { SketchPreview } from './SketchGeometry';
import { SKETCH_APPEARANCE } from './sketchAppearance';
import { sketchPreviewFeedback, type SketchToolPreviewInput } from './sketchPreviewFeedback';

export type SketchToolPreviewProps = SketchToolPreviewInput;

/** One rendering boundary for primitive, arc and rational previews; no document/history mutations. */
export function SketchToolPreview(props: SketchToolPreviewProps) {
  const { tool, pending, cursor, curvePreview, tangent, pixelScale, construction } = props,
    start = pending[0];
  if (!start) return null;
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const feedback = sketchPreviewFeedback(props);
  return (
    <g data-sketch-tool-preview={tool} pointerEvents="none">
      {curvePreview ? (
        <SketchPreview construction={construction}>
          <g>
            <polyline data-curve-preview={tool} points={curvePreview.map(point => `${point.x},${-point.y}`).join(' ')} />
            {(tool === 'bezier' || tool === 'conic') && (
              <polyline
                data-control-preview={tool}
                points={(tool === 'conic' && pending[1] ? [start, cursor, pending[1]] : [...pending, cursor])
                  .map(point => `${point.x},${-point.y}`)
                  .join(' ')}
                strokeDasharray="3 4"
                opacity=".55"
              />
            )}
          </g>
        </SketchPreview>
      ) : tool === 'arc' || tool === 'tangentArc' ? (
        <ArcPreview
          mode={tool === 'arc' ? 'threePoint' : 'tangent'}
          pending={pending}
          cursor={cursor}
          tangent={tangent}
          pixelScale={scale}
          construction={construction}
          showInstruction={false}
        />
      ) : (
        <SketchPreview construction={construction}>
          {tool === 'rectangle' || tool === 'centerRectangle' ? (
            <rect
              x={tool === 'centerRectangle' ? start.x - Math.abs(cursor.x - start.x) : Math.min(start.x, cursor.x)}
              y={tool === 'centerRectangle' ? -start.y - Math.abs(cursor.y - start.y) : -Math.max(start.y, cursor.y)}
              width={Math.abs(cursor.x - start.x) * (tool === 'centerRectangle' ? 2 : 1)}
              height={Math.abs(cursor.y - start.y) * (tool === 'centerRectangle' ? 2 : 1)}
            />
          ) : tool === 'circle' ? (
            <circle cx={start.x} cy={-start.y} r={Math.hypot(cursor.x - start.x, cursor.y - start.y)} />
          ) : (
            <line x1={start.x} y1={-start.y} x2={cursor.x} y2={-cursor.y} />
          )}
        </SketchPreview>
      )}
      {feedback.markers.map((point, index) => (
        <circle
          key={index}
          data-preview-point={index}
          cx={point.x}
          cy={-point.y}
          r={SKETCH_APPEARANCE.pointRadius / scale}
          fill={tool === 'spline' ? SKETCH_APPEARANCE.freeColor : SKETCH_APPEARANCE.previewColor}
          stroke="none"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {feedback.values.map(value => (
        <text
          key={value.kind}
          data-preview-measurement={value.kind}
          x={value.at.x}
          y={-value.at.y}
          dominantBaseline="middle"
          textAnchor="middle"
          fontSize={13 / scale}
          fontWeight={500}
          fill={SKETCH_APPEARANCE.previewColor}
          stroke="none">
          {value.text}
        </text>
      ))}
    </g>
  );
}
