import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CadSketch } from '@wbcnc/cad';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InlineConstraints } from './inlineConstraints';

afterEach(cleanup);
const sketch: CadSketch = {
  id: 'sketch',
  entities: [
    { id: 'a', type: 'point', x: 0, y: 0 },
    { id: 'b', type: 'point', x: 100, y: 0 },
    { id: 'ab', type: 'line', startId: 'a', endId: 'b' },
  ],
  constraints: [{ id: 'horizontal', type: 'horizontal', entityId: 'ab' }],
};

describe('inline constraint interaction', () => {
  it('passes middle and right pointer presses to canvas panning without selecting a relation', () => {
    const onPointerDown = vi.fn(),
      onSelect = vi.fn();
    render(
      <svg onPointerDown={onPointerDown}>
        <InlineConstraints sketch={sketch} scale={1} selectedConstraintIds={[]} onSelect={onSelect} />
      </svg>
    );
    const glyph = screen.getByRole('button', { name: 'Horizontal constraint' });
    fireEvent.pointerDown(glyph, { button: 1 });
    fireEvent.pointerDown(glyph, { button: 2 });
    expect(onPointerDown.mock.calls.map(([event]) => event.button)).toEqual([1, 2]);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(glyph, { button: 0 });
    expect(onPointerDown).toHaveBeenCalledTimes(2);
  });

  it('selects on ordinary/additive clicks without initiating a canvas drag; double click does not delete', () => {
    const onSelect = vi.fn(),
      onEdit = vi.fn(),
      onPointerDown = vi.fn();
    render(
      <svg onPointerDown={onPointerDown}>
        <InlineConstraints sketch={sketch} scale={2} selectedConstraintIds={[]} onSelect={onSelect} onEdit={onEdit} />
      </svg>
    );
    const glyph = screen.getByRole('button', { name: 'Horizontal constraint' });
    fireEvent.pointerDown(glyph);
    fireEvent.click(glyph);
    fireEvent.click(glyph, { shiftKey: true });
    fireEvent.doubleClick(glyph);
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onSelect.mock.calls).toEqual([
      ['horizontal', false],
      ['horizontal', true],
    ]);
    expect(onEdit).toHaveBeenCalledWith('horizontal');
    expect(sketch.constraints).toHaveLength(1);
    expect(glyph.getAttribute('transform')).toContain('scale(0.5)');
    expect(glyph.querySelector('rect')?.getAttribute('width')).toBe('20');
  });

  it('supports Enter/Space selection while Delete reaches the parent editor', () => {
    const onSelect = vi.fn(),
      onKeyDown = vi.fn();
    render(
      <svg onKeyDown={onKeyDown}>
        <InlineConstraints sketch={sketch} scale={1} selectedConstraintIds={[]} onSelect={onSelect} />
      </svg>
    );
    const glyph = screen.getByRole('button', { name: 'Horizontal constraint' });
    fireEvent.keyDown(glyph, { key: 'Enter' });
    fireEvent.keyDown(glyph, { key: ' ', ctrlKey: true });
    expect(onSelect.mock.calls).toEqual([
      ['horizontal', false],
      ['horizontal', true],
    ]);
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(glyph, { key: 'Delete' });
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(glyph.getAttribute('tabindex')).toBe('0');
  });

  it('reports source identities on pointer/focus hover and reflects controlled selection', () => {
    const onHover = vi.fn(),
      onSelect = vi.fn();
    const { rerender } = render(
      <svg>
        <InlineConstraints sketch={sketch} scale={1} selectedConstraintIds={[]} onSelect={onSelect} onHover={onHover} />
      </svg>
    );
    const glyph = screen.getByRole('button', { name: 'Horizontal constraint' });
    fireEvent.pointerEnter(glyph);
    expect(onHover).toHaveBeenLastCalledWith('horizontal', ['ab']);
    expect(glyph.querySelector('rect')?.getAttribute('stroke')).toBe('#c28a19');
    fireEvent.pointerLeave(glyph);
    expect(onHover).toHaveBeenLastCalledWith(null, []);
    fireEvent.focus(glyph);
    expect(onHover).toHaveBeenLastCalledWith('horizontal', ['ab']);
    fireEvent.blur(glyph);
    expect(onHover).toHaveBeenLastCalledWith(null, []);
    rerender(
      <svg>
        <InlineConstraints
          sketch={sketch}
          scale={1}
          selectedConstraintIds={new Set(['horizontal'])}
          onSelect={onSelect}
          onHover={onHover}
        />
      </svg>
    );
    expect(glyph.getAttribute('aria-pressed')).toBe('true');
    expect(glyph.querySelector('rect')?.getAttribute('fill')).toBe('#fff1bf');
  });

  it('lets drawing tools hit the painted canvas through disabled glyphs and removes them from keyboard navigation', () => {
    const onSelect = vi.fn(),
      onHover = vi.fn(),
      onEdit = vi.fn(),
      canvasClick = vi.fn();
    const view = (interactive: boolean) => (
      <svg width="400" height="200" style={{ position: 'fixed', top: 0, left: 0 }}>
        <rect data-testid="canvas" width="400" height="200" fill="white" onClick={canvasClick} />
        <g transform="translate(100 100)">
          <InlineConstraints
            sketch={sketch}
            scale={1}
            selectedConstraintIds={[]}
            interactive={interactive}
            onSelect={onSelect}
            onHover={onHover}
            onEdit={onEdit}
          />
        </g>
      </svg>
    );
    const { rerender } = render(view(true));
    const glyph = screen.getByRole('button', { name: 'Horizontal constraint' });
    const bounds = glyph.getBoundingClientRect(),
      x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    expect(document.elementFromPoint(x, y)?.closest('[data-constraint-id]')).toBe(glyph);
    rerender(view(false));
    const target = document.elementFromPoint(x, y)!;
    expect(target).toBe(screen.getByTestId('canvas'));
    fireEvent.click(target);
    expect(canvasClick).toHaveBeenCalledOnce();
    expect(glyph.getAttribute('tabindex')).toBe('-1');
    expect(glyph.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(glyph);
    fireEvent.doubleClick(glyph);
    fireEvent.keyDown(glyph, { key: 'Enter' });
    fireEvent.pointerEnter(glyph);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onHover).not.toHaveBeenCalled();
  });

  it('marks conflicts red with a description while preserving selection priority, accessible names, and source', () => {
    const before = structuredClone(sketch),
      onSelect = vi.fn();
    const { rerender } = render(
      <svg>
        <InlineConstraints
          sketch={sketch}
          scale={1}
          selectedConstraintIds={[]}
          conflictedConstraintIds={['horizontal']}
          onSelect={onSelect}
        />
      </svg>
    );
    const glyph = screen.getByRole('button', { name: 'Horizontal constraint' });
    expect(glyph.getAttribute('data-conflict')).toBe('true');
    expect(glyph.getAttribute('aria-description')).toContain('Conflicting constraint');
    expect(glyph.querySelector('title')?.textContent).toContain('Conflicting');
    expect(glyph.querySelector('rect')?.getAttribute('stroke')).toBe('#c43b35');
    expect(glyph.querySelector('rect')?.getAttribute('fill')).toBe('#fff0ee');
    rerender(
      <svg>
        <InlineConstraints
          sketch={sketch}
          scale={1}
          selectedConstraintIds={['horizontal']}
          conflictedConstraintIds={['horizontal']}
          onSelect={onSelect}
        />
      </svg>
    );
    expect(glyph.querySelector('rect')?.getAttribute('stroke')).toBe('#c28a19');
    expect(glyph.querySelector('rect')?.getAttribute('fill')).toBe('#fff1bf');
    expect(glyph.getAttribute('data-conflict')).toBe('true');
    expect(sketch).toEqual(before);
  });
});
