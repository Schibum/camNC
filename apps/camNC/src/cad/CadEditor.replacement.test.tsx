import { addArc, addConstraint, addLine, createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const documentIds: string[] = [];
afterEach(() => {
  cleanup();
  documentIds.forEach(endCadSession);
  documentIds.length = 0;
});

function capsule() {
  const document = createCadDocument();
  const part = createCadPart('Capsule');
  part.sketch = addLine(part.sketch, { x1: 21, y1: 0, x2: 94, y2: 0 });
  part.sketch = addArc(part.sketch, { cx: 94, cy: 21, radius: 21, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
  part.sketch = addLine(part.sketch, { x1: 94, y1: 42, x2: 21, y2: 42 });
  part.sketch = addArc(part.sketch, { cx: 21, cy: 21, radius: 21, startAngle: Math.PI / 2, endAngle: -Math.PI / 2 });
  document.parts.push(part);
  return { document, bottom: part.sketch.entities.find(e => e.type === 'line')! };
}

async function setup(document: CadDocument) {
  documentIds.push(document.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={document} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  return { canvas, change, latest: () => change.mock.calls.at(-1)?.[0] ?? document };
}

function clickWorld(x: number, y: number) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerDown(canvas, { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 });
}

function select(ids: string[]) {
  fireEvent.click(screen.getByRole('button', { name: 'Select (Esc)' }));
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  fireEvent.keyDown(canvas, { key: ' ' });
  for (const id of ids) {
    const group = canvas.querySelector(`[data-entity-id="${id}"]`)!;
    const shape = (
      group.matches('circle.cad-point') ? group : (group.querySelector('circle.cad-point') ?? group.querySelector('line,path,circle'))
    ) as SVGGeometryElement;
    const local = shape.matches('.cad-point')
      ? new DOMPoint((shape as SVGCircleElement).cx.baseVal.value, (shape as SVGCircleElement).cy.baseVal.value)
      : shape.getPointAtLength(shape.getTotalLength() / 2);
    const p = local.matrixTransform(shape.getScreenCTM()!);
    fireEvent.pointerDown(shape, { clientX: p.x, clientY: p.y, button: 0, pointerId: 1, shiftKey: true });
  }
}

async function placeLength() {
  const canvas = screen.getByTestId('cad-canvas');
  fireEvent.keyDown(canvas, { key: 'd' });
  fireEvent.change(screen.getByLabelText('Dimension type'), { target: { value: 'distance' } });
  clickWorld(60, -15);
  fireEvent.click(await screen.findByRole('button', { name: 'Apply dimension' }, { timeout: 20_000 }));
}

describe('geometry replacement and command ownership', () => {
  it('removes the hovered midpoint cue immediately when its selected dimensioned line is deleted', async () => {
    const { document, bottom } = capsule();
    document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, {
      type: 'distance',
      pointAId: bottom.startId,
      pointBId: bottom.endId,
      sourceEntityId: bottom.id,
      value: 73,
      label: 'Length',
    });
    const { canvas, latest } = await setup(document);
    select([bottom.id]);
    const midpoint = new DOMPoint(57.5, 0).matrixTransform(canvas.getScreenCTM()!);
    fireEvent.pointerMove(canvas, { clientX: midpoint.x, clientY: midpoint.y, pointerId: 1 });
    const cue = screen.getByText('Midpoint').closest('g')!;
    expect(cue.querySelector('circle')).not.toBeNull();
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(screen.queryByText('Midpoint')).toBeNull();
    expect(cue.isConnected).toBe(false);
    expect(canvas.querySelector('[data-drawing-inference]')).toBeNull();
    expect(latest().parts[0]!.sketch.entities.some(entity => entity.id === bottom.id)).toBe(false);
    expect(screen.queryByRole('button', { name: 'Edit Length: 73 mm' })).toBeNull();
  });

  it('deletes a D-selected line dimension with its source while preserving boundary endpoints for redraw and Undo', async () => {
    const { document, bottom } = capsule();
    const { canvas, latest } = await setup(document);
    expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull();
    select([bottom.id]);
    await placeLength();
    const dimension = latest().parts[0]!.sketch.constraints.find(c => c.type === 'distance')!;
    expect(dimension).toMatchObject({ sourceEntityId: bottom.id, pointAId: bottom.startId, pointBId: bottom.endId, value: 73 });
    await waitFor(() => expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull());
    select([bottom.id]);
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(canvas.querySelector('[data-sketch-region]')).toBeNull();
    const deleted = latest().parts[0]!.sketch;
    expect(deleted.entities.some(e => e.id === bottom.id)).toBe(false);
    expect(deleted.entities.some(e => e.id === bottom.startId)).toBe(true);
    expect(deleted.entities.some(e => e.id === bottom.endId)).toBe(true);
    expect(deleted.constraints.some(c => c.id === dimension.id)).toBe(false);
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(true));
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(21, 0);
    clickWorld(94, 0);
    const redrawn = latest()
      .parts[0]!.sketch.entities.filter(e => e.type === 'line')
      .at(-1)!;
    expect(redrawn.id).not.toBe(bottom.id);
    expect(redrawn.startId).toBe(bottom.startId);
    expect(redrawn.endId).toBe(bottom.endId);
    expect(latest().parts[0]!.sketch.constraints.some(c => c.id === dimension.id)).toBe(false);
    await waitFor(() => expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull());
    fireEvent.keyDown(canvas, { key: 'Escape' });
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(latest().parts[0]!.sketch.entities.some(e => e.id === redrawn.id)).toBe(false);
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(latest().parts[0]!.sketch.entities.some(e => e.id === bottom.id)).toBe(true);
    expect(latest().parts[0]!.sketch.constraints).toContainEqual(dimension);
  });

  it('keeps an explicit two-point dimension independent when their boundary line is deleted', async () => {
    const { document, bottom } = capsule();
    const { canvas, latest } = await setup(document);
    select([bottom.startId, bottom.endId]);
    await placeLength();
    const dimension = latest().parts[0]!.sketch.constraints.find(c => c.type === 'distance')!;
    expect(dimension).not.toHaveProperty('sourceEntityId');
    select([bottom.id]);
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(latest().parts[0]!.sketch.entities.some(e => e.id === bottom.id)).toBe(false);
    expect(latest().parts[0]!.sketch.constraints).toContainEqual(dimension);
  });

  it.each(['h', 'v', 't'] as const)('replaces staged dimension placement with the %s constraint command', async command => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 80, y2: 40 });
    part.sketch = addArc(part.sketch, { cx: 120, cy: 60, radius: 20, startAngle: 0, endAngle: Math.PI / 2 });
    document.parts.push(part);
    const line = part.sketch.entities.find(e => e.type === 'line')!,
      arc = part.sketch.entities.find(e => e.type === 'arc')!;
    const { canvas, latest } = await setup(document);
    select([line.id]);
    fireEvent.keyDown(canvas, { key: 'd' });
    expect(canvas.querySelector('[data-dimension]')).not.toBeNull();
    if (command === 't') {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Constraints' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
      fireEvent.click(await screen.findByRole('menuitem', { name: 'tangent' }));
    } else fireEvent.keyDown(canvas, { key: command });
    expect(canvas.querySelector('[data-dimension]')).toBeNull();
    if (command === 't') {
      const shape = canvas.querySelector<SVGPathElement>(`.cad-entity[data-entity-id="${arc.id}"] path`)!;
      const position = shape.getPointAtLength(shape.getTotalLength() / 2).matrixTransform(shape.getScreenCTM()!);
      fireEvent.pointerDown(shape, { button: 0, clientX: position.x, clientY: position.y, pointerId: 1 });
    } else clickWorld(200, 140);
    expect(screen.queryByRole('textbox', { name: 'Length mm' })).toBeNull();
    expect(latest().parts[0]!.sketch.constraints.some(c => 'value' in c)).toBe(false);
    expect(latest().parts[0]!.sketch.constraints.at(-1)?.type).toBe(
      command === 'h' ? 'horizontal' : command === 'v' ? 'vertical' : 'tangent'
    );
  });

  it.each(['line', 'arc'] as const)('ends a continuation when Delete removes its selected source %s', async source => {
    const document = createCadDocument();
    document.parts.push(createCadPart());
    const { canvas, latest } = await setup(document);
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(20, 20);
    clickWorld(60, 20);
    if (source === 'arc') {
      fireEvent.keyDown(canvas, { key: 'A', shiftKey: true });
      clickWorld(80, 40);
    }
    const removed = latest()
      .parts[0]!.sketch.entities.filter(e => e.type === source)
      .at(-1)!;
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(latest().parts[0]!.sketch.entities.some(e => e.id === removed.id)).toBe(false);
    expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
    expect(canvas.querySelector('.cad-preview')).toBeNull();
    const before = structuredClone(latest());
    clickWorld(120, 100);
    expect(latest()).toEqual(before);
    fireEvent.keyDown(canvas, { key: 'A', shiftKey: true });
    // The standalone tool arms for a new endpoint; it must not reuse the deleted chain anchor.
    expect(screen.getByRole('button', { name: 'Tangent arc (Shift+A)' }).getAttribute('aria-pressed')).toBe('true');
    expect(latest()).toEqual(before);
  });

  it('cancels an uncommitted start point when its midpoint reference curve is deleted', async () => {
    const { document, bottom } = capsule();
    const { canvas, latest } = await setup(document);
    select([bottom.id]);
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(57.5, 0);
    expect(canvas.querySelector('.cad-preview')).not.toBeNull();
    fireEvent.keyDown(canvas, { key: 'Delete' });
    expect(canvas.querySelector('.cad-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
    const before = structuredClone(latest());
    clickWorld(120, 100);
    expect(latest()).toEqual(before);
  });
});
