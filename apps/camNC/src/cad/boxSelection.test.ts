import { addArc, addCircle, addLine, addPoint, createCadPart, removeEntity, type CadSketch } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { boxSelectSketch } from './boxSelection';

const withoutPoints = { visiblePointIds: [] as string[] };
function curveIds(sketch: CadSketch) {
  return sketch.entities.filter(entity => entity.type !== 'point').map(entity => entity.id);
}

describe('CAD window and crossing selection', () => {
  it('contains complete lines left-to-right and crosses partial lines right-to-left', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 10, y1: 10, x2: 90, y2: 10 });
    sketch = addLine(sketch, { x1: 30, y1: 0, x2: 30, y2: 20 });
    expect(boxSelectSketch(sketch, { start: { x: 20, y: 5 }, end: { x: 40, y: 15 } }, withoutPoints)).toEqual({
      mode: 'window',
      entityIds: [],
    });
    expect(boxSelectSketch(sketch, { start: { x: 40, y: 15 }, end: { x: 20, y: 5 } }, withoutPoints)).toEqual({
      mode: 'crossing',
      entityIds: curveIds(sketch),
    });
    expect(boxSelectSketch(sketch, { start: { x: 0, y: 0 }, end: { x: 100, y: 30 } }, withoutPoints).entityIds).toEqual(curveIds(sketch));
  });

  it('normalizes either vertical drag direction without changing window/crossing mode', () => {
    const sketch = addLine(createCadPart().sketch, { x1: 10, y1: 10, x2: 30, y2: 20 });
    const lower = boxSelectSketch(sketch, { start: { x: 0, y: 30 }, end: { x: 40, y: 0 } }, withoutPoints);
    const upper = boxSelectSketch(sketch, { start: { x: 0, y: 0 }, end: { x: 40, y: 30 } }, withoutPoints);
    expect(lower).toEqual(upper);
  });

  it('selects circle circumferences analytically and does not confuse an interior box with a crossing', () => {
    const sketch = addCircle(createCadPart().sketch, { x: 40, y: 40, radius: 20 });
    const [circle] = curveIds(sketch);
    expect(boxSelectSketch(sketch, { start: { x: 19, y: 19 }, end: { x: 61, y: 61 } }, withoutPoints).entityIds).toEqual([circle]);
    expect(boxSelectSketch(sketch, { start: { x: 39, y: 39 }, end: { x: 41, y: 41 } }, withoutPoints).entityIds).toEqual([]);
    expect(boxSelectSketch(sketch, { start: { x: 45, y: 45 }, end: { x: 35, y: 35 } }, withoutPoints).entityIds).toEqual([]);
    expect(boxSelectSketch(sketch, { start: { x: 61, y: 45 }, end: { x: 58, y: 35 } }, withoutPoints).entityIds).toEqual([circle]);
    expect(boxSelectSketch(sketch, { start: { x: 60.1, y: 41 }, end: { x: 59.9, y: 39 } }, withoutPoints).entityIds).toEqual([circle]);
  });

  it('uses arc extrema for containment even when both endpoints fit inside the window', () => {
    const sketch = addArc(createCadPart().sketch, { cx: 0, cy: 0, radius: 20, startAngle: 0, endAngle: Math.PI });
    expect(boxSelectSketch(sketch, { start: { x: -21, y: -1 }, end: { x: 21, y: 1 } }, withoutPoints).entityIds).toEqual([]);
    expect(boxSelectSketch(sketch, { start: { x: -21, y: -1 }, end: { x: 21, y: 21 } }, withoutPoints).entityIds).toEqual(curveIds(sketch));
  });

  it('crosses only the finite arc sweep, including wrapped major arcs', () => {
    const upper = addArc(createCadPart().sketch, { cx: 0, cy: 0, radius: 20, startAngle: 0, endAngle: Math.PI });
    expect(boxSelectSketch(upper, { start: { x: 2, y: -21 }, end: { x: -2, y: -19 } }, withoutPoints).entityIds).toEqual([]);
    expect(boxSelectSketch(upper, { start: { x: 2, y: 21 }, end: { x: -2, y: 19 } }, withoutPoints).entityIds).toEqual(curveIds(upper));
    const major = addArc(createCadPart().sketch, { cx: 0, cy: 0, radius: 20, startAngle: Math.PI / 2, endAngle: 0 });
    expect(boxSelectSketch(major, { start: { x: -19, y: 2 }, end: { x: -21, y: -2 } }, withoutPoints).entityIds).toEqual(curveIds(major));
    expect(boxSelectSketch(major, { start: { x: 16, y: 16 }, end: { x: 13, y: 13 } }, withoutPoints).entityIds).toEqual([]);
  });

  it('suppresses endpoints of selected curves so deleting the box selection cannot remove neighboring lines', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 10, y1: 10, x2: 30, y2: 10 });
    sketch = addLine(sketch, { x1: 30, y1: 10, x2: 60, y2: 10 });
    const lines = sketch.entities.filter(entity => entity.type === 'line');
    const selection = boxSelectSketch(sketch, { start: { x: 9, y: 9 }, end: { x: 31, y: 11 } });
    expect(selection.entityIds).toEqual([lines[0]!.id]);
    let deleted = sketch;
    for (const id of selection.entityIds) deleted = removeEntity(deleted, id);
    expect(deleted.entities).toContainEqual(lines[1]);
  });

  it('selects a point-only vertex or standalone point, excludes the fixed origin, and respects handle visibility', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 10, y1: 10, x2: 30, y2: 10 });
    const line = sketch.entities.find(entity => entity.type === 'line')!;
    sketch = addPoint(sketch, { x: 12, y: 12 });
    const standalone = sketch.entities.at(-1)!;
    expect(boxSelectSketch(sketch, { start: { x: 9, y: 9 }, end: { x: 13, y: 13 } }).entityIds).toEqual([line.startId, standalone.id]);
    expect(
      boxSelectSketch(sketch, { start: { x: 9, y: 9 }, end: { x: 13, y: 13 } }, { visiblePointIds: [standalone.id] }).entityIds
    ).toEqual([standalone.id]);
    expect(boxSelectSketch(sketch, { start: { x: -1, y: -1 }, end: { x: 1, y: 1 } }).entityIds).toEqual([]);
  });

  it('allows construction curves unless their visibility is disabled', () => {
    const sketch = addLine(createCadPart().sketch, { x1: 10, y1: 10, x2: 30, y2: 10, construction: true });
    const box = { start: { x: 9, y: 9 }, end: { x: 31, y: 11 } };
    expect(boxSelectSketch(sketch, box).entityIds).toEqual(curveIds(sketch));
    expect(boxSelectSketch(sketch, box, { includeConstruction: false }).entityIds).toEqual([]);
  });

  it.each(['conic', 'bezier', 'spline'] as const)(
    'selects the %s curve rather than its control polygon and respects hidden handles',
    type => {
      const sketch = createCadPart().sketch;
      sketch.entities.push(
        { id: 'start', type: 'point', x: 10, y: 10 },
        { id: 'control', type: 'point', x: 30, y: 50 },
        { id: 'end', type: 'point', x: 50, y: 10 },
        { id: 'fit-middle', type: 'point', x: 30, y: 30 }
      );
      if (type === 'conic') sketch.entities.push({ id: 'curve', type, startId: 'start', endId: 'end', controlId: 'control', rho: 0.5 });
      else if (type === 'bezier')
        sketch.entities.push({ id: 'curve', type, startId: 'start', endId: 'end', controlPointIds: ['start', 'control', 'end'] });
      else
        sketch.entities.push({
          id: 'curve',
          type,
          startId: 'start',
          endId: 'end',
          controlPointIds: ['start', 'control', 'end'],
          fitPointIds: ['start', 'fit-middle', 'end'],
          fitParameters: [0, 0.5, 1],
          degree: 2,
          knots: [0, 0, 0, 1, 1, 1],
          weights: [1, 1, 1],
        });
      expect(boxSelectSketch(sketch, { start: { x: 9, y: 9 }, end: { x: 51, y: 31 } }, withoutPoints).entityIds).toEqual(['curve']);
      expect(boxSelectSketch(sketch, { start: { x: 9, y: 9 }, end: { x: 51, y: 20 } }, withoutPoints).entityIds).toEqual([]);
      expect(boxSelectSketch(sketch, { start: { x: 31, y: 31 }, end: { x: 29, y: 29 } }, withoutPoints).entityIds).toEqual(['curve']);
      expect(boxSelectSketch(sketch, { start: { x: 31, y: 51 }, end: { x: 29, y: 49 } }, withoutPoints).entityIds).toEqual([]);
      expect(
        boxSelectSketch(sketch, { start: { x: 29, y: 49 }, end: { x: 31, y: 51 } }, { visiblePointIds: ['control'] }).entityIds
      ).toEqual(['control']);
      expect(boxSelectSketch(sketch, { start: { x: 29, y: 49 }, end: { x: 31, y: 51 } }, withoutPoints).entityIds).toEqual([]);
    }
  );

  it('handles tangencies, negative coordinates, and zero-area boxes consistently', () => {
    const sketch = addCircle(createCadPart().sketch, { x: -50, y: -20, radius: 10 });
    const box = { start: { x: -39.9, y: -19 }, end: { x: -40.1, y: -21 } };
    expect(boxSelectSketch(sketch, box, withoutPoints).entityIds).toEqual(curveIds(sketch));
    expect(boxSelectSketch(sketch, { start: { x: -50, y: -20 }, end: { x: -50, y: -20 } }, withoutPoints).entityIds).toEqual([]);
  });

  it('does not mutate source geometry and rejects nonfinite gestures or malformed curves', () => {
    const sketch = addLine(createCadPart().sketch, { x1: 10, y1: 10, x2: 30, y2: 10 });
    const before = structuredClone(sketch);
    expect(boxSelectSketch(sketch, { start: { x: Number.NaN, y: 0 }, end: { x: 40, y: 40 } }).entityIds).toEqual([]);
    boxSelectSketch(sketch, { start: { x: 0, y: 0 }, end: { x: 40, y: 40 } });
    expect(sketch).toEqual(before);
    const line = sketch.entities.find(entity => entity.type === 'line')!;
    line.startId = 'missing';
    expect(boxSelectSketch(sketch, { start: { x: 0, y: 0 }, end: { x: 40, y: 40 } }, withoutPoints).entityIds).toEqual([]);
  });
});
