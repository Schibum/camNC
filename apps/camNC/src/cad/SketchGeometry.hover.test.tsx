import { cleanup, render, waitFor } from '@testing-library/react';
import { cdp } from '@vitest/browser/context';
import { afterEach, expect, it } from 'vitest';
import type { CadEntity } from '@wbcnc/cad';
import { SketchGeometry } from './SketchGeometry';
import './cad.css';

afterEach(cleanup);
it('uses thin orange on real pointer hover, thicker orange selection, and leaves hit geometry transparent', async () => {
  const entities: CadEntity[] = [
    { id: 'a', type: 'point', x: 20, y: -20 },
    { id: 'b', type: 'point', x: 80, y: -20 },
    { id: 'line', type: 'line', startId: 'a', endId: 'b' },
  ];
  const fixture = (selectedIds: string[]) => (
    <svg width="400" height="400" viewBox="0 0 100 100">
      <SketchGeometry entities={entities} selectedIds={selectedIds} pixelScale={4} />
    </svg>
  );
  const { container, rerender } = render(fixture([]));
  const curve = () => container.querySelector('[data-visible-curve]')!,
    hit = () => curve().previousElementSibling!;
  const client = (x: number, y: number) => {
    const p = { x, y };
    let frame: Window = window;
    while (frame.frameElement) {
      const b = frame.frameElement.getBoundingClientRect();
      p.x = b.x + (p.x * b.width) / frame.innerWidth;
      p.y = b.y + (p.y * b.height) / frame.innerHeight;
      frame = frame.parent;
    }
    return p;
  };
  const protocol = cdp(),
    bounds = curve().getBoundingClientRect();
  await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...client(bounds.x + bounds.width / 2, bounds.y) });
  await waitFor(() => expect(getComputedStyle(curve()).stroke).toBe('rgb(255, 155, 35)'));
  expect(getComputedStyle(curve()).strokeWidth).toBe('1.5px');
  expect(getComputedStyle(hit()).stroke).toBe('rgba(0, 0, 0, 0)');
  expect(getComputedStyle(curve().parentElement!).filter).toBe('none');
  rerender(fixture(['line']));
  expect(getComputedStyle(curve()).stroke).toBe('rgb(255, 155, 35)');
  expect(getComputedStyle(curve()).strokeWidth).toBe('2px');
  await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...client(bounds.x + bounds.width / 2, bounds.y + 70) });
  rerender(fixture([]));
  await waitFor(() => expect(getComputedStyle(curve()).stroke).toBe('rgb(0, 0, 255)'));
});
