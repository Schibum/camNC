import { addCircle, addLine, createCadDocument, createCadPart, createPlateDocument, evaluateCadDocument, removeEntity } from '@wbcnc/cad';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SketchRegion } from './SketchRegion';
import './cad.css';

afterEach(cleanup);

describe('closed sketch regions', () => {
  it('shades both a concentric annulus and inner disc while CAM still treats the inner circle as a hole', () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addCircle(part.sketch, { x: 50, y: 50, radius: 30 });
    part.sketch = addCircle(part.sketch, { x: 50, y: 50, radius: 10 });
    document.parts.push(part);
    const { container } = render(
      <svg>
        <SketchRegion document={document} partId={part.id} verified />
      </svg>
    );
    const region = container.querySelector('path')!;
    expect(region.isPointInFill(new DOMPoint(50, -50))).toBe(true);
    expect(region.isPointInFill(new DOMPoint(70, -50))).toBe(true);
    expect(region.isPointInFill(new DOMPoint(90, -50))).toBe(false);
    expect(evaluateCadDocument(document).parts[0]!.holes).toHaveLength(1);
  });

  it('fills nested bounded regions like native sketch mode and leaves pointer picking to the sketch', () => {
    const document = createPlateDocument();
    const part = document.parts[0]!;
    part.sketch = addCircle(part.sketch, { x: 60, y: 40, radius: 10 });
    const { container } = render(
      <svg>
        <SketchRegion document={document} partId={part.id} verified />
      </svg>
    );
    const region = container.querySelector('path')!;
    expect(region.getAttribute('fill-rule')).toBe('nonzero');
    expect(region.getAttribute('pointer-events')).toBe('none');
    expect(getComputedStyle(region).pointerEvents).toBe('none');
    expect(region.isPointInFill(new DOMPoint(20, -20))).toBe(true);
    expect(region.isPointInFill(new DOMPoint(60, -40))).toBe(true);
    expect(getComputedStyle(region).fill).toBe('rgb(226, 230, 233)');
    expect(getComputedStyle(region).fillOpacity).toBe('1');
    expect(region.isPointInFill(new DOMPoint(130, -40))).toBe(false);
  });

  it('drops the previous fill when the boundary opens and restores it only for a closed replacement', () => {
    const closed = createPlateDocument();
    const part = closed.parts[0]!;
    const bottom = part.sketch.entities.find(e => e.type === 'line')!;
    const view = (document: typeof closed) => (
      <svg>
        <SketchRegion document={document} partId={part.id} verified />
      </svg>
    );
    const { container, rerender } = render(view(closed));
    expect(container.querySelector('path')).not.toBeNull();
    const open = structuredClone(closed);
    open.parts[0]!.sketch = removeEntity(open.parts[0]!.sketch, bottom.id);
    rerender(view(open));
    expect(container.querySelector('path')).toBeNull();
    const repaired = structuredClone(open);
    repaired.parts[0]!.sketch = addLine(repaired.parts[0]!.sketch, { x1: 0, y1: 0, x2: 120, y2: 0 });
    rerender(view(repaired));
    expect(container.querySelector('path')).not.toBeNull();
  });

  it('fills both bounded faces of a bow-tie like native sketch mode, independently of CAM acceptance', () => {
    const document = createCadDocument();
    const part = createCadPart();
    for (const [a, b] of [
      [
        [10, 10],
        [90, 70],
      ],
      [
        [90, 70],
        [10, 70],
      ],
      [
        [10, 70],
        [90, 10],
      ],
      [
        [90, 10],
        [10, 10],
      ],
    ])
      part.sketch = addLine(part.sketch, { x1: a![0]!, y1: a![1]!, x2: b![0]!, y2: b![1]! });
    document.parts.push(part);
    const { container } = render(
      <svg>
        <SketchRegion document={document} partId={part.id} verified />
      </svg>
    );
    const region = container.querySelector('path')!;
    expect(region.isPointInFill(new DOMPoint(50, -20))).toBe(true);
    expect(region.isPointInFill(new DOMPoint(50, -60))).toBe(true);
    expect(region.isPointInFill(new DOMPoint(10, -40))).toBe(false);
  });

  it('removes a valid previous region while the current revision is unverified', () => {
    const document = createPlateDocument();
    const partId = document.parts[0]!.id;
    const { container, rerender } = render(
      <svg>
        <SketchRegion document={document} partId={partId} verified />
      </svg>
    );
    expect(container.querySelector('path')).not.toBeNull();
    rerender(
      <svg>
        <SketchRegion document={{ ...document, revision: document.revision + 1 }} partId={partId} verified={false} />
      </svg>
    );
    expect(container.querySelector('path')).toBeNull();
  });

  it('fills overlapping closed curves and a rectangle despite unrelated open tangent lines', () => {
    const document = createPlateDocument({ width: 100, height: 60 });
    const part = document.parts[0]!;
    part.sketch = addCircle(part.sketch, { x: 100, y: 30, radius: 20 });
    part.sketch = addLine(part.sketch, { x1: 100, y1: 60, x2: 150, y2: 60 });
    part.sketch = addLine(part.sketch, { x1: 150, y1: 80, x2: 170, y2: 90 });
    const { container } = render(
      <svg>
        <SketchRegion document={document} partId={part.id} verified />
      </svg>
    );
    const region = container.querySelector('path')!;
    expect(region).not.toBeNull();
    expect(region.isPointInFill(new DOMPoint(90, -30))).toBe(true);
    expect(region.isPointInFill(new DOMPoint(110, -30))).toBe(true);
    expect(region.isPointInFill(new DOMPoint(10, -10))).toBe(true);
    expect(region.isPointInFill(new DOMPoint(130, -30))).toBe(false);
  });
});
