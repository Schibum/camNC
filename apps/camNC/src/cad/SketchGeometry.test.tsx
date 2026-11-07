import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CadEntity, CadEntityFreedom } from '@wbcnc/cad';
import { SketchGeometry, SketchPreview } from './SketchGeometry';
import { SKETCH_APPEARANCE, useSvgPixelScale } from './sketchAppearance';

afterEach(cleanup);
const entities: CadEntity[] = [
  { id: 'a', type: 'point', x: 20, y: -20 },
  { id: 'b', type: 'point', x: 80, y: -20 },
  { id: 'c', type: 'point', x: 20, y: -50 },
  { id: 'd', type: 'point', x: 40, y: -50 },
  { id: 'e', type: 'point', x: 20, y: -30 },
  { id: 'line', type: 'line', startId: 'a', endId: 'b' },
  { id: 'circle', type: 'circle', centerId: 'c', radius: 10, construction: true },
  { id: 'arc', type: 'arc', centerId: 'c', startId: 'd', endId: 'e', radius: 20, startAngle: 0, endAngle: Math.PI / 2 },
];

function Harness({ viewBox = '0 0 100 100', selectedIds = [] as string[] }) {
  const svg = useRef<SVGSVGElement>(null);
  const scale = useSvgPixelScale(svg, viewBox);
  return (
    <svg ref={svg} data-testid="svg" viewBox={viewBox} width="400" height="400">
      <SketchGeometry entities={entities} selectedIds={selectedIds} stroke="#3069c8" pixelScale={scale} hoveredPointId="b" />
      <SketchPreview>
        <line x1="20" y1="80" x2="80" y2="80" />
      </SketchPreview>
    </svg>
  );
}
const visibleCurve = (container: HTMLElement, id: string) =>
  container.querySelector(`g[data-entity-id="${id}"]`)!.lastElementChild as SVGElement;
const markerDiameter = (container: HTMLElement, id: string) =>
  container.querySelector(`circle.cad-point[data-entity-id="${id}"]`)!.getBoundingClientRect().width;

describe('interactive conic rho pointer ownership', () => {
  const conicEntities: CadEntity[] = [
    { id: 'start', type: 'point', x: 10, y: -20 },
    { id: 'control', type: 'point', x: 50, y: -60 },
    { id: 'end', type: 'point', x: 90, y: -20 },
    { id: 'conic', type: 'conic', startId: 'start', controlId: 'control', endId: 'end', rho: 0.5 },
  ];
  function fixture() {
    const pan = vi.fn(),
      edit = vi.fn();
    const view = render(
      <svg width="400" height="400" viewBox="0 0 100 100" onPointerDown={event => pan(event.button)}>
        <SketchGeometry entities={conicEntities} selectedIds={[]} pixelScale={4} interactive onEditConic={edit} />
      </svg>
    );
    return { ...view, pan, edit, label: view.getByRole('button', { name: 'Edit conic rho: 0.5' }) };
  }

  it.each([
    ['middle', 1, 4],
    ['right', 2, 2],
  ] as const)('lets %s pointer-down reach the canvas pan handler', (_name, button, buttons) => {
    const { label, pan, edit } = fixture();
    fireEvent.pointerDown(label, { button, buttons });
    expect(pan).toHaveBeenCalledOnce();
    expect(pan).toHaveBeenCalledWith(button);
    expect(edit).not.toHaveBeenCalled();
  });

  it('isolates primary pointer-down and keeps double-click and keyboard editing', () => {
    const { label, pan, edit } = fixture();
    fireEvent.pointerDown(label, { button: 0, buttons: 1 });
    expect(pan).not.toHaveBeenCalled();
    fireEvent.doubleClick(label, { button: 0 });
    expect(edit).toHaveBeenCalledWith('conic');
    fireEvent.keyDown(label, { key: 'Enter' });
    expect(edit).toHaveBeenCalledTimes(2);
  });
});

describe('screen-pixel sketch appearance', () => {
  it('colors native fully constrained entities and points independently while preserving construction and selection', () => {
    const before = structuredClone(entities);
    const entityStatus: Record<string, CadEntityFreedom> = {
      line: 'fully-constrained',
      arc: 'underconstrained',
      circle: 'fully-constrained',
      a: 'fully-constrained',
      b: 'underconstrained',
    };
    const { container, rerender } = render(
      <svg>
        <SketchGeometry entities={entities} selectedIds={[]} pixelScale={1} stroke="#000000" entityStatus={entityStatus} />
      </svg>
    );
    const point = (id: string) => container.querySelector(`circle.cad-point[data-entity-id="${id}"]`)!;
    expect(visibleCurve(container, 'line').getAttribute('stroke')).toBe(SKETCH_APPEARANCE.constrainedColor);
    expect(visibleCurve(container, 'arc').getAttribute('stroke')).toBe(SKETCH_APPEARANCE.freeColor);
    expect(visibleCurve(container, 'circle').getAttribute('stroke')).toBe(SKETCH_APPEARANCE.constructionColor);
    expect(visibleCurve(container, 'circle').getAttribute('stroke-dasharray')).toBe('6 4');
    expect(point('a').getAttribute('fill')).toBe(SKETCH_APPEARANCE.constrainedColor);
    expect(point('b').getAttribute('fill')).toBe(SKETCH_APPEARANCE.freeColor);
    expect(point('c').getAttribute('fill')).toBe(SKETCH_APPEARANCE.freeColor);
    rerender(
      <svg>
        <SketchGeometry
          entities={entities}
          selectedIds={['line', 'a']}
          pixelScale={1}
          stroke="#000000"
          entityStatus={{ ...entityStatus, arc: 'unknown' }}
        />
      </svg>
    );
    expect(visibleCurve(container, 'line').getAttribute('stroke')).toBe(SKETCH_APPEARANCE.selectedColor);
    expect(point('a').getAttribute('fill')).toBe(SKETCH_APPEARANCE.selectedColor);
    expect(visibleCurve(container, 'arc').getAttribute('stroke')).toBe(SKETCH_APPEARANCE.freeColor);
    expect(point('a').getAttribute('data-constraint-status')).toBe('fully-constrained');
    expect(entities).toEqual(before);
  });
  it('puts consistent non-scaling strokes on every real curve and its transparent hit shape', () => {
    const { container } = render(<Harness selectedIds={['arc']} />);
    for (const id of ['line', 'circle', 'arc']) {
      const curve = visibleCurve(container, id);
      expect(curve.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(Number(curve.getAttribute('stroke-width'))).toBe(id === 'arc' ? 2 : 1.5);
      const hit = curve.previousElementSibling!;
      expect(hit.getAttribute('vector-effect')).toBe('non-scaling-stroke');
      expect(hit.getAttribute('stroke')).toBe('transparent');
      expect(hit.getAttribute('stroke-width')).toBe('12');
      expect(hit.getAttribute('stroke-dasharray')).toBeNull();
    }
    expect(visibleCurve(container, 'circle').getAttribute('stroke-dasharray')).toBe('6 4');
    expect(visibleCurve(container, 'arc').getAttribute('stroke')).toBe(SKETCH_APPEARANCE.selectedColor);
  });

  it('keeps normal and selected point diameters constant immediately after camera zoom', () => {
    const { container, rerender } = render(<Harness selectedIds={['a']} />);
    expect(markerDiameter(container, 'a')).toBeCloseTo(6, 3);
    expect(markerDiameter(container, 'b')).toBeCloseTo(5, 3);
    rerender(<Harness viewBox="0 0 500 500" selectedIds={['a']} />);
    // No pointer move or second editor render is needed to catch up to the new CTM.
    expect(markerDiameter(container, 'a')).toBeCloseTo(6, 3);
    expect(markerDiameter(container, 'b')).toBeCloseTo(5, 3);
    expect(container.querySelector('circle.cad-point[data-entity-id="a"]')!.getAttribute('fill')).toBe(SKETCH_APPEARANCE.selectedColor);
  });

  it('updates marker sizes after a container resize without a React camera change', async () => {
    const { container, getByTestId } = render(<Harness />);
    const svg = getByTestId('svg');
    expect(markerDiameter(container, 'a')).toBeCloseTo(5, 3);
    svg.style.width = '700px';
    svg.style.height = '700px';
    await waitFor(() => expect(markerDiameter(container, 'a')).toBeCloseTo(5, 3));
    const hit = container.querySelector('g[data-entity-id="a"] circle')!;
    expect(hit.getBoundingClientRect().width).toBeCloseTo(16, 3);
  });

  it.each(['line', 'rect', 'circle', 'path'] as const)('styles the actual %s preview shape instead of its parent group', type => {
    const shape =
      type === 'line' ? (
        <line x1="0" y1="0" x2="80" y2="20" />
      ) : type === 'rect' ? (
        <rect x="0" y="0" width="80" height="20" />
      ) : type === 'circle' ? (
        <circle cx="30" cy="30" r="20" />
      ) : (
        <path d="M0 0 L80 20" />
      );
    const { container, rerender } = render(
      <svg>
        <SketchPreview>{shape}</SketchPreview>
      </svg>
    );
    const preview = () => container.querySelector(`.cad-preview ${type}`)!;
    expect(preview().getAttribute('vector-effect')).toBe('non-scaling-stroke');
    expect(preview().getAttribute('stroke-width')).toBe('1.5');
    expect(preview().getAttribute('stroke-dasharray')).toBeNull();
    rerender(
      <svg>
        <SketchPreview construction>{shape}</SketchPreview>
      </svg>
    );
    expect(preview().getAttribute('stroke-dasharray')).toBe('6 4');
  });

  it('rasterizes normal, selected and live preview strokes at the same pixel weights after zoom', async () => {
    const rasterEntities: CadEntity[] = [20, 40, 80].flatMap(y => [
      { id: `a${y}`, type: 'point' as const, x: 10, y: -y },
      { id: `b${y}`, type: 'point' as const, x: 90, y: -y },
      { id: `l${y}`, type: 'line' as const, startId: `a${y}`, endId: `b${y}`, construction: y === 80 },
    ]);
    const fixture = (extent: number) => (
      <svg width="200" height="200" viewBox={`0 0 ${extent} ${extent}`}>
        <SketchGeometry entities={rasterEntities} selectedIds={['l40']} pixelScale={200 / extent} />
        <SketchPreview>
          <line x1="10" y1="60" x2="90" y2="60" />
        </SketchPreview>
      </svg>
    );
    const { container, rerender } = render(fixture(100));
    for (const extent of [100, 200]) {
      rerender(fixture(extent));
      const source = new XMLSerializer().serializeToString(container.querySelector('svg')!);
      const bitmap = new Image();
      bitmap.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      await bitmap.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 200;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, 200, 200).data;
      const scale = 200 / extent;
      for (const [y, weight] of [
        [20, 1.5],
        [40, 2],
        [60, 1.5],
      ]) {
        const xPixel = Math.floor(50 * scale),
          yPixel = Math.floor(y! * scale);
        let alphaWeight = 0;
        for (let dy = -5; dy <= 5; dy++) alphaWeight += pixels[((yPixel + dy) * 200 + xPixel) * 4 + 3]! / 255;
        expect(alphaWeight).toBeCloseTo(weight!, 1);
      }
      // Consecutive construction dashes retain their 10 CSS-pixel period.
      const starts: number[] = [];
      let previous = false;
      for (let x = Math.ceil(12 * scale); x < 88 * scale; x++) {
        const visible = pixels[(Math.floor(80 * scale) * 200 + x) * 4 + 3]! > 128;
        if (visible && !previous) starts.push(x);
        previous = visible;
      }
      expect(starts.length).toBeGreaterThan(4);
      for (let index = 2; index < starts.length; index++) expect(starts[index]! - starts[index - 1]!).toBe(10);
    }
  });
});
