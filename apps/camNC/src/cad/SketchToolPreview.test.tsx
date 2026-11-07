import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SketchToolPreview, type SketchToolPreviewProps } from './SketchToolPreview';
import { sketchPreviewFeedback } from './sketchPreviewFeedback';
import { SketchGeometry } from './SketchGeometry';

afterEach(cleanup);
const input = (tool: SketchToolPreviewProps['tool'], extra: Partial<SketchToolPreviewProps> = {}): SketchToolPreviewProps => ({
  tool,
  pending: [{ x: 20, y: 20 }],
  cursor: { x: 100, y: 60 },
  pixelScale: 2,
  ...extra,
});

describe('native live preview measurements', () => {
  it('measures a free line and offsets its value from the middle at any direction', () => {
    const source = input('line'),
      before = structuredClone(source),
      feedback = sketchPreviewFeedback(source);
    expect(feedback.values.map(value => value.text)).toEqual(['89.443']);
    expect(feedback.markers).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 60 },
    ]);
    const label = feedback.values[0]!.at;
    expect(Math.hypot(label.x - 60, label.y - 40)).toBeCloseTo(10);
    expect(source).toEqual(before);
    const vertical = sketchPreviewFeedback(input('line', { pending: [{ x: 20, y: 20 }], cursor: { x: 20, y: 100 } }));
    expect(vertical.values[0]!.at.y).toBe(60);
    expect(Math.abs(vertical.values[0]!.at.x - 20)).toBe(10);
  });

  it.each([
    { tool: 'rectangle' as const, values: ['80', '40'], markers: 4 },
    { tool: 'centerRectangle' as const, values: ['160', '80'], markers: 5 },
  ])('shows both dimensions and each $tool corner', ({ tool, values, markers }) => {
    const feedback = sketchPreviewFeedback(input(tool));
    expect(feedback.values.map(value => value.text)).toEqual(values);
    expect(feedback.markers).toHaveLength(markers);
    expect(feedback.values[0]!.at.y).toBeGreaterThan(Math.max(...feedback.markers.map(point => point.y)));
    expect(feedback.values[1]!.at.x).toBeLessThan(Math.min(...feedback.markers.map(point => point.x)));
  });

  it('shows circle diameter on the opposite side from the cursor with only a center marker', () => {
    const feedback = sketchPreviewFeedback(input('circle', { cursor: { x: 40, y: 20 } }));
    expect(feedback.values[0]!.text).toBe('⌀40');
    expect(feedback.values[0]!.at.x).toBeLessThan(0);
    expect(feedback.markers).toEqual([{ x: 20, y: 20 }]);
  });

  it('withholds radius for a suggested arc and shows it once the through point defines a real circle', () => {
    const pending = [
      { x: 20, y: 20 },
      { x: 60, y: 20 },
    ];
    expect(sketchPreviewFeedback(input('arc', { pending: [pending[0]!], cursor: pending[1]! })).values).toEqual([]);
    const feedback = sketchPreviewFeedback(input('arc', { pending, cursor: { x: 40, y: 40 } }));
    expect(feedback.values.map(value => value.text)).toEqual(['R20']);
    const { container } = render(
      <svg>
        <SketchToolPreview {...input('arc', { pending, cursor: { x: 40, y: 40 } })} />
      </svg>
    );
    expect(container.querySelectorAll('[data-arc-marker]')).toHaveLength(3);
    expect(container.querySelector('[data-arc-marker="center"]')).toBeTruthy();
    expect(container.querySelector('[data-arc-instruction]')).toBeNull();
  });

  it.each(['spline', 'bezier', 'conic'] as const)('shows the placed %s points and the live cursor without changing them', tool => {
    const pending = [
        { x: 10, y: 20 },
        { x: 40, y: 60 },
        { x: 80, y: 30 },
      ],
      cursor = { x: 100, y: 40 };
    const original = structuredClone(pending),
      feedback = sketchPreviewFeedback(input(tool, { pending, cursor }));
    expect(feedback.markers).toEqual([...pending, cursor]);
    expect(feedback.values).toEqual([]);
    expect(pending).toEqual(original);
    expect(sketchPreviewFeedback(input(tool, { pending, cursor: pending[2]! })).markers).toHaveLength(3);
  });

  it('does not invent a zero measurement before the cursor moves or show a cancelled preview', () => {
    for (const tool of ['line', 'rectangle', 'circle'] as const) {
      expect(sketchPreviewFeedback(input(tool, { cursor: { x: 20, y: 20 } })).values).toEqual([]);
      const { container, unmount } = render(
        <svg>
          <SketchToolPreview {...input(tool, { pending: [] })} />
        </svg>
      );
      expect(container.querySelector('[data-sketch-tool-preview]')).toBeNull();
      unmount();
    }
  });

  it('keeps marker diameters and label text sizes constant through zoom, with non-scaling preview strokes', () => {
    const { container, rerender } = render(<svg />);
    let firstHeight = 0;
    for (const scale of [2, 8]) {
      rerender(
        <svg width="800" height="800" viewBox={`0 -${800 / scale} ${800 / scale} ${800 / scale}`}>
          <SketchToolPreview {...input('rectangle', { pixelScale: scale })} />
        </svg>
      );
      for (const marker of container.querySelectorAll('[data-preview-point]')) expect(marker.getBoundingClientRect().width).toBeCloseTo(5);
      const text = container.querySelector('[data-preview-measurement]')!;
      if (!firstHeight) firstHeight = text.getBoundingClientRect().height;
      expect(text.getBoundingClientRect().height).toBeCloseTo(firstHeight);
      expect(getComputedStyle(container.querySelector('.cad-preview rect')!).vectorEffect).toBe('non-scaling-stroke');
      expect(container.querySelector('[data-sketch-tool-preview]')!.getAttribute('pointer-events')).toBe('none');
    }
  });

  it('shows solid blue spline fit-point dots at the committed point weight through multiple zooms', () => {
    const { container, rerender } = render(<svg />);
    const pending = [
        { x: 20, y: 20 },
        { x: 40, y: 70 },
        { x: 70, y: 30 },
      ],
      cursor = { x: 90, y: 60 };
    for (const scale of [2, 8]) {
      rerender(
        <svg width="800" height="800" viewBox={`0 -${800 / scale} ${800 / scale} ${800 / scale}`}>
          <SketchGeometry
            entities={[{ id: 'committed-fit-point', type: 'point', x: 10, y: 10, standalone: true }]}
            selectedIds={[]}
            pixelScale={scale}
          />
          <SketchToolPreview {...input('spline', { pending, cursor, curvePreview: [...pending, cursor], pixelScale: scale })} />
        </svg>
      );
      const committed = container.querySelector('.cad-point')!;
      const markers = [...container.querySelectorAll('[data-preview-point]')];
      expect(markers).toHaveLength(4);
      for (const marker of markers) {
        expect(getComputedStyle(marker).fill).toBe(getComputedStyle(committed).fill);
        expect(marker.getBoundingClientRect().width).toBeCloseTo(committed.getBoundingClientRect().width, 5);
        expect(marker.getBoundingClientRect().width).toBeCloseTo(5, 5);
        expect(marker.getAttribute('stroke')).toBe('none');
      }
    }
  });
});
