import {
  addArc,
  addCircle,
  addLine,
  addPoint,
  createCadPart,
  createPlateDocument,
  withDimensionPlacement,
  type CadDimension,
  type CadSketch,
} from '@wbcnc/cad';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DimensionGraphics } from './DimensionGraphics';
import { dimensionAnchor } from './dimensionGeometry';
import { SKETCH_APPEARANCE, useSvgPixelScale } from './sketchAppearance';

afterEach(cleanup);
const sketch = createPlateDocument().parts[0]!.sketch;
const width = sketch.constraints.find((c): c is CadDimension => c.label === 'Width')!;
const height = sketch.constraints.find((c): c is CadDimension => c.label === 'Height')!;
function Harness({ viewBox = '-20 -120 180 180' }) {
  const svg = useRef<SVGSVGElement>(null),
    pixelScale = useSvgPixelScale(svg, viewBox);
  return (
    <svg ref={svg} width="400" height="400" viewBox={viewBox} data-testid="svg">
      <DimensionGraphics constraint={width} sketch={sketch} pixelScale={pixelScale} />
    </svg>
  );
}
const numberAttribute = (element: Element, name: string) => Number(element.getAttribute(name));
const linePoints = (element: Element) => ({
  a: { x: numberAttribute(element, 'x1'), y: -numberAttribute(element, 'y1') },
  b: { x: numberAttribute(element, 'x2'), y: -numberAttribute(element, 'y2') },
});

describe('inline dimension graphics', () => {
  it('formats three decimals for display and marks persisted expressions without rounding source values', () => {
    const constraint: CadDimension = { ...width, value: 33.3333333333333, expression: '100/3' };
    const before = structuredClone(constraint);
    const { container, getByRole, rerender } = render(
      <svg>
        <DimensionGraphics constraint={constraint} sketch={sketch} pixelScale={1} />
      </svg>
    );
    const label = getByRole('button', { name: 'Edit Width: 33.333 mm' });
    expect(container.querySelector('text')!.textContent).toBe('ƒ 33.333');
    expect(label.getAttribute('aria-description')).toContain('100/3');
    expect(label.getAttribute('data-dimension-expression')).toBe('true');
    expect(constraint).toEqual(before);
    rerender(
      <svg>
        <DimensionGraphics constraint={{ ...constraint, expression: undefined, value: 0.00000456 }} sketch={sketch} pixelScale={1} />
      </svg>
    );
    expect(container.querySelector('text')!.textContent).toBe('0.00000456');
    expect(container.querySelector('[data-dimension-expression]')).toBeNull();
  });

  it('keeps reference dimensions selectable and movable while their values stay read-only and gray', () => {
    const reference: CadDimension = { ...width, driven: true };
    const onEdit = vi.fn(),
      onSelect = vi.fn(),
      onPointer = vi.fn();
    const { container, getByRole, rerender } = render(
      <svg>
        <DimensionGraphics
          constraint={reference}
          sketch={sketch}
          pixelScale={1}
          onSelect={onSelect}
          onEdit={onEdit}
          onLabelPointerDown={onPointer}
        />
      </svg>
    );
    const label = getByRole('button', { name: 'Reference Width: 120 mm' });
    expect(label.getAttribute('aria-description')).toMatch(/Read-only/);
    expect(label.getAttribute('aria-disabled')).toBe('false');
    expect(label.getAttribute('data-dimension-driven')).toBe('true');
    expect(container.querySelector('text')!.getAttribute('fill')).toBe('#718096');
    fireEvent.pointerDown(label);
    fireEvent.click(label);
    fireEvent.doubleClick(label);
    fireEvent.keyDown(label, { key: 'Enter' });
    fireEvent.keyDown(label, { key: ' ' });
    expect(onPointer).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onEdit).not.toHaveBeenCalled();
    rerender(
      <svg>
        <DimensionGraphics constraint={reference} sketch={sketch} pixelScale={1} selected />
      </svg>
    );
    expect(container.querySelector('text')!.getAttribute('fill')).toBe(SKETCH_APPEARANCE.selectedColor);
  });

  it('keeps text at14CSSpixels and a minimum32x22pixel label target through zoom and resize', async () => {
    const { container, rerender, getByTestId } = render(<Harness />);
    const checkSize = () => {
      const svg = container.querySelector('svg')!,
        text = container.querySelector('text')!,
        target = container.querySelector('rect')!;
      const scale = Math.hypot(svg.getScreenCTM()!.a, svg.getScreenCTM()!.b);
      expect(numberAttribute(text, 'font-size') * scale).toBeCloseTo(14, 3);
      expect(target.getBoundingClientRect().width).toBeGreaterThanOrEqual(32);
      expect(target.getBoundingClientRect().height).toBeCloseTo(22, 3);
    };
    checkSize();
    rerender(<Harness viewBox="-200 -400 900 900" />);
    checkSize();
    getByTestId('svg').style.width = '700px';
    getByTestId('svg').style.height = '700px';
    await waitFor(checkSize);
  });

  it('selects on a single click or Space and edits only on doubleclick or Enter', () => {
    const onSelect = vi.fn(),
      onEdit = vi.fn(),
      onPointer = vi.fn();
    const { getByRole } = render(
      <svg onPointerDown={onPointer}>
        <DimensionGraphics constraint={width} sketch={sketch} pixelScale={1} onSelect={onSelect} onEdit={onEdit} />
      </svg>
    );
    const label = getByRole('button', { name: 'Edit Width: 120 mm' });
    fireEvent.pointerDown(label);
    expect(onPointer).not.toHaveBeenCalled();
    fireEvent.click(label);
    expect(onSelect).toHaveBeenLastCalledWith(false);
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(label, { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(label, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.doubleClick(label);
    fireEvent.keyDown(label, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it('lets placement previews pass through pointer input and disables their actions', () => {
    const onSelect = vi.fn(),
      onEdit = vi.fn();
    const { getByRole, container } = render(
      <svg>
        <DimensionGraphics constraint={width} sketch={sketch} pixelScale={1} interactive={false} onSelect={onSelect} onEdit={onEdit} />
      </svg>
    );
    const label = getByRole('button');
    expect(label.getAttribute('aria-disabled')).toBe('true');
    expect(label.getAttribute('tabindex')).toBe('-1');
    expect(getComputedStyle(label).pointerEvents).toBe('none');
    expect(container.querySelector('[aria-hidden="true"]')!.getAttribute('pointer-events')).toBe('none');
    fireEvent.click(label);
    fireEvent.doubleClick(label);
    fireEvent.keyDown(label, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('shows a real conflicting dimension in red with a pale red label, with selected orange taking priority', () => {
    const fixture = (selected: boolean) => (
      <svg>
        <DimensionGraphics constraint={width} sketch={sketch} pixelScale={1} conflicted selected={selected} />
      </svg>
    );
    const { container, rerender } = render(fixture(false));
    expect(container.querySelector('text')!.getAttribute('fill')).toBe('#c73535');
    expect(container.querySelector('rect')!.getAttribute('fill')).toBe('#fff0f0');
    expect(container.querySelector('[data-dimension-line="measure"]')!.getAttribute('stroke')).toBe('#c73535');
    rerender(fixture(true));
    expect(container.querySelector('text')!.getAttribute('fill')).toBe('#ff9b23');
    expect(container.querySelector('rect')!.getAttribute('stroke')).toBe('#ff9b23');
    expect(container.querySelector('[data-dimension-line="measure"]')!.getAttribute('stroke')).toBe('#ff9b23');
  });

  it('uses stored world label positions while keeping default offsets20pixels from geometry', () => {
    expect(dimensionAnchor(width, sketch, 2)).toEqual({ x: 60, y: -10 });
    expect(dimensionAnchor(height, sketch, 4)).toEqual({ x: 125, y: 40 });
    expect(dimensionAnchor({ ...width, labelPosition: { x: -7, y: 14 } }, sketch, 100)).toEqual({ x: -7, y: 14 });
    const { container } = render(
      <svg>
        <DimensionGraphics
          constraint={{ ...width, labelPosition: { x: -7, y: 14 } }}
          sketch={sketch}
          pixelScale={1}
          position={{ x: 50, y: -25 }}
        />
      </svg>
    );
    expect(container.querySelector('text')!.getAttribute('x')).toBe('50');
    expect(container.querySelector('text')!.getAttribute('y')).toBe('30');
    const measure = container.querySelector('[data-dimension-line="measure"]')!;
    expect(linePoints(measure)).toEqual({ a: { x: 0, y: -25 }, b: { x: 120, y: -25 } });
    expect(container.querySelectorAll('[data-dimension-arrow]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-dimension-line^="extension"]')).toHaveLength(2);
    expect(measure.getAttribute('stroke-width')).toBe('0.75');
    expect(measure.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('draws aligned distance parallel to its point pair with perpendicular extensions', () => {
    const bottom = sketch.entities.find(e => e.type === 'line')!,
      right = sketch.entities.filter(e => e.type === 'line')[1]!;
    if (bottom.type !== 'line' || right.type !== 'line') throw new Error('Missing fixture lines');
    const aligned: CadDimension = {
      id: 'aligned',
      type: 'distance',
      pointAId: bottom.startId,
      pointBId: right.endId,
      value: Math.hypot(120, 80),
    };
    const { container } = render(
      <svg>
        <DimensionGraphics constraint={aligned} sketch={sketch} pixelScale={1} position={{ x: 60, y: 0 }} />
      </svg>
    );
    const { a, b } = linePoints(container.querySelector('[data-dimension-line="measure"]')!);
    expect((b.x - a.x) * 80 - (b.y - a.y) * 120).toBeCloseTo(0, 6);
    const ext = linePoints(container.querySelector('[data-dimension-line="extension-a"]')!);
    expect((ext.b.x - ext.a.x) * 120 + (ext.b.y - ext.a.y) * 80).toBeCloseTo(0, 6);
  });

  it.each(['positionX', 'positionY'] as const)('draws %s from the fixed coordinate origin to its point', type => {
    const positioned = addCircle(createCadPart().sketch, { x: 40, y: 30, radius: 10, positioned: true });
    const dimension = positioned.constraints.find((c): c is CadDimension => c.type === type)!;
    const { container } = render(
      <svg>
        <DimensionGraphics constraint={dimension} sketch={positioned} pixelScale={1} />
      </svg>
    );
    const { a, b } = linePoints(container.querySelector('[data-dimension-line="measure"]')!);
    if (type === 'positionX') {
      expect(a.x).toBe(0);
      expect(b.x).toBe(40);
      expect(a.y).toBe(b.y);
    } else {
      expect(a.y).toBeCloseTo(0);
      expect(b.y).toBe(30);
      expect(a.x).toBe(b.x);
    }
  });

  it.each(['radius', 'diameter'] as const)('draws a %s leader onto the circular curve with appropriate arrows', type => {
    const circular = addCircle(createCadPart().sketch, { x: 40, y: 30, radius: 10 });
    const circle = circular.entities.find(e => e.type === 'circle')!;
    const dimension: CadDimension = { id: type, type, entityId: circle.id, value: type === 'diameter' ? 20 : 10 };
    const { container } = render(
      <svg>
        <DimensionGraphics constraint={dimension} sketch={circular} pixelScale={1} position={{ x: 60, y: 30 }} selected />
      </svg>
    );
    expect(linePoints(container.querySelector('[data-dimension-line="leader"]')!)).toEqual({ a: { x: 50, y: 30 }, b: { x: 60, y: 30 } });
    expect(container.querySelectorAll('[data-dimension-arrow]')).toHaveLength(type === 'diameter' ? 2 : 1);
    const measure = linePoints(container.querySelector(`[data-dimension-line="${type}"]`)!);
    expect(Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y)).toBe(type === 'diameter' ? 20 : 10);
    expect(container.querySelector('text')!.getAttribute('fill')).toBe('#ff9b23');
    expect(container.querySelector('text')!.textContent).toBe(type === 'diameter' ? '⌀20' : 'R10');
  });

  it('draws an angular arc and tangent arrowheads between intersecting line directions', () => {
    let angular: CadSketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 80, y2: 0 });
    const first = angular.entities.at(-1)!;
    angular = addLine(angular, { x1: 0, y1: 0, x2: 0, y2: 60 });
    const dimension: CadDimension = { id: 'angle', type: 'angle', entityAId: first.id, entityBId: angular.entities.at(-1)!.id, value: 90 };
    const { container, getByRole } = render(
      <svg>
        <DimensionGraphics constraint={dimension} sketch={angular} pixelScale={1} position={{ x: 30, y: 30 }} />
      </svg>
    );
    expect(container.querySelector('[data-dimension-line="angle-arc"]')!.getAttribute('d')).toContain(
      ' A 42.42640687119285 42.42640687119285 0 0 0 '
    );
    expect(container.querySelectorAll('[data-dimension-arrow]')).toHaveLength(2);
    expect(getByRole('button', { name: 'Edit angle: 90 degrees' })).toBeTruthy();
    expect(container.querySelector('text')!.textContent).toBe('90°');
  });

  it('draws a point-line distance from the projected foot instead of treating the point as an origin coordinate', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 20, y1: 20, x2: 120, y2: 20 });
    const source = sketch.entities.at(-1)!;
    sketch = addPoint(sketch, { x: 70, y: 45 });
    const dimension: CadDimension = {
      id: 'normal-gap',
      type: 'pointLineDistance',
      pointId: sketch.entities.at(-1)!.id,
      entityId: source.id,
      value: 25,
    };
    const { container } = render(
      <svg>
        <DimensionGraphics constraint={dimension} sketch={sketch} pixelScale={1} position={{ x: 145, y: 65 }} />
      </svg>
    );
    expect(linePoints(container.querySelector('[data-dimension-line="measure"]')!)).toEqual({ a: { x: 145, y: 20 }, b: { x: 145, y: 45 } });
    const extension = linePoints(container.querySelector('[data-dimension-line="extension-a"]')!);
    expect(extension.a).toEqual({ x: 120, y: 20 });
    expect(extension.b).toEqual({ x: 149, y: 20 });
    expect(container.querySelector('[data-dimension-line="radius"]')).toBeNull();
    expect(container.querySelectorAll('[data-dimension-arrow]')).toHaveLength(2);
    expect(linePoints(container.querySelector('[data-dimension-line="label-leader"]')!)).toEqual({
      a: { x: 145, y: 45 },
      b: { x: 145, y: 65 },
    });
  });

  it('does not draw a radius when a zero point-arc reference has coincident linear witnesses', () => {
    let sketch = addCircle(createCadPart().sketch, { x: 40, y: 30, radius: 10 });
    const circle = sketch.entities.at(-1)!;
    sketch = addPoint(sketch, { x: 40, y: 40 });
    const dimension: CadDimension = {
      id: 'zero-contact',
      type: 'pointArcDistance',
      pointId: sketch.entities.at(-1)!.id,
      entityId: circle.id,
      value: 0,
      side: 'outside',
      driven: true,
    };
    const { container, getByRole } = render(
      <svg>
        <DimensionGraphics constraint={dimension} sketch={sketch} pixelScale={1} />
      </svg>
    );
    expect(getByRole('button', { name: 'Reference pointArcDistance: 0 mm' })).toBeTruthy();
    expect(container.querySelector('[data-dimension-line="radius"]')).toBeNull();
    expect(container.querySelector('[data-dimension-line="leader"]')).toBeNull();
  });

  it('uses the persisted angular wedge flags for its arc and positive label after geometry changes', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 80, y2: 0 });
    const first = sketch.entities.at(-1)!;
    sketch = addLine(sketch, { x1: 0, y1: 0, x2: 40, y2: 40 });
    const dimension: CadDimension = {
      id: 'obtuse-angle',
      type: 'angle',
      entityAId: first.id,
      entityBId: sketch.entities.at(-1)!.id,
      value: 135,
      orientation: -1,
      reversedA: true,
      reversedB: false,
    };
    const { container } = render(
      <svg>
        <DimensionGraphics constraint={dimension} sketch={sketch} pixelScale={1} position={{ x: 30, y: 30 }} />
      </svg>
    );
    const arc = container.querySelector('[data-dimension-line="angle-arc"]') as SVGPathElement;
    const start = arc.getPointAtLength(0),
      end = arc.getPointAtLength(arc.getTotalLength());
    expect(start.x).toBeCloseTo(-Math.hypot(30, 30), 4);
    expect(start.y).toBeCloseTo(0, 4);
    expect(end.x).toBeCloseTo(30, 4);
    expect(end.y).toBeCloseTo(-30, 4);
    expect(container.querySelector('text')!.textContent).toBe('135°');
  });

  it('keeps a parallel0degree dimension label visible and editable without an infinite intersection', () => {
    let parallel = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 80, y2: 0 });
    const first = parallel.entities.at(-1)!;
    parallel = addLine(parallel, { x1: 0, y1: 20, x2: 80, y2: 20 });
    const dimension: CadDimension = {
      id: 'parallel-angle',
      type: 'angle',
      entityAId: first.id,
      entityBId: parallel.entities.at(-1)!.id,
      value: 0,
    };
    // Parallel angles use the same finite frame and 40 px default radius as nearby angles.
    expect(dimensionAnchor(dimension, parallel, 2)).toEqual({ x: 60, y: 10 });
    const onEdit = vi.fn();
    const { getByRole } = render(
      <svg>
        <DimensionGraphics constraint={dimension} sketch={parallel} pixelScale={2} onEdit={onEdit} />
      </svg>
    );
    fireEvent.doubleClick(getByRole('button', { name: 'Edit angle: 0 degrees' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('bounds near-parallel angle decorations as well as the manually placed label', () => {
    let almostParallel = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    const first = almostParallel.entities.at(-1)!;
    almostParallel = addLine(almostParallel, { x1: 0, y1: 10, x2: 100, y2: 10.001 });
    const dimension: CadDimension = {
      id: 'conditioned-angle',
      type: 'angle',
      entityAId: first.id,
      entityBId: almostParallel.entities.at(-1)!.id,
      value: (Math.atan2(0.001, 100) * 180) / Math.PI,
      labelPosition: { x: 50, y: 20 },
    };
    const { container } = render(
      <svg>
        <DimensionGraphics constraint={dimension} sketch={almostParallel} pixelScale={1} />
      </svg>
    );
    expect(dimensionAnchor(dimension, almostParallel)).toEqual({ x: 50, y: 20 });
    const path = container.querySelector('[data-dimension-line="angle-arc"]')!;
    expect(path).not.toBeNull();
    const coordinates = path
      .getAttribute('d')!
      .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
      .map(Number);
    expect(coordinates.every(value => Number.isFinite(value) && Math.abs(value) < 100)).toBe(true);
  });

  it('keeps the rendered angle arc continuous through parallel and both former conditioning cutoffs', () => {
    let source = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    const first = source.entities.at(-1)!;
    source = addLine(source, { x1: 0, y1: 10, x2: 100, y2: 60 });
    const second = source.entities.at(-1)!;
    if (second.type !== 'line') throw new Error('Expected a line fixture');
    const placed = withDimensionPlacement<CadDimension>(
      source,
      {
        id: 'swept-angle',
        type: 'angle',
        entityAId: first.id,
        entityBId: second.id,
        value: (Math.atan2(50, 100) * 180) / Math.PI,
        orientation: 1,
      },
      { x: 50, y: 20 }
    );
    const { container, rerender } = render(<svg />);
    let previous: number[] | undefined;
    for (let step = 500; step >= -500; step--) {
      const dy = step / 10;
      const sketch = {
        ...source,
        entities: source.entities.map(entity => (entity.id === second.endId ? { ...entity, y: 10 + dy } : entity)),
      };
      const constraint = { ...placed, value: (Math.atan2(dy, 100) * 180) / Math.PI };
      rerender(
        <svg>
          <DimensionGraphics constraint={constraint} sketch={sketch} pixelScale={1} />
        </svg>
      );
      const path = container.querySelector('[data-dimension-line="angle-arc"]');
      expect(path, `Arc must remain present at dy=${dy}`).not.toBeNull();
      const coordinates = path!
        .getAttribute('d')!
        .match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!
        .map(Number);
      expect(
        coordinates.every(value => Number.isFinite(value) && Math.abs(value) < 400),
        `Bounded arc at dy=${dy}`
      ).toBe(true);
      // SVG flags may change at zero; all geometric coordinates must move locally.
      const geometry = [coordinates[0]!, coordinates[1]!, coordinates[2]!, coordinates[3]!, coordinates[7]!, coordinates[8]!];
      if (previous)
        expect(Math.max(...geometry.map((value, index) => Math.abs(value - previous![index]!))), `Arc step at dy=${dy}`).toBeLessThan(12);
      previous = geometry;
    }
  });

  it('attaches an arc radius leader to the nearest visible endpoint when its label is behind the arc', () => {
    const arcSketch = addArc(createCadPart().sketch, { cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2 });
    const arc = arcSketch.entities.find(e => e.type === 'arc')!;
    const dimension: CadDimension = { id: 'arc-radius', type: 'radius', entityId: arc.id, value: 10 };
    const { container } = render(
      <svg>
        <DimensionGraphics constraint={dimension} sketch={arcSketch} pixelScale={1} position={{ x: -20, y: 0 }} />
      </svg>
    );
    const leader = linePoints(container.querySelector('[data-dimension-line="leader"]')!);
    expect(leader.a.x).toBeCloseTo(0, 8);
    expect(leader.a.y).toBeCloseTo(10, 8);
    expect(leader.b.x).toBe(-20);
    expect(leader.b.y).toBeCloseTo(0);
  });
});
