import type { HoleMiddle } from '@wbcnc/cam';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardNest, PartInstance } from '../boards';
import type { CamPartInfo, PlanResult } from '../camTypes';
import { NestView, type FixtureEditing } from './NestView';

const square = (x: number, y: number, s: number): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];
const part = {
  id: 'part-0',
  shape: { outlines: [square(0, 0, 100)], holes: [square(10, 10, 30), square(60, 60, 20)], pockets: [] },
} as unknown as CamPartInfo;
const instance = { id: 'one', partId: 'part-0', name: 'Plate', size: [100, 100, 18] } as unknown as PartInstance;
const nest = { board: { w: 120, h: 120 }, placements: [{ id: 'one', x: 10, y: 10, rotated: false }], holds: [] } as unknown as BoardNest;
const middle = (hole: number, state: HoleMiddle['state']): HoleMiddle => ({ hole, size: 24, addMinutes: 4, state, part: 'one' });
const plan = { path: [], holeMiddles: [middle(0, 'loose'), middle(1, 'cleared')] } as unknown as PlanResult;
const view = (props: Partial<Parameters<typeof NestView>[0]> = {}) =>
  render(<NestView nest={nest} instances={[instance]} parts={[part]} plan={plan} {...props} />);

afterEach(cleanup);

describe('the middles of through holes on the drawing', () => {
  it('shows what happens to each', () => {
    const { container } = view();
    expect([...container.querySelectorAll('[data-hole]')].map(e => e.getAttribute('data-hole-state'))).toEqual(['loose', 'cleared']);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a click picks the hole, at its middle, and does not start dragging the part', () => {
    const onHole = vi.fn();
    const onPartPointerDown = vi.fn();
    view({ onHole, onPartPointerDown });
    const hole = screen.getByRole('button', { name: /its 24 mm middle: comes loose/ });
    fireEvent.pointerDown(hole);
    expect(onPartPointerDown).not.toHaveBeenCalled();
    fireEvent.click(hole);
    expect(onHole).toHaveBeenCalledWith(plan.holeMiddles![0], { x: 35, y: 35 });
  });

  it('Enter picks it too, without opening the part menu', () => {
    const onHole = vi.fn();
    const onPartKeyDown = vi.fn();
    view({ onHole, onPartKeyDown, onPartPointerDown: vi.fn() });
    fireEvent.keyDown(screen.getByRole('button', { name: /middle: cleared/ }), { key: 'Enter' });
    expect(onHole).toHaveBeenCalledTimes(1);
    expect(onPartKeyDown).not.toHaveBeenCalled();
  });

  it('while placing a screw a click goes through, onto the piece', () => {
    const onHole = vi.fn();
    const onPlace = vi.fn();
    const { container } = view({ onHole, fixtures: { tool: 'screw', onPlace, onHover: vi.fn() } as unknown as FixtureEditing });
    const hole = container.querySelector('[data-hole="0"]')!;
    expect(hole.getAttribute('role')).toBeNull();
    fireEvent.click(hole);
    expect(onHole).not.toHaveBeenCalled();
    expect(onPlace).toHaveBeenCalledTimes(1);
  });
});
