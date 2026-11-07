import {
  addLine,
  addSpline,
  createCadDocument,
  createCadPart,
  evaluateCurvePoint,
  splineHandleId,
  type CadPointEntity,
  type CadSplineEntity,
} from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const sessions: string[] = [];
afterEach(() => {
  cleanup();
  sessions.splice(0).forEach(endCadSession);
});

async function setup(ordinaryLine = false, straight = false) {
  let sketch = addSpline(createCadPart().sketch, {
    points: [
      { x: 20, y: 40 },
      { x: 180, y: straight ? 40 : 70 },
    ],
  });
  const spline = sketch.entities.find((entity): entity is CadSplineEntity => entity.type === 'spline')!;
  const poles = new Map([
    [spline.controlPointIds[1]!, { x: 100, y: 40 }],
    [spline.controlPointIds[2]!, { x: 120, y: straight ? 40 : 55 }],
  ]);
  sketch = {
    ...sketch,
    entities: sketch.entities.map(entity =>
      entity.type === 'point' && poles.has(entity.id) ? { ...entity, ...poles.get(entity.id)! } : entity
    ),
  };
  let lineId: string | undefined;
  if (ordinaryLine) {
    sketch = addLine(sketch, { x1: 45, y1: 41, x2: 90, y2: 41 });
    lineId = sketch.entities.at(-1)!.id;
  }
  // Stable source geometry isolates hit resolution from constraint solving/dragging.
  sketch = { ...sketch, entities: sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity)) };
  const source = createCadDocument('Closest visible curve');
  source.parts.push({ ...createCadPart(), sketch });
  sessions.push(source.id);
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={() => {}} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await waitFor(
    () => {
      expect(screen.queryByText(/^Checking sketch/)).toBeNull();
      expect(document.querySelector('.cad-editor')!.getAttribute('aria-busy')).toBe('false');
    },
    { timeout: 20_000 }
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const click = async (point: { x: number; y: number }, button: 'left' | 'right' = 'left') => {
    const screenPoint = new DOMPoint(point.x, -point.y).matrixTransform(canvas.getScreenCTM()!),
      bounds = canvas.getBoundingClientRect();
    // This verifies the exact reported obstruction instead of merely aiming nearby.
    expect(document.elementFromPoint(screenPoint.x, screenPoint.y)?.closest('[data-entity-id]')?.getAttribute('data-entity-id')).toBe(
      splineHandleId(spline.id, 'start')
    );
    if (button === 'left') {
      await userEvent.click(canvas, { position: { x: screenPoint.x - bounds.left, y: screenPoint.y - bounds.top } });
    } else {
      const position = { x: screenPoint.x, y: screenPoint.y };
      let frame: Window = window;
      while (frame.frameElement) {
        const frameBounds = frame.frameElement.getBoundingClientRect();
        position.x = frameBounds.left + (position.x * frameBounds.width) / frame.innerWidth;
        position.y = frameBounds.top + (position.y * frameBounds.height) / frame.innerHeight;
        frame = frame.parent;
      }
      const protocol = cdp();
      await protocol.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...position });
      await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'right', buttons: 2, clickCount: 1 });
      await protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'right', buttons: 0, clickCount: 1 });
    }
  };
  const selected = (id: string) =>
    canvas.querySelector(`[data-entity-id="${id}"] [data-visible-curve]`)?.getAttribute('stroke') === '#ff9b23';
  return { sketch, spline, lineId, click, selected };
}

describe('closest visible curve under spline tangent hit areas', () => {
  it('selects an ordinary line closer than the transparent owned handle above it', async () => {
    const { spline, lineId, click, selected } = await setup(true);
    await click({ x: 65, y: 41 });
    expect(selected(lineId!)).toBe(true);
    expect(selected(splineHandleId(spline.id, 'start'))).toBe(false);
  });

  it('uses the closer ordinary line for its right-click context menu', async () => {
    const { spline, lineId, click, selected } = await setup(true);
    await click({ x: 65, y: 41 }, 'right');
    await screen.findByRole('menu');
    expect(selected(lineId!)).toBe(true);
    expect(selected(splineHandleId(spline.id, 'start'))).toBe(false);
  });

  it('keeps a near-straight parent spline reachable beneath its long handle hit area', async () => {
    const { sketch, spline, click, selected } = await setup();
    const points = new Map(
      sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(point => [point.id, point])
    );
    await click(evaluateCurvePoint(spline, points, 0.15));
    expect(selected(spline.id)).toBe(true);
    expect(selected(splineHandleId(spline.id, 'start'))).toBe(false);
  });

  it('retains the painted handle as the selectable operand at an exact geometric overlap', async () => {
    const { spline, click, selected } = await setup(false, true);
    await click({ x: 60, y: 40 });
    expect(selected(splineHandleId(spline.id, 'start'))).toBe(true);
    expect(selected(spline.id)).toBe(false);
  });
});
