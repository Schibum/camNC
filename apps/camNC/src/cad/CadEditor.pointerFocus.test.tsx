import { addRectangle, createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const menuFocus = vi.hoisted(() => ({ delayed: false, close: undefined as (() => void) | undefined }));
vi.mock('./SketchToolbar', async original => {
  const actual = await original<typeof import('./SketchToolbar')>();
  return {
    ...actual,
    SketchToolbar: (props: ComponentProps<typeof actual.SketchToolbar>) => {
      const Toolbar = actual.SketchToolbar;
      return (
        <Toolbar
          {...props}
          onReturnToCanvas={() => {
            if (menuFocus.delayed) menuFocus.close = props.onReturnToCanvas;
            else props.onReturnToCanvas();
          }}
        />
      );
    },
  };
});

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
  menuFocus.delayed = false;
  menuFocus.close = undefined;
});

it.each([false, true])('keeps rho focused after the complete native pointer sequence (delayed menu close=%s)', async delayed => {
  menuFocus.delayed = delayed;
  const source = createCadDocument();
  source.parts.push(createCadPart());
  ids.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const click = async (x: number, y: number) => {
    const client = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    const bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: client.x - bounds.left, y: client.y - bounds.top } });
  };
  await userEvent.click(
    screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Drawing tools' }) ? 'Drawing tools' : 'Arc tools' })
  );
  await userEvent.click(screen.getByRole('menuitem', { name: 'Conic' }));
  await click(20, 20);
  await click(100, 20);
  await click(60, 75);
  const rho = screen.getByRole('textbox', { name: 'Conic rho' });
  expect(document.activeElement).toBe(rho);
  if (delayed) {
    expect(menuFocus.close).toBeTypeOf('function');
    menuFocus.close!();
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    expect(document.activeElement).toBe(rho);
  }
  await userEvent.keyboard('0.7{Enter}');
  await waitFor(() =>
    expect(change.mock.calls.at(-1)?.[0].parts[0]!.sketch.entities.find(entity => entity.type === 'conic')?.rho).toBe(0.7)
  );
  expect(document.activeElement).toBe(canvas);
  expect(screen.queryByRole('textbox', { name: 'Conic rho' })).toBeNull();
});

it('keeps the closed region visible in a solved point-drag preview while the real mouse button is still held', async () => {
  const source = createCadDocument();
  const part = createCadPart();
  part.sketch = addRectangle(part.sketch, { x: 20, y: 20, width: 100, height: 80 });
  source.parts.push(part);
  ids.push(source.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  await waitFor(() => expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull(), { timeout: 20_000 });
  const corner = part.sketch.entities.find(entity => entity.type === 'point' && entity.x === 120 && entity.y === 100)!;
  const client = (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      p.x = bounds.left + (p.x * bounds.width) / frame.innerWidth;
      p.y = bounds.top + (p.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    return { x: p.x, y: p.y };
  };
  const protocol = cdp(),
    start = client(120, 100),
    target = client(140, 115);
  await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
  await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
  try {
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target, button: 'left', buttons: 1 });
    await waitFor(
      () => {
        const point = canvas.querySelector(`circle.cad-point[data-entity-id="${corner.id}"]`)!;
        expect(Number(point.getAttribute('cx'))).toBeCloseTo(140, 3);
        expect(Number(point.getAttribute('cy'))).toBeCloseTo(-115, 3);
      },
      { timeout: 10_000 }
    );
    expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull();
  } finally {
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', buttons: 0, clickCount: 1 });
  }
  await waitFor(() => expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull());
});
