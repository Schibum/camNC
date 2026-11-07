import { createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
async function setup() {
  const source = createCadDocument();
  source.parts.push(createCadPart());
  ids.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? source.parts[0]!.sketch;
  const checked = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  await checked();
  const click = async (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!),
      bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: p.x - bounds.left, y: p.y - bounds.top } });
  };
  const move = async (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      p.x = bounds.left + (p.x * bounds.width) / frame.innerWidth;
      p.y = bounds.top + (p.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  };
  return { canvas, latest, click, move, checked };
}

it.each(['Spline', 'Bezier'] as const)(
  'Escape retains the three clicked %s points, excludes the hover ghost, and undoes once',
  async name => {
    const { canvas, latest, click, move, checked } = await setup();
    await userEvent.click(
      screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Drawing tools' }) ? 'Drawing tools' : 'Spline tools' })
    );
    await userEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${name}$`) }));
    for (const [x, y] of [
      [20, 20],
      [60, 80],
      [100, 30],
    ])
      await click(x!, y!);
    await move(140, 90);
    expect(latest().entities.filter(entity => entity.type !== 'point')).toHaveLength(0);
    await userEvent.keyboard('{Escape}');
    await checked();
    const curve = latest().entities.find(entity => entity.type === name.toLowerCase())!;
    expect(curve).toBeDefined();
    if (curve.type === 'spline') expect(curve.fitPointIds).toHaveLength(3);
    else if (curve.type === 'bezier') expect(curve.controlPointIds).toHaveLength(3);
    expect(latest().entities.some(entity => entity.type === 'point' && entity.x === 140 && entity.y === 90)).toBe(false);
    expect(canvas.classList.contains(`cad-tool-${name.toLowerCase()}`)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Select (Esc)' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.keyboard('{Control>}z{/Control}');
    await checked();
    expect(latest().entities.filter(entity => entity.type !== 'point')).toHaveLength(0);
    await userEvent.keyboard('{Control>}y{/Control}');
    await checked();
    expect(latest().entities.find(entity => entity.id === curve.id)).toEqual(curve);
  }
);

it.each(['Spline', 'Arc'] as const)('Escape cancels an incomplete %s without inventing geometry', async name => {
  const { latest, click, checked } = await setup();
  const family = name === 'Spline' ? 'Spline tools' : 'Arc tools';
  await userEvent.click(
    screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Drawing tools' }) ? 'Drawing tools' : family })
  );
  await userEvent.click(screen.getByRole('menuitem', { name: name === 'Spline' ? /^Spline$/ : /^Arc \(A\)$/ }));
  await click(20, 20);
  if (name !== 'Spline') await click(100, 20);
  await userEvent.keyboard('{Escape}');
  await checked();
  expect(latest().entities.filter(entity => entity.type !== 'point')).toHaveLength(0);
  expect(latest().entities.filter(entity => entity.type === 'point' && entity.standalone)).toHaveLength(0);
});
