import { createCadDocument, createCadPart } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
async function setup() {
  const document = createCadDocument();
  document.parts.push(createCadPart());
  ids.push(document.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={document} onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  await userEvent.click(screen.getByRole('button', { name: 'Snap on' }));
  const local = (x: number, y: number) => new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  const client = (x: number, y: number) => {
    const p = local(x, y);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      p.x = bounds.x + (p.x * bounds.width) / frame.innerWidth;
      p.y = bounds.y + (p.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    return { x: p.x, y: p.y };
  };
  const protocol = cdp();
  const click = async (x: number, y: number) => {
    const p = local(x, y),
      bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: p.x - bounds.x, y: p.y - bounds.y } });
  };
  const move = (x: number, y: number) => protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...client(x, y), buttons: 0 });
  const zoom = (x: number, y: number) =>
    protocol.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...client(x, y), deltaX: 0, deltaY: -600 });
  return { canvas, click, move, zoom };
}

describe('real pointer preview feedback before placement', () => {
  it('renders each placed spline fit point and its hover point as blue dots at a constant screen size', async () => {
    const { canvas, click, move, zoom } = await setup();
    await userEvent.click(
      screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Drawing tools' }) ? 'Drawing tools' : 'Spline tools' })
    );
    await userEvent.click(screen.getByRole('menuitem', { name: /^Spline$/ }));
    await click(20, 20);
    await click(65, 75);
    await click(110, 30);
    await move(150, 65);
    await waitFor(() => expect(canvas.querySelectorAll('[data-preview-point]')).toHaveLength(4));
    const assertDots = () => {
      for (const dot of canvas.querySelectorAll('[data-preview-point]')) {
        expect(getComputedStyle(dot).fill).toBe('rgb(0, 0, 255)');
        expect(dot.getBoundingClientRect().width).toBeCloseTo(5, 4);
      }
    };
    assertDots();
    await zoom(65, 75);
    await waitFor(assertDots);
    expect(canvas.querySelectorAll('.cad-entity')).toHaveLength(0);
  });

  it.each([
    { key: 'l', values: ['89.443'], markers: 2 },
    { key: 'g', values: ['80', '40'], markers: 4 },
    { key: 'c', values: ['178.885'], markers: 1 },
  ])('shows live values and markers for $key before committing geometry', async ({ key, values, markers }) => {
    const { canvas, click, move } = await setup();
    await userEvent.keyboard(key);
    await click(20, 20);
    await move(100, 60);
    await waitFor(() => expect(canvas.querySelectorAll('[data-preview-measurement]')).toHaveLength(values.length));
    const displayed = [...canvas.querySelectorAll('[data-preview-measurement]')].map(el => Number(el.textContent?.replace('⌀', '')));
    // Native mouse input rounds client coordinates; allow less than a fraction of one CSS pixel.
    values.forEach((value, index) => expect(displayed[index]).toBeCloseTo(Number(value), 1));
    expect(canvas.querySelectorAll('[data-preview-point]')).toHaveLength(markers);
    expect(canvas.querySelectorAll('.cad-entity')).toHaveLength(0);
    expect(document.activeElement).toBe(canvas);
    await userEvent.keyboard('{Escape}');
    expect(canvas.querySelector('[data-sketch-tool-preview]')).toBeNull();
    expect(canvas.querySelectorAll('.cad-entity')).toHaveLength(0);
  });

  it('keeps live circle values and markers readable through a real wheel zoom, then removes them on placement', async () => {
    const { canvas, click, move, zoom } = await setup();
    await userEvent.keyboard('c');
    await click(80, 70);
    await move(100, 70);
    const marker = () => canvas.querySelector('[data-preview-point]')!;
    await waitFor(() => expect(Number(canvas.querySelector('[data-preview-measurement]')!.textContent!.slice(1))).toBeCloseTo(40, 1));
    const firstValue = canvas.querySelector('[data-preview-measurement]')!.textContent;
    const firstWidth = marker().getBoundingClientRect().width;
    expect(firstWidth).toBeCloseTo(5);
    await zoom(80, 70);
    await waitFor(() => expect(marker().getBoundingClientRect().width).toBeCloseTo(5));
    expect(canvas.querySelector('[data-preview-measurement]')!.textContent).toBe(firstValue);
    await click(100, 70);
    await waitFor(() => expect(canvas.querySelector('.cad-entity circle')).toBeTruthy());
    expect(canvas.querySelector('[data-sketch-tool-preview]')).toBeNull();
    expect(screen.getByRole('button', { name: /^Circle diameter: 40(?:\.\d+)? mm/ })).toBeTruthy();
  });
});
