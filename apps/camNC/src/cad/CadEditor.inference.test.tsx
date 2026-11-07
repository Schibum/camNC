import { addConstraint, addLine, addPoint, createCadDocument, createCadPart, type CadDocument } from '@wbcnc/cad';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const documentIds: string[] = [];
afterEach(() => {
  cleanup();
  documentIds.forEach(endCadSession);
  documentIds.length = 0;
});

function fixture(withSecondPart = false) {
  const document = createCadDocument();
  const part = createCadPart('Reference part');
  part.sketch = addLine(part.sketch, { x1: 70, y1: 90, x2: 145, y2: 115 });
  const line = part.sketch.entities.find(e => e.type === 'line')!;
  part.sketch.entities = part.sketch.entities.map(e => (e.type === 'point' && e.id === line.startId ? { ...e, fixed: true } : e));
  part.sketch = addConstraint(part.sketch, { type: 'positionX', pointId: line.endId, value: 145, label: 'Source X' });
  part.sketch = addConstraint(part.sketch, { type: 'positionY', pointId: line.endId, value: 115, label: 'Source Y' });
  document.parts.push(part);
  if (withSecondPart) document.parts.push(createCadPart('Other part'));
  return { document, sourcePointId: line.endId };
}

async function setup(document: CadDocument) {
  documentIds.push(document.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={document} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {});
  await waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  change.mockClear();
  return { canvas, change, latest: () => change.mock.calls.at(-1)?.[0] ?? document };
}

function pointerWorld(type: 'move' | 'down', x: number, y: number, shiftKey = false) {
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const p = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
  const event = { clientX: p.x, clientY: p.y, button: 0, pointerId: 1, shiftKey };
  if (type === 'move') fireEvent.pointerMove(canvas, event);
  else fireEvent.pointerDown(canvas, event);
}
const moveWorld = (x: number, y: number, shift = false) => pointerWorld('move', x, y, shift);
const clickWorld = (x: number, y: number, shift = false) => pointerWorld('down', x, y, shift);
const pointTool = () => fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 's', shiftKey: true });
const noPreview = (canvas: SVGSVGElement) => {
  expect(canvas.querySelector('[data-inference-guide]')).toBeNull();
  expect(canvas.querySelector('[data-inferred-constraint]')).toBeNull();
  expect(canvas.querySelector('[data-inference-source]')).toBeNull();
};

describe('drawing inference previews and persistence', () => {
  it.each([
    {
      axis: 'horizontal',
      relation: 'horizontalPoints',
      target: { x: 205, y: 116 },
      initial: { x: 205, y: 115 },
      label: 'Source Y',
      value: 125,
      after: { x: 205, y: 125 },
    },
    {
      axis: 'vertical',
      relation: 'verticalPoints',
      target: { x: 146, y: 40 },
      initial: { x: 145, y: 40 },
      label: 'Source X',
      value: 155,
      after: { x: 155, y: 40 },
    },
  ] as const)(
    'previews $axis alignment after hover, then retains source IDs and follows a driving edit',
    async test => {
      const { document, sourcePointId } = fixture();
      const { canvas, change, latest } = await setup(document);
      pointTool();
      moveWorld(145, 115);
      expect(canvas.querySelector('[data-inferred-constraint="coincident"]')).not.toBeNull();
      moveWorld(test.target.x, test.target.y);
      expect(canvas.querySelector(`[data-inference-guide="${test.axis}"]`)).not.toBeNull();
      expect(canvas.querySelector(`[data-inferred-constraint="${test.relation}"]`)).not.toBeNull();
      expect(canvas.querySelector(`[data-inference-source="${sourcePointId}"]`)).not.toBeNull();
      expect(change).not.toHaveBeenCalled();
      clickWorld(test.target.x, test.target.y);
      const sketch = latest().parts[0]!.sketch;
      const added = sketch.entities.find(e => e.type === 'point' && !document.parts[0]!.sketch.entities.some(old => old.id === e.id))!;
      expect(added).toMatchObject({ type: 'point', x: expect.closeTo(test.initial.x), y: expect.closeTo(test.initial.y) });
      expect(sketch.constraints).toContainEqual(
        expect.objectContaining({ type: test.relation, pointAId: sourcePointId, pointBId: added.id })
      );
      fireEvent.keyDown(canvas, { key: 'Escape' });
      fireEvent.doubleClick(screen.getByRole('button', { name: `Edit ${test.label}: ${test.label === 'Source X' ? 145 : 115} mm` }));
      fireEvent.change(screen.getByRole('textbox', { name: `${test.label} mm` }), { target: { value: String(test.value) } });
      fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
      await waitFor(
        () =>
          expect(latest().parts[0]!.sketch.entities.find(e => e.id === added.id)).toMatchObject({
            x: expect.closeTo(test.after.x),
            y: expect.closeTo(test.after.y),
          }),
        { timeout: 20_000 }
      );
      expect(latest().parts[0]!.sketch.constraints).toContainEqual(
        expect.objectContaining({ type: test.relation, pointAId: sourcePointId, pointBId: added.id })
      );
    },
    30_000
  );

  it('previews a horizontal line with its endpoint vertically aligned to a previously hovered endpoint', async () => {
    const { document, sourcePointId } = fixture();
    const { canvas, change, latest } = await setup(document);
    fireEvent.keyDown(canvas, { key: 'l' });
    clickWorld(195, 40);
    moveWorld(145, 115);
    moveWorld(146, 41);
    expect(canvas.querySelector('[data-inferred-constraint="horizontal"]')).not.toBeNull();
    expect(canvas.querySelector('[data-inference-guide="vertical"]')).not.toBeNull();
    expect(canvas.querySelector('[data-inferred-constraint="verticalPoints"]')).not.toBeNull();
    expect(canvas.querySelector(`[data-inference-source="${sourcePointId}"]`)).not.toBeNull();
    expect(change).not.toHaveBeenCalled();
    clickWorld(146, 41);
    const sketch = latest().parts[0]!.sketch;
    const line = sketch.entities.filter(e => e.type === 'line').at(-1)!;
    expect(sketch.entities.find(e => e.id === line.endId)).toMatchObject({ x: expect.closeTo(145), y: expect.closeTo(40) });
    expect(sketch.constraints).toContainEqual(expect.objectContaining({ type: 'horizontal', entityId: line.id }));
    expect(sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'verticalPoints', pointAId: sourcePointId, pointBId: line.endId })
    );
    fireEvent.keyDown(canvas, { key: 'Escape' });
    fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    expect(latest().parts[0]!.sketch.entities).toEqual(document.parts[0]!.sketch.entities);
    expect(latest().parts[0]!.sketch.constraints).toEqual(document.parts[0]!.sketch.constraints);
  });

  it.each(['Snap off', 'Shift held'] as const)('suppresses previews and automatic constraints with %s', async mode => {
    const { document } = fixture();
    const { canvas, latest } = await setup(document);
    pointTool();
    moveWorld(145, 115);
    moveWorld(205, 116);
    expect(canvas.querySelector('[data-inference-guide="horizontal"]')).not.toBeNull();
    if (mode === 'Snap off') fireEvent.click(screen.getByRole('button', { name: 'Snap on' }));
    else fireEvent.keyDown(canvas, { key: 'Shift', shiftKey: true });
    moveWorld(205, 116, mode === 'Shift held');
    noPreview(canvas);
    clickWorld(205, 116, mode === 'Shift held');
    if (mode === 'Shift held') fireEvent.keyUp(canvas, { key: 'Shift', shiftKey: false });
    const sketch = latest().parts[0]!.sketch;
    expect(sketch.constraints).toEqual(document.parts[0]!.sketch.constraints);
    const added = sketch.entities.find(e => e.type === 'point' && !document.parts[0]!.sketch.entities.some(old => old.id === e.id));
    expect(added).toMatchObject({ x: expect.closeTo(205), y: expect.closeTo(116) });
  });

  it('prioritizes an exact endpoint contact over a competing remote alignment', async () => {
    const { document, sourcePointId } = fixture();
    const part = document.parts[0]!;
    part.sketch = addPoint(part.sketch, { x: 205, y: 116 });
    const target = part.sketch.entities.at(-1)!;
    const { canvas, latest } = await setup(document);
    pointTool();
    moveWorld(145, 115);
    moveWorld(205, 116);
    expect(canvas.querySelector('[data-inferred-constraint="coincident"]')).not.toBeNull();
    expect(canvas.querySelector('[data-inference-guide]')).toBeNull();
    clickWorld(205, 116);
    const sketch = latest().parts[0]!.sketch;
    const added = sketch.entities.find(e => e.type === 'point' && !part.sketch.entities.some(old => old.id === e.id))!;
    expect(sketch.constraints).toContainEqual(expect.objectContaining({ type: 'coincident', pointAId: added.id, pointBId: target.id }));
    expect(
      sketch.constraints.some(
        c =>
          (c.type === 'horizontalPoints' || c.type === 'verticalPoints') &&
          [c.pointAId, c.pointBId].includes(sourcePointId) &&
          [c.pointAId, c.pointBId].includes(added.id)
      )
    ).toBe(false);
  });

  it('retains circle rim contact with an existing endpoint after that endpoint moves', async () => {
    const { document, sourcePointId } = fixture();
    const { canvas, latest } = await setup(document);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'c' });
    clickWorld(205, 40);
    moveWorld(145, 115);
    clickWorld(145, 115);
    const circle = latest().parts[0]!.sketch.entities.find(e => e.type === 'circle')!;
    expect(latest().parts[0]!.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnCircle', pointId: sourcePointId, entityId: circle.id })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select (Esc)' }));
    fireEvent.keyDown(canvas, { key: ' ' });
    clickWorld(205, 40, true);
    fireEvent.keyDown(canvas, { key: 'J', shiftKey: true });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Source X: 145 mm' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Source X mm' }), { target: { value: '155' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
    await waitFor(
      () =>
        expect(latest().parts[0]!.sketch.entities.find(e => e.id === circle.id)).toMatchObject({
          radius: expect.closeTo(Math.hypot(50, 75)),
        }),
      { timeout: 20_000 }
    );
    expect(latest().parts[0]!.sketch.entities.find(e => e.id === circle.centerId)).toMatchObject({
      x: expect.closeTo(205),
      y: expect.closeTo(40),
      fixed: true,
    });
    expect(latest().parts[0]!.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnCircle', pointId: sourcePointId, entityId: circle.id })
    );
  }, 30_000);

  it('retains an arc through-point contact after the source endpoint moves', async () => {
    const { document, sourcePointId } = fixture();
    const { canvas, latest } = await setup(document);
    fireEvent.keyDown(screen.getByTestId('cad-canvas'), { key: 'a' });
    clickWorld(185, 40);
    clickWorld(235, 40);
    moveWorld(145, 115);
    clickWorld(145, 115);
    const arc = latest().parts[0]!.sketch.entities.find(e => e.type === 'arc')!;
    expect(latest().parts[0]!.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnCircle', pointId: sourcePointId, entityId: arc.id })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select (Esc)' }));
    fireEvent.keyDown(canvas, { key: ' ' });
    clickWorld(185, 40, true);
    clickWorld(235, 40, true);
    fireEvent.keyDown(canvas, { key: 'J', shiftKey: true });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Edit Source X: 145 mm' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Source X mm' }), { target: { value: '155' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply dimension' }));
    await waitFor(
      () => {
        const sketch = latest().parts[0]!.sketch;
        const changed = sketch.entities.find(e => e.id === arc.id)!;
        const source = sketch.entities.find(e => e.id === sourcePointId)!;
        if (changed.type !== 'arc' || source.type !== 'point') throw new Error('Missing arc source geometry');
        const center = sketch.entities.find(e => e.id === changed.centerId)!;
        if (center.type !== 'point') throw new Error('Missing arc center');
        expect(source.x).toBeCloseTo(155);
        expect(Math.hypot(source.x - center.x, source.y - center.y)).toBeCloseTo(changed.radius);
        expect(Math.abs(changed.radius - arc.radius)).toBeGreaterThan(1);
      },
      { timeout: 20_000 }
    );
    expect(latest().parts[0]!.sketch.constraints).toContainEqual(
      expect.objectContaining({ type: 'pointOnCircle', pointId: sourcePointId, entityId: arc.id })
    );
  }, 30_000);

  it.each(['tool', 'part', 'history'] as const)('clears pending hover previews on a %s transition', async transition => {
    const { document } = fixture(true);
    const { canvas, latest } = await setup(document);
    pointTool();
    if (transition === 'history') clickWorld(215, 150);
    moveWorld(145, 115);
    moveWorld(205, 116);
    expect(canvas.querySelector('[data-inference-guide="horizontal"]')).not.toBeNull();
    if (transition === 'tool') fireEvent.click(screen.getByRole('button', { name: 'Select (Esc)' }));
    else if (transition === 'part') fireEvent.click(screen.getByRole('button', { name: /^Other part$/ }));
    else fireEvent.keyDown(canvas, { key: 'z', ctrlKey: true });
    noPreview(canvas);
    const before = structuredClone(latest());
    clickWorld(205, 116);
    expect(latest()).toEqual(before);
  });
});
