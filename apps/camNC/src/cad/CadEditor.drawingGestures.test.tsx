import { createCadDocument, createCadPart, type CadDocument, type CadPoint } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});

async function setup() {
  const source = createCadDocument();
  source.parts.push(createCadPart());
  ids.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? source.parts[0]!.sketch;
  const settled = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  await settled();
  await userEvent.click(screen.getByRole('button', { name: 'Snap on' }));
  const click = async (x: number, y: number) => {
    const point = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    const bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: point.x - bounds.left, y: point.y - bounds.top } });
  };
  const client = (x: number, y: number) => {
    const point = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      point.x = bounds.left + (point.x * bounds.width) / frame.innerWidth;
      point.y = bounds.top + (point.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    return { x: point.x, y: point.y };
  };
  const mouse = cdp();
  const press = async (point: CadPoint) => {
    const position = client(point.x, point.y);
    await mouse.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
    await mouse.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', buttons: 1, clickCount: 1 });
  };
  const move = (point: CadPoint) =>
    mouse.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...client(point.x, point.y), button: 'left', buttons: 1 });
  const release = (point: CadPoint) =>
    mouse.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...client(point.x, point.y),
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  return { canvas, latest, settled, click, press, move, release };
}

describe('real press-drag-release primitive creation', () => {
  it.each([
    { key: 'l', tool: 'Line (L)', count: 1 },
    { key: 'g', tool: 'Corner rectangle (G)', count: 4 },
    { key: 'c', tool: 'Circle (C)', count: 1 },
  ])('completes $tool on release, leaves the tool armed, and undoes the shape once', async ({ key, tool, count }) => {
    const { canvas, latest, settled, press, move, release } = await setup();
    await userEvent.keyboard(key);
    await press({ x: 20, y: 20 });
    await move({ x: 100, y: 70 });
    expect(latest().entities.filter(entity => entity.type !== 'point')).toHaveLength(0);
    await release({ x: 100, y: 70 });
    await settled();
    const shapes = latest().entities.filter(entity => entity.type !== 'point');
    expect(shapes).toHaveLength(count);
    expect(screen.getByRole('button', { name: tool }).getAttribute('aria-pressed')).toBe('true');
    if (key === 'l') {
      const line = shapes[0]!;
      if (line.type !== 'line') throw Error();
      expect(latest().entities.find(entity => entity.id === line.startId)).toMatchObject({
        x: expect.closeTo(20, 1),
        y: expect.closeTo(20, 1),
      });
      expect(latest().entities.find(entity => entity.id === line.endId)).toMatchObject({
        x: expect.closeTo(100, 1),
        y: expect.closeTo(70, 1),
      });
    } else {
      expect(screen.queryByRole('textbox', { name: key === 'c' ? 'Circle radius' : 'Rectangle width' })).toBeNull();
      expect(canvas.querySelectorAll('.cad-preview')).toHaveLength(0);
    }
    expect(document.activeElement).toBe(canvas);
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(latest().entities.filter(entity => entity.type !== 'point')).toHaveLength(0);
    expect(latest().constraints).toHaveLength(0);
    await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    await settled();
    expect(latest().entities.filter(entity => entity.type !== 'point')).toHaveLength(count);
  });

  it.each([
    { key: 'g', count: 8 },
    { key: 'c', count: 2 },
  ])('starts the next $key shape cleanly after release without a stuck preview', async ({ key, count }) => {
    const { canvas, latest, settled, press, move, release } = await setup();
    await userEvent.keyboard(key);
    for (const [start, end] of [
      [
        { x: 20, y: 20 },
        { x: 60, y: 50 },
      ],
      [
        { x: 120, y: 30 },
        { x: 140, y: 55 },
      ],
    ]) {
      await press(start!);
      await move(end!);
      await release(end!);
      await settled();
    }
    expect(latest().entities.filter(entity => entity.type !== 'point')).toHaveLength(count);
    expect(canvas.querySelectorAll('.cad-preview')).toHaveLength(0);
  });

  it('continues a drag-created line from its released endpoint and preserves ordinary click-click creation', async () => {
    const { latest, settled, click, press, move, release } = await setup();
    await userEvent.keyboard('l');
    await press({ x: 20, y: 20 });
    await move({ x: 80, y: 45 });
    await release({ x: 80, y: 45 });
    await settled();
    await click(130, 70);
    await settled();
    const lines = latest().entities.filter(entity => entity.type === 'line');
    expect(lines).toHaveLength(2);
    expect(lines[1]!.startId).toBe(lines[0]!.endId);
    await userEvent.keyboard('{Escape}');
    await click(150, 20);
    expect(latest().entities.filter(entity => entity.type === 'line')).toHaveLength(2);
    await click(180, 50);
    await settled();
    expect(latest().entities.filter(entity => entity.type === 'line')).toHaveLength(3);
  });

  it('cancels a held drawing drag with Escape and ignores its later release', async () => {
    const { canvas, latest, click, press, move, release } = await setup();
    await userEvent.keyboard('c');
    await press({ x: 30, y: 30 });
    await move({ x: 80, y: 60 });
    await userEvent.keyboard('{Escape}');
    await release({ x: 80, y: 60 });
    expect(latest().entities.filter(entity => entity.type !== 'point')).toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: 'Circle radius' })).toBeNull();
    expect(canvas.querySelectorAll('.cad-preview')).toHaveLength(0);
    await click(100, 40);
    expect(latest().entities.filter(entity => entity.type !== 'point')).toHaveLength(0);
    expect(screen.getByRole('textbox', { name: 'Circle radius' })).toBeTruthy();
  });

  it('owns the drawing release outside the canvas through pointer capture and leaves no circle preview', async () => {
    const { canvas, latest, settled, press, move, release } = await setup();
    await userEvent.keyboard('c');
    const bounds = canvas.getBoundingClientRect();
    const raw = new DOMPoint(bounds.right + 12, bounds.y + bounds.height / 2).matrixTransform(canvas.getScreenCTM()!.inverse());
    const end = { x: raw.x, y: -raw.y };
    await press({ x: 30, y: 30 });
    await move(end);
    await release(end);
    await settled();
    expect(latest().entities.filter(entity => entity.type === 'circle')).toHaveLength(1);
    expect(canvas.querySelectorAll('.cad-preview')).toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: 'Circle radius' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Circle (C)' }).getAttribute('aria-pressed')).toBe('true');
  });
});
