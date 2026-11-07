import { createCadDocument, createCadPart, type CadDocument, type CadEntity } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';
import { tangentLineAxis } from './lineInference';

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
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={document} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  const latest = () => change.mock.calls.at(-1)?.[0] ?? document;
  return { canvas, change, latest, sketch: () => latest().parts[0]!.sketch };
}
function pointer(type: 'move' | 'down', x: number, y: number) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  const event = { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 };
  if (type === 'down') fireEvent.pointerDown(canvas, event);
  else fireEvent.pointerMove(canvas, event);
}
const click = (x: number, y: number) => pointer('down', x, y);
const move = (x: number, y: number) => pointer('move', x, y);
const key = (key: string, shiftKey = false) => fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key, shiftKey });
function selectCurve(id: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Select (Esc)' }));
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const group = canvas.querySelector(`.cad-entity[data-entity-id="${id}"]`)!;
  const shape = group.querySelector('line,path') as SVGGeometryElement;
  const p = shape.getPointAtLength(shape.getTotalLength() / 2).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerDown(shape, { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 });
}
async function dimension(id: string, label: string, value: string, x: number, y: number) {
  selectCurve(id);
  key('d');
  click(x, y);
  fireEvent.change(await screen.findByRole('textbox', { name: `${label} mm` }, { timeout: 20_000 }), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
}
const lastLine = (entities: CadEntity[]) => entities.filter((e): e is Extract<CadEntity, { type: 'line' }> => e.type === 'line').at(-1)!;

describe('axis intent alongside tangent continuation', () => {
  it('does not infer an axis from a non-axis tangent or an out-of-range raw cursor', () => {
    expect(tangentLineAxis({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 40 }, 2)).toBeNull();
    expect(tangentLineAxis({ x: 0, y: 20 }, { x: 0, y: 0 }, { x: 4.01, y: 40 }, 2)).toBeNull();
    expect(tangentLineAxis({ x: 0, y: 20 }, { x: 0, y: 0 }, { x: 4, y: 40 }, 2)).toBe('vertical');
    expect(tangentLineAxis({ x: 1, y: 2e-7 }, { x: 0, y: 0 }, { x: 40, y: 0 }, 2)).toBeNull();
  });

  it('previews and retains V plus T after a quarter arc, including after its radius changes', async () => {
    const { canvas, sketch } = await setup();
    key('l');
    click(20, 20);
    click(60, 20);
    key('A', true);
    click(80, 40);
    move(81, 85);
    expect(canvas.querySelector('[data-inferred-constraint="tangent"]')).not.toBeNull();
    expect(canvas.querySelector('[data-inferred-constraint="vertical"]')).not.toBeNull();
    expect(canvas.querySelector('[data-inference-guide="vertical"]')).not.toBeNull();
    click(81, 85);
    const line = lastLine(sketch().entities),
      arc = sketch().entities.find(e => e.type === 'arc')!;
    expect(sketch().constraints).toContainEqual(expect.objectContaining({ type: 'vertical', entityId: line.id }));
    expect(sketch().constraints).toContainEqual(expect.objectContaining({ type: 'tangent', entityAId: arc.id, entityBId: line.id }));
    await dimension(arc.id, 'radius', '22', 115, 65);
    await waitFor(() => expect(sketch().entities.find(e => e.id === arc.id)).toMatchObject({ radius: expect.closeTo(22) }), {
      timeout: 20_000,
    });
    const start = sketch().entities.find(e => e.id === line.startId)!,
      end = sketch().entities.find(e => e.id === line.endId)!;
    if (start.type !== 'point' || end.type !== 'point') throw new Error('Missing vertical line points');
    expect(start.x).toBeCloseTo(end.x, 7);
    expect(sketch().constraints).toContainEqual(expect.objectContaining({ type: 'vertical', entityId: line.id }));
  }, 30_000);

  it('allows a tangent horizontal continuation to align its end with a remote point', async () => {
    const { canvas, change, sketch } = await setup();
    key('l');
    click(21, 0);
    click(94, 0);
    key('A', true);
    click(94, 42);
    const bottom = sketch().entities.find(e => e.type === 'line')!,
      arc = sketch().entities.find(e => e.type === 'arc')!;
    change.mockClear();
    move(21, 0);
    move(21.000008, 42);
    expect(canvas.querySelector('[data-inferred-constraint="tangent"]')).not.toBeNull();
    expect(canvas.querySelector('[data-inferred-constraint="horizontal"]')).not.toBeNull();
    expect(canvas.querySelector('[data-inferred-constraint="verticalPoints"]')).not.toBeNull();
    expect(change).not.toHaveBeenCalled();
    click(21.000008, 42);
    const top = lastLine(sketch().entities);
    expect(sketch().constraints).toContainEqual(expect.objectContaining({ type: 'horizontal', entityId: top.id }));
    expect(sketch().constraints).toContainEqual(expect.objectContaining({ type: 'tangent', entityAId: arc.id, entityBId: top.id }));
    expect(sketch().constraints).toContainEqual(
      expect.objectContaining({ type: 'verticalPoints', pointAId: bottom.startId, pointBId: top.endId })
    );
  });

  it('keeps a non-axis tangent continuation free of contradictory H/V constraints', async () => {
    const { canvas, sketch } = await setup();
    key('l');
    click(20, 20);
    click(60, 20);
    key('A', true);
    click(80, 50);
    move(80 - 25 / 3, 70);
    expect(canvas.querySelector('[data-inferred-constraint="tangent"]')).not.toBeNull();
    expect(canvas.querySelector('[data-inferred-constraint="vertical"]')).toBeNull();
    expect(canvas.querySelector('[data-inferred-constraint="horizontal"]')).toBeNull();
    click(80 - 25 / 3, 70);
    const line = lastLine(sketch().entities);
    expect(sketch().constraints.some(c => c.type === 'tangent' && c.entityBId === line.id)).toBe(true);
    expect(sketch().constraints.some(c => (c.type === 'horizontal' || c.type === 'vertical') && c.entityId === line.id)).toBe(false);
  });

  it('keeps the Corbel right edge vertical after sequential span and corner-radius edits', async () => {
    const { sketch } = await setup();
    key('l');
    click(22, 0);
    click(88, 0);
    key('A', true);
    click(110, 22);
    click(110, 78);
    key('A', true);
    click(88, 100);
    click(22, 100);
    key('A', true);
    click(0, 78);
    click(0, 22);
    key('A', true);
    click(22, 0);
    key('Escape');
    key('Escape');
    const lines = sketch().entities.filter((e): e is Extract<CadEntity, { type: 'line' }> => e.type === 'line');
    const arc = sketch().entities.find(e => e.type === 'arc')!;
    await dimension(lines[0]!.id, 'Length', '70', 60, -15);
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
    await dimension(arc.id, 'radius', '24', 145, 70);
    await waitFor(() => expect(sketch().entities.find(e => e.id === arc.id)).toMatchObject({ radius: expect.closeTo(24) }), {
      timeout: 20_000,
    });
    const right = lines[1]!,
      a = sketch().entities.find(e => e.id === right.startId)!,
      b = sketch().entities.find(e => e.id === right.endId)!;
    if (a.type !== 'point' || b.type !== 'point') throw new Error('Missing right edge');
    expect(a.x).toBeCloseTo(b.x, 7);
    expect(sketch().constraints).toContainEqual(expect.objectContaining({ type: 'vertical', entityId: right.id }));
    expect(sketch().constraints).toContainEqual(expect.objectContaining({ type: 'tangent', entityAId: arc.id, entityBId: right.id }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ }).hasAttribute('disabled')).toBe(false), {
      timeout: 20_000,
    });
  }, 30_000);
});
