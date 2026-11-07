import { tessellateCurve, type CadEntity, type CadNurbsEntity, type CadPoint } from '@wbcnc/cad';
import { useLayoutEffect, useState, type RefObject } from 'react';

type SketchPoint = Extract<CadEntity, { type: 'point' }>;
type SketchArc = Extract<CadEntity, { type: 'arc' }>;

/** Approximate reference styling, expressed in CSS pixels rather than sketch millimeters. */
export const SKETCH_APPEARANCE = {
  normalStroke: 1.5,
  selectedStroke: 2,
  previewStroke: 1.5,
  curveHitStroke: 12,
  pointRadius: 2.5,
  selectedPointRadius: 3,
  pointHitRadius: 8,
  hoverRadius: 5.5,
  constructionDash: '6 4',
  freeColor: '#0000ff',
  constrainedColor: '#000000',
  selectedColor: '#ff9b23',
  constructionColor: '#72909c',
  fixedPointColor: '#000000',
  previewColor: '#78b9cb',
} as const;

/** Read after viewBox commit: a render-time CTM still describes the previous camera. */
export function useSvgPixelScale(svgRef: RefObject<SVGSVGElement | null>, camera: unknown): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const next = Math.hypot(matrix.a, matrix.b);
      if (Number.isFinite(next) && next > 0) setScale(previous => (previous === next ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [svgRef, camera]);
  return scale;
}

export function sketchArcPath(entity: SketchArc, points: ReadonlyMap<string, SketchPoint>): string {
  const start = points.get(entity.startId),
    end = points.get(entity.endId);
  if (!start || !end) return '';
  const sweep = (((entity.endAngle - entity.startAngle) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return `M ${start.x} ${-start.y} A ${entity.radius} ${entity.radius} 0 ${sweep > Math.PI ? 1 : 0} 0 ${end.x} ${-end.y}`;
}

/** The source remains analytic; only the SVG display path is adaptively approximated. */
export function sketchCurvePath(entity: CadNurbsEntity, points: ReadonlyMap<string, CadPoint>, pixelScale = 1): string {
  try {
    return tessellateCurve(entity, points, 0.2 / Math.max(0.001, pixelScale))
      .map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${-p.y}`)
      .join(' ');
  } catch {
    return '';
  }
}
