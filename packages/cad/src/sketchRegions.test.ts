import { describe, expect, it } from 'vitest';
import {
  addBezier,
  addCircle,
  addConic,
  addLine,
  addRectangle,
  addSpline,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  parseCadDocument,
  polygonArea,
  solveCadDocument,
  updateDimension,
  type CadPoint,
  type CadSketch,
} from './index';
import { sketchRegions } from './sketchRegions';

const sketchRegionLoops = (sketch: CadSketch) => sketchRegions(sketch).map(region => region.points);

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

describe('CAD sketch region IDs', () => {
  const inside = (point: CadPoint, loop: CadPoint[]) => winding(point, [loop]) !== 0;
  const idAt = (sketch: CadSketch, point: CadPoint) => {
    const hits = sketchRegions(sketch).filter(region => inside(point, region.points));
    if (hits.length !== 1) throw new Error(`Expected one region at ${point.x},${point.y}, found ${hits.length}`);
    return hits[0]!.id;
  };
  const translateAll = (sketch: CadSketch, dx: number, dy: number): CadSketch => ({
    ...sketch,
    entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, x: e.x + dx, y: e.y + dy } : e)),
  });
  const overlappingCircles = () => {
    let sketch = addCircle(createCadPart().sketch, { x: 40, y: 40, radius: 30 });
    sketch = addCircle(sketch, { x: 80, y: 40, radius: 30 });
    return sketch;
  };

  it('tells apart regions bounded by the same curves, using the side of each curve', () => {
    const sketch = overlappingCircles(),
      regions = sketchRegions(sketch);
    expect(regions).toHaveLength(3);
    expect(new Set(regions.map(region => region.id)).size).toBe(3);
    expect(regions.every(region => region.curveIds.length === 2)).toBe(true);
    // The curves and sides alone must separate these, without falling back on numbering.
    expect(regions.some(region => region.id.includes('#'))).toBe(false);
    const left = idAt(sketch, { x: 20, y: 40 }),
      lens = idAt(sketch, { x: 60, y: 40 }),
      right = idAt(sketch, { x: 100, y: 40 });
    expect(new Set([left, lens, right]).size).toBe(3);
  });

  it('gives the two sides of a dividing line different IDs', () => {
    const sketch = addLine(createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch, { x1: 0, y1: 0, x2: 100, y2: 60 });
    expect(idAt(sketch, { x: 70, y: 20 })).not.toBe(idAt(sketch, { x: 30, y: 40 }));
    expect(sketchRegions(sketch).some(region => region.id.includes('#'))).toBe(false);
  });

  it('keeps IDs when the sketch lists its entities in a different order', () => {
    const sketch = overlappingCircles(),
      reordered = { ...sketch, entities: [...sketch.entities].reverse() };
    expect(sketchRegions(reordered).map(region => region.id)).toEqual(sketchRegions(sketch).map(region => region.id));
  });

  it('keeps IDs when coincident curves are listed in a different order', () => {
    let sketch = createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch;
    sketch = addLine(sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    sketch = addLine(sketch, { x1: 100, y1: 0, x2: 0, y2: 0 });
    const curves = sketch.entities.filter(e => e.type !== 'point'),
      points = sketch.entities.filter(e => e.type === 'point'),
      reordered = { ...sketch, entities: [...points, ...[...curves].reverse()] };
    expect(sketchRegions(reordered).map(region => region.id)).toEqual(sketchRegions(sketch).map(region => region.id));
  });

  it('keeps IDs through moving, resizing and scaling that leave the same curves bounding each face', () => {
    const sketch = overlappingCircles(),
      lens = idAt(sketch, { x: 60, y: 40 });
    const moved = translateAll(sketch, 500, -300);
    expect(idAt(moved, { x: 560, y: -260 })).toBe(lens);
    const resized = {
      ...sketch,
      entities: sketch.entities.map(e => (e.type === 'circle' ? { ...e, radius: e.radius + 5 } : e)),
    };
    expect(idAt(resized, { x: 60, y: 40 })).toBe(lens);
    expect(sketchRegions(sketch, 0.001).map(region => region.id)).toEqual(sketchRegions(sketch).map(region => region.id));
  });

  it('keeps IDs through solving, a dimension change and reloading', async () => {
    const document = createCadDocument(),
      part = createCadPart();
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 60, dimensioned: true });
    part.sketch = addCircle(part.sketch, { x: 50, y: 30, radius: 10 });
    document.parts.push(part);
    const ids = (sketch: CadSketch) => sketchRegions(sketch).map(region => region.id);
    const before = ids(part.sketch);
    expect(before).toHaveLength(2);
    const solved = await solveCadDocument(document);
    expect(solved.status).toBe('solved');
    expect(ids(solved.document.parts[0]!.sketch)).toEqual(before);
    const dimension = part.sketch.constraints.find(c => c.type === 'distanceY' || c.type === 'distance')!;
    const resized = await solveCadDocument(updateDimension(document, dimension.id, 80));
    expect(resized.status).toBe('solved');
    expect(ids(resized.document.parts[0]!.sketch)).toEqual(before);
    const reloaded = parseCadDocument(JSON.parse(JSON.stringify(resized.document)));
    expect(ids(reloaded.parts[0]!.sketch)).toEqual(before);
  });

  it('keeps IDs when unrelated or dangling geometry is added', () => {
    const sketch = overlappingCircles(),
      lens = idAt(sketch, { x: 60, y: 40 });
    let busy = addLine(sketch, { x1: 300, y1: 0, x2: 340, y2: 10 });
    busy = addLine(busy, { x1: 60, y1: 40, x2: 62, y2: 44 });
    busy = addCircle(busy, { x: 300, y: 100, radius: 10 });
    expect(idAt(busy, { x: 60, y: 30 })).toBe(lens);
  });

  it('keeps the ID of a region when an island is added inside it', () => {
    const sketch = createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch,
      plate = idAt(sketch, { x: 10, y: 10 });
    const withIsland = addCircle(sketch, { x: 50, y: 30, radius: 10 });
    expect(sketchRegions(withIsland).map(region => region.id)).toContain(plate);
    expect(sketchRegions(withIsland)).toHaveLength(2);
  });

  it('changes the ID when a region is split or its curves stop bounding it', () => {
    const plate = createPlateDocument({ width: 100, height: 60 }).parts[0]!.sketch,
      whole = idAt(plate, { x: 10, y: 10 }),
      split = addLine(plate, { x1: 50, y1: 0, x2: 50, y2: 60 });
    expect(sketchRegions(split).map(region => region.id)).not.toContain(whole);
    const sketch = overlappingCircles(),
      lens = idAt(sketch, { x: 60, y: 40 });
    const apart = {
      ...sketch,
      entities: sketch.entities.map(e => (e.type === 'point' && e.x === 80 ? { ...e, x: 300 } : e)),
    };
    expect(sketchRegions(apart).map(region => region.id)).not.toContain(lens);
    expect(sketchRegions(apart)).toHaveLength(2);
  });

  it('tells apart repeated faces between a wavy curve and a line, and keeps each ID as the line moves', () => {
    const sketch = addLine(
      addSpline(createCadPart().sketch, {
        points: [
          { x: 0, y: -20 },
          { x: 30, y: 20 },
          { x: 60, y: -20 },
          { x: 90, y: 20 },
          { x: 120, y: -20 },
          { x: 150, y: 20 },
        ],
      }),
      { x1: -20, y1: 0, x2: 170, y2: 0 }
    );
    const regions = (lineY: number) => {
      const moved = {
        ...sketch,
        entities: sketch.entities.map(e => (e.type === 'point' && e.y === 0 && (e.x === -20 || e.x === 170) ? { ...e, y: lineY } : e)),
      };
      return sketchRegions(moved)
        .map(region => ({ id: region.id, x: Math.min(...region.points.map(p => p.x)) }))
        .sort((a, b) => a.x - b.x);
    };
    const first = regions(0);
    expect(first.length).toBeGreaterThanOrEqual(4);
    expect(new Set(first.map(region => region.id)).size).toBe(first.length);
    expect(first.some(region => region.id.includes('#'))).toBe(true);
    expect(regions(2).map(region => region.id)).toEqual(first.map(region => region.id));
    // Turning the drawing reverses every coordinate but no curve, so each ID must follow its face.
    const centre = (points: CadPoint[]) => ({
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    });
    const turned = { ...sketch, entities: sketch.entities.map(e => (e.type === 'point' ? { ...e, x: -e.x, y: -e.y } : e)) };
    const before = new Map(sketchRegions(sketch).map(region => [region.id, centre(region.points)]));
    const after = sketchRegions(turned);
    expect(after.map(region => region.id).sort()).toEqual([...before.keys()].sort());
    for (const region of after) {
      const at = centre(region.points),
        was = before.get(region.id)!;
      expect(at.x).toBeCloseTo(-was.x, 3);
      expect(at.y).toBeCloseTo(-was.y, 3);
    }
  });
});
