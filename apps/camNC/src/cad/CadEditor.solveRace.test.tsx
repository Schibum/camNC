import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { createPlateDocument, type CadDocument, type CadSolveResult } from '@wbcnc/cad';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const solver = vi.hoisted(() => ({ solve: vi.fn<typeof import('./solveCad').solveCadDocument>() }));
vi.mock('./solveCad', async importOriginal => ({
  ...(await importOriginal<typeof import('./solveCad')>()),
  solveCadDocument: solver.solve,
}));

const sessionIds: string[] = [];
afterEach(() => {
  cleanup();
  sessionIds.forEach(endCadSession);
  sessionIds.length = 0;
  solver.solve.mockReset();
});

async function setup() {
  const actual = await vi.importActual<typeof import('./solveCad')>('./solveCad');
  const checked = await actual.solveCadDocument(createPlateDocument(), { classifyEntities: true });
  expect(checked.status).toBe('solved');
  const source = checked.document;
  sessionIds.push(source.id);
  let resolve!: (result: CadSolveResult) => void;
  const pending = new Promise<CadSolveResult>(done => {
    resolve = done;
  });
  solver.solve.mockImplementation(actual.solveCadDocument).mockImplementationOnce(() => pending);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  await waitFor(() => expect(solver.solve).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/^Checking sketch/)).toBeTruthy();
  const corner = source.parts[0]!.sketch.entities.find(entity => entity.type === 'point' && entity.x > 100 && entity.y > 50)!;
  if (corner.type !== 'point') throw new Error('Expected the source corner of the dimensioned plate');
  // The new rectangle graph exposes two coincident endpoints at each corner;
  // the pending gesture belongs to the visible marker the browser really hits.
  const local = new DOMPoint(corner.x, -corner.y).matrixTransform(canvas.getScreenCTM()!);
  const targetId = document.elementFromPoint(local.x, local.y)?.closest('[data-entity-id]')?.getAttribute('data-entity-id');
  const point = source.parts[0]!.sketch.entities.find(entity => entity.id === targetId && entity.type === 'point');
  if (point?.type !== 'point') throw new Error('Expected the visible rectangle corner operand');
  const target = new DOMPoint(point.x, -point.y).matrixTransform(canvas.getScreenCTM()!);
  let frame: Window = window;
  while (frame.frameElement) {
    const bounds = frame.frameElement.getBoundingClientRect();
    target.x = bounds.left + (target.x * bounds.width) / frame.innerWidth;
    target.y = bounds.top + (target.y * bounds.height) / frame.innerHeight;
    frame = frame.parent;
  }
  const position = { x: target.x, y: target.y },
    protocol = cdp();
  await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
  await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', buttons: 1, clickCount: 1 });
  const pointNode = canvas.querySelector<SVGCircleElement>(`circle.cad-point[data-entity-id="${point.id}"]`)!;
  expect(pointNode.getAttribute('fill')).toBe('#ff9b23');
  // Deliver a real native result after selection pointerdown, before any move or release.
  await act(async () => {
    resolve(checked);
    await pending;
  });
  expect(screen.getByText(/^Checking sketch/)).toBeTruthy();
  expect(solver.solve).toHaveBeenCalledTimes(1);
  const release = () =>
    protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', buttons: 0, clickCount: 1 });
  return { source, change, canvas, release };
}

describe('committed solver results during an otherwise stationary pointer gesture', () => {
  it.each(['release', 'Escape'] as const)('rechecks the source after %s without creating a source/history command', async ending => {
    const { source, change, canvas, release } = await setup();
    try {
      if (ending === 'Escape') await userEvent.keyboard('{Escape}');
    } finally {
      await release();
    }
    await waitFor(
      () => {
        expect(solver.solve.mock.calls.length).toBeGreaterThanOrEqual(2);
        expect(screen.queryByText(/^Checking sketch/)).toBeNull();
        expect(screen.getByRole('button', { name: /Finish sketch/ })).toBeEnabled();
      },
      { timeout: 20_000 }
    );
    expect(solver.solve.mock.calls.every(([document]) => document.revision === source.revision)).toBe(true);
    const latest = change.mock.calls.at(-1)?.[0] ?? source;
    expect(latest.revision).toBe(source.revision);
    expect(latest.parts[0]!.sketch.entities.map(entity => entity.id)).toEqual(source.parts[0]!.sketch.entities.map(entity => entity.id));
    expect(latest.parts[0]!.sketch.constraints).toEqual(source.parts[0]!.sketch.constraints);
    for (const entity of source.parts[0]!.sketch.entities) {
      if (entity.type !== 'point') continue;
      const normalized = latest.parts[0]!.sketch.entities.find(candidate => candidate.id === entity.id)!;
      if (normalized.type !== 'point') throw new Error('Point identity changed');
      expect(normalized.x).toBeCloseTo(entity.x, 7);
      expect(normalized.y).toBeCloseTo(entity.y, 7);
    }
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' })).toBeDisabled();
    expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull();
  });
});
