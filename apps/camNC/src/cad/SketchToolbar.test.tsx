import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { SketchToolbar } from './SketchToolbar';
import { sketchTools as tools, type SketchTool } from './sketchTools';
import { userEvent } from '@vitest/browser/context';
import './cad.css';

afterEach(cleanup);
function setup(width = 800) {
  const onTool = vi.fn(),
    onConstraint = vi.fn(),
    onReturnToCanvas = vi.fn();
  function Harness({ width }: { width: number }) {
    const [tool, setTool] = useState<SketchTool>('select');
    return (
      <div className="cad-editor" style={{ width }}>
        <SketchToolbar
          tools={tools}
          tool={tool}
          construction={false}
          constraintMode={null}
          busy={false}
          canUndo={false}
          canRedo={false}
          canFinish={true}
          onTool={tool => {
            setTool(tool);
            onTool(tool);
          }}
          onConstraint={onConstraint}
          onReturnToCanvas={onReturnToCanvas}
          onConstruction={() => {}}
          onFix={() => {}}
          onUndo={() => {}}
          onRedo={() => {}}
          onCancel={() => {}}
          onFinish={() => {}}
        />
      </div>
    );
  }
  const view = render(<Harness width={width} />);
  return { onTool, onConstraint, onReturnToCanvas, resize: (width: number) => view.rerender(<Harness width={width} />) };
}
describe('compact sketch toolbar', () => {
  it('fits drawing and sketch actions in one 40px row at the current panel width', () => {
    const { onTool } = setup();
    const toolbar = screen.getByRole('toolbar', { name: 'Sketch toolbar' });
    const bounds = toolbar.getBoundingClientRect();
    expect(bounds.height).toBe(40);
    for (const button of toolbar.querySelectorAll('button')) {
      const rect = button.getBoundingClientRect();
      expect(rect.width).toBe(button.classList.contains('cad-tool-picker') ? 16 : 32);
      expect(rect.height).toBe(32);
      expect(rect.top).toBeCloseTo(bounds.top + 3.5, 0);
    }
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
    expect(screen.getByRole('button', { name: '✓ Finish sketch' }).textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Drawing tools' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Line (L)' }));
    expect(onTool).toHaveBeenCalledWith('line');
  });

  it('keeps constraint names and shortcuts available from the compact menu', async () => {
    const { onConstraint, onReturnToCanvas } = setup();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Constraints' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const horizontal = await screen.findByRole('menuitem', { name: 'horizontal' });
    fireEvent.click(horizontal);
    expect(onConstraint).toHaveBeenCalledWith('horizontal');
    await waitFor(() => expect(onReturnToCanvas).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
  });
  it('groups genuine drawing variants and remembers the chosen drawing and modify primary independently', async () => {
    const { onTool } = setup(480);
    await waitFor(() => expect(screen.getByRole('toolbar').getAttribute('data-toolbar-layout')).toBe('compact'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Drawing tools' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    expect(await screen.findByRole('menuitem', { name: 'Corner rectangle (G)' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Tangent arc (Shift+A)' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Spline' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Bezier' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Conic' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Conic' }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Modify tools' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Trim (M)' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Trim (M)' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Conic' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Conic' }));
    expect(onTool).toHaveBeenLastCalledWith('conic');
    expect(screen.getByRole('button', { name: 'Trim (M)' })).toBeTruthy();
  });

  it.each([955, 1280, 1920])('keeps separate native tool families on one row at %ipx', width => {
    setup(width);
    const toolbar = screen.getByRole('toolbar');
    expect(toolbar.getAttribute('data-toolbar-layout')).toBe('families');
    for (const label of ['Rectangle tools', 'Arc tools', 'Spline tools']) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    for (const label of ['Line (L)', 'Circle (C)', 'Point (Shift+S)', 'Sketch fillet (Shift+F)', 'Trim (M)'])
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Drawing tools' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Modify tools' })).toBeNull();
    expect(toolbar.getBoundingClientRect().height).toBe(40);
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
    expect(toolbar.querySelector('.cad-drawing-tools')!.scrollWidth).toBeLessThanOrEqual(
      toolbar.querySelector('.cad-drawing-tools')!.clientWidth
    );
  });

  it('remembers each family independently across keyboard activation and compact/wide resizing', async () => {
    const { onTool, resize } = setup(955);
    screen.getByRole('button', { name: 'Arc tools' }).focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(await screen.findByRole('menuitem', { name: 'Conic' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Spline' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Arc (A)' })));
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Conic' })));
    await userEvent.keyboard('{Enter}');
    expect(onTool).toHaveBeenLastCalledWith('conic');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Conic' }).getAttribute('aria-pressed')).toBe('true'));
    await userEvent.click(screen.getByRole('button', { name: 'Rectangle tools' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Center rectangle (R)' }));
    expect(onTool).toHaveBeenLastCalledWith('centerRectangle');
    expect(screen.getByRole('button', { name: 'Conic' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Center rectangle (R)' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Point (Shift+S)' }));
    resize(480);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Drawing tools' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Point (Shift+S)' }).getAttribute('aria-pressed')).toBe('true');
    resize(955);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Arc tools' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Drawing tools' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Conic' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Center rectangle (R)' })).toBeTruthy();
  });
});
