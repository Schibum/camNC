import {
  addBezier,
  addCircle,
  addConic,
  addLine,
  addSpline,
  createCadPart,
  createPlateDocument,
  polygonArea,
  type CadPoint,
  type CadSketch,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { sketchRegionLoops } from './sketchRegions';

function area(sketch: CadSketch) {
  return sketchRegionLoops(sketch).reduce((sum, loop) => sum + polygonArea(loop), 0);
}
function winding(point: CadPoint, loops: CadPoint[][]) {
  let result = 0;
  for (const loop of loops)
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!,
        b = loop[(i + 1) % loop.length]!;
      const side = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
      if (a.y <= point.y && b.y > point.y && side > 0) result++;
      if (a.y > point.y && b.y <= point.y && side < 0) result--;
    }
  return result;
}

describe('CAD planar sketch regions', () => {
  it('keeps a rectangle filled beside detached open geometry and tangent branches', () => {
    let sketch = createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch;
    sketch = addLine(sketch, { x1: 150, y1: 10, x2: 180, y2: 30 });
    sketch = addLine(sketch, { x1: 100, y1: 30, x2: 140, y2: 30 });
    sketch = addLine(sketch, { x1: 0, y1: 0, x2: 20, y2: 20 });
    expect(sketchRegionLoops(sketch)).toHaveLength(1);
    expect(area(sketch)).toBeCloseTo(6000, 6);
  });

  it('extracts the union of overlapping circle and rectangle faces without an even-odd white overlap', () => {
    let sketch = createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch;
    sketch = addCircle(sketch, { x: 100, y: 30, radius: 20 });
    sketch = addLine(sketch, { x1: 150, y1: 70, x2: 170, y2: 80 });
    const loops = sketchRegionLoops(sketch);
    expect(winding({ x: 90, y: 30 }, loops)).toBeGreaterThan(0);
    expect(winding({ x: 110, y: 30 }, loops)).toBeGreaterThan(0);
    expect(winding({ x: 10, y: 10 }, loops)).toBeGreaterThan(0);
    expect(winding({ x: 130, y: 30 }, loops)).toBe(0);
    expect(area(sketch)).toBeCloseTo(6000 + Math.PI * 200, -1);
  });

  it('shades all nested bounded regions independently of open bridge lines', () => {
    let sketch = createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch;
    sketch = addCircle(sketch, { x: 50, y: 30, radius: 15 });
    sketch = addCircle(sketch, { x: 50, y: 30, radius: 5 });
    sketch = addLine(sketch, { x1: 65, y1: 30, x2: 100, y2: 30 });
    const loops = sketchRegionLoops(sketch);
    expect(winding({ x: 10, y: 10 }, loops)).toBeGreaterThan(0);
    expect(winding({ x: 60, y: 30 }, loops)).toBeGreaterThan(0);
    expect(winding({ x: 50, y: 30 }, loops)).toBeGreaterThan(0);
    expect(loops.map(loop => Math.sign(polygonArea(loop))).sort()).toEqual([1, 1, 1]);
  });

  it('subdivides a rectangle along a diagonal without losing or doubling material', () => {
    let sketch = createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch;
    sketch = addLine(sketch, { x1: 0, y1: 0, x2: 100, y2: 60 });
    expect(sketchRegionLoops(sketch)).toHaveLength(2);
    expect(area(sketch)).toBeCloseTo(6000, 6);
  });

  it('splits crossings and collinear overlaps, deduplicating coincident boundary segments', () => {
    let sketch = createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch;
    sketch = addLine(sketch, { x1: -10, y1: 0, x2: 110, y2: 0 });
    sketch = addLine(sketch, { x1: 50, y1: -10, x2: 50, y2: 70 });
    expect(sketchRegionLoops(sketch)).toHaveLength(2);
    expect(area(sketch)).toBeCloseTo(6000, 6);
  });

  it('recognizes a bounded triangle formed by three crossing open lines', () => {
    let sketch = createCadPart().sketch;
    sketch = addLine(sketch, { x1: -10, y1: 0, x2: 110, y2: 0 });
    sketch = addLine(sketch, { x1: -10, y1: -10, x2: 60, y2: 60 });
    sketch = addLine(sketch, { x1: 40, y1: 60, x2: 110, y2: -10 });
    expect(sketchRegionLoops(sketch)).toHaveLength(1);
    expect(area(sketch)).toBeCloseTo(2500, 6);
  });

  it('does not fill open chains or construction-only boundaries', () => {
    let sketch = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    sketch = addLine(sketch, { x1: 100, y1: 0, x2: 50, y2: 50 });
    expect(sketchRegionLoops(sketch)).toEqual([]);
    sketch = addLine(sketch, { x1: 50, y1: 50, x2: 0, y2: 0, construction: true });
    expect(sketchRegionLoops(sketch)).toEqual([]);
  });

  it('supports separate closed components and leaves source geometry untouched', () => {
    let sketch = createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch;
    sketch = addCircle(sketch, { x: 150, y: 30, radius: 10 });
    const before = structuredClone(sketch);
    expect(sketchRegionLoops(sketch)).toHaveLength(2);
    expect(sketch).toEqual(before);
  });

  it.each(['conic', 'bezier'] as const)('shades a closed %s using the evaluated curve instead of its control polygon', type => {
    let sketch = createCadPart().sketch;
    sketch =
      type === 'conic'
        ? addConic(sketch, { start: { x: 10, y: 10 }, end: { x: 90, y: 10 }, control: { x: 50, y: 80 }, rho: 0.5 })
        : addBezier(sketch, {
            points: [
              { x: 10, y: 10 },
              { x: 10, y: 70 },
              { x: 90, y: 70 },
              { x: 90, y: 10 },
            ],
          });
    sketch = addLine(sketch, { x1: 90, y1: 10, x2: 10, y2: 10 });
    const loops = sketchRegionLoops(sketch);
    expect(loops).toHaveLength(1);
    expect(winding({ x: 50, y: 30 }, loops)).toBeGreaterThan(0);
    expect(winding({ x: 50, y: 60 }, loops)).toBe(0);
  });

  it('shades a closed fit spline with unrelated open sketch geometry', () => {
    let sketch = addSpline(createCadPart().sketch, {
      points: [
        { x: 10, y: 10 },
        { x: 70, y: 10 },
        { x: 70, y: 70 },
        { x: 10, y: 70 },
      ],
      closed: true,
    });
    sketch = addLine(sketch, { x1: 100, y1: 10, x2: 140, y2: 30 });
    const loops = sketchRegionLoops(sketch);
    expect(loops).toHaveLength(1);
    expect(winding({ x: 40, y: 40 }, loops)).toBeGreaterThan(0);
  });

  it('snaps only gaps within the CAD tolerance when closing region boundaries', () => {
    const sketch = (gap: number) => {
      let result = addLine(createCadPart().sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
      result = addLine(result, { x1: 100, y1: 0, x2: 100, y2: 60 });
      result = addLine(result, { x1: 100, y1: 60, x2: 0, y2: 60 });
      return addLine(result, { x1: 0, y1: 60, x2: 0, y2: gap });
    };
    expect(sketchRegionLoops(sketch(0.5e-6))).toHaveLength(1);
    expect(sketchRegionLoops(sketch(2e-6))).toHaveLength(0);
  });

  it('handles many detached segments without letting them suppress a valid local region', () => {
    let sketch = createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch;
    for (let i = 0; i < 1000; i++) sketch = addLine(sketch, { x1: 200 + i * 10, y1: 0, x2: 205 + i * 10, y2: 5 });
    expect(sketchRegionLoops(sketch)).toHaveLength(1);
    expect(area(sketch)).toBeCloseTo(6000, 6);
  });
});
