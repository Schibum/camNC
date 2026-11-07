import { addCircle, addConstraint, addLine, createCadPart, type CadSketch } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { useEffect, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DimensionGraphics } from './DimensionGraphics';
import { SketchContextMenu } from './SketchContextMenu';
import { createSketchContext, pickSketchContextTarget, type SketchContext, type SketchContextSelection } from './sketchContext';

afterEach(cleanup);
function fixture(driven = false) {
  let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 30, x2: 100, y2: 30 });
  const line = sketch.entities.at(-1)!;
  sketch = addCircle(sketch, { x: 140, y: 80, radius: 15 });
  const circle = sketch.entities.at(-1)!;
  sketch = addConstraint(sketch, { type: 'diameter', entityId: circle.id, value: 30, labelPosition: { x: 170, y: 120 }, driven });
  return { sketch, line, circle, dimension: sketch.constraints.at(-1)! };
}

function setup(source = fixture(), initialSelection: SketchContextSelection = { entityIds: [], constraintIds: [] }) {
  const action = vi.fn(),
    canvasKeys = vi.fn(),
    returnFocus = vi.fn();
  function Harness() {
    const canvas = useRef<SVGSVGElement>(null),
      input = useRef<HTMLInputElement>(null);
    const [context, setContext] = useState<SketchContext | null>(null);
    const [selection, setSelection] = useState(initialSelection);
    const [editing, setEditing] = useState(false);
    useEffect(() => {
      if (editing) input.current?.focus();
    }, [editing]);
    return (
      <div onKeyDown={canvasKeys}>
        <svg
          ref={canvas}
          tabIndex={0}
          width="600"
          height="450"
          style={{ maxWidth: '100%' }}
          viewBox="0 -150 200 150"
          data-testid="canvas"
          onContextMenu={event => {
            event.preventDefault();
            const matrix = canvas.current!.getScreenCTM()!;
            const target = pickSketchContextTarget(
              source.sketch,
              { x: event.clientX, y: event.clientY },
              {
                project: point => {
                  const p = new DOMPoint(point.x, -point.y).matrixTransform(matrix);
                  return { x: p.x, y: p.y };
                },
                targetDimensionId: (event.target as Element).closest('[data-dimension]')?.getAttribute('data-dimension') ?? undefined,
                targetEntityId: (event.target as Element).closest('[data-entity-id]')?.getAttribute('data-entity-id') ?? undefined,
              }
            );
            const next = createSketchContext(source.sketch, target, { x: event.clientX, y: event.clientY }, selection);
            setSelection(next);
            setContext(next);
          }}>
          {source.sketch.entities.map(entity =>
            entity.type === 'line' ? (
              <line key={entity.id} data-entity-id={entity.id} x1={20} y1={-30} x2={100} y2={-30} stroke="blue" strokeWidth={2} />
            ) : entity.type === 'circle' ? (
              <circle key={entity.id} data-entity-id={entity.id} cx={140} cy={-80} r={15} stroke="blue" fill="none" />
            ) : null
          )}
          <DimensionGraphics
            constraint={source.dimension as Extract<CadSketch['constraints'][number], { value: number }>}
            sketch={source.sketch}
            pixelScale={3}
          />
        </svg>
        <input aria-label="Outside input" />
        {editing && <input ref={input} aria-label="Dimension value" defaultValue="30" />}
        <output data-testid="selection">
          {selection.entityIds.join(',')}|{selection.constraintIds.join(',')}
        </output>
        <SketchContextMenu
          sketch={source.sketch}
          context={context}
          onClose={() => setContext(null)}
          onAction={(command, context) => {
            action(command, context);
            if (command === 'edit-dimension') setEditing(true);
          }}
          onReturnToCanvas={() => {
            returnFocus();
            canvas.current?.focus();
          }}
        />
      </div>
    );
  }
  render(<Harness />);
  const canvas = screen.getByTestId('canvas') as unknown as SVGSVGElement;
  const rightClick = async (x: number, y: number) => {
    const point = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      point.x = bounds.left + (point.x * bounds.width) / frame.innerWidth;
      point.y = bounds.top + (point.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    const protocol = cdp(),
      position = { x: point.x, y: point.y };
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'right', buttons: 2, clickCount: 1 });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'right', buttons: 0, clickCount: 1 });
  };
  return { ...source, canvas, action, canvasKeys, returnFocus, rightClick };
}

describe('real pointer sketch context menu', () => {
  it('selects the right-clicked geometry, dispatches Construction, and restores canvas focus', async () => {
    const { line, canvas, action, rightClick } = setup();
    await rightClick(60, 30);
    expect(await screen.findByRole('menu', { name: 'Sketch geometry menu' })).toBeTruthy();
    expect(screen.getByTestId('selection').textContent).toBe(`${line.id}|`);
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Construction' }));
    expect(action).toHaveBeenCalledWith('construction', expect.objectContaining({ entityIds: [line.id], constraintIds: [] }));
    await waitFor(() => expect(document.activeElement).toBe(canvas));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('preserves selected geometry groups and supports menu keyboard navigation without sketch shortcuts firing', async () => {
    const source = fixture();
    const { canvas, canvasKeys, action, rightClick } = setup(source, { entityIds: [source.line.id, source.circle.id], constraintIds: [] });
    await rightClick(60, 30);
    expect(await screen.findByRole('menuitem', { name: 'Delete sketch entities' })).toBeTruthy();
    canvasKeys.mockClear();
    await userEvent.keyboard('{End}{Enter}');
    expect(action).toHaveBeenCalledWith('fit-selection', expect.objectContaining({ entityIds: [source.line.id, source.circle.id] }));
    expect(canvasKeys).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(canvas));
  });

  it('opens the dimension-specific menu and preserves the newly opened value editor focus', async () => {
    const { dimension, action, rightClick } = setup();
    await rightClick(170, 120);
    expect(await screen.findByRole('menu', { name: 'Sketch dimension menu' })).toBeTruthy();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Construction' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit dimension' }));
    expect(action).toHaveBeenCalledWith('edit-dimension', expect.objectContaining({ constraintIds: [dimension.id], entityIds: [] }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Dimension value' })));
  });

  it('offers driving conversion for a reference and disables direct value editing', async () => {
    const { action, rightClick } = setup(fixture(true));
    await rightClick(170, 120);
    const edit = await screen.findByRole('menuitem', { name: 'Edit dimension' });
    expect(edit.getAttribute('aria-disabled')).toBe('true');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Change to driving dimension' }));
    expect(action.mock.calls.at(-1)?.[0]).toBe('toggle-driven');
  });

  it('closes with Escape without sending Escape to CAD or changing the source', async () => {
    const { canvas, canvasKeys, action, rightClick } = setup();
    await rightClick(60, 30);
    await screen.findByRole('menu');
    canvasKeys.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(action).not.toHaveBeenCalled();
    expect(canvasKeys).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(canvas));
  });

  it('light-dismisses without stealing focus from the outside input', async () => {
    const { rightClick } = setup();
    await rightClick(60, 30);
    await screen.findByRole('menu');
    const input = screen.getByRole('textbox', { name: 'Outside input' });
    await userEvent.click(input);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(input);
  });

  it('shows safe blank-space view commands and clamps the portal to the viewport edge', async () => {
    const source = fixture();
    render(
      <SketchContextMenu
        sketch={source.sketch}
        context={createSketchContext(
          source.sketch,
          { kind: 'blank' },
          { x: window.innerWidth - 3, y: window.innerHeight - 3 },
          { entityIds: [], constraintIds: [] }
        )}
        onClose={() => {}}
        onAction={() => {}}
        onReturnToCanvas={() => {}}
      />
    );
    const menu = await screen.findByRole('menu', { name: 'Sketch menu' });
    await waitFor(() => {
      const bounds = menu.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    });
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Clear selection' }).getAttribute('aria-disabled')).toBe('true');
  });
});
