import { createCadDocument, createCadPart, type CadDocument, type CadPointEntity, type CadSketch } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});
const checked = () =>
  waitFor(
    () => {
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
    },
    { timeout: 20_000 }
  );
async function setup() {
  const source = createCadDocument('Extend pointer rehearsal');
  source.parts.push(createCadPart());
  sessions.push(source.id);
  const changed = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={changed} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await checked();
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const position = (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    const box = canvas.getBoundingClientRect();
    return { x: p.x - box.left, y: p.y - box.top };
  };
  const click = async (x: number, y: number) => {
    await userEvent.click(canvas, { position: position(x, y) });
    await checked();
  };
  const hover = async (x: number, y: number) => {
    await userEvent.hover(canvas, { position: position(x, y) });
  };
  const latest = () => changed.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? source.parts[0]!.sketch;
  return { canvas, click, hover, latest };
}
const point = (sketch: CadSketch, id: string) =>
  sketch.entities.find((entity): entity is CadPointEntity => entity.id === id && entity.type === 'point')!;
const curves = (sketch: CadSketch) => sketch.entities.filter(entity => entity.type !== 'point');

it('draws an arc, extends its picked end to three quarters, then completes a full circle and undoes each transaction', async () => {
  const { canvas, click, latest } = await setup();
  await userEvent.keyboard('a');
  await click(40, 60);
  await click(80, 60);
  await click(60, 80);
  await userEvent.keyboard('{Escape}{Escape}');
  const before = structuredClone(latest());
  const original = before.entities.find(entity => entity.type === 'arc')!;
  expect(original).toMatchObject({ radius: 20 });
  await userEvent.keyboard('x');
  await click(79, 66);
  expect(latest()).toEqual(before);
  expect(canvas.querySelector('[data-extend-endpoint="start"]')).not.toBeNull();
  await click(60, 40);
  const extended = latest().entities.find(entity => entity.id === original.id);
  expect(extended?.type).toBe('arc');
  if (extended?.type !== 'arc') throw new Error('Expected extended arc');
  expect(extended.radius).toBeCloseTo(20, 5);
  expect(point(latest(), extended.centerId).x).toBeCloseTo(60, 5);
  expect(point(latest(), extended.centerId).y).toBeCloseTo(60, 5);
  const sweep = (((extended.endAngle - extended.startAngle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  expect(sweep).toBeCloseTo(1.5 * Math.PI, 5);
  await click(65, 41);
  await click(40, 60);
  expect(latest().entities.find(entity => entity.id === original.id)).toMatchObject({ type: 'circle', radius: 20 });
  expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull();
  expect(document.querySelector('.cad-editor')!.contains(document.activeElement)).toBe(true);
  await userEvent.keyboard('{Control>}z{/Control}');
  await checked();
  expect(latest().entities.find(entity => entity.id === original.id)).toMatchObject({ type: 'arc', radius: 20 });
  await userEvent.keyboard('{Control>}z{/Control}');
  await checked();
  expect(curves(latest()).map(entity => entity.id)).toEqual([original.id]);
  expect(latest().constraints).toEqual(before.constraints);
  const restored = latest().entities.find(entity => entity.id === original.id);
  if (restored?.type !== 'arc') throw new Error('Expected original arc after Undo');
  expect(restored.startAngle).toBeCloseTo(original.startAngle, 5);
  expect(restored.endAngle).toBeCloseTo(original.endAngle, 5);
}, 30_000);

it('extends a line past its tangent arc junction without moving the arc, removes the line driver, and restores both with one Undo', async () => {
  const { click, latest } = await setup();
  await userEvent.keyboard('l');
  await click(20, 40);
  await click(80, 40);
  await userEvent.keyboard('{Shift>}a{/Shift}');
  await click(100, 60);
  await userEvent.keyboard('{Escape}{Escape}d');
  await click(50, 40);
  await click(50, 20);
  await userEvent.keyboard('60{Enter}');
  await checked();
  await userEvent.keyboard('{Escape}d');
  await click(94, 46);
  await click(115, 45);
  await userEvent.keyboard('20{Enter}');
  await checked();
  await userEvent.keyboard('{Escape}{Escape}');
  const before = structuredClone(latest());
  const line = before.entities.find(entity => entity.type === 'line')!;
  const arc = before.entities.find(entity => entity.type === 'arc')!;
  const length = before.constraints.find(constraint => constraint.label === 'Length')!;
  const radius = before.constraints.find(constraint => constraint.type === 'radius')!;
  expect(length).toMatchObject({ value: 60, sourceEntityId: line.id });
  expect(radius).toMatchObject({ value: 20, entityId: arc.id });
  expect(before.constraints.some(constraint => constraint.type === 'tangent')).toBe(true);
  await userEvent.keyboard('x');
  await click(75, 40);
  await click(120, 40);
  const extendedLine = latest().entities.find(entity => entity.id === line.id);
  if (extendedLine?.type !== 'line') throw new Error('Expected extended line');
  expect(point(latest(), extendedLine.endId).x).toBeCloseTo(120, 4);
  expect(point(latest(), extendedLine.endId).y).toBeCloseTo(40, 4);
  expect(latest().constraints.some(constraint => constraint.id === length.id)).toBe(false);
  expect(latest().constraints).toContainEqual(radius);
  expect(latest().constraints.some(constraint => constraint.type === 'tangent')).toBe(true);
  for (const id of [arc.centerId, arc.startId, arc.endId]) {
    expect(point(latest(), id).x).toBeCloseTo(point(before, id).x, 4);
    expect(point(latest(), id).y).toBeCloseTo(point(before, id).y, 4);
  }
  await userEvent.keyboard('{Control>}z{/Control}');
  await checked();
  expect(latest().constraints).toContainEqual(length);
  expect(latest().constraints).toContainEqual(radius);
  expect(latest().entities.find(entity => entity.id === line.id)).toEqual(line);
  for (const id of [arc.centerId, arc.startId, arc.endId]) {
    expect(point(latest(), id).x).toBeCloseTo(point(before, id).x, 4);
    expect(point(latest(), id).y).toBeCloseTo(point(before, id).y, 4);
  }
  await userEvent.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
  await checked();
  expect(latest().constraints.some(constraint => constraint.id === length.id)).toBe(false);
  expect(latest().constraints).toContainEqual(radius);
}, 30_000);

it('locks the first near-start pick and previews a crossing deletion without publishing it, then undoes one committed deletion', async () => {
  const { canvas, click, hover, latest } = await setup();
  await userEvent.keyboard('l');
  await click(40, 40);
  await click(100, 40);
  await userEvent.keyboard('{Escape}{Escape}');
  const before = structuredClone(latest());
  const line = before.entities.find(entity => entity.type === 'line')!;
  await userEvent.keyboard('x');
  await click(45, 40);
  expect(canvas.querySelector('[data-extend-endpoint="start"]')).not.toBeNull();
  await hover(120, 40);
  await waitFor(() => expect(canvas.querySelector('[data-extend-removes-curve="true"]')).not.toBeNull());
  expect(latest()).toEqual(before);
  await click(120, 40);
  expect(curves(latest())).toHaveLength(0);
  expect(screen.getByText(/Curve removed by crossing its opposite endpoint/)).toBeTruthy();
  await userEvent.keyboard('{Control>}z{/Control}');
  await checked();
  expect(latest().entities.find(entity => entity.id === line.id)).toEqual(line);
  expect(latest().constraints).toEqual(before.constraints);
  expect(point(latest(), line.startId)).toMatchObject({ x: 40, y: 40 });
  expect(point(latest(), line.endId)).toMatchObject({ x: 100, y: 40 });
}, 30_000);

it('cancels the first Extend pick with one Escape, returns to Select, and adds no Undo command', async () => {
  const { canvas, click, latest } = await setup();
  await userEvent.keyboard('l');
  await click(20, 40);
  await click(80, 40);
  await userEvent.keyboard('{Escape}{Escape}');
  const before = structuredClone(latest());
  await userEvent.keyboard('x');
  await click(75, 40);
  expect(canvas.querySelector('[data-extend-endpoint="end"]')).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
  expect(canvas.querySelector('[data-extend-endpoint]')).toBeNull();
  expect(canvas.querySelector('[data-modification-preview]')).toBeNull();
  expect(latest()).toEqual(before);
  await userEvent.keyboard('{Control>}z{/Control}');
  await checked();
  expect(curves(latest())).toHaveLength(0);
}, 30_000);

it('extends to an explicitly picked construction guide and keeps its owned boundary relation through a real guide drag', async () => {
  const { canvas, click, latest } = await setup();
  await userEvent.keyboard('l');
  await click(20, 40);
  await click(80, 40);
  await userEvent.keyboard('{Escape}{Escape}');
  const source = latest().entities.find(entity => entity.type === 'line')!;
  // Anchor the source start with the actual Fix command, so only its extended end can follow.
  await click(20, 40);
  await userEvent.keyboard('{Shift>}j{/Shift}');
  await checked();
  expect(point(latest(), source.startId).fixed).toBe(true);
  await userEvent.keyboard('{Escape}l');
  await click(120, 20);
  await click(120, 80);
  await userEvent.keyboard('{Escape}{Escape}');
  const guide = latest().entities.find(entity => entity.type === 'line' && entity.id !== source.id)!;
  if (guide.type !== 'line') throw new Error('Expected an independent line guide');
  await click(120, 50);
  await userEvent.keyboard('q');
  await checked();
  expect(latest().entities.find(entity => entity.id === guide.id)?.construction).toBe(true);
  await userEvent.keyboard('{Escape}x');
  await click(75, 40);
  await click(120, 60);
  const extended = latest().entities.find(entity => entity.id === source.id);
  if (extended?.type !== 'line') throw new Error('Expected the extended source line');
  expect(point(latest(), extended.endId)).toMatchObject({ x: 120, y: 40 });
  expect(latest().constraints).toContainEqual(
    expect.objectContaining({
      type: 'pointOnLine',
      pointId: extended.endId,
      entityId: guide.id,
    })
  );
  await userEvent.keyboard('{Escape}');
  const client = (x: number, y: number) => {
    const result = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      result.x = bounds.left + (result.x * bounds.width) / frame.innerWidth;
      result.y = bounds.top + (result.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    return { x: result.x, y: result.y };
  };
  const protocol = cdp();
  await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...client(120, 65) });
  await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...client(120, 65), button: 'left', buttons: 1, clickCount: 1 });
  for (let step = 1; step <= 8; step++)
    await protocol.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...client(120 + (20 * step) / 8, 65),
      button: 'left',
      buttons: 1,
    });
  await protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...client(140, 65), button: 'left', buttons: 0, clickCount: 1 });
  await checked();
  await waitFor(() => expect(point(latest(), guide.startId).x).toBeCloseTo(140, 4), { timeout: 20_000 });
  expect(point(latest(), guide.endId).x).toBeCloseTo(140, 4);
  expect(point(latest(), extended.endId).x).toBeCloseTo(140, 4);
  expect(point(latest(), extended.endId).y).toBeCloseTo(40, 4);
  expect(point(latest(), source.startId)).toMatchObject({ x: 20, y: 40, fixed: true });
  expect(latest().constraints).toContainEqual(
    expect.objectContaining({
      type: 'pointOnLine',
      pointId: extended.endId,
      entityId: guide.id,
    })
  );
}, 30_000);
