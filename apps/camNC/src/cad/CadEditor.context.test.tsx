import { addCircle, addLine, createCadDocument, createCadPart, createPlateDocument, type CadDimension, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';
import { SKETCH_APPEARANCE } from './sketchAppearance';

const dragSolver = vi.hoisted(() => ({ wait: null as Promise<void> | null }));
vi.mock('./solveCad', async original => {
  const actual = await original<typeof import('./solveCad')>();
  return {
    ...actual,
    solveCadDocument: async (...args: Parameters<typeof actual.solveCadDocument>) => {
      const result = await actual.solveCadDocument(...args);
      await dragSolver.wait;
      return result;
    },
  };
});

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
async function setup(source = createPlateDocument()) {
  ids.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = () => change.mock.calls.at(-1)?.[0] ?? source;
  const settled = () =>
    waitFor(
      () => {
        expect(screen.queryByText(/^Checking sketch/)).toBeNull();
        expect(canvas.closest('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
      },
      { timeout: 20_000 }
    );
  await settled();
  const client = (point: { x: number; y: number }) => {
    const p = { ...point };
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      p.x = bounds.left + (p.x * bounds.width) / frame.innerWidth;
      p.y = bounds.top + (p.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    return p;
  };
  const protocol = cdp();
  const rightClick = async (element: Element) => {
    const bounds = element.getBoundingClientRect(),
      position = client({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'right', buttons: 2, clickCount: 1 });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'right', buttons: 0, clickCount: 1 });
  };
  const worldClient = (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    return { x: p.x, y: p.y };
  };
  const click = async (x: number, y: number) => {
    const p = worldClient(x, y),
      bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: p.x - bounds.left, y: p.y - bounds.top } });
  };
  const rightPan = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const start = client(worldClient(from.x, from.y)),
      end = client(worldClient(to.x, to.y));
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'right', buttons: 2, clickCount: 1 });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'right', buttons: 2 });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'right', buttons: 0, clickCount: 1 });
  };
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const start = client(worldClient(from.x, from.y)),
      end = client(worldClient(to.x, to.y));
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...end, button: 'left', buttons: 1 });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 });
  };
  return { source, canvas, latest, settled, rightClick, click, rightPan, drag };
}

describe('integrated real-pointer sketch context commands', () => {
  it.each(['body', 'input'] as const)('restores drag keyboard ownership with animation frames paused and %s focused', async focusTarget => {
    const source = createCadDocument(),
      part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 120, y2: 20 });
    source.parts.push(part);
    const line = part.sketch.entities.find(entity => entity.type === 'line')!;
    const { canvas, latest, settled, drag } = await setup(source);
    await userEvent.click(screen.getByRole('button', { name: 'Snap on' }));
    const input = screen.getByRole('textbox', { name: 'Part name' });
    const frames: FrameRequestCallback[] = [];
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => frames.push(callback));
    // A released pointer may leave focus on the body; a user-selected input must
    // keep it. Neither case should depend on a background tab rendering a frame.
    canvas.addEventListener('pointerup', () => (focusTarget === 'body' ? canvas.blur() : input.focus()), { once: true });
    try {
      await drag({ x: 120, y: 20 }, { x: 150, y: 30 });
      await settled();
      expect(latest().parts[0]!.sketch.entities.find(entity => entity.id === line.endId)).toMatchObject({
        x: expect.closeTo(150, 4),
        y: expect.closeTo(30, 4),
      });
      expect(frames.length).toBeGreaterThan(0);
      expect(document.activeElement).toBe(focusTarget === 'body' ? canvas : input);
    } finally {
      animationFrame.mockRestore();
    }
  });

  it('restores keyboard ownership after the busy workspace stops being inert without waiting for a frame', async () => {
    const source = createCadDocument(),
      part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 120, y2: 20 });
    source.parts.push(part);
    const { canvas, settled, drag } = await setup(source);
    await userEvent.click(screen.getByRole('button', { name: 'Snap on' }));
    let finish!: () => void;
    dragSolver.wait = new Promise<void>(resolve => {
      finish = resolve;
    });
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
    try {
      await drag({ x: 120, y: 20 }, { x: 150, y: 30 });
      await waitFor(() => expect(canvas.closest('.cad-workspace')!.hasAttribute('inert')).toBe(true));
      finish();
      dragSolver.wait = null;
      await settled();
      expect(document.activeElement).toBe(canvas);
    } finally {
      finish();
      dragSolver.wait = null;
      frame.mockRestore();
    }
  });

  it('changes driving/reference state, keeps references read-only, and deletes dimensions with immediate Undo', async () => {
    const { source, canvas, latest, settled, rightClick, drag } = await setup();
    const dimension = source.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    const label = () => canvas.querySelector(`[data-dimension="${dimension.id}"]`)!;
    const current = () => latest().parts[0]!.sketch.constraints.find((c): c is CadDimension => c.id === dimension.id && 'value' in c)!;
    const sourceIds = source.parts[0]!.sketch.entities.map(entity => entity.id);
    await rightClick(label());
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Change to driven dimension' }));
    await settled();
    expect(current()).toMatchObject({ driven: true, value: 120 });
    expect(label().getAttribute('aria-label')).toBe('Reference Width: 120 mm');
    await userEvent.dblClick(label());
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('textbox', { name: 'Width mm' })).toBeNull();
    await drag({ x: 120, y: 80 }, { x: 150, y: 80 });
    await settled();
    expect(current()).toMatchObject({ driven: true, value: expect.closeTo(150, 4) });
    expect(label().getAttribute('aria-label')).toBe('Reference Width: 150 mm');
    await waitFor(() => expect(document.activeElement).toBe(canvas));
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(current()).toMatchObject({ driven: true, value: 120 });
    await rightClick(label());
    expect((await screen.findByRole('menuitem', { name: 'Edit dimension' })).getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change to driving dimension' }));
    await settled();
    expect(current()).toMatchObject({ value: 120 });
    expect(current().driven).not.toBe(true);
    await rightClick(label());
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete dimension' }));
    await settled();
    expect(current()).toBeUndefined();
    expect(document.activeElement).toBe(canvas);
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(current()).toMatchObject({ id: dimension.id, value: 120 });
    expect(current().driven).not.toBe(true);
    expect(latest().parts[0]!.sketch.entities.map(entity => entity.id)).toEqual(sourceIds);
  });

  it('applies Construction and Delete to a selected group in one Undo each', async () => {
    const source = createCadDocument(),
      part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 100, y2: 20 });
    part.sketch = addLine(part.sketch, { x1: 30, y1: 70, x2: 110, y2: 70 });
    source.parts.push(part);
    const { canvas, latest, settled, rightClick } = await setup(source);
    const lines = part.sketch.entities.filter(e => e.type === 'line');
    await userEvent.keyboard('{Control>}a{/Control}');
    await rightClick(canvas.querySelector(`g.cad-entity[data-entity-id="${lines[0]!.id}"]`)!);
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Construction' }));
    await settled();
    expect(
      latest()
        .parts[0]!.sketch.entities.filter(e => e.type === 'line')
        .every(e => e.construction)
    ).toBe(true);
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(
      latest()
        .parts[0]!.sketch.entities.filter(e => e.type === 'line')
        .some(e => e.construction)
    ).toBe(false);
    await userEvent.keyboard('{Control>}a{/Control}');
    await rightClick(canvas.querySelector(`g.cad-entity[data-entity-id="${lines[0]!.id}"]`)!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete sketch entities' }));
    await settled();
    expect(latest().parts[0]!.sketch.entities.filter(e => e.type === 'line')).toHaveLength(0);
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(
      latest()
        .parts[0]!.sketch.entities.filter(e => e.type === 'line')
        .map(e => e.id)
    ).toEqual(lines.map(e => e.id));
  });

  it('opens the selected entity menu by Shift+F10 and keeps right-drag panning separate from context clicks', async () => {
    const { canvas, latest, source, click, rightPan } = await setup();
    await click(60, 0);
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    expect(await screen.findByRole('menu', { name: 'Sketch geometry menu' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(canvas));
    const view = canvas.getAttribute('viewBox');
    await rightPan({ x: 150, y: 100 }, { x: 175, y: 110 });
    await waitFor(() => expect(canvas.getAttribute('viewBox')).not.toBe(view));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(latest()).toEqual(source);
  });

  it('colors a fully constrained rectangle black beside a free blue circle using native per-entity results', async () => {
    const source = createPlateDocument();
    source.parts[0]!.sketch = addCircle(source.parts[0]!.sketch, { x: 180, y: 80, radius: 15 });
    const { canvas } = await setup(source);
    const line = source.parts[0]!.sketch.entities.find(e => e.type === 'line')!,
      circle = source.parts[0]!.sketch.entities.find(e => e.type === 'circle')!;
    const group = (id: string) => canvas.querySelector(`g.cad-entity[data-entity-id="${id}"]`)!;
    expect(group(line.id).getAttribute('data-constraint-status')).toBe('fully-constrained');
    expect(group(line.id).lastElementChild!.getAttribute('stroke')).toBe(SKETCH_APPEARANCE.constrainedColor);
    expect(group(circle.id).getAttribute('data-constraint-status')).toBe('underconstrained');
    expect(group(circle.id).lastElementChild!.getAttribute('stroke')).toBe(SKETCH_APPEARANCE.freeColor);
  });

  it('resizes a driven-diameter circle from its body but translates the same circle when its size is driving', async () => {
    const source = createCadDocument(),
      part = createCadPart();
    part.sketch = addCircle(part.sketch, { x: 70, y: 60, radius: 15, dimensioned: true });
    source.parts.push(part);
    const dimension = part.sketch.constraints.find(c => c.type === 'diameter')!;
    const { canvas, latest, settled, rightClick, drag } = await setup(source);
    await userEvent.click(screen.getByRole('button', { name: 'Snap on' }));
    const circle = () => latest().parts[0]!.sketch.entities.find(e => e.type === 'circle')!;
    const label = () => canvas.querySelector(`[data-dimension="${dimension.id}"]`)!;
    const center = () => latest().parts[0]!.sketch.entities.find(e => e.id === circle().centerId)!;
    await rightClick(label());
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Change to driven dimension' }));
    await settled();
    await drag({ x: 85, y: 60 }, { x: 95, y: 60 });
    await settled();
    expect(circle().radius).toBeCloseTo(25, 1);
    expect(center()).toMatchObject({ x: expect.closeTo(70, 3), y: expect.closeTo(60, 3) });
    expect(latest().parts[0]!.sketch.constraints.find(c => c.id === dimension.id)).toMatchObject({
      driven: true,
      value: expect.closeTo(50, 1),
    });
    await waitFor(() => expect(document.activeElement).toBe(canvas));
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(circle().radius).toBe(15);
    await rightClick(label());
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Change to driving dimension' }));
    await settled();
    await drag({ x: 85, y: 60 }, { x: 95, y: 60 });
    await settled();
    expect(circle().radius).toBe(15);
    expect(center()).toMatchObject({ x: expect.closeTo(80, 1), y: expect.closeTo(60, 1) });
  });

  it('blocks Finish while thickness text is invalid and restores it when Escape resets the field', async () => {
    await setup();
    const input = screen.getByRole('textbox', { name: 'Thickness' });
    await userEvent.dblClick(input);
    await userEvent.keyboard('0{Enter}');
    expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false));
  });
});
