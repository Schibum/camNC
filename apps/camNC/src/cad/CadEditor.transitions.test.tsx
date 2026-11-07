import { addCircle, addLine, createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const documentIds: string[] = [];
afterEach(() => {
  cleanup();
  documentIds.forEach(endCadSession);
  documentIds.length = 0;
});

function fixture(withSecondPart = false) {
  const document = createCadDocument();
  const first = createCadPart('Part A');
  first.sketch = addLine(first.sketch, { x1: 10, y1: 10, x2: 60, y2: 30 });
  document.parts.push(first);
  if (withSecondPart) document.parts.push(createCadPart('Part B'));
  return document;
}

function setup(document = fixture()) {
  documentIds.push(document.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={document} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  const latest = () => change.mock.calls.at(-1)?.[0] ?? document;
  return { document, change, canvas, latest };
}

function clickWorld(x: number, y: number) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerDown(canvas, { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 });
}

function stageDimension(entityId: string) {
  const canvas = screen.getByTestId('cad-canvas');
  fireEvent.click(screen.getByRole('button', { name: 'Select (Esc)' }));
  fireEvent.keyDown(canvas, { key: ' ' });
  const shape = canvas.querySelector<SVGGeometryElement>(`[data-entity-id="${entityId}"] line,[data-entity-id="${entityId}"] path`)!;
  const position = shape.getPointAtLength(shape.getTotalLength() / 2).matrixTransform(shape.getScreenCTM()!);
  fireEvent.pointerDown(shape, { button: 0, shiftKey: true, clientX: position.x, clientY: position.y });
  fireEvent.keyDown(canvas, { key: 'd' });
  expect(canvas.querySelector('[data-dimension]')).not.toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
}

function expectNoStagedDimension() {
  expect(screen.getByTestId('cad-canvas').querySelector('[data-dimension]')).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
}

describe('CAD command transitions', () => {
  it('discards an unplaced dimension before adding a part', () => {
    const { document, latest } = setup();
    stageDimension(document.parts[0]!.sketch.entities.find(e => e.type === 'line')!.id);
    fireEvent.click(screen.getByRole('button', { name: 'Add part' }));
    expectNoStagedDimension();
    clickWorld(30, 50);
    expect(latest().parts).toHaveLength(2);
    expect(latest().parts.every(p => p.sketch.constraints.length === 0)).toBe(true);
    expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
  });

  it('discards an unplaced dimension before switching parts', () => {
    const { document, latest } = setup(fixture(true));
    stageDimension(document.parts[0]!.sketch.entities.find(e => e.type === 'line')!.id);
    fireEvent.click(screen.getByRole('button', { name: /^Part B$/ }));
    expectNoStagedDimension();
    clickWorld(30, 50);
    expect(latest().parts.every(p => p.sketch.constraints.length === 0)).toBe(true);
    expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
  });

  it('discards an unplaced dimension before deleting its source part', () => {
    const { document, latest } = setup(fixture(true));
    const firstPartId = document.parts[0]!.id;
    stageDimension(document.parts[0]!.sketch.entities.find(e => e.type === 'line')!.id);
    fireEvent.click(screen.getByRole('button', { name: 'Delete part' }));
    expectNoStagedDimension();
    clickWorld(30, 50);
    expect(latest().parts.map(p => p.id)).not.toContain(firstPartId);
    expect(latest().parts[0]!.sketch.constraints).toEqual([]);
    expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
  });

  it.each(['keyboard', 'toolbar'] as const)('discards an unplaced dimension before %s Undo removes its geometry', method => {
    const document = createCadDocument();
    document.parts.push(createCadPart('Part A'));
    const { canvas, latest } = setup(document);
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(10, 10);
    clickWorld(60, 30);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    const line = latest().parts[0]!.sketch.entities.find(e => e.type === 'line')!;
    stageDimension(line.id);
    if (method === 'keyboard') fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    else fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    expectNoStagedDimension();
    clickWorld(30, 50);
    expect(latest().parts[0]!.sketch.constraints).toEqual([]);
    expect(latest().parts[0]!.sketch.entities.filter(e => e.type !== 'point')).toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
  });

  it.each(['keyboard', 'toolbar'] as const)('discards an unplaced dimension before %s Redo restores another command', method => {
    const { document, canvas, latest } = setup();
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(90, 10);
    clickWorld(130, 30);
    fireEvent.keyDown(canvas, { key: 'Escape' });
    const drawnConstraints = latest().parts[0]!.sketch.constraints;
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    stageDimension(document.parts[0]!.sketch.entities.find(e => e.type === 'line')!.id);
    if (method === 'keyboard') fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true, shiftKey: true });
    else fireEvent.click(screen.getByRole('button', { name: 'Redo (Ctrl or Command Shift Z)' }));
    expectNoStagedDimension();
    clickWorld(30, 50);
    expect(latest().parts[0]!.sketch.entities.filter(e => e.type === 'line')).toHaveLength(2);
    expect(latest().parts[0]!.sketch.constraints).toEqual(drawnConstraints);
    expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
  });

  it('exposes positioned source dimensions for inline editing, deletion, and Undo without deleting geometry', () => {
    const document = createCadDocument();
    const part = createCadPart('Positioned circle');
    part.sketch = addCircle(part.sketch, { x: 20, y: 30, radius: 5, dimensioned: true, positioned: true });
    document.parts.push(part);
    const { canvas, latest } = setup(document);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Center X: 20 mm' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Center X mm' }), { target: { value: '-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
    expect(latest().parts[0]!.sketch.constraints.find(c => c.type === 'positionX')).toMatchObject({ value: -10 });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Center Y: 30 mm' }));
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(latest().parts[0]!.sketch.constraints.some(c => c.type === 'positionY')).toBe(false);
    expect(latest().parts[0]!.sketch.entities.map(e => e.id)).toEqual(part.sketch.entities.map(e => e.id));
    expect(latest().parts[0]!.sketch.constraints.find(c => c.type === 'positionX')).toMatchObject({ value: -10 });
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Edit Center Y: 30 mm' })).toBeTruthy();
    expect(latest().parts[0]!.sketch.constraints.find(c => c.type === 'positionY')).toMatchObject({ value: 30 });
  });
});
