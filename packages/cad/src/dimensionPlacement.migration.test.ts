import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addConstraint,
  addLine,
  createCadDocument,
  createCadPart,
  parseCadDocument,
  updateDimension,
  updatePoint,
} from './document';
import { solveCadDocument } from './solver';
import type { CadDimension, CadDocument } from './types';

function lineDocument() {
  const document = createCadDocument(),
    part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 20, y1: 40, x2: 120, y2: 40 });
  const line = part.sketch.entities.find(entity => entity.type === 'line')!;
  part.sketch = addConstraint(part.sketch, {
    type: 'distance',
    pointAId: line.startId,
    pointBId: line.endId,
    value: 100,
    labelPosition: { x: 45, y: 70 },
  });
  document.parts.push(part);
  return { document, line };
}
const dimension = (document: CadDocument) => document.parts[0]!.sketch.constraints.find((c): c is CadDimension => 'value' in c)!;

describe('legacy dimension placement before source changes', () => {
  it('converts portable absolute coordinates without adding a source revision or changing the caller', () => {
    const { document } = lineDocument();
    const before = structuredClone(document),
      parsed = parseCadDocument(JSON.parse(JSON.stringify(document))),
      label = dimension(parsed);
    expect(label.labelPlacement).toEqual({ kind: 'linear', fraction: 0.25, normalOffset: 30 });
    expect(label).not.toHaveProperty('labelPosition');
    expect(parsed.revision).toBe(document.revision);
    expect(document).toEqual(before);
  });

  it('captures the original witness span before a direct point edit', () => {
    const { document, line } = lineDocument();
    const edited = updatePoint(document, line.endId, { x: 220, y: 40 });
    expect(dimension(edited).labelPlacement).toEqual({ kind: 'linear', fraction: 0.25, normalOffset: 30 });
    expect(dimension(edited)).not.toHaveProperty('labelPosition');
    expect(document.parts[0]!.sketch.entities.find(entity => entity.id === line.endId)).toMatchObject({ x: 120, y: 40 });
  });

  it('captures circular placement at the original radius before its driving value changes', () => {
    const document = createCadDocument(),
      part = createCadPart();
    part.sketch = addCircle(part.sketch, { x: 100, y: 70, radius: 15 });
    const circle = part.sketch.entities.find(entity => entity.type === 'circle')!;
    part.sketch = addConstraint(part.sketch, { type: 'diameter', entityId: circle.id, value: 30, labelPosition: { x: 145, y: 100 } });
    document.parts.push(part);
    const edited = updateDimension(document, dimension(document).id, 60);
    expect(dimension(edited).labelPlacement).toMatchObject({
      kind: 'radial',
      angle: Math.atan2(30, 45),
      radiusRatio: Math.hypot(45, 30) / 15,
    });
    expect(dimension(edited)).not.toHaveProperty('labelPosition');
  });

  it('captures the original oriented angle ray before its value changes', () => {
    const document = createCadDocument(),
      part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 40, y1: 40, x2: 140, y2: 40 });
    part.sketch = addLine(part.sketch, { x1: 40, y1: 40, x2: 90, y2: 40 + 50 * Math.sqrt(3) });
    const [first, second] = part.sketch.entities.filter(entity => entity.type === 'line');
    part.sketch = addConstraint(part.sketch, {
      type: 'angle',
      entityAId: first!.id,
      entityBId: second!.id,
      value: 60,
      orientation: 1,
      labelPosition: { x: 105, y: 65 },
    });
    document.parts.push(part);
    const edited = updateDimension(document, dimension(document).id, 90);
    expect(dimension(edited).labelPlacement).toEqual({
      kind: 'angle',
      frame: 'local',
      radius: Math.hypot(65, 25),
      angleOffset: Math.atan2(25, 65),
    });
    expect(dimension(edited)).not.toHaveProperty('labelPosition');
  });

  it('normalizes legacy placement before applying native drag targets', async () => {
    const { document, line } = lineDocument();
    const solved = await solveCadDocument(document, {
      drag: [
        { pointId: line.startId, x: 40, y: 80 },
        { pointId: line.endId, x: 140, y: 80 },
      ],
    });
    expect(solved.sketches[0]!.status).toBe('solved');
    expect(dimension(solved.document).labelPlacement).toEqual({ kind: 'linear', fraction: 0.25, normalOffset: 30 });
    expect(dimension(solved.document)).not.toHaveProperty('labelPosition');
  });
});
