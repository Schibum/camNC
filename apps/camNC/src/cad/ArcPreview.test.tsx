import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ArcPreview } from './ArcPreview';

afterEach(cleanup);

describe('arc preview rendering', () => {
  it('renders a curved suggestion and a separate dashed endpoint guide rather than a solid line preview', () => {
    const { container } = render(
      <svg>
        <ArcPreview mode="threePoint" pending={[{ x: 0, y: 0 }]} cursor={{ x: 40, y: 20 }} pixelScale={2} />
      </svg>
    );
    expect(container.querySelector('.cad-preview path')!.getAttribute('d')).toContain(' A ');
    expect(container.querySelector('.cad-preview line')).toBeNull();
    expect(container.querySelector('[data-arc-guide]')!.getAttribute('stroke-dasharray')).toBe('4 4');
    expect(container.querySelector('[data-arc-phase="end"]')!.getAttribute('pointer-events')).toBe('none');
  });

  it('keeps markers, instructions and preview strokes constant in CSS pixels after zoom', () => {
    const fixture = (extent: number) => (
      <svg width={400} height={400} viewBox={`0 -100 ${extent} ${extent}`}>
        <ArcPreview
          mode="threePoint"
          pending={[
            { x: 0, y: 0 },
            { x: 40, y: 20 },
          ]}
          cursor={{ x: 20, y: 40 }}
          pixelScale={400 / extent}
        />
      </svg>
    );
    const { container, rerender } = render(fixture(100));
    for (const extent of [100, 200]) {
      rerender(fixture(extent));
      expect(container.querySelector('[data-arc-marker="start"]')!.getBoundingClientRect().width).toBeCloseTo(5);
      expect(container.querySelector('[data-arc-marker="end"]')!.getBoundingClientRect().width).toBeCloseTo(5);
      expect(container.querySelector('[data-arc-marker="center"]')!.getBoundingClientRect().width).toBeCloseTo(5);
      const text = container.querySelector('text')!;
      expect((Number(text.getAttribute('font-size')) * 400) / extent).toBe(11);
      expect(container.querySelector('.cad-preview path')!.getAttribute('stroke-width')).toBe('1.5');
      expect(container.querySelector('.cad-preview path')!.getAttribute('vector-effect')).toBe('non-scaling-stroke');
    }
  });

  it('gives contact snap text priority while preserving the curved preview and control markers', () => {
    const fixture = (showInstruction: boolean) => (
      <svg>
        <ArcPreview
          mode="threePoint"
          pending={[{ x: 0, y: 0 }]}
          cursor={{ x: 40, y: 20 }}
          pixelScale={2}
          showInstruction={showInstruction}
        />
      </svg>
    );
    const { container, rerender } = render(fixture(true));
    expect(container.querySelector('[data-arc-instruction]')?.textContent).toBe('Click arc end');
    const path = container.querySelector('[data-arc-preview="curve"]')!.getAttribute('d');
    rerender(fixture(false));
    expect(container.querySelector('[data-arc-instruction]')).toBeNull();
    expect(container.querySelector('[data-arc-preview="curve"]')!.getAttribute('d')).toBe(path);
    expect(container.querySelectorAll('[data-arc-marker]')).toHaveLength(2);
  });
});
