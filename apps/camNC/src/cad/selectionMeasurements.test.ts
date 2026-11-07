import { describe, expect, it } from 'vitest';
import type { CadEntity, CadPointEntity, CadSketch } from '@wbcnc/cad';
import { selectionMeasurements } from './selectionMeasurements';

const point = (id: string, x: number, y: number): CadPointEntity => ({ id, type: 'point', x, y });
const line = (id: string, startId: string, endId: string): CadEntity => ({ id, type: 'line', startId, endId });
const circle = (id: string, centerId: string, radius: number): CadEntity => ({ id, type: 'circle', centerId, radius });
function arc(id: string, center: CadPointEntity, radius: number, startAngle: number, endAngle: number): CadEntity[] {
  const start = point(`${id}:start`, center.x + radius * Math.cos(startAngle), center.y + radius * Math.sin(startAngle));
  const end = point(`${id}:end`, center.x + radius * Math.cos(endAngle), center.y + radius * Math.sin(endAngle));
  return [start, end, { id, type: 'arc', centerId: center.id, radius, startId: start.id, endId: end.id, startAngle, endAngle }];
}
const sketch = (...entities: CadEntity[]): CadSketch => ({ id: 'measure', entities, constraints: [] });
const value = (source: CadSketch, ids: string[], label = 'Minimum distance') =>
  selectionMeasurements(source, ids).find(metric => metric.label === label)!.value;

describe('finite selection measurements', () => {
  it('measures actual single-curve lengths and circular sizes', () => {
    const center = point('c', 0, 0);
    const source = sketch(
      center,
      point('a', 1, 2),
      point('b', 4, 6),
      line('line', 'a', 'b'),
      circle('circle', 'c', 7),
      ...arc('arc', center, 4, 0, Math.PI / 2)
    );
    expect(selectionMeasurements(source, ['line'])).toEqual([{ label: 'Length', value: 5, unit: 'mm' }]);
    expect(selectionMeasurements(source, ['circle'])).toEqual([{ label: 'Diameter', value: 14, unit: 'mm' }]);
    expect(selectionMeasurements(source, ['arc'])).toEqual([{ label: 'Radius', value: 4, unit: 'mm' }]);
  });

  it('measures two source points without modifying constraints or their positions', () => {
    const source = sketch(point('a', 0, 0), point('b', 3, 4));
    Object.freeze(source.entities[0]);
    Object.freeze(source.entities[1]);
    Object.freeze(source.entities);
    Object.freeze(source.constraints);
    Object.freeze(source);
    expect(selectionMeasurements(source, ['a', 'b'])).toEqual([{ label: 'Minimum distance', value: 5, unit: 'mm' }]);
  });

  it('uses the finite segment endpoint when a point is outside its supporting line interval', () => {
    const source = sketch(point('a', 0, 0), point('b', 10, 0), point('p', 15, 4), line('line', 'a', 'b'));
    expect(value(source, ['p', 'line'])).toBeCloseTo(Math.sqrt(41), 7);
    expect(value(source, ['p', 'line'])).not.toBeCloseTo(4);
  });

  it('reports finite line distance separately from their infinite-support angle', () => {
    const source = sketch(
      point('a', 0, 0),
      point('b', 10, 0),
      point('c', 20, 5),
      point('d', 20, 10),
      line('a-line', 'a', 'b'),
      line('b-line', 'c', 'd')
    );
    expect(value(source, ['a-line', 'b-line'])).toBeCloseTo(Math.sqrt(125), 7);
    expect(value(source, ['a-line', 'b-line'], 'Angle')).toBe(90);
    const crossing = sketch(...source.entities, point('e', 5, -5), point('f', 5, 5), line('crossing', 'e', 'f'));
    expect(value(crossing, ['a-line', 'crossing'])).toBe(0);
  });

  it('uses the selected angular rays and ignores stale driving target values', () => {
    const source = sketch(
      point('a', -10, 0),
      point('b', 10, 0),
      point('c', -10, -10),
      point('d', 10, 10),
      line('a-line', 'a', 'b'),
      line('b-line', 'c', 'd')
    );
    source.constraints.push({ id: 'stale', type: 'angle', entityAId: 'a-line', entityBId: 'b-line', value: 12 });
    expect(value(source, ['a-line', 'b-line'], 'Angle')).toBeCloseTo(45);
    const measured = selectionMeasurements(source, ['a-line', 'b-line'], { 'a-line': { x: -5, y: 0 }, 'b-line': { x: 5, y: 5 } });
    expect(measured.find(metric => metric.label === 'Angle')?.value).toBeCloseTo(135);
    expect(source.constraints[0]).toMatchObject({ value: 12 });
  });

  it('measures a finite arc instead of its entire support circle', () => {
    const center = point('c', 0, 0);
    const source = sketch(center, point('p', -5, 0), ...arc('arc', center, 5, 0, Math.PI / 2), circle('circle', 'c', 5));
    expect(value(source, ['p', 'arc'])).toBeCloseTo(Math.sqrt(50), 6);
    expect(value(source, ['p', 'circle'])).toBeCloseTo(0, 6);
    expect(value(source, ['c', 'arc'])).toBe(5);
  });

  it('clamps a line/circle center witness to the finite line and exposes that center distance', () => {
    const source = sketch(point('a', 0, 0), point('b', 10, 0), point('c', 20, 0), line('line', 'a', 'b'), circle('circle', 'c', 2));
    expect(value(source, ['line', 'circle'])).toBeCloseTo(8, 6);
    expect(value(source, ['line', 'circle'], 'Center to line')).toBeCloseTo(10, 6);
  });

  it('rejects support-circle intersections outside the actual arc', () => {
    const center = point('c', 0, 0);
    const source = sketch(
      center,
      point('a', -10, 0),
      point('b', 10, 0),
      line('line', 'a', 'b'),
      ...arc('arc', center, 5, Math.PI / 4, (Math.PI * 3) / 4)
    );
    expect(value(source, ['line', 'arc'])).toBeCloseTo(5 / Math.sqrt(2), 6);
  });

  it('measures separated, nested, concentric and intersecting circles', () => {
    const source = sketch(
      point('a', 0, 0),
      point('b', 10, 0),
      point('c', 3, 0),
      circle('small', 'a', 2),
      circle('other', 'b', 3),
      circle('outer', 'a', 10),
      circle('nested', 'c', 2),
      circle('concentric', 'a', 5)
    );
    expect(value(source, ['small', 'other'])).toBeCloseTo(5, 6);
    expect(value(source, ['outer', 'nested'])).toBeCloseTo(5, 6);
    expect(value(source, ['small', 'concentric'])).toBeCloseTo(3, 6);
    expect(value(source, ['small', 'nested'])).toBe(0);
    expect(value(source, ['small', 'other'], 'Center distance')).toBe(10);
  });

  it('includes finite-arc endpoints when center-line extrema are outside the arc', () => {
    const a = point('a', 0, 0),
      b = point('b', -10, 0);
    const source = sketch(a, b, ...arc('arc', a, 5, 0, Math.PI / 2), circle('circle', 'b', 1));
    expect(value(source, ['arc', 'circle'])).toBeCloseTo(Math.sqrt(125) - 1, 6);
  });

  it('includes interior radial witnesses on wrapped arcs and reports overlap as zero', () => {
    const a = point('a', 0, 0),
      b = point('b', 10, 0);
    const source = sketch(
      a,
      b,
      ...arc('a-arc', a, 5, (Math.PI * 11) / 6, Math.PI / 6),
      ...arc('b-arc', b, 2, (Math.PI * 5) / 6, (Math.PI * 7) / 6),
      ...arc('overlap', a, 5, 0, Math.PI / 2)
    );
    expect(value(source, ['a-arc', 'b-arc'])).toBeCloseTo(3, 6);
    expect(value(source, ['a-arc', 'overlap'])).toBe(0);
  });

  it('omits unsupported rational pairs, stale IDs and invalid source references', () => {
    const source = sketch(
      point('a', 0, 0),
      point('b', 10, 0),
      point('control', 5, 5),
      { id: 'conic', type: 'conic', startId: 'a', endId: 'b', controlId: 'control', rho: 0.5 },
      line('broken', 'missing', 'b')
    );
    expect(selectionMeasurements(source, ['conic'])).toEqual([]);
    expect(selectionMeasurements(source, ['a', 'conic'])).toEqual([]);
    expect(selectionMeasurements(source, ['broken'])).toEqual([]);
    expect(selectionMeasurements(source, ['absent'])).toEqual([]);
    expect(selectionMeasurements(source, ['a', 'b', 'control'])).toEqual([]);
    expect(selectionMeasurements(source, ['a', 'a'])).toEqual([]);
  });

  it('keeps finite distances accurate on long segments and large circular supports', () => {
    const angle = 0.123,
      radius = 1e8;
    const source = sketch(
      point('a', 0, 0),
      point('b', 1e12, 0),
      point('p', 1e12 / 3, 3),
      line('line', 'a', 'b'),
      point('near', (radius + 7) * Math.cos(angle), (radius + 7) * Math.sin(angle)),
      ...arc('arc', point('a', 0, 0), radius, 0, Math.PI / 2),
      point('other-center', 1e8 * Math.cos(angle), 1e8 * Math.sin(angle)),
      circle('first-circle', 'a', 5e7),
      circle('second-circle', 'other-center', 3e7)
    );
    expect(value(source, ['p', 'line'])).toBeCloseTo(3, 7);
    expect(value(source, ['near', 'arc'])).toBeCloseTo(7, 5);
    expect(value(source, ['first-circle', 'second-circle'])).toBeCloseTo(2e7, 5);
  });
});
