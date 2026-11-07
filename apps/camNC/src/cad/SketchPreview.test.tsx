import { cleanup, render } from '@testing-library/react';
import { addBezier, addConic, addSpline, createCadPart, tessellateCurve } from '@wbcnc/cad';
import { afterEach, describe, expect, it } from 'vitest';
import { ArcPreview } from './ArcPreview';
import { SketchGeometry, SketchPreview } from './SketchGeometry';
import { SKETCH_APPEARANCE } from './sketchAppearance';

afterEach(cleanup);

const tools = ['line', 'rectangle', 'centerRectangle', 'circle', 'arc', 'tangentArc', 'conic', 'spline', 'bezier'] as const;
type Tool = (typeof tools)[number];
const drawableSelector = 'line,rect,circle,ellipse,path,polyline,polygon';

/** Matches the Editor's direct shapes, ArcPreview, and nested curve/control polylines. */
function preview(tool: Tool, scale: number, construction = false) {
  if (tool === 'arc' || tool === 'tangentArc')
    return (
      <ArcPreview
        mode={tool === 'arc' ? 'threePoint' : 'tangent'}
        pending={
          tool === 'arc'
            ? [
                { x: 10, y: 10 },
                { x: 90, y: 10 },
              ]
            : [{ x: 10, y: 10 }]
        }
        cursor={tool === 'arc' ? { x: 50, y: 40 } : { x: 70, y: 60 }}
        tangent={{ x: 1, y: 0 }}
        pixelScale={scale}
        construction={construction}
        showInstruction={false}
      />
    );
  return (
    <SketchPreview construction={construction}>
      {tool === 'line' ? (
        <line x1="10" y1="-10" x2="90" y2="-20" />
      ) : tool === 'rectangle' || tool === 'centerRectangle' ? (
        <rect x="10" y="-60" width="80" height="50" />
      ) : tool === 'circle' ? (
        <circle cx="50" cy="-40" r="25" />
      ) : (
        <g>
          <g>
            <polyline data-curve-preview={tool} points="10,-10 40,-60 70,-40 100,-10" />
            {(tool === 'conic' || tool === 'bezier') && (
              <>
                <polyline data-control-preview={tool} points="10,-10 50,-70 100,-10" strokeDasharray="3 4" opacity=".55" />
              </>
            )}
          </g>
        </g>
      )}
    </SketchPreview>
  );
}

async function rasterAlpha(shape: SVGElement, viewBox: string): Promise<number> {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '560');
  svg.setAttribute('height', '400');
  svg.setAttribute('viewBox', viewBox);
  svg.appendChild(shape.cloneNode(true));
  const bitmap = new Image();
  bitmap.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  await bitmap.decode();
  const canvas = document.createElement('canvas');
  canvas.width = 560;
  canvas.height = 400;
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const pixels = context.getImageData(0, 0, 560, 400).data;
  let sum = 0;
  for (let index = 3; index < pixels.length; index += 4) sum += pixels[index]! / 255;
  return sum;
}

describe('all drawing tool preview strokes in Chromium', () => {
  it.each(tools)('keeps every %s preview drawable non-scaling at two camera zooms', tool => {
    const { container, rerender } = render(<svg />);
    for (const scale of [2, 8]) {
      for (const construction of [false, true]) {
        rerender(
          <svg width="400" height="400" viewBox={`0 -${400 / scale} ${400 / scale} ${400 / scale}`}>
            {preview(tool, scale, construction)}
          </svg>
        );
        const allShapes = [...container.querySelectorAll<SVGElement>(drawableSelector)];
        expect(allShapes.length).toBeGreaterThan(0);
        for (const shape of allShapes) expect(getComputedStyle(shape).vectorEffect).toBe('non-scaling-stroke');
        const drawingShapes = [
          ...container.querySelectorAll<SVGElement>(
            '.cad-preview line,.cad-preview rect,.cad-preview circle,.cad-preview path,.cad-preview polyline'
          ),
        ];
        expect(drawingShapes.length).toBeGreaterThan(0);
        for (const shape of drawingShapes) {
          const styles = getComputedStyle(shape);
          expect(styles.strokeWidth).toBe('1.5px');
          expect(styles.stroke).toBe('rgb(120, 185, 203)');
          expect(styles.fill).toBe('none');
          if (shape.hasAttribute('data-control-preview')) {
            expect(styles.strokeDasharray).toBe('3px, 4px');
            expect(styles.opacity).toBe('0.55');
          } else expect(styles.strokeDasharray).toBe(construction ? '6px, 4px' : 'none');
        }
      }
    }
  });

  it.each(['conic', 'spline', 'bezier'] as const)(
    'rasterizes the nested %s preview at the committed curve weight at both zooms',
    async tool => {
      const sketch =
        tool === 'conic'
          ? addConic(createCadPart().sketch, { start: { x: 10, y: 10 }, end: { x: 120, y: 10 }, control: { x: 65, y: 80 }, rho: 0.6 })
          : tool === 'spline'
            ? addSpline(createCadPart().sketch, {
                points: [
                  { x: 10, y: 10 },
                  { x: 35, y: 65 },
                  { x: 85, y: 55 },
                  { x: 120, y: 10 },
                ],
              })
            : addBezier(createCadPart().sketch, {
                points: [
                  { x: 10, y: 10 },
                  { x: 30, y: 75 },
                  { x: 90, y: 65 },
                  { x: 120, y: 10 },
                ],
              });
      const curve = sketch.entities.at(-1)!;
      if (curve.type === 'point') throw new Error('Expected a curve');
      const points = new Map(sketch.entities.filter(entity => entity.type === 'point').map(point => [point.id, point]));
      const { container, rerender } = render(<svg />);
      for (const extent of [140, 280]) {
        const scale = 560 / extent,
          viewBox = `0 -${(extent * 5) / 7} ${extent} ${(extent * 5) / 7}`;
        const locations = tessellateCurve(curve, points, 0.2 / scale);
        rerender(
          <svg width="560" height="400" viewBox={viewBox}>
            <SketchGeometry entities={sketch.entities} selectedIds={[]} pixelScale={scale} />
            <SketchPreview>
              <g>
                <polyline data-curve-preview={tool} points={locations.map(p => `${p.x},${-p.y}`).join(' ')} />
              </g>
            </SketchPreview>
          </svg>
        );
        const committed = container.querySelector<SVGElement>(`g.cad-entity[data-entity-id="${curve.id}"] > path:last-child`)!;
        const live = container.querySelector<SVGElement>(`[data-curve-preview="${tool}"]`)!;
        expect(getComputedStyle(live).vectorEffect).toBe('non-scaling-stroke');
        expect(getComputedStyle(live).strokeWidth).toBe(`${SKETCH_APPEARANCE.normalStroke}px`);
        const [normalAlpha, previewAlpha] = await Promise.all([rasterAlpha(committed, viewBox), rasterAlpha(live, viewBox)]);
        // Both use the same analytic tessellation; integrated alpha measures antialiased screen stroke coverage.
        expect(previewAlpha / normalAlpha).toBeCloseTo(1, 2);
      }
    }
  );
});
