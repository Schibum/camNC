import {
  createCadDocument,
  createCadPart,
  createPlateDocument,
  pointEquivalence,
  type CadDocument,
  type CadLineEntity,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
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
const settled = () =>
  waitFor(
    () => {
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
    },
    { timeout: 20_000 }
  );
const points = (sketch: CadSketch) => new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
async function setup(source: CadDocument) {
  sessions.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? source.parts[0]!.sketch;
  const click = async (x: number, y: number) => {
    const client = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!),
      bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: client.x - bounds.left, y: client.y - bounds.top } });
    await settled();
  };
  const client = (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      p.x = bounds.left + (p.x * bounds.width) / frame.innerWidth;
      p.y = bounds.top + (p.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    return { x: p.x, y: p.y };
  };
  const drag = async (x: number, y: number, tx: number, ty: number) => {
    const protocol = cdp();
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...client(x, y) });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...client(x, y), button: 'left', buttons: 1, clickCount: 1 });
    for (let step = 1; step <= 8; step++)
      await protocol.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        ...client(x + ((tx - x) * step) / 8, y + ((ty - y) * step) / 8),
        button: 'left',
        buttons: 1,
      });
    await protocol.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...client(tx, ty),
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await settled();
  };
  return { canvas, latest, click, drag };
}

it('deletes a real corner Coincident glyph, drags only the detached alias, and restores each command with Undo', async () => {
  const { canvas, latest, drag } = await setup(createPlateDocument({ width: 100, height: 60 }));
  const original = structuredClone(latest()),
    edges = original.entities.filter((e): e is CadLineEntity => e.type === 'line' && !e.construction);
  const right = edges[1]!,
    top = edges[2]!;
  expect(right.endId).not.toBe(top.startId);
  const join = original.constraints.find(
    c => c.type === 'coincident' && [c.pointAId, c.pointBId].includes(right.endId) && [c.pointAId, c.pointBId].includes(top.startId)
  )!;
  expect(join).toBeDefined();
  await userEvent.click(canvas.querySelector(`[data-constraint-id="${join.id}"]`)!);
  await userEvent.keyboard('{Delete}');
  await settled();
  expect(latest().constraints.some(c => c.id === join.id)).toBe(false);
  expect(latest().entities.filter(e => e.type === 'line' && !e.construction)).toHaveLength(4);
  await drag(100, 60, 130, 80);
  await waitFor(() => expect(points(latest()).get(top.startId)!.x).toBeCloseTo(130, 3), { timeout: 20_000 });
  expect(points(latest()).get(top.startId)!.y).toBeCloseTo(80, 3);
  expect(points(latest()).get(right.endId)!.x).toBeCloseTo(100, 3);
  expect(points(latest()).get(right.endId)!.y).toBeCloseTo(60, 3);
  expect(canvas.querySelector('[data-sketch-region]')).toBeNull();
  await userEvent.keyboard('{Control>}z{/Control}');
  await settled();
  expect(points(latest()).get(top.startId)!.x).toBeCloseTo(100, 3);
  expect(latest().constraints.some(c => c.id === join.id)).toBe(false);
  await userEvent.keyboard('{Control>}z{/Control}');
  await settled();
  expect(latest().constraints).toContainEqual(join);
  expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull();
});

it.each([true, false])('uses explicit origin snap intent for fresh rectangle endpoints (snap=%s)', async enabled => {
  const source = createCadDocument();
  source.parts.push(createCadPart());
  const { canvas, latest, click } = await setup(source);
  if (!enabled) await userEvent.click(screen.getByRole('button', { name: 'Snap on' }));
  await userEvent.keyboard('g');
  await click(0, 0);
  await click(100, 60);
  await userEvent.keyboard('{Escape}{Escape}');
  await settled();
  const sketch = latest(),
    edges = sketch.entities.filter((e): e is CadLineEntity => e.type === 'line' && !e.construction);
  const endpoints = new Set(edges.flatMap(e => [e.startId, e.endId]));
  expect(endpoints.size).toBe(8);
  const joins = sketch.constraints.filter(c => c.type === 'coincident' && endpoints.has(c.pointAId) && endpoints.has(c.pointBId));
  expect(joins).toHaveLength(4);
  for (const join of joins) expect(canvas.querySelector(`[data-constraint-id="${join.id}"]`)).not.toBeNull();
  expect(pointEquivalence(sketch.constraints).equivalent(edges[0]!.startId, `${sketch.id}:origin`)).toBe(enabled);
});
