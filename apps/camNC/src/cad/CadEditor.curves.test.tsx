import {
  addBezier,
  addLine,
  addSpline,
  createCadDocument,
  createCadPart,
  evaluateCurvePoint,
  type CadDocument,
  type CadPointEntity,
  type CadSketch,
} from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';
import { pickSketchSnap } from './picking';
const ids: string[] = [];
afterEach(() => {
  cleanup();
  ids.forEach(endCadSession);
  ids.length = 0;
});
async function setup(sketch = createCadPart().sketch) {
  const doc = createCadDocument();
  doc.parts.push({ ...createCadPart(), sketch });
  ids.push(doc.id);
  const change = vi.fn<(document: CadDocument) => void>();
  const result = render(
    <div style={{ height: 700 }}>
      <CadEditor document={doc} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await checked();
  change.mockClear();
  return { ...result, canvas, change, latest: () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? sketch };
}
const checked = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20000 });
function click(x: number, y: number) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement,
    p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  fireEvent.pointerDown(canvas, { clientX: p.x, clientY: p.y, button: 0, pointerId: 1 });
}
const key = (key: string, modifiers = {}) => fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key, ...modifiers });
async function tool(name: string) {
  const family = /arc/i.test(name) || name === 'Conic' ? 'Arc tools' : 'Spline tools';
  await userEvent.click(
    screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Drawing tools' }) ? 'Drawing tools' : family })
  );
  await userEvent.click(screen.getByRole('menuitem', { name }));
}
const curveCount = (s: CadSketch) => s.entities.filter(e => e.type !== 'point').length;
describe('conic and spline drawing commands', () => {
  it('creates a three-click conic, focuses rho, and applies it as the same undo command', async () => {
    const { canvas, latest } = await setup();
    await tool('Conic');
    click(20, 20);
    click(100, 20);
    click(60, 75);
    const rho = screen.getByRole('textbox', { name: 'Conic rho' });
    expect(document.activeElement).toBe(rho);
    fireEvent.change(rho, { target: { value: '0.7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply rho' }));
    await checked();
    const conic = latest().entities.find(e => e.type === 'conic')!;
    expect(conic.rho).toBe(0.7);
    expect(canvas.querySelector(`[data-conic-rho="${conic.id}"]`)).not.toBeNull();
    expect(document.activeElement).toBe(canvas);
    key('z', { ctrlKey: true });
    expect(curveCount(latest())).toBe(0);
    key('z', { ctrlKey: true, shiftKey: true });
    await checked();
    expect(latest().entities.find(e => e.type === 'conic')!.rho).toBe(0.7);
  });
  it.each(['Spline', 'Bezier'])('finishes %s on double-click with editable native source points and no numeric focus theft', async name => {
    const { canvas, latest } = await setup();
    await tool(name);
    for (const [x, y] of [
      [20, 20],
      [45, 65],
      [80, 45],
      [110, 20],
    ])
      click(x!, y!);
    fireEvent.doubleClick(canvas);
    await checked();
    const curve = latest().entities.find(e => e.type === name.toLowerCase())!;
    expect(curve).toBeDefined();
    expect(document.activeElement).toBe(canvas);
    const points = new Map(
      latest()
        .entities.filter((e): e is CadPointEntity => e.type === 'point')
        .map(e => [e.id, e])
    );
    if (curve.type === 'spline') {
      expect(curve.fitPointIds).toHaveLength(4);
      expect(curve.controlPointIds).toHaveLength(6);
      for (let i = 0; i < 4; i++) {
        const p = evaluateCurvePoint(curve, points, curve.fitParameters[i]!);
        expect(p.x).toBeCloseTo(points.get(curve.fitPointIds[i]!)!.x, 5);
        expect(p.y).toBeCloseTo(points.get(curve.fitPointIds[i]!)!.y, 5);
      }
      expect(canvas.querySelector(`circle.cad-point[data-entity-id="${curve.controlPointIds[1]}"]`)!.getAttribute('fill')).toBe('#fff');
    } else if (curve.type === 'bezier') {
      expect(curve.controlPointIds).toHaveLength(4);
      expect(canvas.querySelector(`[data-control-polygon="${curve.id}"]`)).not.toBeNull();
    }
    key('l');
    expect(canvas.classList.contains('cad-tool-line')).toBe(true);
  });
  it('starts the standalone tangent arc tool from an existing endpoint and returns to a connected Line', async () => {
    const sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 70, y2: 20 }),
      line = sketch.entities.at(-1)!;
    const { canvas, latest } = await setup(sketch);
    await tool('Tangent arc (Shift+A)');
    click(70, 20);
    click(95, 45);
    await checked();
    const arc = latest().entities.find(e => e.type === 'arc')!;
    expect(arc).toBeDefined();
    expect([arc.startId, arc.endId]).toContain(line.type === 'line' ? line.endId : '');
    expect(latest().constraints).toContainEqual(expect.objectContaining({ type: 'tangent', entityAId: line.id, entityBId: arc.id }));
    expect(canvas.classList.contains('cad-tool-line')).toBe(true);
    click(95, 75);
    await checked();
    expect(latest().entities.filter(e => e.type === 'line')).toHaveLength(2);
  });
  it('remembers the chosen drawing-family primary after switching to another command', async () => {
    await setup();
    await tool('Bezier');
    key('Escape');
    expect(screen.getByRole('button', { name: 'Bezier' })).toBeDefined();
    key('d');
    key('Escape');
    expect(screen.getByRole('button', { name: 'Bezier' })).toBeDefined();
  });
  it('adds a control using the drawing flyout without changing the analytic curve and undoes it once', async () => {
    const original = addBezier(createCadPart().sketch, {
        points: [
          { x: 20, y: 20 },
          { x: 45, y: 70 },
          { x: 80, y: 50 },
          { x: 110, y: 20 },
        ],
      }),
      curve = original.entities.at(-1)!;
    if (curve.type !== 'bezier') throw Error();
    const map = (s: CadSketch) => new Map(s.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
    const before = Array.from({ length: 51 }, (_, i) => evaluateCurvePoint(curve, map(original), i / 50));
    const { latest } = await setup(original);
    await tool('Spline control point');
    const p = evaluateCurvePoint(curve, map(original), 0.5);
    click(p.x, p.y);
    await checked();
    const next = latest().entities.find(e => e.id === curve.id)!;
    if (next.type !== 'bezier') throw Error();
    expect(next.controlPointIds).toHaveLength(5);
    before.forEach((p, i) => {
      const q = evaluateCurvePoint(next, map(latest()), i / 50);
      expect(q.x).toBeCloseTo(p.x, 5);
      expect(q.y).toBeCloseTo(p.y, 5);
    });
    key('z', { ctrlKey: true });
    expect(latest().entities.find(e => e.id === curve.id)).toEqual(curve);
  });

  it('adds a blue fit point on a spline, drags it through native interpolation, and undoes the edit and insertion separately', async () => {
    const original = addSpline(createCadPart().sketch, {
        points: [
          { x: 20, y: 20 },
          { x: 45, y: 70 },
          { x: 80, y: 50 },
          { x: 110, y: 20 },
        ],
      }),
      curve = original.entities.at(-1)!;
    if (curve.type !== 'spline') throw Error();
    const map = (s: CadSketch) => new Map(s.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
    const { canvas, latest } = await setup(original);
    await tool('Spline control point');
    const p = evaluateCurvePoint(curve, map(original), 0.42);
    click(p.x, p.y);
    await checked();
    const next = latest().entities.find(e => e.id === curve.id)!;
    if (next.type !== 'spline') throw Error();
    expect(next.fitPointIds).toHaveLength(5);
    expect(next.controlPointIds).toHaveLength(7);
    const id = next.fitPointIds.find(id => !curve.fitPointIds.includes(id))!,
      added = map(latest()).get(id)!;
    expect(canvas.querySelector(`circle.cad-point[data-entity-id="${id}"]`)!.getAttribute('fill')).toBe('#0000ff');
    const beforeDrag = map(latest());
    const start = new DOMPoint(added.x, -added.y).matrixTransform(canvas.getScreenCTM()!),
      end = new DOMPoint(added.x + 5, -added.y - 12).matrixTransform(canvas.getScreenCTM()!);
    fireEvent.pointerDown(canvas.querySelector(`circle.cad-point[data-entity-id="${id}"]`)!, {
      clientX: start.x,
      clientY: start.y,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerMove(canvas, { clientX: end.x, clientY: end.y, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: end.x, clientY: end.y, button: 0, pointerId: 1 });
    await waitFor(() => expect(map(latest()).get(id)!.y).toBeGreaterThan(added.y + 6), { timeout: 20000 });
    await checked();
    const moved = latest().entities.find(e => e.id === curve.id)!;
    if (moved.type !== 'spline') throw Error();
    const out = map(latest());
    for (const stableId of [...curve.fitPointIds, next.controlPointIds[1]!, next.controlPointIds.at(-2)!]) {
      expect(out.get(stableId)!.x).toBeCloseTo(beforeDrag.get(stableId)!.x, 5);
      expect(out.get(stableId)!.y).toBeCloseTo(beforeDrag.get(stableId)!.y, 5);
    }
    moved.fitParameters.forEach((t, i) => {
      const a = evaluateCurvePoint(moved, out, t),
        b = out.get(moved.fitPointIds[i]!)!;
      expect(a.x).toBeCloseTo(b.x, 5);
      expect(a.y).toBeCloseTo(b.y, 5);
    });
    key('z', { ctrlKey: true });
    expect(map(latest()).get(id)!.y).toBeCloseTo(added.y, 5);
    key('z', { ctrlKey: true });
    expect(latest().entities.find(e => e.id === curve.id)).toEqual(curve);
  });
  it('protects a spline tangent handle from direct Delete while explicit curve Delete still removes its geometry', async () => {
    const original = addSpline(createCadPart().sketch, {
        points: [
          { x: 20, y: 20 },
          { x: 45, y: 70 },
          { x: 80, y: 50 },
          { x: 110, y: 20 },
        ],
      }),
      curve = original.entities.at(-1)!;
    if (curve.type !== 'spline') throw Error();
    const { canvas, latest } = await setup(original),
      handle = curve.controlPointIds[1]!;
    const handleShape = canvas.querySelector<SVGCircleElement>(`circle.cad-point[data-entity-id="${handle}"]`)!;
    const handlePosition = new DOMPoint(handleShape.cx.baseVal.value, handleShape.cy.baseVal.value).matrixTransform(
      handleShape.getScreenCTM()!
    );
    fireEvent.pointerDown(handleShape, { button: 0, pointerId: 1, clientX: handlePosition.x, clientY: handlePosition.y });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 1, clientX: handlePosition.x, clientY: handlePosition.y });
    key('Delete');
    expect(latest().entities.find(e => e.id === curve.id)).toEqual(curve);
    const curveShape = canvas.querySelector<SVGPathElement>(`g[data-entity-id="${curve.id}"] path`)!;
    const curvePosition = curveShape.getPointAtLength(curveShape.getTotalLength() / 2).matrixTransform(curveShape.getScreenCTM()!);
    fireEvent.pointerDown(curveShape, { button: 0, pointerId: 1, clientX: curvePosition.x, clientY: curvePosition.y });
    fireEvent.pointerUp(canvas, { button: 0, pointerId: 1, clientX: curvePosition.x, clientY: curvePosition.y });
    key('Delete');
    expect(latest().entities.some(e => e.id === curve.id)).toBe(false);
  });
  it('adds a Bezier control from a real pointer click on its black polygon away from the curve and protects existing vertices', async () => {
    const original = addBezier(createCadPart().sketch, {
        points: [
          { x: 20, y: 20 },
          { x: 40, y: 105 },
          { x: 95, y: 65 },
          { x: 130, y: 20 },
        ],
      }),
      curve = original.entities.at(-1)!;
    if (curve.type !== 'bezier') throw Error();
    const map = (s: CadSketch) => new Map(s.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
    const samples = Array.from({ length: 51 }, (_, i) => evaluateCurvePoint(curve, map(original), i / 50));
    const { canvas, change, latest } = await setup(original);
    const project = (point: { x: number; y: number }) => {
      const p = new DOMPoint(point.x, -point.y).matrixTransform(canvas.getScreenCTM()!);
      return { x: p.x, y: p.y };
    };
    const target = project({ x: 67.5, y: 85 });
    expect(pickSketchSnap(original, target, { project, pointRadiusPx: -1, curveRadiusPx: 8, includeMidpoints: false })).toBeNull();
    const clickReal = async (x: number, y: number) => {
      const p = project({ x, y }),
        bounds = canvas.getBoundingClientRect();
      await userEvent.click(canvas, { position: { x: p.x - bounds.left, y: p.y - bounds.top } });
    };
    await tool('Spline control point');
    await clickReal(67.5, 85);
    await checked();
    const elevated = latest().entities.find(e => e.id === curve.id)!;
    if (elevated.type !== 'bezier') throw Error();
    expect(elevated.controlPointIds).toHaveLength(5);
    samples.forEach((p, i) => {
      const q = evaluateCurvePoint(elevated, map(latest()), i / 50);
      expect(q.x).toBeCloseTo(p.x, 5);
      expect(q.y).toBeCloseTo(p.y, 5);
    });
    key('z', { ctrlKey: true });
    await checked();
    expect(latest().entities.find(e => e.id === curve.id)).toEqual(curve);
    change.mockClear();
    await tool('Spline control point');
    await clickReal(40, 105);
    expect(change).not.toHaveBeenCalled();
    expect(latest().entities.find(e => e.id === curve.id)).toEqual(curve);
  });
});
