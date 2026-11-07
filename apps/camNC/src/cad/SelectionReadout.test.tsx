import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CadSketch } from '@wbcnc/cad';
import { SelectionReadout } from './SelectionReadout';

afterEach(cleanup);

const sketch: CadSketch = {
  id: 'readout',
  constraints: [],
  entities: [
    { id: 'a', type: 'point', x: 0, y: 0 },
    { id: 'b', type: 'point', x: 3, y: 4 },
    { id: 'line', type: 'line', startId: 'a', endId: 'b' },
    { id: 'circle', type: 'circle', centerId: 'a', radius: 6 },
  ],
};

describe('selection readout', () => {
  it('updates passive measurements without adding fields, focus stops or constraints', () => {
    const { rerender } = render(<SelectionReadout sketch={sketch} selectedIds={['line']} className="test-footer" />);
    const status = screen.getByRole('status', { name: 'Selection measurements' });
    expect(status.classList.contains('test-footer')).toBe(true);
    expect(status.getAttribute('aria-atomic')).toBe('true');
    expect(within(status).getByText('Length')).toBeTruthy();
    expect(within(status).getByText('5 mm')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(status.querySelector('[tabindex],button,input')).toBeNull();
    expect(sketch.constraints).toEqual([]);
    rerender(<SelectionReadout sketch={sketch} selectedIds={['circle']} />);
    expect(within(status).queryByText('Length')).toBeNull();
    expect(within(status).getByText('Diameter')).toBeTruthy();
    expect(within(status).getByText('12 mm')).toBeTruthy();
    expect(getComputedStyle(status.querySelector('dl')!).flexWrap).toBe('wrap');
  });

  it('disappears when the selection clears or has no supported measurement', () => {
    const { rerender } = render(<SelectionReadout sketch={sketch} selectedIds={['a', 'b']} />);
    expect(screen.getByText('Minimum distance')).toBeTruthy();
    rerender(<SelectionReadout sketch={sketch} selectedIds={[]} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<SelectionReadout sketch={sketch} selectedIds={['missing']} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps a small positive measured gap visible instead of rounding its label to zero', () => {
    const tiny: CadSketch = {
      id: 'tiny',
      constraints: [],
      entities: [
        { id: 'a', type: 'point', x: 0, y: 0 },
        { id: 'b', type: 'point', x: 1e-7, y: 0 },
      ],
    };
    render(<SelectionReadout sketch={tiny} selectedIds={['a', 'b']} />);
    expect(screen.getByText('1e-7 mm')).toBeTruthy();
    expect(screen.queryByText('0 mm')).toBeNull();
  });
});
