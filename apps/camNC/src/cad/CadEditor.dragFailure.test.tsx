import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { addRectangle, addPoint, createCadDocument, createCadPart, type CadDocument, type CadPoint, type CadSolveResult } from '@wbcnc/cad';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { cadSession, commitCadSession, endCadSession } from './session';

const solver = vi.hoisted(() => ({ solve: vi.fn<typeof import('./solveCad').solveCadDocument>() }));
vi.mock('./solveCad', async importOriginal => ({
  ...(await importOriginal<typeof import('./solveCad')>()),
  solveCadDocument: solver.solve,
}));
const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
  solver.solve.mockReset();
});

function screenPoint(canvas: SVGSVGElement, point: CadPoint) {
  const target = new DOMPoint(point.x, -point.y).matrixTransform(canvas.getScreenCTM()!);
  let frame: Window = window;
  while (frame.frameElement) {
    const bounds = frame.frameElement.getBoundingClientRect();
    target.x = bounds.left + (target.x * bounds.width) / frame.innerWidth;
    target.y = bounds.top + (target.y * bounds.height) / frame.innerHeight;
    frame = frame.parent;
  }
  return { x: target.x, y: target.y };
}

async function fixture(withSnapTarget = false) {
  const actual = await vi.importActual<typeof import('./solveCad')>('./solveCad');
  const input = createCadDocument();
  const part = createCadPart();
  part.sketch = addRectangle(part.sketch, { x: 20, y: 20, width: 70, height: 40 });
  if (withSnapTarget) part.sketch = addPoint(part.sketch, { x: 140, y: 90, fixed: true });
  input.parts.push(part);
  const checked = await actual.solveCadDocument(input);
  expect(checked.status).toBe('solved');
  const session = cadSession(checked.document);
  // An older successful command must survive the failed drag unchanged.
  const source = commitCadSession(session, {
    ...checked.document,
    parts: checked.document.parts.map(p => ({ ...p, name: 'Existing successful edit' })),
  });
  ids.push(source.id);
  solver.solve.mockImplementation(actual.solveCadDocument);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  await waitFor(() => expect(screen.getByRole('button', { name: /Finish sketch/ })).toBeEnabled(), { timeout: 20_000 });
  await userEvent.click(screen.getByRole('button', { name: 'Snap on' }));
  change.mockClear();
  const corner = source.parts[0]!.sketch.entities.find(entity => entity.type === 'point' && entity.x > 80 && entity.y > 50)!;
  if (corner.type !== 'point') throw Error('Expected rectangle corner');
  // Rectangle corners now have two explicitly coincident endpoint UUIDs. Keep
  // the operand actually hit by the real pointer, rather than the first alias
  // in the source array (which can be covered by its partner's point marker).
  const local = new DOMPoint(corner.x, -corner.y).matrixTransform(canvas.getScreenCTM()!);
  const targetId = document.elementFromPoint(local.x, local.y)?.closest('[data-entity-id]')?.getAttribute('data-entity-id');
  const point = source.parts[0]!.sketch.entities.find(entity => entity.id === targetId && entity.type === 'point');
  if (point?.type !== 'point') throw Error('Expected the visible rectangle corner operand');
  const rendered = () => {
    const node = canvas.querySelector<SVGCircleElement>(`circle.cad-point[data-entity-id="${point.id}"]`)!;
    return { x: Number(node.getAttribute('cx')), y: -Number(node.getAttribute('cy')) };
  };
  const protocol = cdp();
  let at = screenPoint(canvas, point);
  const move = async (position: CadPoint) => {
    at = screenPoint(canvas, position);
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at, button: 'left', buttons: 1 });
  };
  const press = async () => {
    at = screenPoint(canvas, point);
    await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
    await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 });
    expect(canvas.querySelector(`circle.cad-point[data-entity-id="${point.id}"]`)?.getAttribute('fill')).toBe('#ff9b23');
  };
  const release = () =>
    protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 });
  return { actual, checked, source, session, change, canvas, point, rendered, move, press, release };
}

describe('atomic drag recovery from a stopped solver', () => {
  it.each([
    ['reset result', false, false],
    ['reset result', true, false],
    ['worker rejection', true, false],
    ['reset result', true, true],
  ] as const)(
    'discards the complete gesture after %s (prior solved preview: %s, released before error: %s)',
    async (failure, priorPreview, releasedBeforeError) => {
      const f = await fixture();
      let resolve!: (result: CadSolveResult) => void;
      let reject!: (reason: Error) => void;
      const failed = new Promise<CadSolveResult>((done, stop) => {
        resolve = done;
        reject = stop;
      });
      let dragCalls = 0;
      const failureCall = priorPreview ? 2 : 1;
      solver.solve.mockImplementation((document, options) => {
        if (options?.drag && ++dragCalls === failureCall) return failed;
        return f.actual.solveCadDocument(document, options);
      });
      const historyLength = f.session.past.length;
      const source = structuredClone(f.session.document);
      try {
        await f.press();
        if (priorPreview) {
          await f.move({ x: f.point.x + 8, y: f.point.y + 5 });
          await waitFor(() => expect(f.rendered().x).not.toBeCloseTo(f.point.x, 2));
        }
        await f.move({ x: f.point.x + 15, y: f.point.y + 9 });
        await waitFor(() => expect(dragCalls).toBe(failureCall));
        // Another pointer intent arrives while the failing request is still pending.
        await f.move({ x: f.point.x + 20, y: f.point.y + 12 });
        if (releasedBeforeError) {
          await f.release();
          expect(f.canvas.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true');
        }
        await act(async () => {
          if (failure === 'worker rejection') reject(new Error('The sketch solver worker stopped. Try the edit again.'));
          else
            resolve({
              ...f.checked,
              document: structuredClone(source),
              status: 'invalid',
              parts: [],
              sketches: f.checked.sketches.map(sketch => ({ ...sketch, status: 'invalid', dof: -1 })),
              diagnostics: [
                {
                  code: 'solver-restarted',
                  severity: 'error',
                  message: 'The sketch solver stopped and its engine was reset. Your sketch is unchanged; try the edit again.',
                },
              ],
            });
          await failed.catch(() => {});
        });
        await waitFor(() => expect(screen.getByText(/Drag cancelled.*try.*again/i)).toBeTruthy());
        expect(f.rendered().x).toBeCloseTo(f.point.x, 7);
        expect(f.rendered().y).toBeCloseTo(f.point.y, 7);
        expect(dragCalls).toBe(failureCall);
        if (!releasedBeforeError) {
          await f.move({ x: f.point.x + 25, y: f.point.y + 15 });
          expect(dragCalls).toBe(failureCall);
        }
      } finally {
        await f.release();
      }
      await waitFor(() => expect(f.canvas.closest('[aria-busy]')).toHaveAttribute('aria-busy', 'false'));
      expect(screen.queryByText(/current constraints keep/)).toBeNull();
      expect(f.session.document).toEqual(source);
      expect(f.session.past).toHaveLength(historyLength);
      expect(f.change).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(f.canvas);

      // Only a new gesture may ask the recovered worker to solve again.
      try {
        await f.press();
        await f.move({ x: f.point.x + 10, y: f.point.y + 6 });
      } finally {
        await f.release();
      }
      await waitFor(() => expect(f.session.past).toHaveLength(historyLength + 1));
      expect(f.session.document.parts[0]!.name).toBe('Existing successful edit');
      expect(f.rendered().x).not.toBeCloseTo(f.point.x, 2);
      await userEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
      await waitFor(() => expect(f.rendered().x).toBeCloseTo(f.point.x, 7));
      expect(f.session.past).toHaveLength(historyLength);
      expect(f.session.document.parts[0]!.name).toBe('Existing successful edit');
    }
  );

  it('retains only the already-solved movement when the automatic drop relation resets the solver', async () => {
    const f = await fixture(true);
    await userEvent.click(screen.getByRole('button', { name: 'Snap off' }));
    let relationAttempts = 0;
    const originalConstraints = new Set(f.source.parts[0]!.sketch.constraints.map(constraint => constraint.id));
    solver.solve.mockImplementation((document, options) => {
      const hasAutomatic = document.parts[0]!.sketch.constraints.some(
        constraint => constraint.type === 'coincident' && !originalConstraints.has(constraint.id)
      );
      if (!options?.drag && hasAutomatic) {
        relationAttempts++;
        return Promise.resolve({
          ...f.checked,
          document,
          status: 'invalid',
          parts: [],
          sketches: f.checked.sketches.map(sketch => ({ ...sketch, status: 'invalid', dof: -1 })),
          diagnostics: [
            {
              code: 'solver-restarted',
              severity: 'error',
              message: 'The sketch solver stopped and its engine was reset. Your sketch is unchanged; try the edit again.',
            },
          ],
        });
      }
      return f.actual.solveCadDocument(document, options);
    });
    const historyLength = f.session.past.length;
    try {
      await f.press();
      await f.move({ x: 140, y: 90 });
      await waitFor(() => expect(f.rendered().x).toBeCloseTo(140, 4));
    } finally {
      await f.release();
    }
    await waitFor(() => expect(f.session.past).toHaveLength(historyLength + 1));
    expect(relationAttempts).toBe(1);
    expect(f.session.document.parts[0]!.sketch.constraints).toEqual(f.source.parts[0]!.sketch.constraints);
    expect(screen.getByText(/Point moved.*solver engine reset.*automatic constraint was not applied/i)).toBeTruthy();
    expect(screen.queryByText(/Your sketch is unchanged/i)).toBeNull();
    expect(f.rendered().x).toBeCloseTo(140, 4);
    await userEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }));
    await waitFor(() => expect(f.rendered().x).toBeCloseTo(f.point.x, 7));
    expect(f.session.past).toHaveLength(historyLength);
  });
});
