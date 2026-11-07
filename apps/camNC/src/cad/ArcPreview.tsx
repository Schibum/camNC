import { buildArcPreview, arcPreviewPath, type ArcPreviewInput } from './arcPreviewGeometry';
import { SketchPreview } from './SketchGeometry';
import { SKETCH_APPEARANCE } from './sketchAppearance';

export function ArcPreview({
  pixelScale,
  construction,
  showInstruction = true,
  ...input
}: ArcPreviewInput & { pixelScale: number; construction?: boolean; showInstruction?: boolean }) {
  const preview = buildArcPreview(input);
  if (!preview) return null;
  const scale = Number.isFinite(pixelScale) && pixelScale > 0 ? pixelScale : 1;
  const { start, end, cursor, arc, phase, instruction } = preview;
  const marker = (point: typeof start, key: string) => (
    <circle
      key={key}
      data-arc-marker={key}
      cx={point.x}
      cy={-point.y}
      r={SKETCH_APPEARANCE.pointRadius / scale}
      fill={SKETCH_APPEARANCE.previewColor}
      stroke="none"
      vectorEffect="non-scaling-stroke"
    />
  );
  return (
    <g className="cad-arc-preview" data-arc-phase={phase} data-provisional={preview.provisional} pointerEvents="none">
      <line
        data-arc-guide="chord"
        x1={start.x}
        y1={-start.y}
        x2={end.x}
        y2={-end.y}
        stroke="#a4b4c2"
        strokeWidth={0.75}
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      />
      {arc && (
        <SketchPreview construction={construction}>
          <path data-arc-preview="curve" d={arcPreviewPath(arc)} />
        </SketchPreview>
      )}
      {marker(start, 'start')}
      {marker(end, 'end')}
      {arc && !preview.provisional && marker({ x: arc.cx, y: arc.cy }, 'center')}
      {showInstruction && (
        <text data-arc-instruction x={cursor.x + 12 / scale} y={-cursor.y - 12 / scale} fontSize={11 / scale} fill="#526577">
          {instruction}
        </text>
      )}
    </g>
  );
}
