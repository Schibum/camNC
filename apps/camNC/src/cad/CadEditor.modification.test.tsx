import {
  addCircle,
  addConstraint,
  addLine,
  addRectangle,
  addSpline,
  createCadDocument,
  createCadPart,
  type CadDocument,
  type CadSketch,
} from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';
import { saveCadViewState } from './viewState';

const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
async function setup(sketch: CadSketch, selectedEntityIds: string[] = []) {
  const document = createCadDocument();
  const part = createCadPart();
  document.parts.push({ ...part, sketch });
  if (selectedEntityIds.length)
    saveCadViewState(document.id, { selectedPartId: part.id, selectedEntityIds, view: { x: -35, y: -175, w: 300, h: 210 } });
  ids.push(document.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={document} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await checked();
  change.mockClear();
  return { canvas, change, latest: () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? sketch };
}
const checked = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
function pointer(type: 'down' | 'move' | 'up', x: number, y: number, shiftKey = false) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  const event = { clientX: p.x, clientY: p.y, button: 0, pointerId: 1, shiftKey };
  if (type === 'down') fireEvent.pointerDown(canvas, event);
  else if (type === 'move') fireEvent.pointerMove(canvas, event);
  else fireEvent.pointerUp(canvas, event);
}
const key = (key: string, modifiers = {}) => fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key, ...modifiers });
const curves = (sketch: CadSketch) => sketch.entities.filter(entity => entity.type !== 'point');

describe('CAD modification command boundaries', () => {
  it('stages a multi-corner fillet without publishing a draft and applies its shared radius as one Undo command', async () => {
    const original = addRectangle(createCadPart().sketch, { x: 20, y: 20, width: 120, height: 80, dimensioned: true, positioned: true });
    const { canvas, change, latest } = await setup(original);
    key('a', { ctrlKey: true });
    key('f', { shiftKey: true });
    expect(canvas.querySelectorAll('.cad-entity path')).not.toHaveLength(0);
    expect(change).not.toHaveBeenCalled();
    expect(latest()).toEqual(original);
    key('Enter');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Fillet radius' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Fillet radius' }), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply fillets' }));
    await checked();
    expect(latest().entities.filter(entity => entity.type === 'arc')).toHaveLength(4);
    expect(latest().constraints.filter(constraint => constraint.type === 'radius')).toHaveLength(1);
    expect(latest().constraints.filter(constraint => constraint.type === 'equal')).toHaveLength(3);
    expect(
      latest()
        .entities.filter(entity => entity.type === 'arc')
        .every(arc => Math.abs(arc.radius - 12) < 1e-5)
    ).toBe(true);
    key('z', { ctrlKey: true });
    expect(curves(latest()).map(entity => entity.id)).toEqual(curves(original).map(entity => entity.id));
    expect(latest().constraints).toEqual(original.constraints);
    key('z', { ctrlKey: true, shiftKey: true });
    await checked();
    expect(latest().entities.filter(entity => entity.type === 'arc')).toHaveLength(4);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Fillet radius: 12 mm' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Fillet radius mm' }), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
    await checked();
    expect(
      latest()
        .entities.filter(entity => entity.type === 'arc')
        .every(arc => Math.abs(arc.radius - 15) < 1e-5)
    ).toBe(true);
  });

  it('cancels invalid fillet previews without changing geometry or adding an Undo entry', async () => {
    const original = addRectangle(createCadPart().sketch, { x: 20, y: 20, width: 100, height: 60 });
    const { canvas, change, latest } = await setup(original);
    key('a', { ctrlKey: true });
    key('f', { shiftKey: true });
    fireEvent.change(screen.getByRole('textbox', { name: 'Fillet radius' }), { target: { value: '100' } });
    expect(screen.getByRole('button', { name: 'Apply fillets' }).hasAttribute('disabled')).toBe(true);
    expect(canvas.querySelector('[data-fillet-error]')).not.toBeNull();
    key('Escape');
    expect(screen.queryByRole('textbox', { name: 'Fillet radius' })).toBeNull();
    expect(change).not.toHaveBeenCalled();
    expect(latest()).toEqual(original);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
  });

  it('trims a placed midpoint into a persistent line endpoint and retains horizontal intent', async () => {
    let original = addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 110, y2: 20 });
    const line = original.entities.find(entity => entity.type === 'line')!;
    original = addConstraint(original, { type: 'horizontal', entityId: line.id });
    const { latest } = await setup(original);
    key('s', { shiftKey: true });
    pointer('down', 60, 20);
    const middle = latest().entities.find(entity => entity.type === 'point' && entity.standalone)!;
    expect(latest().constraints.some(constraint => constraint.type === 'midpoint')).toBe(true);
    key('m');
    pointer('down', 85, 20);
    await checked();
    expect(latest().entities.find(entity => entity.id === line.id)).toMatchObject({ startId: line.startId, endId: middle.id });
    expect(latest().entities.find(entity => entity.id === middle.id)).toMatchObject({ x: 60, y: 20 });
    expect(latest().constraints.some(constraint => constraint.type === 'midpoint')).toBe(false);
    expect(latest().constraints).toContainEqual(expect.objectContaining({ type: 'horizontal', entityId: line.id }));
    key('z', { ctrlKey: true });
    expect(latest().entities.find(entity => entity.id === line.id)).toEqual(line);
    expect(latest().constraints.some(constraint => constraint.type === 'midpoint')).toBe(true);
  });

  it('creates persistent coincidence when an endpoint is dragged onto another endpoint, in one Undo command', async () => {
    let original = addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 60, y2: 40 });
    original = addLine(original, { x1: 120, y1: 80, x2: 160, y2: 30 });
    const [first, second] = original.entities.filter(entity => entity.type === 'line');
    const { latest } = await setup(original);
    pointer('down', 60, 40);
    pointer('move', 120, 80);
    pointer('up', 120, 80);
    await waitFor(
      () =>
        expect(latest().constraints).toContainEqual(
          expect.objectContaining({ type: 'coincident', pointAId: first!.endId, pointBId: second!.startId })
        ),
      { timeout: 5_000 }
    );
    await checked();
    pointer('down', 120, 80);
    pointer('move', 135, 95);
    pointer('up', 135, 95);
    await waitFor(
      () => {
        const point = latest().entities.find(entity => entity.id === first!.endId)!;
        expect(point.type).toBe('point');
        if (point.type === 'point') {
          expect(point.x).toBeCloseTo(135, 4);
          expect(point.y).toBeCloseTo(95, 4);
        }
      },
      { timeout: 5_000 }
    );
    const secondPoint = latest().entities.find(entity => entity.id === second!.startId)!;
    if (secondPoint.type === 'point') {
      expect(secondPoint.x).toBeCloseTo(135, 4);
      expect(secondPoint.y).toBeCloseTo(95, 4);
    }
    key('z', { ctrlKey: true });
    expect(latest().constraints.some(constraint => constraint.type === 'coincident')).toBe(true);
    key('z', { ctrlKey: true });
    expect(latest().constraints).toEqual(original.constraints);
    expect(latest().entities).toEqual(original.entities);
  });

  it.each([1, 2])('uses %i placed circle points as trim boundaries and preserves their independent identities', async count => {
    const original = addCircle(createCadPart().sketch, { x: 70, y: 80, radius: 25 });
    const circle = original.entities.find(entity => entity.type === 'circle')!;
    const { latest } = await setup(original);
    key('s', { shiftKey: true });
    pointer('down', 95, 80);
    if (count === 2) pointer('down', 45, 80);
    const points = latest().entities.filter(entity => entity.type === 'point' && entity.standalone);
    expect(points).toHaveLength(count);
    key('m');
    pointer('down', 70, 105);
    await checked();
    expect(latest().entities.filter(entity => entity.type === 'circle')).toHaveLength(0);
    expect(
      latest()
        .entities.filter(entity => entity.type === 'point' && entity.standalone)
        .map(entity => entity.id)
    ).toEqual(points.map(entity => entity.id));
    if (count === 1) {
      expect(latest().entities.some(entity => entity.id === circle.centerId)).toBe(false);
      expect(curves(latest())).toHaveLength(0);
    } else {
      const arc = latest().entities.find(entity => entity.type === 'arc')!;
      expect(arc).toMatchObject({ id: circle.id, centerId: circle.centerId, radius: 25 });
      expect(new Set([arc.startId, arc.endId])).toEqual(new Set(points.map(entity => entity.id)));
      expect(arc.endAngle - arc.startAngle).toBeCloseTo(Math.PI, 5);
    }
  });

  it('suppresses persistent drag inference while Shift is held', async () => {
    let original = addLine(createCadPart().sketch, { x1: 10, y1: 20, x2: 60, y2: 40 });
    original = addLine(original, { x1: 120, y1: 80, x2: 160, y2: 30 });
    const { canvas, latest } = await setup(original);
    pointer('down', 60, 40);
    pointer('move', 120, 80, true);
    pointer('up', 120, 80, true);
    await waitFor(() => expect(latest().entities).not.toEqual(original.entities), { timeout: 20_000 });
    expect(latest().constraints).toEqual([]);
    expect(canvas.querySelector('[data-inferred-constraint]')).toBeNull();
  });

  it('starts a standalone tangent arc at an existing endpoint after leaving an armed point constraint', async () => {
    const original = addLine(createCadPart().sketch, { x1: 10, y1: 40, x2: 70, y2: 40 });
    const line = original.entities.find(entity => entity.type === 'line')!;
    const { latest } = await setup(original);
    key('i');
    key('a', { shiftKey: true });
    pointer('down', 70, 40);
    pointer('down', 90, 60);
    const arc = latest().entities.find(entity => entity.type === 'arc')!;
    expect(arc).toBeDefined();
    expect([arc.startId, arc.endId]).toContain(line.endId);
    expect(latest().constraints).toContainEqual(expect.objectContaining({ type: 'tangent', entityAId: line.id, entityBId: arc.id }));
    expect(screen.getByRole('button', { name: 'Line (L)' }).getAttribute('aria-pressed')).toBe('true');
    await checked();
  });

  it('honors the preselected tangent source at a coincident joint and continues from the new arc end', async () => {
    let original = addLine(createCadPart().sketch, { x1: 10, y1: 40, x2: 70, y2: 40 });
    const first = original.entities.find(entity => entity.type === 'line')!;
    original = addLine(original, { x1: 80, y1: 60, x2: 80, y2: 100 });
    const second = original.entities.filter(entity => entity.type === 'line')[1]!;
    original.entities = original.entities.map(entity => (entity.id === second.startId ? { ...entity, x: 70, y: 40 } : entity));
    original = addConstraint(original, { type: 'coincident', pointAId: first.endId, pointBId: second.startId });
    const { latest } = await setup(original);
    pointer('down', 75, 70, true);
    key('a', { shiftKey: true });
    pointer('down', 70, 40);
    pointer('down', 100, 50);
    const arc = latest().entities.find(entity => entity.type === 'arc')!;
    expect(arc).toBeDefined();
    expect(latest().constraints).toContainEqual(expect.objectContaining({ type: 'tangent', entityAId: second.id, entityBId: arc.id }));
    pointer('down', 130, 70);
    const continuation = latest().entities.filter(entity => entity.type === 'line')[2]!;
    const map = new Map(
      latest()
        .entities.filter(entity => entity.type === 'point')
        .map(point => [point.id, point])
    );
    expect(map.get(continuation.startId)!.x).toBeCloseTo(100, 5);
    expect(map.get(continuation.startId)!.y).toBeCloseTo(50, 5);
    await checked();
  });

  it.each(['window', 'crossing'] as const)(
    'uses %s marquee selection without selecting owned endpoints or deleting neighboring curves',
    async mode => {
      let original = addLine(createCadPart().sketch, { x1: 30, y1: 50, x2: 60, y2: 50 });
      original = addLine(original, { x1: 10, y1: 70, x2: 120, y2: 70 });
      const [short, long] = original.entities.filter(entity => entity.type === 'line');
      const { canvas, change, latest } = await setup(original);
      const [start, end] =
        mode === 'window'
          ? [
              [20, 40],
              [80, 80],
            ]
          : [
              [80, 80],
              [20, 40],
            ];
      pointer('down', start![0]!, start![1]!);
      pointer('move', end![0]!, end![1]!);
      expect(canvas.querySelector(`[data-sketch-selection-box="${mode}"]`)).not.toBeNull();
      pointer('up', end![0]!, end![1]!);
      expect(canvas.querySelector('[data-sketch-selection-box]')).toBeNull();
      expect(change).not.toHaveBeenCalled();
      key('Delete');
      expect(curves(latest()).map(entity => entity.id)).toEqual(mode === 'window' ? [long!.id] : []);
      expect(latest().entities.some(entity => entity.id === short!.id)).toBe(false);
      key('z', { ctrlKey: true });
      expect(curves(latest())).toEqual(curves(original));
    }
  );

  it('adds marquee results with Shift and cancels the box without changing source', async () => {
    let original = addLine(createCadPart().sketch, { x1: 30, y1: 50, x2: 60, y2: 50 });
    original = addLine(original, { x1: 170, y1: 50, x2: 210, y2: 50 });
    const { canvas, change, latest } = await setup(original);
    pointer('down', 190, 50, true);
    pointer('down', 20, 40, true);
    pointer('move', 80, 80, true);
    pointer('up', 80, 80, true);
    key('Delete');
    expect(curves(latest())).toEqual([]);
    key('z', { ctrlKey: true });
    change.mockClear();
    pointer('down', 20, 40);
    pointer('move', 80, 80);
    key('Escape');
    expect(canvas.querySelector('[data-sketch-selection-box]')).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it('protects a white spline tangent handle from Delete without publishing a command', async () => {
    const original = addSpline(createCadPart().sketch, {
      points: [
        { x: 20, y: 20 },
        { x: 50, y: 60 },
        { x: 90, y: 30 },
        { x: 120, y: 20 },
      ],
    });
    const curve = original.entities.find(entity => entity.type === 'spline')!;
    const handle = original.entities.find(entity => entity.id === curve.controlPointIds[1])!;
    if (handle.type !== 'point') throw Error();
    const { change, latest } = await setup(original);
    pointer('down', handle.x, handle.y, true);
    key('Delete');
    expect(screen.getByText('Spline tangent handles cannot be deleted individually. Select the curve to delete it.')).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
    expect(latest().entities.find(entity => entity.id === curve.id)).toEqual(curve);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
  });

  it('drops restored invisible spline-pole selection before Delete can remove its owning curve', async () => {
    const original = addSpline(createCadPart().sketch, {
      points: [
        { x: 20, y: 20 },
        { x: 50, y: 60 },
        { x: 90, y: 30 },
        { x: 120, y: 20 },
      ],
    });
    const curve = original.entities.find(entity => entity.type === 'spline')!;
    const { latest } = await setup(original, [curve.controlPointIds[2]!]);
    key('Delete');
    expect(latest().entities.find(entity => entity.id === curve.id)).toEqual(curve);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
  });
});
