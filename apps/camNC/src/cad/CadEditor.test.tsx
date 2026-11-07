import {
  addCircle,
  addConstraint,
  addLine,
  addPoint,
  addRectangle,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  originId,
  resolveDimensionPlacement,
  type CadDimension,
  type CadDocument,
} from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from '@vitest/browser/context';
import { CadEditor } from './CadEditor';
import { isCadEditorActive } from './keyboardOwnership';
import { endCadSession } from './session';
import { setDemoModeForTest } from '@/lib/demo/demo-mode';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
function setup(document = createPlateDocument()) {
  ids.push(document.id);
  const change = vi.fn<(document: CadDocument) => void>(),
    finish = vi.fn(),
    cancel = vi.fn();
  const result = render(
    <div style={{ height: 700 }}>
      <CadEditor document={document} onDraftChange={change} onFinish={finish} onCancel={cancel} saveStatus="Saved" />
    </div>
  );
  // Synthetic pointer events have no browser-owned pointer to capture; Playwright covers real capture.
  vi.spyOn(result.getByTestId('cad-canvas'), 'setPointerCapture').mockImplementation(() => {});
  return { document, change, finish, cancel, ...result };
}
function clickWorld(x: number, y: number) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const point = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerDown(canvas, { clientX: point.x, clientY: point.y, button: 0, pointerId: 1 });
}

function selectEntities(ids: string[]) {
  const canvas = screen.getByTestId('cad-canvas');
  ids.forEach(id => {
    const entity = canvas.querySelector(`[data-entity-id="${id}"]`)!;
    const marker = entity.querySelector<SVGCircleElement>('circle.cad-point'),
      curve = entity.querySelector<SVGGeometryElement>('[data-visible-curve]'),
      shape = marker ?? curve!;
    // A DOM target alone cannot identify an operand: measured picking uses the
    // real screen position. Read the currently rendered (possibly solved) pose.
    const at = marker
      ? new DOMPoint(marker.cx.baseVal.value, marker.cy.baseVal.value)
      : curve!.getPointAtLength(curve!.getTotalLength() / 2);
    const position = new DOMPoint(at.x, at.y).matrixTransform(shape.getScreenCTM()!);
    fireEvent.pointerDown(shape, { button: 0, shiftKey: true, clientX: position.x, clientY: position.y, pointerId: 1 });
    fireEvent.pointerUp(canvas, { button: 0, clientX: position.x, clientY: position.y, pointerId: 1 });
  });
}
describe('integrated sketch editor', () => {
  it('selects inline relations and deletes them without deleting their geometry, with one Undo', async () => {
    const { document, change } = setup();
    const canvas = screen.getByTestId('cad-canvas');
    const original = document.parts[0]!.sketch;
    const first = original.constraints[0]!,
      second = original.constraints[1]!;
    fireEvent.click(canvas.querySelector(`[data-constraint-id="${first.id}"]`)!);
    fireEvent.click(canvas.querySelector(`[data-constraint-id="${second.id}"]`)!, { shiftKey: true });
    fireEvent.keyDown(canvas, { key: 'Delete' });
    const removed = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    expect(removed.entities).toEqual(original.entities);
    expect(removed.constraints.map(c => c.id)).not.toContain(first.id);
    expect(removed.constraints.map(c => c.id)).not.toContain(second.id);
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints).toEqual(original.constraints);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show constraints' }));
    expect(canvas.querySelector('[data-inline-constraint]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit Width: 120 mm' })).toBeTruthy();
  });

  it('deletes a selected dimension and immediately undoes it without losing keyboard focus', () => {
    const { document, change } = setup();
    const canvas = screen.getByTestId('cad-canvas');
    const label = screen.getByRole('button', { name: 'Edit Width: 120 mm' });
    label.focus();
    fireEvent.click(label);
    expect(screen.queryByRole('textbox', { name: 'Width mm' })).toBeNull();
    fireEvent.keyDown(label, { key: 'Delete' });
    expect(window.document.activeElement).toBe(canvas);
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.some(c => c.label === 'Width')).toBe(false);
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities).toEqual(document.parts[0]!.sketch.entities);
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints).toEqual(document.parts[0]!.sketch.constraints);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
    const input = screen.getByRole('textbox', { name: 'Width mm' });
    expect(window.document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '150' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints).toEqual(document.parts[0]!.sketch.constraints);
  });

  it('moves a dimension annotation without changing its value or geometry, and undoes the move once', async () => {
    const { document, change } = setup();
    // This is worker readiness, not the annotation's behavior or a performance assertion.
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    const label = screen.getByRole('button', { name: 'Edit Width: 120 mm' });
    const rect = label.getBoundingClientRect();
    vi.spyOn(label, 'setPointerCapture').mockImplementation(() => {});
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    fireEvent.pointerDown(label, { clientX: start.x, clientY: start.y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: start.x + 48, clientY: start.y - 32, pointerId: 1 });
    expect(change).not.toHaveBeenCalled();
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    const moved = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    expect(moved.entities).toEqual(document.parts[0]!.sketch.entities);
    const dimension = moved.constraints.find((c): c is CadDimension => 'value' in c && c.label === 'Width')!;
    expect(dimension).toMatchObject({ value: 120 });
    expect(dimension.labelPlacement).toBeDefined();
    expect(dimension.labelPosition).toBeUndefined();
    expect(resolveDimensionPlacement(moved, dimension)).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    expect(moved.constraints.filter(c => c.id !== dimension.id)).toEqual(
      document.parts[0]!.sketch.constraints.filter(c => c.id !== dimension.id)
    );
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints).toEqual(document.parts[0]!.sketch.constraints);
  }, 30_000);

  it('cancels an annotation drag with Escape without creating an undo command', async () => {
    setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
    const canvas = screen.getByTestId('cad-canvas');
    const label = screen.getByRole('button', { name: 'Edit Width: 120 mm' });
    const before = label.querySelector('text')!.getAttribute('x');
    vi.spyOn(label, 'setPointerCapture').mockImplementation(() => {});
    const rect = label.getBoundingClientRect();
    const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    fireEvent.pointerDown(label, { clientX: start.x, clientY: start.y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: start.x + 48, clientY: start.y - 32, pointerId: 1 });
    expect(screen.getByRole('button', { name: 'Edit Width: 120 mm' }).querySelector('text')!.getAttribute('x')).not.toBe(before);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Edit Width: 120 mm' }).querySelector('text')!.getAttribute('x')).toBe(before);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('textbox', { name: 'Width mm' })).toBeNull();
  }, 30_000);

  it('removes a fixed-point glyph by unfixing that point while retaining the permanent origin', () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addPoint(part.sketch, { x: 20, y: 20 });
    const point = part.sketch.entities.at(-1)!;
    if (point.type === 'point') point.fixed = true;
    document.parts.push(part);
    const { change } = setup(document);
    fireEvent.click(screen.getByRole('button', { name: 'Fixed point constraint' }));
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'Delete' });
    const points = change.mock.calls.at(-1)![0].parts[0]!.sketch.entities;
    expect(points).toContainEqual(expect.objectContaining({ id: point.id, fixed: false }));
    expect(points).toContainEqual(expect.objectContaining({ x: 0, y: 0, fixed: true }));
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'z', ctrlKey: true });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities).toContainEqual(expect.objectContaining({ id: point.id, fixed: true }));
  });

  it('edits a driving dimension, undoes after leaving and returning, and cancels to the entry checkpoint', async () => {
    const { document, change, cancel, unmount } = setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
    fireEvent.change(screen.getByLabelText('Width mm'), { target: { value: '160' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
    await waitFor(() =>
      expect(change.mock.calls.at(-1)?.[0].parts[0]!.sketch.constraints.find(c => c.label === 'Width')).toMatchObject({ value: 160 })
    );
    const draft = change.mock.calls.at(-1)![0];
    expect(draft.parts[0]!.id).toBe(document.parts[0]!.id);
    unmount();
    render(
      <div style={{ height: 700 }}>
        <CadEditor document={draft} onDraftChange={change} onFinish={() => {}} onCancel={cancel} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    await waitFor(() =>
      expect(change.mock.calls.at(-1)?.[0].parts[0]!.sketch.constraints.find(c => c.label === 'Width')).toMatchObject({ value: 120 })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Redo (Ctrl or Command Shift Z)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(change.mock.calls.at(-1)?.[0].parts[0]!.sketch.constraints.find(c => c.label === 'Width')).toMatchObject({ value: 120 });
  }, 30_000);

  it('draws a dimensioned plate and circular cutout using numeric creation, then finishes the same document', async () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { finish, change } = setup(document);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'g' });
    clickWorld(0, 0);
    fireEvent.change(screen.getByLabelText('Rectangle width'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Rectangle height'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'c' });
    clickWorld(30, 30);
    fireEvent.change(screen.getByLabelText('Circle radius'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
    fireEvent.click(screen.getByRole('button', { name: /Finish sketch/ }));
    await waitFor(() => expect(finish).toHaveBeenCalledOnce());
    const accepted = finish.mock.calls[0]![0] as CadDocument;
    expect(accepted.id).toBe(document.id);
    expect(accepted.parts[0]!.sketch.entities.filter(e => e.type === 'line')).toHaveLength(4);
    expect(accepted.parts[0]!.sketch.entities.filter(e => e.type === 'circle')).toHaveLength(1);
    expect(change).toHaveBeenCalled();
  }, 30_000);

  it('owns keyboard input, leaves fields alone, and cancels an unfinished gesture without adding undo', async () => {
    setup();
    expect(isCadEditorActive()).toBe(true);
    const machineKey = vi.fn();
    window.addEventListener('keydown', machineKey);
    try {
      const input = screen.getByLabelText('Part name');
      fireEvent.keyDown(input, { key: 'l' });
      fireEvent.keyDown(input, { key: 'ArrowRight' });
      expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
      expect(machineKey).not.toHaveBeenCalled();
      const canvas = screen.getByTestId('cad-canvas');
      fireEvent.keyDown(canvas, { key: 'g' });
      clickWorld(20, 20);
      expect(screen.getByLabelText('Rectangle width')).toBeTruthy();
      fireEvent.keyDown(canvas, { key: 'Escape' });
      expect(screen.queryByLabelText('Rectangle width')).toBeNull();
      expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
      fireEvent.keyDown(canvas, { key: 'Escape' });
      expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByText('Click geometry to select. Drag to move. Shift-click adds to selection.')).toBeTruthy();
      fireEvent.keyDown(canvas, { key: 'r' });
      expect(screen.getByRole('button', { name: 'Center rectangle (R)' }).getAttribute('aria-pressed')).toBe('true');
    } finally {
      window.removeEventListener('keydown', machineKey);
    }
  });

  it('uses R for a centered rectangle with exact numeric sizes', async () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { change } = setup(document);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'r' });
    clickWorld(50, 40);
    fireEvent.change(screen.getByLabelText('Rectangle width'), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText('Rectangle height'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
    const points = change.mock.calls.at(-1)![0].parts[0]!.sketch.entities.filter(e => e.type === 'point' && !e.fixed);
    expect(points).toEqual(expect.arrayContaining([expect.objectContaining({ x: 10, y: 20 }), expect.objectContaining({ x: 90, y: 60 })]));
  }, 30_000);

  it('retains editable conflicting constraints and recovers when the conflicting relation is removed', async () => {
    const { change } = setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
    const line = screen.getByTestId('cad-canvas').querySelector('[data-entity-id] line')!;
    selectEntities([line.closest('[data-entity-id]')!.getAttribute('data-entity-id')!]);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'v' });
    await screen.findByText('Conflicting constraints', undefined, { timeout: 20_000 });
    expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(true);
    const conflictId = change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)!.id;
    fireEvent.click(screen.getByTestId('cad-canvas').querySelector(`[data-constraint-id="${conflictId}"]`)!);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'Delete' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
  }, 30_000);

  it('keeps a new open contour as an editable draft and blocks Finish', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 60 });
    document.parts.push(part);
    setup(document);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'l' });
    clickWorld(150, 50);
    clickWorld(170, 50);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'Escape' });
    await screen.findByText('Sketch in progress', undefined, { timeout: 20_000 });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(true);
  }, 30_000);
  it('supports constraint shortcuts and ignores them while editing a field', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 10, y1: 10, x2: 50, y2: 20 });
    part.sketch = addLine(part.sketch, { x1: 10, y1: 40, x2: 60, y2: 50 });
    document.parts.push(part);
    const lines = part.sketch.entities.filter(e => e.type === 'line');
    const { change } = setup(document);
    selectEntities([lines[0]!.id]);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'h' });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)).toMatchObject({ type: 'horizontal', entityId: lines[0]!.id });
    const count = change.mock.calls.length;
    fireEvent.keyDown(screen.getByLabelText('Part name'), { key: 'v' });
    fireEvent.keyDown(screen.getByLabelText('Part name'), { key: 'J', shiftKey: true });
    expect(change.mock.calls.length).toBe(count);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: ' ' });
    selectEntities(lines.map(e => e.id));
    for (const [key, shiftKey, type] of [
      ['b', false, 'parallel'],
      ['e', false, 'equal'],
      ['L', true, 'perpendicular'],
    ] as const) {
      fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key, shiftKey });
      expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)?.type).toBe(type);
    }
  });

  it('creates an angle for two selected lines and horizontal/vertical point distances', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 40, y2: 0 });
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 0, y2: 30 });
    document.parts.push(part);
    const { change } = setup(document);
    const lines = part.sketch.entities.filter(e => e.type === 'line');
    selectEntities(lines.map(e => e.id));
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'd' });
    expect(screen.queryByLabelText('Angle degrees')).toBeNull();
    expect((change.mock.calls.at(-1)?.[0] ?? document).parts[0]!.sketch.constraints.some(c => c.type === 'angle')).toBe(false);
    clickWorld(70, 70);
    fireEvent.change(await screen.findByLabelText('Angle degrees', {}, { timeout: 20_000 }), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)).toMatchObject({ type: 'angle', value: 45 });
    await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'Escape' });
    const points = part.sketch.entities.filter(e => e.type === 'point' && !e.fixed);
    fireEvent.click(screen.getByRole('button', { name: 'Dimension (D)' }));
    fireEvent.change(screen.getByLabelText('Dimension type'), { target: { value: 'distanceX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select (Esc)' }));
    selectEntities(points.map(e => e.id));
    fireEvent.click(screen.getByRole('button', { name: 'Select (Esc)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dimension (D)' }));
    clickWorld(80, -20);
    fireEvent.click(await screen.findByRole('button', { name: 'Apply dimension' }, { timeout: 20_000 }));
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)).toMatchObject({ type: 'distanceX' });
    await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
    fireEvent.change(screen.getByLabelText('Dimension type'), { target: { value: 'distanceY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Select (Esc)' }));
    selectEntities(points.map(e => e.id));
    fireEvent.click(screen.getByRole('button', { name: 'Dimension (D)' }));
    clickWorld(90, 50);
    fireEvent.click(await screen.findByRole('button', { name: 'Apply dimension' }, { timeout: 20_000 }));
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)).toMatchObject({ type: 'distanceY' });
  });

  it('fixes selected geometry in one undo step and never unfixes the origin', () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 40, y2: 10 });
    document.parts.push(part);
    const { change } = setup(document);
    const line = part.sketch.entities.find(e => e.type === 'line')!;
    selectEntities([line.id]);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'J', shiftKey: true });
    expect(
      change.mock.calls
        .at(-1)![0]
        .parts[0]!.sketch.entities.filter(e => e.type === 'point')
        .every(e => e.type === 'point' && e.fixed)
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities.filter(e => e.type === 'point' && e.fixed)).toHaveLength(1);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'J', shiftKey: true });
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'J', shiftKey: true });
    const fixed = change.mock.calls.at(-1)![0].parts[0]!.sketch.entities.filter(e => e.type === 'point' && e.fixed);
    expect(fixed).toHaveLength(1);
    expect(fixed[0]).toMatchObject({ x: 0, y: 0 });
  });
  it('keeps the selected part, viewport and valid entity selection across navigation and Finish', async () => {
    const document = createPlateDocument();
    const second = createCadPart('Second panel');
    second.sketch = addRectangle(second.sketch, { x: 10, y: 10, width: 70, height: 50 });
    document.parts.push(second);
    const { change, finish, cancel, unmount } = setup(document);
    fireEvent.click(screen.getByRole('button', { name: /Second panel/ }));
    const edge = second.sketch.entities.find(e => e.type === 'line')!;
    selectEntities([edge.id]);
    const canvas = screen.getByTestId('cad-canvas');
    const box = canvas.getBoundingClientRect();
    fireEvent.wheel(canvas, { deltaY: -100, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
    const previousView = canvas.getAttribute('viewBox');
    unmount();
    const again = render(
      <div style={{ height: 700 }}>
        <CadEditor document={document} onDraftChange={change} onFinish={finish} onCancel={cancel} />
      </div>
    );
    expect((screen.getByLabelText('Part name') as HTMLInputElement).value).toBe('Second panel');
    expect(screen.getByTestId('cad-canvas').getAttribute('viewBox')).toBe(previousView);
    expect(screen.getByTestId('cad-canvas').querySelector(`[data-entity-id="${edge.id}"] [stroke="#ff9b23"]`)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
    fireEvent.click(screen.getByRole('button', { name: /Finish sketch/ }));
    await waitFor(() => expect(finish).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false));
    const accepted = finish.mock.calls[0]![0] as CadDocument;
    again.unmount();
    render(
      <div style={{ height: 700 }}>
        <CadEditor document={accepted} onDraftChange={change} onFinish={finish} onCancel={cancel} />
      </div>
    );
    expect((screen.getByLabelText('Part name') as HTMLInputElement).value).toBe('Second panel');
    expect(screen.getByTestId('cad-canvas').getAttribute('viewBox')).toBe(previousView);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
  }, 30_000);

  it('uses whole-sketch constraint status for dark, blue and conflict-red outlines', async () => {
    setup();
    await waitFor(() => expect(screen.getByTestId('cad-canvas').querySelector('[data-entity-id] line[stroke="#000000"]')).toBeTruthy(), {
      timeout: 20_000,
    });
    const line = screen.getByTestId('cad-canvas').querySelector('[data-entity-id] line')!;
    selectEntities([line.closest('[data-entity-id]')!.getAttribute('data-entity-id')!]);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'v' });
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: ' ' });
    await waitFor(() => expect(screen.getByTestId('cad-canvas').querySelector('[data-entity-id] line[stroke="#c73535"]')).toBeTruthy(), {
      timeout: 20_000,
    });
    cleanup();
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 30, y2: 20 });
    document.parts.push(part);
    setup(document);
    await screen.findByText('Sketch in progress', undefined, { timeout: 20_000 });
    expect(screen.getByTestId('cad-canvas').querySelector('[data-entity-id] line[stroke="#0000ff"]')).toBeTruthy();
  }, 30_000);
  it('returns keyboard ownership to the canvas after committing or cancelling part fields', () => {
    const { change } = setup();
    const canvas = screen.getByTestId('cad-canvas');
    const name = screen.getByRole('textbox', { name: 'Part name' });
    name.focus();
    fireEvent.change(name, { target: { value: 'Keyboard plate' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(window.document.activeElement).toBe(canvas);
    fireEvent.keyDown(canvas, { key: 'g' });
    expect(screen.getByRole('button', { name: 'Corner rectangle (G)' }).getAttribute('aria-pressed')).toBe('true');
    const thickness = screen.getByRole('textbox', { name: 'Thickness' });
    thickness.focus();
    fireEvent.change(thickness, { target: { value: '18,5' } });
    fireEvent.keyDown(thickness, { key: 'Enter' });
    expect(change.mock.calls.at(-1)![0].parts[0]!.thickness).toBe(18.5);
    expect(window.document.activeElement).toBe(canvas);
    fireEvent.keyDown(canvas, { key: 'c' });
    expect(screen.getByRole('button', { name: 'Circle (C)' }).getAttribute('aria-pressed')).toBe('true');
    thickness.focus();
    fireEvent.change(thickness, { target: { value: '25' } });
    fireEvent.keyDown(thickness, { key: 'Escape' });
    expect(window.document.activeElement).toBe(canvas);
    expect(change.mock.calls.at(-1)![0].parts[0]!.thickness).toBe(18.5);
  });

  it('uses the full Design height in demo and normal sessions without reserving a machine bar', () => {
    setDemoModeForTest(true);
    try {
      const { unmount } = setup();
      const editor = screen.getByTestId('cad-canvas').closest('.cad-editor')!;
      expect(getComputedStyle(editor).paddingBottom).toBe('0px');
      unmount();
    } finally {
      setDemoModeForTest(false);
    }
    setup();
    const editor = screen.getByTestId('cad-canvas').closest('.cad-editor')!;
    expect(getComputedStyle(editor).paddingBottom).toBe('0px');
  });

  it('cancels native wheel scrolling while zooming at the pointer and removes its listener on exit', () => {
    const { unmount } = setup();
    const canvas = screen.getByTestId('cad-canvas');
    const box = canvas.getBoundingClientRect();
    const before = canvas.getAttribute('viewBox')!;
    const wheel = new WheelEvent('wheel', {
      deltaY: -100,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(canvas, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    const zoomed = canvas.getAttribute('viewBox')!;
    expect(Number(zoomed.split(' ')[2])).toBeLessThan(Number(before.split(' ')[2]));
    unmount();
    const afterExit = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    canvas.dispatchEvent(afterExit);
    expect(afterExit.defaultPrevented).toBe(false);
  });
  it('keeps a vertical edge midpoint selectable beside its height dimension', async () => {
    const { document: source, change } = setup();
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    await screen.findByRole('button', { name: 'Edit Height: 80 mm' });
    const position = new DOMPoint(120, -40).matrixTransform(canvas.getScreenCTM()!);
    const target = window.document.elementFromPoint(position.x, position.y)!;
    const edge = source.parts[0]!.sketch.entities.filter(e => e.type === 'line')[1]!;
    expect(target.closest('[data-entity-id]')?.getAttribute('data-entity-id')).toBe(edge.id);
    fireEvent.pointerDown(target, { button: 0, clientX: position.x, clientY: position.y });
    fireEvent.pointerUp(canvas);
    fireEvent.keyDown(canvas, { key: 'h' });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)).toMatchObject({ type: 'horizontal', entityId: edge.id });
  });
  it('commits a line through a dimension label instead of opening its numeric editor', () => {
    const { change } = setup();
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    const label = screen.getByRole('button', { name: 'Edit Height: 80 mm' });
    const bounds = label.getBoundingClientRect();
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'l' });
    const start = new DOMPoint(-10, -40).matrixTransform(canvas.getScreenCTM()!);
    fireEvent.pointerDown(canvas, { button: 0, clientX: start.x, clientY: start.y });
    const x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    const target = window.document.elementFromPoint(x, y)!;
    expect(target.closest('[data-dimension]')).toBeNull();
    fireEvent.pointerDown(target, { button: 0, clientX: x, clientY: y });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities.filter(e => e.type === 'line')).toHaveLength(5);
    expect(screen.queryByRole('textbox', { name: 'Height mm' })).toBeNull();
  });
  it('connects contextual A from the current line endpoint and resumes L from the arc gesture end', () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(0, 0);
    clickWorld(40, 0);
    fireEvent.keyDown(canvas, { key: 'a' });
    clickWorld(60, 20);
    clickWorld(60, 0);
    expect(window.document.activeElement).toBe(canvas);
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(60, 60);
    const sketch = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    const lines = sketch.entities.filter(e => e.type === 'line');
    const arc = sketch.entities.find(e => e.type === 'arc')!;
    expect(lines).toHaveLength(2);
    expect(sketch.entities.filter(e => e.type === 'arc')).toHaveLength(1);
    if (arc.type !== 'arc' || lines[0]?.type !== 'line' || lines[1]?.type !== 'line')
      throw new Error('Expected connected line/arc/line fixture');
    expect([arc.startId, arc.endId]).toContain(lines[0].endId);
    expect([arc.startId, arc.endId]).toContain(lines[1].startId);
    expect(screen.queryByRole('textbox', { name: /radius mm|Diameter mm|Width mm/ })).toBeNull();
  });

  it('keeps shortcuts active after numeric rectangle creation and circle drawing without unsolicited dimension entry', () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'g' });
    clickWorld(10, 10);
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(window.document.activeElement).toBe(canvas);
    expect(screen.queryByRole('textbox', { name: 'Width mm' })).toBeNull();
    fireEvent.keyDown(canvas, { key: 'c' });
    clickWorld(40, 30);
    clickWorld(50, 30);
    expect(window.document.activeElement).toBe(canvas);
    expect(screen.queryByRole('textbox', { name: 'Diameter mm' })).toBeNull();
    fireEvent.keyDown(canvas, { key: 'l' });
    expect(screen.getByRole('button', { name: 'Line (L)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('finishes a closed polyline while its committed continuation anchor is still active', async () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { finish } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(0, 0);
    clickWorld(40, 0);
    clickWorld(40, 30);
    clickWorld(0, 30);
    clickWorld(0, 0);
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
    expect(screen.getByRole('button', { name: 'Line (L)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Finish sketch/ }));
    await waitFor(() => expect(finish).toHaveBeenCalledOnce());
    expect((finish.mock.calls[0]![0] as CadDocument).parts[0]!.sketch.entities.filter(e => e.type === 'line')).toHaveLength(4);
  }, 30_000);
  it('continues line -> Shift+A clockwise tangent arc -> line with shared points and persistent tangency', () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(0, 0);
    clickWorld(40, 0);
    fireEvent.keyDown(canvas, { key: 'A', shiftKey: true });
    clickWorld(60, -20);
    expect(screen.getByRole('button', { name: 'Line (L)' }).getAttribute('aria-pressed')).toBe('true');
    clickWorld(60, -60);
    const sketch = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    const lines = sketch.entities.filter(e => e.type === 'line');
    const arc = sketch.entities.find(e => e.type === 'arc')!;
    expect(lines).toHaveLength(2);
    expect(sketch.constraints.filter(c => c.type === 'tangent')).toHaveLength(2);
    if (arc.type !== 'arc' || lines[0]?.type !== 'line' || lines[1]?.type !== 'line')
      throw new Error('Expected tangent line/arc/line fixture');
    expect([arc.startId, arc.endId]).toContain(lines[0].endId);
    expect([arc.startId, arc.endId]).toContain(lines[1].startId);
    const end = sketch.entities.find(e => e.id === lines[1]!.endId);
    expect(end).toMatchObject({ x: expect.closeTo(60), y: expect.closeTo(-60) });
  });

  it('chains repeated Shift+A arcs using the gesture end instead of the stored counterclockwise end', () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(0, 0);
    clickWorld(40, 0);
    fireEvent.keyDown(canvas, { key: 'A', shiftKey: true });
    clickWorld(60, -20);
    fireEvent.keyDown(canvas, { key: 'A', shiftKey: true });
    clickWorld(80, -40);
    clickWorld(120, -40);
    const sketch = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    expect(sketch.entities.filter(e => e.type === 'arc')).toHaveLength(2);
    expect(sketch.entities.filter(e => e.type === 'line')).toHaveLength(2);
    expect(sketch.constraints.filter(c => c.type === 'tangent')).toHaveLength(3);
  });

  it('arms point constraints first and collects ordinary clicks for H/V, coincidence and midpoint', () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addPoint(part.sketch, { x: 20, y: 20 });
    part.sketch = addPoint(part.sketch, { x: 60, y: 50 });
    part.sketch = addLine(part.sketch, { x1: 90, y1: 10, x2: 130, y2: 10 });
    document.parts.push(part);
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'h' });
    expect(screen.getByRole('button', { name: 'Constraints' }).getAttribute('aria-pressed')).toBe('true');
    clickWorld(20, 20);
    clickWorld(60, 50);
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)?.type).toBe('horizontalPoints');
    fireEvent.keyDown(canvas, { key: 'Escape' });
    fireEvent.keyDown(canvas, { key: 'v' });
    clickWorld(20, 20);
    clickWorld(60, 50);
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)?.type).toBe('verticalPoints');
    fireEvent.keyDown(canvas, { key: 'Escape' });
    fireEvent.keyDown(canvas, { key: 'i' });
    clickWorld(20, 20);
    clickWorld(110, 10);
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)?.type).toBe('pointOnLine');
    fireEvent.keyDown(canvas, { key: 'Escape' });
    fireEvent.keyDown(canvas, { key: 'M', shiftKey: true });
    clickWorld(20, 20);
    clickWorld(110, 10);
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)?.type).toBe('midpoint');
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Constraints' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('places standalone points with Shift+S and dimensions two points with D then ordinary clicks', async () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'S', shiftKey: true });
    clickWorld(20, 20);
    clickWorld(60, 50);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities.filter(e => e.type === 'point')).toHaveLength(3);
    fireEvent.keyDown(canvas, { key: 'd' });
    clickWorld(20, 20);
    expect(screen.getByText(/Select another point/)).toBeTruthy();
    clickWorld(60, 50);
    expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
    clickWorld(80, 80);
    expect(await screen.findByRole('textbox', { name: 'Length mm' }, { timeout: 20_000 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
    const placedSketch = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    const dimension = placedSketch.constraints.at(-1)! as CadDimension;
    expect(dimension).toMatchObject({
      type: 'distance',
      value: 50,
    });
    expect(dimension.labelPlacement).toBeDefined();
    expect(dimension.labelPosition).toBeUndefined();
    expect(resolveDimensionPlacement(placedSketch, dimension)).toEqual({ x: expect.closeTo(80), y: expect.closeTo(80) });
  });

  it('adds persistent axis inference while Snap is on and leaves pointer geometry free when it is off', () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(0, 0);
    clickWorld(40, 1);
    const first = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    expect(first.constraints.filter(c => c.type === 'horizontal')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Snap on' }));
    clickWorld(80, 2);
    const second = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    expect(second.constraints.filter(c => c.type === 'horizontal')).toHaveLength(1);
    expect(second.entities.find(e => e.type === 'point' && Math.abs(e.x - 80) < 1e-6)).toMatchObject({ y: expect.closeTo(2) });
  });

  it('keeps pointer rectangles and circles free of driving sizes until explicitly dimensioned', () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'g' });
    clickWorld(10, 10);
    clickWorld(110, 70);
    fireEvent.keyDown(canvas, { key: 'c' });
    clickWorld(40, 30);
    clickWorld(50, 30);
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.some(c => 'value' in c)).toBe(false);
    expect(screen.queryByRole('textbox', { name: /Width mm|Diameter mm/ })).toBeNull();
  });
  it('keeps a standalone point snapped to an existing endpoint when its driving dimension changes', async () => {
    const { document: source, change } = setup();
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'S', shiftKey: true });
    clickWorld(120, 0);
    const added = change.mock.calls
      .at(-1)![0]
      .parts[0]!.sketch.entities.find(e => e.type === 'point' && !source.parts[0]!.sketch.entities.some(before => before.id === e.id))!;
    expect(
      change.mock.calls
        .at(-1)![0]
        .parts[0]!.sketch.constraints.some(c => c.type === 'coincident' && [c.pointAId, c.pointBId].includes(added.id))
    ).toBe(true);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Width mm' }), { target: { value: '160' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
    await waitFor(
      () =>
        expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities.find(e => e.id === added.id)).toMatchObject({
          x: expect.closeTo(160),
          y: expect.closeTo(0),
        }),
      { timeout: 20_000 }
    );
  }, 30_000);

  it('drags a free rectangle corner along its remaining freedom without changing its width dimension', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 60 });
    const bottom = part.sketch.entities.find(e => e.type === 'line')!;
    // The constructor no longer merges a numeric (0,0) corner into the origin.
    // This fixture specifically needs the old anchored one-DOF edit setup.
    part.sketch = addConstraint(part.sketch, { type: 'coincident', pointAId: bottom.startId, pointBId: originId(part.sketch) });
    part.sketch = addConstraint(part.sketch, {
      type: 'distanceX',
      pointAId: bottom.startId,
      pointBId: bottom.endId,
      value: 100,
      label: 'Width',
    });
    document.parts.push(part);
    const { change } = setup(document);
    await screen.findByText('1 degree of freedom', undefined, { timeout: 20_000 });
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    const from = new DOMPoint(100, -60).matrixTransform(canvas.getScreenCTM()!);
    const to = new DOMPoint(130, -90).matrixTransform(canvas.getScreenCTM()!);
    fireEvent.pointerDown(canvas, { clientX: from.x, clientY: from.y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    await waitFor(
      () =>
        expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities).toContainEqual(
          expect.objectContaining({ type: 'point', x: expect.closeTo(100), y: expect.closeTo(90) })
        ),
      { timeout: 20_000 }
    );
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints).toEqual(part.sketch.constraints);
    fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities).toContainEqual(expect.objectContaining({ x: 100, y: 60 }));
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
  }, 30_000);

  it('resizes a free circle at the fixed origin with one undo step', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addCircle(part.sketch, { x: 0, y: 0, radius: 20 });
    document.parts.push(part);
    const { change } = setup(document);
    await screen.findByText('1 degree of freedom', undefined, { timeout: 20_000 });
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    const from = new DOMPoint(20, 0).matrixTransform(canvas.getScreenCTM()!);
    const to = new DOMPoint(30, 0).matrixTransform(canvas.getScreenCTM()!);
    fireEvent.pointerDown(canvas, { clientX: from.x, clientY: from.y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    await waitFor(
      () => expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities.find(e => e.type === 'circle')).toMatchObject({ radius: 30 }),
      { timeout: 20_000 }
    );
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities.find(e => e.type === 'circle')).toMatchObject({ radius: 20 });
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
  }, 30_000);

  it('leaves explicit center coordinates and diameter unchanged when a constrained circle is dragged', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addCircle(part.sketch, { x: 20, y: 20, radius: 10, dimensioned: true, positioned: true });
    document.parts.push(part);
    const { change } = setup(document);
    await screen.findByText('Fully constrained', undefined, { timeout: 20_000 });
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    const from = new DOMPoint(20, -20).matrixTransform(canvas.getScreenCTM()!);
    const to = new DOMPoint(50, -50).matrixTransform(canvas.getScreenCTM()!);
    fireEvent.pointerDown(canvas, { clientX: from.x, clientY: from.y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    await screen.findByText(
      'The current constraints keep this geometry in place. Edit a dimension or remove a constraint to move it.',
      undefined,
      { timeout: 20_000 }
    );
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
    for (const call of change.mock.calls) expect(call[0].parts[0]!.sketch.constraints).toEqual(part.sketch.constraints);
  }, 30_000);

  it('keeps dimension labels out of an armed point-to-curve constraint', () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addCircle(part.sketch, { x: 30, y: 30, radius: 10, dimensioned: true });
    part.sketch = addPoint(part.sketch, { x: 50, y: 10 });
    document.parts.push(part);
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    fireEvent.keyDown(canvas, { key: 'i' });
    clickWorld(50, 10);
    const hit = new DOMPoint(30, -40).matrixTransform(canvas.getScreenCTM()!);
    const target = window.document.elementFromPoint(hit.x, hit.y)!;
    expect(target.closest('[data-dimension]')).toBeNull();
    fireEvent.pointerMove(canvas, { clientX: hit.x, clientY: hit.y });
    expect(screen.getByText('On curve')).toBeTruthy();
    fireEvent.pointerLeave(canvas);
    expect(screen.queryByText('On curve')).toBeNull();
    fireEvent.pointerDown(target, { button: 0, clientX: hit.x, clientY: hit.y });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints.at(-1)?.type).toBe('pointOnCircle');
    expect(screen.queryByRole('textbox', { name: 'Diameter mm' })).toBeNull();
  });

  it('restores shortcut focus after cancelling a dimension and toggles an active tool off', () => {
    setup();
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel dimension edit' }));
    const canvas = screen.getByTestId('cad-canvas');
    expect(window.document.activeElement).toBe(canvas);
    fireEvent.keyDown(canvas, { key: 'l' });
    expect(screen.getByRole('button', { name: 'Line (L)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(canvas, { key: 'l' });
    expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(canvas, { key: 'h' });
    fireEvent.keyDown(canvas, { key: 'h' });
    expect(screen.getByRole('button', { name: 'Constraints' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows the active part DOF and keeps center-rectangle diagonals construction-only', async () => {
    const document = createPlateDocument();
    document.parts.push(createCadPart('Centered panel'));
    const { change } = setup(document);
    fireEvent.click(screen.getByRole('button', { name: /Centered panel/ }));
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'r' });
    clickWorld(0, 0);
    clickWorld(40, 30);
    await screen.findByText('2 degrees of freedom', undefined, { timeout: 20_000 });
    const centerSketch = change.mock.calls.at(-1)![0].parts[1]!.sketch;
    expect(centerSketch.constraints.some(c => c.type === 'midpoint')).toBe(true);
    expect(centerSketch.entities.filter(e => e.type === 'line' && e.construction)).toHaveLength(2);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'q' });
    expect(change.mock.calls.at(-1)![0].parts[1]!.sketch.entities.filter(e => e.type === 'line' && !e.construction)).toHaveLength(0);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'q' });
    expect(change.mock.calls.at(-1)![0].parts[1]!.sketch.entities.filter(e => e.type === 'line' && e.construction)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /^Plate$/ }));
    await screen.findByText('Fully constrained', undefined, { timeout: 20_000 });
  }, 30_000);

  it('keeps dimension edits and dragging usable when another part has conflicting fixed geometry', async () => {
    const document = createCadDocument();
    const good = createCadPart('Valid panel');
    good.sketch = addRectangle(good.sketch, { x: 0, y: 0, width: 100, height: 60 });
    const bottom = good.sketch.entities.find(e => e.type === 'line')!;
    good.sketch = addConstraint(good.sketch, { type: 'coincident', pointAId: bottom.startId, pointBId: originId(good.sketch) });
    good.sketch = addConstraint(good.sketch, {
      type: 'distanceX',
      pointAId: bottom.startId,
      pointBId: bottom.endId,
      value: 100,
      label: 'Width',
    });
    const bad = createCadPart('Needs repair');
    bad.sketch = addLine(bad.sketch, { x1: 10, y1: 10, x2: 40, y2: 10 });
    const line = bad.sketch.entities.find(e => e.type === 'line')!;
    bad.sketch.entities = bad.sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e));
    bad.sketch = addConstraint(bad.sketch, { type: 'distance', pointAId: line.startId, pointBId: line.endId, value: 60 });
    document.parts.push(good, bad);
    const { change } = setup(document);
    await screen.findByText('Conflicting constraints', undefined, { timeout: 20_000 });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Width: 100 mm' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Width mm' }), { target: { value: '140' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
    await waitFor(
      () =>
        expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities).toContainEqual(
          expect.objectContaining({ type: 'point', x: expect.closeTo(140), y: expect.closeTo(60) })
        ),
      { timeout: 20_000 }
    );
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    const from = new DOMPoint(140, -60).matrixTransform(canvas.getScreenCTM()!);
    const to = new DOMPoint(170, -90).matrixTransform(canvas.getScreenCTM()!);
    fireEvent.pointerDown(canvas, { clientX: from.x, clientY: from.y, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    await waitFor(
      () =>
        expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities).toContainEqual(
          expect.objectContaining({ type: 'point', x: expect.closeTo(140), y: expect.closeTo(90) })
        ),
      { timeout: 20_000 }
    );
    expect(change.mock.calls.at(-1)![0].parts[1]!.sketch).toEqual(bad.sketch);
    expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(true);
  }, 30_000);
  it('selects an existing dimension without focusing input, then double-click edits and Escape cancels', () => {
    const { document: source, change } = setup();
    const canvas = screen.getByTestId('cad-canvas');
    const width = screen.getByRole('button', { name: 'Edit Width: 120 mm' });
    fireEvent.click(width);
    expect(screen.queryByRole('textbox', { name: 'Width mm' })).toBeNull();
    expect(window.document.activeElement?.tagName).not.toBe('INPUT');
    fireEvent.doubleClick(width);
    const input = screen.getByRole('textbox', { name: 'Width mm' });
    expect(window.document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '180' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(window.document.activeElement).toBe(canvas);
    expect((change.mock.calls.at(-1)?.[0] ?? source).parts[0]!.sketch.constraints.find(c => c.label === 'Width')).toMatchObject({
      value: 120,
    });
  });

  it('places a new dimension before value entry and commits its position and value as one undoable edit', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 60, y2: 20 });
    document.parts.push(part);
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    selectEntities([part.sketch.entities.find(e => e.type === 'line')!.id]);
    fireEvent.keyDown(canvas, { key: 'd' });
    fireEvent.change(screen.getByLabelText('Dimension type'), { target: { value: 'distance' } });
    expect(change).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
    clickWorld(35, 55);
    const input = await screen.findByRole('textbox', { name: 'Length mm' }, { timeout: 20_000 });
    expect(window.document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
    const placedSketch = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    expect(placedSketch.constraints).toHaveLength(1);
    const dimension = placedSketch.constraints[0]! as CadDimension;
    expect(dimension).toMatchObject({ type: 'distance', value: 80 });
    expect(dimension.labelPlacement).toBeDefined();
    expect(dimension.labelPosition).toBeUndefined();
    expect(resolveDimensionPlacement(part.sketch, dimension)).toEqual({ x: expect.closeTo(35), y: expect.closeTo(55) });
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints).toHaveLength(0);
  });

  it('cancels an unplaced dimension but keeps the measured value after placement and Escape', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 40, y2: 20 });
    document.parts.push(part);
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    selectEntities([part.sketch.entities.find(e => e.type === 'line')!.id]);
    fireEvent.keyDown(canvas, { key: 'd' });
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(change).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select (Esc)' }));
    selectEntities([part.sketch.entities.find(e => e.type === 'line')!.id]);
    fireEvent.click(screen.getByRole('button', { name: 'Dimension (D)' }));
    fireEvent.change(screen.getByLabelText('Dimension type'), { target: { value: 'distance' } });
    clickWorld(40, 55);
    const input = await screen.findByRole('textbox', { name: 'Length mm' }, { timeout: 20_000 });
    fireEvent.change(input, { target: { value: '100' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    const placedSketch = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    expect(placedSketch.constraints).toHaveLength(1);
    const dimension = placedSketch.constraints[0]! as CadDimension;
    expect(dimension).toMatchObject({ type: 'distance', value: expect.closeTo(Math.hypot(40, 20)) });
    expect(dimension.labelPlacement).toBeDefined();
    expect(dimension.labelPosition).toBeUndefined();
    expect(resolveDimensionPlacement(placedSketch, dimension)).toEqual({ x: expect.closeTo(40), y: expect.closeTo(55) });
    expect(window.document.activeElement).toBe(canvas);
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.constraints).toHaveLength(0);
  });

  it('keeps a fresh A command as three-point creation and carries the gesture endpoint for clockwise contextual arcs', () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'a' });
    clickWorld(10, 10);
    clickWorld(30, 30);
    expect(change).not.toHaveBeenCalled();
    clickWorld(30, 10);
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities.filter(e => e.type === 'arc')).toHaveLength(1);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(50, 60);
    clickWorld(90, 60);
    fireEvent.keyDown(canvas, { key: 'a' });
    clickWorld(110, 40);
    clickWorld(110, 60);
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(110, 10);
    const sketch = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    const last = sketch.entities.filter(e => e.type === 'line').at(-1)!;
    if (last.type !== 'line') throw new Error('Missing resumed line');
    expect(sketch.entities.find(e => e.id === last.startId)).toMatchObject({ x: expect.closeTo(110), y: expect.closeTo(40) });
  });

  it('opens and focuses the dimension value editor beside a real browser placement click', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 10, y1: 10, x2: 60, y2: 20 });
    document.parts.push(part);
    setup(document);
    selectEntities([part.sketch.entities.find(e => e.type === 'line')!.id]);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'd' });
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    const bounds = canvas.getBoundingClientRect();
    const anchor = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    await userEvent.click(canvas);
    const form = (await screen.findByRole('textbox', { name: 'Length mm' })).closest('form')!.getBoundingClientRect();
    expect(form.left + form.width / 2).toBeCloseTo(anchor.x, 0);
    expect(form.top - anchor.y).toBeCloseTo(12, 0);
    expect(window.document.activeElement).toBe(screen.getByRole('textbox', { name: 'Length mm' }));
  });

  it('keeps the dimension value editor inside the drawing area for an annotation at its edge', () => {
    const document = createPlateDocument();
    document.parts[0]!.sketch.constraints = document.parts[0]!.sketch.constraints.map(c =>
      c.label === 'Width' ? { ...c, labelPosition: { x: 100_000, y: -100_000 } } : c
    );
    setup(document);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Width: 120 mm' }));
    const input = screen.getByRole('textbox', { name: 'Width mm' });
    const form = input.closest('form')!.getBoundingClientRect();
    const drawing = input.closest('.cad-drawing')!.getBoundingClientRect();
    expect(form.left).toBeGreaterThanOrEqual(drawing.left + 7);
    expect(form.top).toBeGreaterThanOrEqual(drawing.top + 7);
    expect(form.right).toBeLessThanOrEqual(drawing.right - 7);
    expect(form.bottom).toBeLessThanOrEqual(drawing.bottom - 7);
  });

  it('uses the first pending line point as the contextual arc start before a line is committed', () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas');
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(10, 10);
    fireEvent.keyDown(canvas, { key: 'a' });
    clickWorld(30, 30);
    expect(change).not.toHaveBeenCalled();
    clickWorld(30, 10);
    const sketch = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    const arc = sketch.entities.find(e => e.type === 'arc')!;
    expect([arc.startId, arc.endId].map(id => sketch.entities.find(e => e.id === id))).toContainEqual(
      expect.objectContaining({ type: 'point', x: expect.closeTo(10), y: expect.closeTo(10) })
    );
    expect(sketch.entities.filter(e => e.type === 'line')).toHaveLength(0);
  });

  it('previews an arc during endpoint and through-point stages without creating a line or undo command', () => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { change } = setup(document);
    const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
    const move = (x: number, y: number) => {
      const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
      fireEvent.pointerMove(canvas, { clientX: p.x, clientY: p.y, pointerId: 1 });
    };
    fireEvent.keyDown(canvas, { key: 'a' });
    clickWorld(10, 10);
    move(50, 30);
    const suggestion = canvas.querySelector('[data-arc-preview="curve"]')!.getAttribute('d');
    expect(canvas.querySelector('[data-arc-phase="end"]')).not.toBeNull();
    expect(suggestion).toContain(' A ');
    expect(canvas.querySelector('.cad-preview line')).toBeNull();
    expect(canvas.querySelector('[data-arc-guide="chord"]')!.getAttribute('stroke-dasharray')).toBe('4 4');
    clickWorld(50, 30);
    expect(canvas.querySelector('[data-arc-phase="through"]')).not.toBeNull();
    expect(canvas.querySelector('[data-arc-preview="curve"]')!.getAttribute('d')).toBe(suggestion);
    expect(change).not.toHaveBeenCalled();
    move(30, 50);
    expect(canvas.querySelector('[data-provisional="false"]')).not.toBeNull();
    expect(canvas.querySelector('[data-arc-preview="curve"]')!.getAttribute('d')).not.toBe(suggestion);
    clickWorld(30, 50);
    const sketch = change.mock.calls.at(-1)![0].parts[0]!.sketch;
    expect(sketch.entities.filter(e => e.type === 'arc')).toHaveLength(1);
    expect(sketch.entities.filter(e => e.type === 'line')).toHaveLength(0);
    expect(sketch.constraints.some(c => c.type === 'tangent')).toBe(false);
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(change.mock.calls.at(-1)![0].parts[0]!.sketch.entities.filter(e => e.type !== 'point')).toHaveLength(0);
  });
});
