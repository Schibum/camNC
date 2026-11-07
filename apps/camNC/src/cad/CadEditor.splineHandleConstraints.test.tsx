import {
  addCircle,
  addLine,
  addSpline,
  createCadDocument,
  createCadPart,
  evaluateCurvePoint,
  measureDimension,
  splineHandleId,
  type CadDocument,
  type CadLineEntity,
  type CadPointEntity,
  type CadSketch,
  type CadSplineEntity,
} from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
const pointMap = (sketch: CadSketch) => new Map(sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(e => [e.id, e]));
const point = (sketch: CadSketch, id: string) => pointMap(sketch).get(id)!;
const spline = (sketch: CadSketch, id: string) => sketch.entities.find((e): e is CadSplineEntity => e.id === id && e.type === 'spline')!;
const line = (sketch: CadSketch, id: string) => sketch.entities.find((e): e is CadLineEntity => e.id === id && e.type === 'line')!;
const length = (sketch: CadSketch, id: string) => {
  const entity = line(sketch, id),
    a = point(sketch, entity.startId),
    b = point(sketch, entity.endId);
  return Math.hypot(b.x - a.x, b.y - a.y);
};

function fixture(reference: 'line' | 'circle' | 'connected' | undefined = undefined) {
  let sketch = addSpline(createCadPart().sketch, {
    points: [
      { x: 30, y: 30 },
      { x: 65, y: 85 },
      { x: 110, y: 70 },
      { x: 160, y: 35 },
    ],
  });
  const curve = sketch.entities.find((e): e is CadSplineEntity => e.type === 'spline')!;
  let referenceId: string | undefined;
  if (reference === 'line') {
    sketch = addLine(sketch, { x1: 20, y1: 130, x2: 75, y2: 130 });
    referenceId = sketch.entities.at(-1)!.id;
  } else if (reference === 'connected') {
    sketch = addLine(sketch, { x1: 160, y1: 35, x2: 215, y2: 35 });
    referenceId = sketch.entities.at(-1)!.id;
  } else if (reference === 'circle') {
    sketch = addCircle(sketch, { x: 175, y: 120, radius: 12, dimensioned: true });
    referenceId = sketch.entities.find(e => e.type === 'circle')!.id;
  }
  const fixed = new Set(curve.fitPointIds);
  if (referenceId) {
    const entity = sketch.entities.find(e => e.id === referenceId)!;
    if (entity.type === 'line') {
      fixed.add(entity.startId);
      fixed.add(entity.endId);
    }
    if (entity.type === 'circle') fixed.add(entity.centerId);
  }
  sketch = { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' && fixed.has(e.id) ? { ...e, fixed: true } : e)) };
  return { sketch, curve, referenceId };
}

async function setup(sketch: CadSketch) {
  const source = createCadDocument('Spline handle pointer constraints');
  source.parts.push({ ...createCadPart(), sketch });
  sessions.push(source.id);
  const changed = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={changed} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  await settled();
  changed.mockClear();
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = () => changed.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? sketch;
  const click = async (x: number, y: number) => {
    const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!),
      bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: p.x - bounds.left, y: p.y - bounds.top } });
    await settled();
  };
  const handle = (kind: 'point' | 'segment', end: 'start' | 'end') => {
    const result = canvas.querySelector(`[data-spline-handle-${kind}="${end}"]`);
    expect(result, `Missing selectable ${end} handle ${kind}`).not.toBeNull();
    return result!;
  };
  const pickHandle = async (kind: 'point' | 'segment', end: 'start' | 'end') => {
    await userEvent.click(handle(kind, end));
    await settled();
  };
  const pickPoint = async (id: string) => {
    const p = point(latest(), id);
    await click(p.x, p.y);
  };
  const pickLine = async (id: string) => {
    const entity = line(latest(), id),
      a = point(latest(), entity.startId),
      b = point(latest(), entity.endId);
    await click((a.x + b.x) / 2, (a.y + b.y) / 2);
  };
  return { canvas, changed, latest, click, handle, pickHandle, pickPoint, pickLine };
}

async function addSelected(pick: () => Promise<void>) {
  await userEvent.keyboard('{Shift>}');
  try {
    await pick();
  } finally {
    await userEvent.keyboard('{/Shift}');
  }
}
const undo = async () => {
  await userEvent.keyboard('{Control>}z{/Control}');
  await settled();
};

describe('spline tangent handles through real pointer selection', () => {
  it.each(['parent-first', 'point-first'] as const)(
    'protects an unselected line sharing a white handle during mixed Delete (%s)',
    async order => {
      const { sketch: initial, curve } = fixture();
      const whiteId = curve.controlPointIds[1]!,
        white = point(initial, whiteId);
      const sketch = addLine(initial, { x1: white.x, y1: white.y, x2: white.x + 40, y2: white.y - 30 });
      const attached = sketch.entities.at(-1)!;
      expect(attached).toMatchObject({ type: 'line', startId: whiteId });
      const { latest, click, pickHandle, handle } = await setup(sketch);
      const position = evaluateCurvePoint(curve, pointMap(sketch), 0.52);
      const pickParent = () => click(position.x, position.y);
      if (order === 'parent-first') {
        await pickParent();
        await addSelected(() => pickHandle('point', 'start'));
      } else {
        await pickHandle('point', 'start');
        await addSelected(pickParent);
      }
      expect(handle('point', 'start').querySelector('circle.cad-point')!.getAttribute('stroke')).toBe('#ff9b23');
      await userEvent.keyboard('{Delete}');
      await settled();
      expect(latest().entities.some(entity => entity.id === curve.id)).toBe(false);
      expect(latest().entities).toContainEqual(attached);
      expect(latest().entities).toContainEqual(white);
      expect(latest().entities.some(entity => entity.type === 'line' && entity.owner?.splineId === curve.id)).toBe(false);
      await undo();
      expect(latest()).toEqual(sketch);
    }
  );

  it.each([
    ['start', 'h', 'horizontal'],
    ['start', 'v', 'vertical'],
    ['end', 'h', 'horizontal'],
    ['end', 'v', 'vertical'],
  ] as const)('constrains the %s segment with %s without turning it into a cut edge', async (end, shortcut, type) => {
    const { sketch, curve } = fixture(),
      { latest, pickHandle } = await setup(sketch);
    const id = splineHandleId(curve.id, end);
    await pickHandle('segment', end);
    await userEvent.keyboard(shortcut);
    await settled();
    expect(latest().constraints).toContainEqual(expect.objectContaining({ type, entityId: id }));
    const entity = line(latest(), id),
      a = point(latest(), entity.startId),
      b = point(latest(), entity.endId);
    expect(type === 'horizontal' ? b.y - a.y : b.x - a.x).toBeCloseTo(0, 5);
    expect(entity).toMatchObject({ construction: true, owner: { type: 'splineHandle', splineId: curve.id, end } });
    expect(spline(latest(), curve.id).fitPointIds).toEqual(curve.fitPointIds);
    await undo();
    expect(latest().constraints).toEqual(sketch.constraints);
  });

  it.each([
    ['h', 'horizontalPoints'],
    ['v', 'verticalPoints'],
  ] as const)('keeps a white point distinct from its segment for %s point-pair constraints', async (shortcut, type) => {
    const { sketch, curve } = fixture(),
      { latest, pickHandle, pickPoint } = await setup(sketch);
    const white = curve.controlPointIds[1]!;
    await pickHandle('point', 'start');
    await addSelected(() => pickPoint(curve.startId));
    await userEvent.keyboard(shortcut);
    await settled();
    const relation = latest().constraints.find(c => c.type === type)!;
    expect(relation).toBeDefined();
    expect(relation).toMatchObject({ type });
    expect('pointAId' in relation && [relation.pointAId, relation.pointBId].sort()).toEqual([white, curve.startId].sort());
    expect(
      latest().constraints.some(c => (c.type === 'horizontal' || c.type === 'vertical') && c.entityId === splineHandleId(curve.id, 'start'))
    ).toBe(false);
  });

  it.each([
    ['parallel', 'b'],
    ['equal', 'e'],
    ['tangent', 't'],
  ] as const)('applies %s to the real segment and a supported reference curve', async (type, shortcut) => {
    const { sketch, curve, referenceId } = fixture(type === 'tangent' ? 'circle' : 'line');
    const { latest, pickHandle, pickLine, click } = await setup(sketch);
    const id = splineHandleId(curve.id, 'start');
    await pickHandle('segment', 'start');
    await addSelected(() => (type === 'tangent' ? click(187, 120) : pickLine(referenceId!)));
    await userEvent.keyboard(shortcut);
    await settled();
    const relation = latest().constraints.find(c => c.type === type)!;
    expect(relation).toBeDefined();
    expect(relation).toMatchObject({ type });
    expect('entityAId' in relation && [relation.entityAId, relation.entityBId].sort()).toEqual([id, referenceId!].sort());
    if (type === 'equal') expect(length(latest(), id)).toBeCloseTo(length(latest(), referenceId!), 5);
    if (type === 'parallel') {
      const a = point(latest(), line(latest(), id).startId),
        b = point(latest(), line(latest(), id).endId);
      expect(b.y - a.y).toBeCloseTo(0, 5);
    }
    if (type === 'tangent') {
      const entity = line(latest(), id),
        a = point(latest(), entity.startId),
        b = point(latest(), entity.endId);
      const circle = latest().entities.find(e => e.id === referenceId)!;
      if (circle.type !== 'circle') throw Error('Missing circle');
      const center = point(latest(), circle.centerId);
      const normalDistance = Math.abs((b.x - a.x) * (center.y - a.y) - (b.y - a.y) * (center.x - a.x)) / length(latest(), id);
      expect(normalDistance).toBeCloseTo(circle.radius, 4);
    }
  });

  it.each([
    ['white', 'parallel', 'b'],
    ['white', 'tangent', 't'],
    ['white', 'equal', 'e'],
    ['fit', 'parallel', 'b'],
    ['fit', 'tangent', 't'],
    ['fit', 'equal', 'e'],
  ] as const)('rejects %s-point plus line %s instead of silently promoting the point to a segment', async (surface, type, shortcut) => {
    const { sketch, curve, referenceId } = fixture('line'),
      { latest, changed, pickHandle, pickPoint, pickLine } = await setup(sketch);
    if (surface === 'white') await pickHandle('point', 'start');
    else await pickPoint(curve.fitPointIds[1]!);
    await addSelected(() => pickLine(referenceId!));
    await userEvent.keyboard(shortcut);
    await settled();
    expect(latest().constraints).toEqual(sketch.constraints);
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector('.cad-instruction')!.textContent).toMatch(
      type === 'parallel' ? /two lines/i : type === 'equal' ? /two lines|circular curves/i : /line.*circular|tangen/i
    );
  });

  it('dimensions a white handle point against a blue fit point as a point-pair distance, without segment ownership', async () => {
    const { sketch, curve } = fixture(),
      { latest, pickHandle, pickPoint, click } = await setup(sketch);
    const white = curve.controlPointIds[1]!,
      fit = curve.fitPointIds[1]!;
    await userEvent.keyboard('d');
    await pickHandle('point', 'start');
    expect(screen.queryByRole('textbox', { name: /Length mm/ })).toBeNull();
    await pickPoint(fit);
    await click((point(latest(), white).x + point(latest(), fit).x) / 2, 130);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Horizontal distance mm' }));
    await userEvent.keyboard('45{Enter}');
    await settled();
    const dimension = latest().constraints.find(c => c.type === 'distanceX')!;
    expect(dimension).toMatchObject({ type: 'distanceX', value: 45 });
    expect('pointAId' in dimension && [dimension.pointAId, dimension.pointBId].sort()).toEqual([white, fit].sort());
    expect(dimension).not.toHaveProperty('sourceEntityId');
    expect(Math.abs(point(latest(), white).x - point(latest(), fit).x)).toBeCloseTo(45, 5);
    await undo();
    expect(latest().constraints).toEqual(sketch.constraints);
  });

  it('creates a source-owned geometric Length on a selected segment while a white point alone waits for another operand', async () => {
    const { sketch, curve } = fixture(),
      { latest, pickHandle, click } = await setup(sketch);
    await userEvent.keyboard('d');
    await pickHandle('point', 'start');
    expect(screen.queryByRole('textbox', { name: /Length mm/ })).toBeNull();
    expect(latest().constraints).toEqual(sketch.constraints);
    await userEvent.keyboard('{Escape}{Escape}d');
    await pickHandle('segment', 'start');
    await click(5, 100);
    const input = screen.getByRole('textbox', { name: 'Length mm' });
    expect(document.activeElement).toBe(input);
    await userEvent.keyboard('50{Enter}');
    await settled();
    expect(latest().constraints).toContainEqual(
      expect.objectContaining({ type: 'distance', sourceEntityId: splineHandleId(curve.id, 'start'), value: 50 })
    );
    expect(length(latest(), splineHandleId(curve.id, 'start'))).toBeCloseTo(50, 5);
  });

  it('retains last-handle Length and Angle drivers and source identities when inserting a fit point through the menu', async () => {
    const { sketch, curve, referenceId } = fixture('connected'),
      { latest, canvas, pickHandle, pickLine, click } = await setup(sketch);
    const id = splineHandleId(curve.id, 'end'),
      white = curve.controlPointIds.at(-2)!;
    await userEvent.keyboard('d');
    await pickHandle('segment', 'end');
    await click(235, 80);
    await userEvent.keyboard('40{Enter}');
    await settled();
    await userEvent.keyboard('{Escape}{Escape}d');
    await pickHandle('segment', 'end');
    await pickLine(referenceId!);
    await click(200, 110);
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Angle degrees' }));
    await userEvent.keyboard('120{Enter}');
    await settled();
    const before = structuredClone(latest()),
      drivers = before.constraints.filter(c => 'value' in c);
    expect(drivers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'distance', sourceEntityId: id, value: 40 }),
        expect.objectContaining({ type: 'angle', value: 120 }),
      ])
    );
    const position = evaluateCurvePoint(spline(before, curve.id), pointMap(before), 0.9);
    await userEvent.keyboard('{Escape}{Escape}');
    await userEvent.click(
      screen.getByRole('button', { name: screen.queryByRole('button', { name: 'Drawing tools' }) ? 'Drawing tools' : 'Spline tools' })
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Spline control point' }));
    await click(position.x, position.y);
    const after = latest(),
      refined = spline(after, curve.id);
    expect(refined.fitPointIds).toHaveLength(curve.fitPointIds.length + 1);
    expect(refined.controlPointIds.at(-2)).toBe(white);
    expect(line(after, id)).toMatchObject({ endId: white, owner: { splineId: curve.id, end: 'end' } });
    expect(after.constraints).toEqual(expect.arrayContaining(drivers));
    expect(length(after, id)).toBeCloseTo(40, 4);
    const angular = after.constraints.find(c => c.type === 'angle')!;
    expect(measureDimension(after, angular)).toBeCloseTo(120, 4);
    expect(canvas.querySelector('[data-spline-handle-segment="end"]')).not.toBeNull();
    await undo();
    expect(spline(latest(), curve.id).fitPointIds).toEqual(curve.fitPointIds);
    expect(latest().constraints).toEqual(expect.arrayContaining(drivers));
  }, 30_000);

  it('protects individual white points and segments from Delete or Q, then cascades both owned segments with the parent curve', async () => {
    const { sketch, curve } = fixture(),
      { latest, changed, pickHandle, click, canvas } = await setup(sketch);
    for (const kind of ['point', 'segment'] as const) {
      await userEvent.keyboard('{Escape}{Escape}');
      await pickHandle(kind, 'start');
      await userEvent.keyboard('{Delete}q');
      await settled();
      expect(latest()).toEqual(sketch);
      expect(changed).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Undo (Ctrl or Command Z)' }).hasAttribute('disabled')).toBe(true);
    }
    await userEvent.keyboard('{Escape}{Escape}');
    const p = evaluateCurvePoint(curve, pointMap(latest()), 0.52);
    await click(p.x, p.y);
    await userEvent.keyboard('{Delete}');
    await settled();
    expect(latest().entities.some(e => e.id === curve.id || (e.type === 'line' && e.owner?.splineId === curve.id))).toBe(false);
    expect(canvas.querySelector('[data-spline-handle-segment]')).toBeNull();
    await undo();
    expect(spline(latest(), curve.id)).toEqual(curve);
    expect(latest().entities.filter(e => e.type === 'line' && e.owner?.splineId === curve.id)).toHaveLength(2);
  });
});
