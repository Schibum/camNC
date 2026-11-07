import {
  addArc,
  addCircle,
  addLine,
  addPoint,
  addRectangle,
  createCadDocument,
  createCadPart,
  dimensionWitnessPoints,
  resolveDimensionPlacement,
  type CadDimension,
  type CadDocument,
  type CadSketch,
} from '@wbcnc/cad';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { cdp, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CadEditor } from './CadEditor';
import { endCadSession } from './session';

const sessionIds: string[] = [];
afterEach(() => {
  cleanup();
  sessionIds.forEach(endCadSession);
  sessionIds.length = 0;
});

async function setup(sketch: CadSketch) {
  const source = createCadDocument(),
    part = createCadPart();
  part.sketch = sketch;
  source.parts.push(part);
  sessionIds.push(source.id);
  const change = vi.fn<(document: CadDocument) => void>();
  render(
    <div style={{ height: 700 }}>
      <CadEditor document={source} onDraftChange={change} onFinish={() => {}} onCancel={() => {}} />
    </div>
  );
  const canvas = screen.getByTestId('cad-canvas') as unknown as SVGSVGElement;
  const latest = () => change.mock.calls.at(-1)?.[0].parts[0]!.sketch ?? sketch;
  const settled = () => waitFor(() => expect(screen.queryByText(/^Checking sketch/)).toBeNull(), { timeout: 20_000 });
  await settled();
  const click = async (x: number, y: number) => {
    const client = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    const bounds = canvas.getBoundingClientRect();
    await userEvent.click(canvas, { position: { x: client.x - bounds.left, y: client.y - bounds.top } });
    await waitFor(() => expect(canvas.closest('.cad-editor')!.getAttribute('aria-busy')).toBe('false'));
  };
  const move = async (x: number, y: number) => {
    const point = new DOMPoint(x, -y).matrixTransform(canvas.getScreenCTM()!);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      point.x = bounds.left + (point.x * bounds.width) / frame.innerWidth;
      point.y = bounds.top + (point.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  };
  return { canvas, latest, click, move, settled };
}

const fixPoints = (sketch: CadSketch, ids: readonly string[]): CadSketch => ({
  ...sketch,
  entities: sketch.entities.map(entity => (entity.type === 'point' && ids.includes(entity.id) ? { ...entity, fixed: true } : entity)),
});

describe('real pointer dimension gestures', () => {
  it('hides the fixed angle suffix for degree text and reopens a plain degree literal with one unit', async () => {
    let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 100, y2: 20 });
    sketch = addLine(sketch, { x1: 20, y1: 20, x2: 80, y2: 80 });
    const { canvas, latest, click, settled } = await setup(sketch);
    await userEvent.keyboard('d');
    await click(60, 20);
    await click(50, 50);
    await click(80, 60);
    const input = screen.getByRole('textbox', { name: 'Angle degrees' }) as HTMLInputElement;
    for (const text of ['45deg', '45°', '90°+']) {
      await userEvent.fill(input, text);
      expect(input.parentElement!.querySelector('[aria-hidden="true"]')).toBeNull();
      expect(document.activeElement).toBe(input);
    }
    await userEvent.fill(input, '90');
    expect(input.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('°');
    await userEvent.fill(input, '90°');
    await userEvent.keyboard('{Enter}');
    await settled();
    const angle = latest().constraints.find(c => c.type === 'angle')!;
    expect(angle.value).toBe(90);
    expect(angle.expression).toBeUndefined();
    expect(document.activeElement).toBe(canvas);
    await userEvent.keyboard('{Escape}');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Angle: 90 degrees' }));
    const reopened = screen.getByRole('textbox', { name: 'Angle degrees' }) as HTMLInputElement;
    expect(reopened.value).toBe('90');
    expect(reopened.parentElement!.querySelector('[aria-hidden="true"]')?.textContent).toBe('°');
    expect(document.activeElement).toBe(reopened);
  });

  it.each([
    {
      kind: 'pointLineDistance',
      value: 25,
      span: [20, 45],
      vertical: true,
      references: [[20, 120, 20]],
      picks: [
        [70, 45],
        [90, 20],
      ],
      labels: [
        [-10, 65],
        [155, 0],
        [155, 65],
      ],
      make: () => {
        const sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 120, y2: 20 });
        return addPoint(sketch, { x: 70, y: 45 });
      },
    },
    {
      kind: 'lineLineDistance',
      value: 40,
      span: [20, 60],
      vertical: true,
      references: [
        [20, 120, 20],
        [30, 110, 60],
      ],
      picks: [
        [80, 20],
        [90, 60],
      ],
      labels: [
        [-10, 100],
        [155, 0],
        [155, 100],
      ],
      make: () => {
        const sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 120, y2: 20 });
        return addLine(sketch, { x1: 30, y1: 60, x2: 110, y2: 60 });
      },
    },
    {
      kind: 'pointArcDistance',
      value: 30,
      span: [80, 110],
      vertical: true,
      references: [],
      picks: [
        [70, 110],
        [70, 80],
      ],
      labels: [
        [-10, 130],
        [155, 50],
        [155, 130],
      ],
      make: () => {
        const sketch = addArc(createCadPart().sketch, { cx: 70, cy: 60, radius: 20, startAngle: 0, endAngle: Math.PI });
        return addPoint(sketch, { x: 70, y: 110 });
      },
    },
    {
      kind: 'lineCircleDistance',
      value: 40,
      span: [20, 60],
      vertical: true,
      references: [[20, 140, 20]],
      picks: [
        [110, 20],
        [80, 60],
      ],
      labels: [
        [-10, 100],
        [165, 0],
        [165, 100],
      ],
      make: () => {
        const sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 140, y2: 20 });
        return addArc(sketch, { cx: 80, cy: 80, radius: 20, startAngle: Math.PI, endAngle: Math.PI * 2 });
      },
    },
    {
      kind: 'circleCircleDistance',
      value: 55,
      span: [65, 120],
      vertical: false,
      references: [],
      picks: [
        [65, 60],
        [120, 60],
      ],
      labels: [
        [150, -10],
        [25, 120],
        [150, 120],
      ],
      make: () => {
        const sketch = addArc(createCadPart().sketch, { cx: 50, cy: 60, radius: 15, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
        return addArc(sketch, { cx: 140, cy: 60, radius: 20, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5 });
      },
    },
  ])(
    'moves complete $kind annotations across both sides and beyond references, then stores the final position unchanged',
    async ({ make, picks, labels, span, vertical, references, kind, value }) => {
      const { canvas, latest, click, move, settled } = await setup(make()),
        source = structuredClone(latest());
      await userEvent.keyboard('d');
      for (const [x, y] of picks) await click(x!, y!);
      for (const [x, y] of labels) {
        await move(x!, y!);
        await waitFor(() => {
          const measure = canvas.querySelector('[data-dimension-line="measure"]')!;
          const leader = canvas.querySelector('[data-dimension-line="label-leader"]')!;
          expect(measure).not.toBeNull();
          expect(leader).not.toBeNull();
          if (vertical) {
            expect(Number(measure.getAttribute('x1'))).toBeCloseTo(x!, 1);
            expect(Number(measure.getAttribute('x2'))).toBeCloseTo(x!, 1);
            expect(Number(measure.getAttribute('y1'))).toBeCloseTo(-span[0]!, 5);
            expect(Number(measure.getAttribute('y2'))).toBeCloseTo(-span[1]!, 5);
            expect(Number(leader.getAttribute('y1'))).toBeCloseTo(-(y! < span[0]! ? span[0]! : span[1]!), 5);
          } else {
            expect(Number(measure.getAttribute('y1'))).toBeCloseTo(-y!, 1);
            expect(Number(measure.getAttribute('y2'))).toBeCloseTo(-y!, 1);
            expect(Number(measure.getAttribute('x1'))).toBeCloseTo(span[0]!, 5);
            expect(Number(measure.getAttribute('x2'))).toBeCloseTo(span[1]!, 5);
            expect(Number(leader.getAttribute('x1'))).toBeCloseTo(x! < span[0]! ? span[0]! : span[1]!, 5);
          }
          expect(Number(leader.getAttribute('x2'))).toBeCloseTo(x!, 1);
          expect(Number(leader.getAttribute('y2'))).toBeCloseTo(-y!, 1);
          references.forEach(([xmin, xmax, y], index) => {
            const extension = canvas.querySelector(`[data-dimension-line="extension-${index === 0 ? 'a' : 'b'}"]`)!;
            expect(Number(extension.getAttribute('x1'))).toBeCloseTo(x! < xmin! ? xmin! : xmax!, 5);
            expect(Number(extension.getAttribute('y1'))).toBeCloseTo(-y!, 5);
          });
        });
        expect(latest()).toEqual(source);
      }
      const [x, y] = labels.at(-1)!;
      await click(x!, y!);
      await userEvent.keyboard('{Enter}');
      await settled();
      const dimension = latest().constraints.find(c => c.type === kind)! as CadDimension;
      expect(dimension.value).toBeCloseTo(value, 5);
      expect(dimension.labelPlacement).toBeDefined();
      expect(dimension.labelPosition).toBeUndefined();
      const position = resolveDimensionPlacement(latest(), dimension)!;
      expect(position.x).toBeCloseTo(x!, 1);
      expect(position.y).toBeCloseTo(y!, 1);
      expect(latest().entities.map(entity => entity.id)).toEqual(source.entities.map(entity => entity.id));
      for (const entity of latest().entities) {
        const before = source.entities.find(e => e.id === entity.id)!;
        if (entity.type === 'point' && before.type === 'point') {
          expect(entity.x).toBeCloseTo(before.x, 6);
          expect(entity.y).toBeCloseTo(before.y, 6);
        }
        if ('radius' in entity && 'radius' in before) expect(entity.radius).toBeCloseTo(before.radius, 6);
      }
      expect(canvas.querySelector('[data-dimension-line="label-leader"]')).not.toBeNull();
    }
  );

  it('anchors the first curve preview to the pointer press even when no mousemove preceded that click', async () => {
    const sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 120, y2: 20 });
    const { canvas, latest } = await setup(sketch);
    await userEvent.keyboard('d');
    const client = new DOMPoint(80, -20).matrixTransform(canvas.getScreenCTM()!);
    let frame: Window = window;
    while (frame.frameElement) {
      const bounds = frame.frameElement.getBoundingClientRect();
      client.x = bounds.left + (client.x * bounds.width) / frame.innerWidth;
      client.y = bounds.top + (client.y * bounds.height) / frame.innerHeight;
      frame = frame.parent;
    }
    const protocol = cdp(),
      position = { x: client.x, y: client.y };
    await protocol.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...position, button: 'left', buttons: 1, clickCount: 1 });
    try {
      await waitFor(() => expect(canvas.querySelector('[data-dimension] text')).not.toBeNull());
      expect(Number(canvas.querySelector('[data-dimension] text')!.getAttribute('x'))).toBeCloseTo(80, 1);
      expect(latest().constraints).toHaveLength(0);
    } finally {
      await protocol.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...position, button: 'left', buttons: 0, clickCount: 1 });
    }
  });

  it.each(['point-first', 'line-first'] as const)(
    'dimensions a point and line with ordinary sequential clicks in %s order',
    async order => {
      let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 120, y2: 20 });
      const line = sketch.entities.find(entity => entity.type === 'line')!;
      sketch = fixPoints(sketch, [line.startId, line.endId]);
      sketch = addPoint(sketch, { x: 70, y: 45 });
      const point = sketch.entities.at(-1)!;
      const { canvas, latest, click, settled } = await setup(sketch);
      await userEvent.keyboard('d');
      const picks =
        order === 'point-first'
          ? [
              [70, 45],
              [90, 20],
            ]
          : [
              [90, 20],
              [70, 45],
            ];
      for (const [x, y] of picks) await click(x!, y!);
      expect(latest().constraints).toHaveLength(0);
      expect(screen.queryByRole('textbox', { name: 'Distance mm' })).toBeNull();
      await click(145, 65);
      const input = screen.getByRole('textbox', { name: 'Distance mm' });
      expect(document.activeElement).toBe(input);
      expect((input as HTMLInputElement).value).toBe('25');
      await userEvent.keyboard('30{Enter}');
      await settled();
      const dimension = latest().constraints.find(constraint => constraint.type === 'pointLineDistance')!;
      expect(dimension).toMatchObject({ pointId: point.id, entityId: line.id, value: 30 });
      expect(dimension.labelPlacement).toBeDefined();
      expect(dimension.labelPosition).toBeUndefined();
      const placedPosition = resolveDimensionPlacement(sketch, dimension)!;
      expect(placedPosition.x).toBeCloseTo(145, 1);
      expect(placedPosition.y).toBeCloseTo(65, 1);
      const witnesses = dimensionWitnessPoints(latest(), dimension)!;
      expect(Math.hypot(witnesses[1].x - witnesses[0].x, witnesses[1].y - witnesses[0].y)).toBeCloseTo(30, 5);
      expect(document.activeElement).toBe(canvas);
      await userEvent.keyboard('{Control>}z{/Control}');
      await settled();
      expect(latest().constraints).toHaveLength(0);
      expect(latest().entities.map(entity => entity.id)).toEqual(sketch.entities.map(entity => entity.id));
    }
  );

  it('uses two sequential line clicks for an angle and recomputes the wedge at label placement before focused value entry', async () => {
    let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 100, y2: 20 });
    const first = sketch.entities.find(entity => entity.type === 'line')!;
    sketch = fixPoints(sketch, [first.startId, first.endId]);
    sketch = addLine(sketch, { x1: 100, y1: 20, x2: 160, y2: 50 });
    const second = sketch.entities.filter(entity => entity.type === 'line')[1]!;
    const { canvas, latest, click, settled } = await setup(sketch);
    await userEvent.keyboard('d');
    await click(60, 20);
    await click(130, 35);
    expect(latest().constraints).toHaveLength(0);
    expect(canvas.querySelector('[data-dimension-line="angle-arc"]')).not.toBeNull();
    await click(130, 25);
    const input = screen.getByRole('textbox', { name: 'Angle degrees' });
    expect(document.activeElement).toBe(input);
    expect(Number((input as HTMLInputElement).value)).toBeCloseTo(26.565, 2);
    await userEvent.keyboard('45{Enter}');
    await settled();
    const angle = latest().constraints.find(constraint => constraint.type === 'angle')!;
    expect(angle).toMatchObject({ entityAId: first.id, entityBId: second.id, value: 45 });
    expect(angle.labelPlacement).toBeDefined();
    expect(angle.labelPosition).toBeUndefined();
    const placedPosition = resolveDimensionPlacement(sketch, angle)!;
    expect(placedPosition.x).toBeCloseTo(130, 1);
    expect(placedPosition.y).toBeCloseTo(25, 1);
    expect(latest().constraints).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Edit Angle: 45 degrees' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Angle degrees' }));
    await userEvent.keyboard('60{Enter}');
    await settled();
    expect(latest().constraints).toContainEqual(expect.objectContaining({ id: angle.id, type: 'angle', value: 60 }));
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(latest().constraints).toContainEqual(expect.objectContaining({ id: angle.id, type: 'angle', value: 45 }));
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(latest().constraints).toHaveLength(0);
    expect(latest().entities.map(entity => entity.id)).toEqual(sketch.entities.map(entity => entity.id));
  });

  it.each([
    { placement: [50, 90], type: 'distanceX', value: 60, label: 'Horizontal distance' },
    { placement: [110, 40], type: 'distanceY', value: 40, label: 'Vertical distance' },
    { placement: [120, 100], type: 'distance', value: Math.hypot(60, 40), label: 'Length' },
  ] as const)('chooses $type for two ordinary point clicks from actual label placement', async ({ placement, type, value, label }) => {
    let sketch = addPoint(createCadPart().sketch, { x: 20, y: 20 });
    sketch = addPoint(sketch, { x: 80, y: 60 });
    const refs = sketch.entities.filter(entity => entity.type === 'point' && entity.standalone).map(entity => entity.id);
    const { latest, click, settled } = await setup(sketch);
    await userEvent.keyboard('d');
    await click(20, 20);
    await click(80, 60);
    await click(placement[0], placement[1]);
    const input = screen.getByRole('textbox', { name: `${label} mm` });
    expect(document.activeElement).toBe(input);
    expect(Number((input as HTMLInputElement).value)).toBeCloseTo(value, 2);
    await userEvent.keyboard('75{Enter}');
    await settled();
    const dimension = latest().constraints.find(constraint => 'value' in constraint)!;
    expect(dimension).toMatchObject({ type, pointAId: refs[0], pointBId: refs[1], value: 75 });
    expect(dimension).not.toHaveProperty('sourceEntityId');
  });

  it('dimensions the outer corner against an inner rectangle edge without Shift or first-entity fallthrough', async () => {
    let sketch = addRectangle(createCadPart().sketch, { x: 20, y: 20, width: 140, height: 100 });
    sketch = addRectangle(sketch, { x: 45, y: 45, width: 90, height: 50 });
    const { canvas, latest, click, settled } = await setup(sketch);
    expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull();
    const sourceIds = sketch.entities.map(entity => entity.id);
    await userEvent.keyboard('d');
    await click(20, 20);
    await click(90, 45);
    await click(10, 35);
    const input = screen.getByRole('textbox', { name: 'Distance mm' });
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe('25');
    await userEvent.keyboard('30{Enter}');
    await settled();
    expect(latest().constraints.filter(constraint => 'value' in constraint)).toEqual([
      expect.objectContaining({ type: 'pointLineDistance', value: 30 }),
    ]);
    expect(latest().entities.map(entity => entity.id)).toEqual(sourceIds);
    expect(canvas.querySelector('[data-sketch-region]')).not.toBeNull();
  });

  it('rejects empty or negative gap input without publishing it and accepts an explicit zero contact distance', async () => {
    let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 120, y2: 20 });
    const line = sketch.entities.find(entity => entity.type === 'line')!;
    sketch = fixPoints(sketch, [line.startId, line.endId]);
    sketch = addPoint(sketch, { x: 70, y: 45 });
    const { latest, click, settled } = await setup(sketch);
    await userEvent.keyboard('d');
    await click(70, 45);
    await click(90, 20);
    await click(145, 65);
    await userEvent.keyboard('-5{Enter}');
    expect(screen.getByText('A normal distance must not be negative.')).toBeTruthy();
    expect(latest().constraints.at(-1)).toMatchObject({ type: 'pointLineDistance', value: 25 });
    await userEvent.keyboard('{Backspace}{Backspace}{Enter}');
    expect(screen.getByText('Enter a dimension value.')).toBeTruthy();
    expect(latest().constraints.at(-1)).toMatchObject({ value: 25 });
    await userEvent.keyboard('0{Enter}');
    await settled();
    expect(latest().constraints.at(-1)).toMatchObject({ type: 'pointLineDistance', value: 0 });
    expect(screen.queryByRole('textbox', { name: 'Distance mm' })).toBeNull();
    expect(screen.queryByText('Finish is blocked')).toBeNull();
  });

  it.each([
    {
      name: 'parallel lines',
      kind: 'lineLineDistance',
      value: 30,
      picks: [
        [80, 20],
        [90, 50],
      ],
      make: () => {
        let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 130, y2: 20 });
        sketch = addLine(sketch, { x1: 30, y1: 50, x2: 140, y2: 50 });
        return sketch;
      },
    },
    {
      name: 'point and facing arc',
      kind: 'pointArcDistance',
      value: 30,
      picks: [
        [70, 110],
        [70, 80],
      ],
      make: () => {
        let sketch = addArc(createCadPart().sketch, { cx: 70, cy: 60, radius: 20, startAngle: 0, endAngle: Math.PI });
        sketch = addPoint(sketch, { x: 70, y: 110 });
        return sketch;
      },
    },
    {
      name: 'line and facing arc',
      kind: 'lineCircleDistance',
      value: 40,
      picks: [
        [110, 20],
        [80, 60],
      ],
      make: () => {
        let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 140, y2: 20 });
        sketch = addArc(sketch, { cx: 80, cy: 80, radius: 20, startAngle: Math.PI, endAngle: Math.PI * 2 });
        return sketch;
      },
    },
    {
      name: 'facing arcs',
      kind: 'circleCircleDistance',
      value: 55,
      picks: [
        [65, 60],
        [120, 60],
      ],
      make: () => {
        let sketch = addArc(createCadPart().sketch, { cx: 50, cy: 60, radius: 15, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
        sketch = addArc(sketch, { cx: 140, cy: 60, radius: 20, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5 });
        return sketch;
      },
    },
    {
      name: 'same-side arcs',
      kind: 'circleCircleDistance',
      value: 85,
      picks: [
        [35, 60],
        [120, 60],
      ],
      make: () => {
        let sketch = addArc(createCadPart().sketch, { cx: 50, cy: 60, radius: 15, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5 });
        sketch = addArc(sketch, { cx: 140, cy: 60, radius: 20, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5 });
        return sketch;
      },
    },
    {
      name: 'arc radius',
      kind: 'radius',
      value: 20,
      picks: [[70, 80]],
      make: () => addArc(createCadPart().sketch, { cx: 70, cy: 60, radius: 20, startAngle: 0, endAngle: Math.PI }),
    },
    {
      name: 'circle diameter',
      kind: 'diameter',
      value: 40,
      picks: [[70, 80]],
      make: () => addCircle(createCadPart().sketch, { x: 70, y: 60, radius: 20 }),
    },
  ])('creates and edits the $name dimension with real ordinary pointer clicks', async ({ make, picks, kind, value }) => {
    const source = make(),
      sourceIds = source.entities.map(entity => entity.id);
    const { latest, click, settled } = await setup(source);
    await userEvent.keyboard('d');
    for (const [x, y] of picks) await click(x!, y!);
    expect(latest().constraints.filter(constraint => 'value' in constraint)).toHaveLength(0);
    await click(165, 110);
    const input = screen.getByRole('textbox', { name: `${kind === 'radius' || kind === 'diameter' ? kind : 'Distance'} mm` });
    expect(document.activeElement).toBe(input);
    expect(Number((input as HTMLInputElement).value)).toBeCloseTo(value, 2);
    const targetValue = value + 5;
    await userEvent.keyboard(`${targetValue}{Enter}`);
    await settled();
    const dimension = latest().constraints.find(constraint => constraint.type === kind)! as CadDimension;
    expect(dimension).toMatchObject({ type: kind, value: targetValue });
    const witnesses = dimensionWitnessPoints(latest(), dimension);
    if (witnesses) expect(Math.hypot(witnesses[1].x - witnesses[0].x, witnesses[1].y - witnesses[0].y)).toBeCloseTo(targetValue, 4);
    expect(latest().entities.map(entity => entity.id)).toEqual(sourceIds);
    expect(screen.queryByText('Finish is blocked')).toBeNull();
    await userEvent.keyboard('{Control>}z{/Control}');
    await settled();
    expect(latest().constraints.filter(constraint => 'value' in constraint)).toHaveLength(0);
  });
});
