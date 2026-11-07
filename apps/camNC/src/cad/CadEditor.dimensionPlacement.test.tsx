import {
  addCircle,
  addConstraint,
  addLine,
  createCadDocument,
  createCadPart,
  parseCadDocument,
  type CadDocument,
  type CadPoint,
} from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

async function setup(source: CadDocument, initial?: (canvas: SVGSVGElement) => void) {
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  initial?.(canvas);
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
  await userEvent.click(screen.getByRole('button', { name: 'Snap on' }));
  const client = (at: CadPoint) => {
    const point = new DOMPoint(at.x, -at.y).matrixTransform(canvas.getScreenCTM()!);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      point.x = bounds.left + (point.x * bounds.width) / frame.innerWidth;
      point.y = bounds.top + (point.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    return { x: point.x, y: point.y };
  };
  const protocol = cdp();
  const move = (at: CadPoint, held = false) =>
    protocol.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...client(at),
      ...(held && { button: 'left', buttons: 1 }),
    });
  const press = async (at: CadPoint, modifiers = 0) => {
    await move(at);
    await protocol.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...client(at),
      button: 'left',
      buttons: 1,
      clickCount: 1,
      modifiers,
    });
  };
  const release = (at: CadPoint, modifiers = 0) =>
    protocol.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...client(at),
      button: 'left',
      buttons: 0,
      clickCount: 1,
      modifiers,
    });
  const click = async (at: CadPoint, additive = false) => {
    await press(at, additive ? 8 : 0);
    await release(at, additive ? 8 : 0);
  };
  const drag = async (from: CadPoint, to: CadPoint) => {
    await press(from);
    await move(to, true);
    await release(to);
    await settled();
  };
  return { canvas, latest, settled, press, move, release, click, drag };
}

const shifted = (point: CadPoint, delta: CadPoint) => ({ x: point.x + delta.x, y: point.y + delta.y });
const closePoint = (actual: CadPoint, expected: CadPoint) => {
  expect(actual.x).toBeCloseTo(expected.x, 3);
  expect(actual.y).toBeCloseTo(expected.y, 3);
};
function labelAt(canvas: SVGSVGElement, id?: string): CadPoint {
  const box = canvas.querySelector<SVGRectElement>(`${id ? `[data-dimension="${id}"]` : '[data-dimension]'} rect`)!;
  return { x: box.x.baseVal.value + box.width.baseVal.value / 2, y: -(box.y.baseVal.value + box.height.baseVal.value / 2) };
}
function visibleLine(canvas: SVGSVGElement, id: string) {
  const line = canvas.querySelector(`[data-entity-id="${id}"] line[data-visible-curve]`)!;
  return {
    a: { x: Number(line.getAttribute('x1')), y: -Number(line.getAttribute('y1')) },
    b: { x: Number(line.getAttribute('x2')), y: -Number(line.getAttribute('y2')) },
  };
}
function decorations(canvas: SVGSVGElement) {
  return [...canvas.querySelectorAll<SVGLineElement>('line[data-dimension-line]')].map(line => ({
    key: line.getAttribute('data-dimension-line')!,
    a: { x: line.x1.baseVal.value, y: -line.y1.baseVal.value },
    b: { x: line.x2.baseVal.value, y: -line.y2.baseVal.value },
  }));
}
function expectDecorationShift(canvas: SVGSVGElement, before: ReturnType<typeof decorations>, delta: CadPoint) {
  const after = decorations(canvas);
  expect(after.map(line => line.key)).toEqual(before.map(line => line.key));
  before.forEach((line, index) => {
    closePoint(after[index]!.a, shifted(line.a, delta));
    closePoint(after[index]!.b, shifted(line.b, delta));
  });
}

describe('dimension placement follows geometry independently of stored annotation metadata', () => {
  it.each(['line', 'circle'] as const)('carries a manually moved %s dimension during the held drag, Undo/Redo and reload', async kind => {
    const source = createCadDocument(),
      part = createCadPart();
    part.sketch =
      kind === 'line' ? addLine(part.sketch, { x1: 20, y1: 40, x2: 120, y2: 40 }) : addCircle(part.sketch, { x: 100, y: 70, radius: 15 });
    source.parts.push(part);
    const entity = part.sketch.entities.find(entity => entity.type === kind)!;
    const pick = kind === 'line' ? { x: 70, y: 40 } : { x: 115, y: 70 };
    const placed = kind === 'line' ? { x: 70, y: 70 } : { x: 130, y: 90 };
    const manual = kind === 'line' ? { x: 85, y: 75 } : { x: 145, y: 100 };
    const from = kind === 'line' ? pick : { x: 100, y: 70 };
    const delta = { x: 20, y: 40 },
      to = shifted(from, delta);
    const editor = await setup(source);
    await userEvent.keyboard('d');
    await editor.click(pick);
    await editor.click(placed);
    await userEvent.keyboard('{Enter}{Escape}{Escape}');
    await editor.settled();
    closePoint(labelAt(editor.canvas), placed);
    await editor.drag(placed, manual);
    closePoint(labelAt(editor.canvas), manual);
    const beforeDecorations = decorations(editor.canvas);
    expect(beforeDecorations.length).toBeGreaterThan(0);
    const assertGeometry = () => {
      if (kind === 'line') {
        const line = visibleLine(editor.canvas, entity.id);
        closePoint(line.a, { x: 40, y: 80 });
        closePoint(line.b, { x: 140, y: 80 });
      } else {
        const circle = editor.canvas.querySelector<SVGCircleElement>(`[data-entity-id="${entity.id}"] circle[data-visible-curve]`)!;
        closePoint({ x: circle.cx.baseVal.value, y: -circle.cy.baseVal.value }, { x: 120, y: 110 });
        expect(circle.r.baseVal.value).toBeCloseTo(15, 3);
      }
    };
    await editor.press(from);
    try {
      await editor.move(to, true);
      await waitFor(assertGeometry, { timeout: 20_000 });
      await waitFor(() => {
        closePoint(labelAt(editor.canvas), shifted(manual, delta));
        expectDecorationShift(editor.canvas, beforeDecorations, delta);
      });
    } finally {
      await editor.release(to);
    }
    await editor.settled();
    assertGeometry();
    closePoint(labelAt(editor.canvas), shifted(manual, delta));
    await userEvent.keyboard('{Control>}z{/Control}');
    await editor.settled();
    closePoint(labelAt(editor.canvas), manual);
    await userEvent.keyboard('{Control>}y{/Control}');
    await editor.settled();
    closePoint(labelAt(editor.canvas), shifted(manual, delta));
    const portable = parseCadDocument(JSON.parse(JSON.stringify(editor.latest())));
    cleanup();
    endCadSession(portable.id);
    const reloaded = await setup(portable);
    closePoint(labelAt(reloaded.canvas), shifted(manual, delta));
    expectDecorationShift(reloaded.canvas, beforeDecorations, delta);
  });

  it('keeps angle placement through live profile drag, value edits, Undo/Redo and reload', async () => {
    const source = createCadDocument(),
      part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 40, y1: 40, x2: 140, y2: 40 });
    part.sketch = addLine(part.sketch, { x1: 40, y1: 40, x2: 100, y2: 100 });
    const [base, ray] = part.sketch.entities.filter(entity => entity.type === 'line');
    part.sketch = addConstraint(part.sketch, { type: 'horizontal', entityId: base!.id });
    for (const line of [base!, ray!])
      part.sketch = addConstraint(part.sketch, {
        type: 'distance',
        pointAId: line.startId,
        pointBId: line.endId,
        value: line.id === base!.id ? 100 : Math.hypot(60, 60),
      });
    source.parts.push(part);
    const editor = await setup(source),
      placed = { x: 105, y: 65 },
      delta = { x: 20, y: 40 };
    await userEvent.keyboard('d');
    await editor.click({ x: 90, y: 40 });
    await editor.click({ x: 70, y: 70 });
    await editor.click(placed);
    await userEvent.keyboard('{Enter}{Escape}{Escape}');
    await editor.settled();
    const dimension = editor.latest().parts[0]!.sketch.constraints.find(constraint => constraint.type === 'angle')!;
    expect(editor.canvas.closest('.cad-editor')!.querySelector('.cad-status')!.textContent).toContain('2 degrees of freedom');
    const arc = () =>
      editor.canvas
        .querySelector('[data-dimension-line="angle-arc"]')!
        .getAttribute('d')!
        .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
        .map(Number);
    const before = arc();
    closePoint(labelAt(editor.canvas, dimension.id), placed);
    await editor.click({ x: 90, y: 40 });
    await editor.click({ x: 70, y: 70 }, true);
    for (const line of [base!, ray!])
      expect(editor.canvas.querySelector(`[data-entity-id="${line.id}"] [data-visible-curve]`)!.getAttribute('stroke')).toBe('#ff9b23');
    const from = { x: 90, y: 40 },
      to = shifted(from, delta);
    await editor.press(from);
    try {
      await editor.move(to, true);
      await waitFor(() => {
        closePoint(visibleLine(editor.canvas, base!.id).a, { x: 60, y: 80 });
        closePoint(visibleLine(editor.canvas, base!.id).b, { x: 160, y: 80 });
        closePoint(visibleLine(editor.canvas, ray!.id).a, { x: 60, y: 80 });
        closePoint(visibleLine(editor.canvas, ray!.id).b, { x: 120, y: 140 });
      });
      await waitFor(() => {
        closePoint(labelAt(editor.canvas, dimension.id), shifted(placed, delta));
        const after = arc();
        closePoint({ x: after[0]!, y: -after[1]! }, shifted({ x: before[0]!, y: -before[1]! }, delta));
        closePoint({ x: after[7]!, y: -after[8]! }, shifted({ x: before[7]!, y: -before[8]! }, delta));
        expect(after[2]).toBeCloseTo(before[2]!, 3);
        expect(after[3]).toBeCloseTo(before[3]!, 3);
      });
    } finally {
      await editor.release(to);
    }
    await editor.settled();
    const center = visibleLine(editor.canvas, base!.id).a;
    const label = labelAt(editor.canvas, dimension.id);
    const offset = { x: label.x - center.x, y: label.y - center.y };
    await userEvent.dblClick(editor.canvas.querySelector(`[data-dimension="${dimension.id}"]`)!);
    const input = screen.getByRole('textbox', { name: /degrees/ });
    await userEvent.fill(input, '90deg');
    await userEvent.keyboard('{Enter}');
    await editor.settled();
    const changed = editor.latest().parts[0]!.sketch.constraints.find(c => c.id === dimension.id)!;
    expect(changed).toMatchObject({ value: 90 });
    expect('expression' in changed && changed.expression).toBeFalsy();
    const editedCenter = visibleLine(editor.canvas, base!.id).a;
    closePoint(labelAt(editor.canvas, dimension.id), shifted(editedCenter, offset));
    expect(arc()[2]).toBeCloseTo(before[2]!, 3);
    await userEvent.keyboard('{Control>}z{/Control}');
    await editor.settled();
    closePoint(labelAt(editor.canvas, dimension.id), shifted(placed, delta));
    await userEvent.keyboard('{Control>}y{/Control}');
    await editor.settled();
    const editedLabel = labelAt(editor.canvas, dimension.id);
    closePoint(editedLabel, shifted(visibleLine(editor.canvas, base!.id).a, offset));
    const portable = parseCadDocument(JSON.parse(JSON.stringify(editor.latest())));
    cleanup();
    endCadSession(portable.id);
    const reloaded = await setup(portable);
    closePoint(labelAt(reloaded.canvas, dimension.id), editedLabel);
  });

  it('keeps the exact initial location of a portable legacy absolute label through mount and solver normalization', async () => {
    const source = createCadDocument(),
      part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 20, y1: 40, x2: 120, y2: 40 });
    const line = part.sketch.entities.find(entity => entity.type === 'line')!;
    part.sketch = addConstraint(part.sketch, {
      type: 'distance',
      pointAId: line.startId,
      pointBId: line.endId,
      value: 100,
      labelPosition: { x: 85, y: 75 },
    });
    source.parts.push(part);
    const before = structuredClone(source);
    const editor = await setup(JSON.parse(JSON.stringify(source)), canvas => closePoint(labelAt(canvas), { x: 85, y: 75 }));
    closePoint(labelAt(editor.canvas), { x: 85, y: 75 });
    closePoint(visibleLine(editor.canvas, line.id).a, { x: 20, y: 40 });
    closePoint(visibleLine(editor.canvas, line.id).b, { x: 120, y: 40 });
    const normalized = editor.latest().parts[0]!.sketch.constraints.find(constraint => 'value' in constraint)!;
    expect(normalized.value).toBe(100);
    expect(normalized.labelPlacement).toBeDefined();
    expect(normalized.labelPosition).toBeUndefined();
    expect(editor.latest().revision).toBe(source.revision);
    expect(source).toEqual(before);
  });
});
