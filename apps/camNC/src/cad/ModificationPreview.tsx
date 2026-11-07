import { entityPointIds, type CadSketch } from '@wbcnc/cad';
import { SketchGeometry } from './SketchGeometry';
import { SKETCH_APPEARANCE } from './sketchAppearance';

/** Draw only candidate geometry; references remain in the committed canvas underneath. */
export function ModificationPreview({
  sketch,
  curveIds,
  pixelScale,
}: {
  sketch: CadSketch;
  curveIds: readonly string[];
  pixelScale: number;
}) {
  const ids = new Set(curveIds),
    points = new Set(
      sketch.entities
        .filter(entity => ids.has(entity.id))
        .flatMap(entity => (entity.type === 'point' ? [entity.id] : entityPointIds(entity)))
    );
  const entities = sketch.entities.filter(entity => ids.has(entity.id) || (entity.type === 'point' && points.has(entity.id)));
  return (
    <g data-modification-preview="true" pointerEvents="none" aria-hidden="true">
      <SketchGeometry entities={entities} selectedIds={[]} stroke={SKETCH_APPEARANCE.previewColor} pixelScale={pixelScale} />
    </g>
  );
}
