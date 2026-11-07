import { describe, expect, it } from 'vitest';
import {
  addCircle,
  addConstraint,
  addFaceSketch,
  addLine,
  addRectangle,
  cadSketchRegions,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  parseCadDocument,
  polygonArea,
  removeCadFeature,
  setCutDepth,
  sketchRegions,
  solveCadDocument,
  type CadDocument,
  type CadPoint,
  type CadSketch,
  type CadSketchRegion,
} from './index';

const inside = (point: CadPoint, loop: CadPoint[]) => {
  let result = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]!,
      b = loop[j]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
};
const pick = <T extends CadSketchRegion>(regions: T[], point: CadPoint) => {
  const hits = regions.filter(region => inside(point, region.points) && !region.holes.some(hole => inside(point, hole)));
  if (hits.length !== 1) throw new Error(`Expected one region at ${point.x},${point.y}, found ${hits.length}`);
  return hits[0]!;
};
const regionAt = (sketch: CadSketch, point: CadPoint) => pick(sketchRegions(sketch), point);
const faceRegionAt = (document: CadDocument, sketchId: string, point: CadPoint) =>
  pick(cadSketchRegions(document.parts[0]!, sketchId), point);
/** A 200 x 120 x 18 plate with a circle at 50,60 and one at 150,60. */
function plate(): CadDocument {
  const document = createPlateDocument({ width: 200, height: 120, thickness: 18 }),
    part = document.parts[0]!;
  part.sketch = addCircle(part.sketch, { x: 50, y: 60, radius: 20 });
  part.sketch = addCircle(part.sketch, { x: 150, y: 60, radius: 10 });
  return document;
}
const evaluated = (document: CadDocument) => {
  const result = evaluateCadDocument(document);
  return { part: result.parts[0], errors: result.diagnostics.filter(d => d.severity === 'error').map(d => d.code) };
};
const outline = (document: CadDocument) => evaluated(document).part!.outline;
const faceSketch = (document: CadDocument, sketchId: string) =>
  document.parts[0]!.features!.flatMap(f => (f.type === 'sketch' && f.sketch.id === sketchId ? [f.sketch] : []))[0]!;
const withFaceSketch = (document: CadDocument, sketchId: string, sketch: CadSketch): CadDocument => ({
  ...document,
  parts: document.parts.map(part => ({
    ...part,
    features: part.features?.map(f => (f.type === 'sketch' && f.sketch.id === sketchId ? { ...f, sketch } : f)),
  })),
});

describe('CAD parts without features', () => {
  it('keep their saved form exactly through parsing and solving', async () => {
    const document = plate(),
      saved = JSON.stringify(document);
    expect(JSON.stringify(parseCadDocument(JSON.parse(saved)))).toBe(saved);
    const solved = await solveCadDocument(document);
    expect(solved.status).toBe('solved');
    expect(solved.document.version).toBe(1);
    expect('features' in solved.document.parts[0]!).toBe(false);
    expect('cuts' in solved.parts[0]!).toBe(false);
    expect(solved.parts[0]!.holes).toHaveLength(2);
  });

  it('go back to the old format when the last feature is removed', () => {
    const document = plate(),
      saved = JSON.stringify(document),
      region = regionAt(document.parts[0]!.sketch, { x: 50, y: 60 }),
      cut = setCutDepth(document, document.parts[0]!.id, document.parts[0]!.sketch.id, region.id, 6);
    expect(cut.version).toBe(2);
    const removed = removeCadFeature(cut, cut.parts[0]!.id, cut.parts[0]!.features![0]!.id);
    expect(JSON.stringify(removed)).toBe(saved);
  });
});

describe('CAD cuts on the profile sketch', () => {
  const disc = (document: CadDocument) => regionAt(document.parts[0]!.sketch, { x: 50, y: 60 });
  const depth = (document: CadDocument, value: number | 'through') =>
    setCutDepth(document, document.parts[0]!.id, document.parts[0]!.sketch.id, disc(document).id, value);

  it('turns an inner loop from a through-hole into a pocket when it gets a depth', () => {
    const { part, errors } = evaluated(depth(plate(), 6));
    expect(errors).toEqual([]);
    expect(part!.holes).toHaveLength(1);
    expect(part!.loops.filter(loop => loop.kind === 'hole')).toHaveLength(1);
    expect(part!.cuts).toHaveLength(1);
    expect(part!.cuts![0]).toMatchObject({ side: 'top', from: 0, to: 6, through: false });
    expect(polygonArea(part!.cuts![0]!.outline)).toBeCloseTo(Math.PI * 400, -1);
  });

  it('keeps the exact hole for a through cut, and leaves the region uncut at zero', () => {
    const through = evaluated(depth(plate(), 'through')).part!;
    expect(through.holes).toHaveLength(2);
    expect(through.cuts).toBeUndefined();
    expect(through.holes).toEqual(evaluated(plate()).part!.holes);
    const none = evaluated(depth(plate(), 0)).part!;
    expect(none.holes).toHaveLength(1);
    expect(none.cuts).toBeUndefined();
  });

  it('treats a depth at the full thickness as a cut all the way through', () => {
    const cut = evaluated(depth(plate(), 30)).part!.cuts![0]!;
    expect(cut.to).toBe(18);
    expect(cut.through).toBe(true);
  });

  it('updates a region’s cut instead of adding a second one', () => {
    const document = depth(depth(plate(), 6), 10);
    expect(document.parts[0]!.features).toHaveLength(1);
    expect(evaluated(document).part!.cuts![0]!.to).toBe(10);
  });

  it('pockets the part around its holes when the outer region is cut', () => {
    const document = plate(),
      outer = regionAt(document.parts[0]!.sketch, { x: 100, y: 10 });
    expect(outer.holes).toHaveLength(2);
    const { part } = evaluated(setCutDepth(document, document.parts[0]!.id, document.parts[0]!.sketch.id, outer.id, 3));
    expect(part!.cuts![0]!.islands).toHaveLength(2);
    expect(part!.holes).toHaveLength(2);
  });

  it('refuses a through cut of the whole part', () => {
    const document = plate(),
      outer = regionAt(document.parts[0]!.sketch, { x: 100, y: 10 });
    expect(evaluated(setCutDepth(document, document.parts[0]!.id, document.parts[0]!.sketch.id, outer.id, 'through')).errors).toEqual([
      'cut-whole-part',
    ]);
  });

  it('reports a cut whose region is gone', () => {
    const document = plate();
    expect(evaluated(setCutDepth(document, document.parts[0]!.id, document.parts[0]!.sketch.id, 'gone', 6)).errors).toEqual([
      'cut-region-missing',
    ]);
  });
});

describe('CAD face sketches', () => {
  it('finds a rabbet between a line and the part outline, which the profile sketch would refuse', async () => {
    const document = plate(),
      partId = document.parts[0]!.id,
      added = addFaceSketch(document, partId, 'top'),
      sketch = addLine(faceSketch(added.document, added.sketchId), { x1: 176, y1: -5, x2: 176, y2: 125 }),
      drawn = withFaceSketch(added.document, added.sketchId, sketch),
      rabbet = faceRegionAt(drawn, added.sketchId, { x: 190, y: 60 });
    const cut = setCutDepth(drawn, partId, added.sketchId, rabbet.id, 6);
    const solved = await solveCadDocument(cut);
    expect(solved.diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    expect(solved.status).toBe('solved');
    expect(solved.parts[0]!.holes).toHaveLength(2);
    const result = solved.parts[0]!.cuts![0]!;
    expect(result.to).toBe(6);
    expect(polygonArea(result.outline)).toBeCloseTo(24 * 120, 3);
  });

  it('returns only regions inside the part', () => {
    const document = plate(),
      sketch = addCircle(createCadPart().sketch, { x: 300, y: 60, radius: 20 });
    const regions = sketchRegions(sketch, 0.01, { boundary: { id: 'outline', points: outline(document) } });
    expect(regions).toHaveLength(1);
    expect(polygonArea(regions[0]!.points)).toBeCloseTo(200 * 120, 3);
    const crossing = addCircle(createCadPart().sketch, { x: 200, y: 60, radius: 20 }),
      parts = sketchRegions(crossing, 0.01, { boundary: { id: 'outline', points: outline(document) } });
    expect(parts).toHaveLength(2);
    expect(parts.some(region => inside({ x: 210, y: 60 }, region.points))).toBe(false);
  });

  it('solves dimensions in a face sketch', async () => {
    const document = plate(),
      partId = document.parts[0]!.id,
      added = addFaceSketch(document, partId, 'top');
    let sketch = addRectangle(faceSketch(added.document, added.sketchId), { x: 20, y: 20, width: 30, height: 40 });
    const line = sketch.entities.find(e => e.type === 'line')!;
    if (line.type !== 'line') throw new Error('Missing line');
    sketch = addConstraint(sketch, { type: 'distance', pointAId: line.startId, pointBId: line.endId, value: 50 });
    const solved = await solveCadDocument(withFaceSketch(added.document, added.sketchId, sketch));
    expect(solved.status).toBe('solved');
    const result = faceSketch(solved.document, added.sketchId),
      resultLine = result.entities.find(e => e.id === line.id)!;
    if (resultLine.type !== 'line') throw new Error('Missing line');
    const point = (id: string) => result.entities.find(e => e.id === id) as unknown as CadPoint;
    expect(
      Math.hypot(point(resultLine.endId).x - point(resultLine.startId).x, point(resultLine.endId).y - point(resultLine.startId).y)
    ).toBeCloseTo(50, 4);
  });

  /** A pocket with a second sketch on its floor. */
  function nested() {
    const base = plate(),
      partId = base.parts[0]!.id,
      disc = regionAt(base.parts[0]!.sketch, { x: 50, y: 60 });
    const pocket = setCutDepth(base, partId, base.parts[0]!.sketch.id, disc.id, 6),
      cutId = pocket.parts[0]!.features![0]!.id,
      added = addFaceSketch(pocket, partId, { floorOf: cutId }),
      sketch = addCircle(faceSketch(added.document, added.sketchId), { x: 50, y: 60, radius: 5 }),
      drawn = withFaceSketch(added.document, added.sketchId, sketch),
      inner = faceRegionAt(drawn, added.sketchId, { x: 50, y: 60 });
    return { partId, cutId, sketchId: added.sketchId, inner, document: setCutDepth(drawn, partId, added.sketchId, inner.id, 4) };
  }

  it('starts a cut from the floor it sits on, and follows that floor', () => {
    const { document, partId } = nested();
    const cuts = evaluated(document).part!.cuts!;
    expect(cuts.map(cut => [cut.from, cut.to])).toEqual([
      [0, 6],
      [6, 10],
    ]);
    const disc = regionAt(document.parts[0]!.sketch, { x: 50, y: 60 });
    const deeper = setCutDepth(document, partId, document.parts[0]!.sketch.id, disc.id, 8);
    expect(evaluated(deeper).part!.cuts![1]).toMatchObject({ from: 8, to: 12 });
  });

  it('limits a floor cut to the board’s thickness', () => {
    const { document, partId, sketchId, inner } = nested(),
      result = evaluated(setCutDepth(document, partId, sketchId, inner.id, 'through')).part!.cuts![1]!;
    expect(result).toMatchObject({ from: 6, to: 18, through: true });
  });

  it('reports a lost face when the floor’s pocket goes through or is removed', () => {
    const { document, partId, cutId } = nested(),
      disc = regionAt(document.parts[0]!.sketch, { x: 50, y: 60 });
    expect(evaluated(setCutDepth(document, partId, document.parts[0]!.sketch.id, disc.id, 'through')).errors).toEqual(['cut-face-lost']);
    expect(evaluated(setCutDepth(document, partId, document.parts[0]!.sketch.id, disc.id, 0)).errors).toEqual(['cut-face-lost']);
    expect(evaluated(removeCadFeature(document, partId, cutId)).errors).toContain('invalid-face');
  });

  it('removes a sketch’s cuts with it', () => {
    const { document, partId, sketchId } = nested(),
      feature = document.parts[0]!.features!.find(f => f.type === 'sketch' && f.sketch.id === sketchId)!;
    const removed = removeCadFeature(document, partId, feature.id);
    expect(removed.parts[0]!.features).toHaveLength(1);
    expect(evaluated(removed).errors).toEqual([]);
  });

  it('measures underside cuts from the underside', () => {
    const document = plate(),
      partId = document.parts[0]!.id,
      added = addFaceSketch(document, partId, 'underside'),
      sketch = addCircle(faceSketch(added.document, added.sketchId), { x: 100, y: 60, radius: 15 }),
      drawn = withFaceSketch(added.document, added.sketchId, sketch),
      region = faceRegionAt(drawn, added.sketchId, { x: 100, y: 60 });
    expect(evaluated(setCutDepth(drawn, partId, added.sketchId, region.id, 5)).part!.cuts![0]).toMatchObject({
      side: 'underside',
      from: 0,
      to: 5,
    });
  });

  it('reports a cut whose region stopped existing', () => {
    const document = plate(),
      partId = document.parts[0]!.id,
      added = addFaceSketch(document, partId, 'top');
    expect(evaluated(setCutDepth(added.document, partId, added.sketchId, 'gone', 6)).errors).toEqual(['cut-region-missing']);
  });
});

describe('CAD feature format', () => {
  const featured = () => {
    const document = plate(),
      region = regionAt(document.parts[0]!.sketch, { x: 50, y: 60 });
    return setCutDepth(document, document.parts[0]!.id, document.parts[0]!.sketch.id, region.id, 6);
  };

  it('survives saving and reloading', () => {
    const document = featured(),
      saved = JSON.parse(JSON.stringify(document));
    expect(parseCadDocument(saved).parts[0]!.features).toEqual(document.parts[0]!.features);
  });

  it('refuses features in the old version, and broken features', () => {
    expect(() => parseCadDocument({ ...featured(), version: 1 })).toThrow();
    expect(() => parseCadDocument({ ...featured(), version: 3 })).toThrow();
    expect(() => parseCadDocument({ ...plate(), version: 2 })).toThrow();
    expect(evaluated({ ...featured(), version: 1 }).errors).toContain('invalid-document');
    expect(evaluated({ ...plate(), version: 2 }).errors).toContain('invalid-document');
    const brokenDepth = featured();
    (brokenDepth.parts[0]!.features![0] as { depth: unknown }).depth = 'deep';
    expect(() => parseCadDocument(brokenDepth)).toThrow();
    const unknown = featured();
    (unknown.parts[0]!.features![0] as { type: unknown }).type = 'fillet';
    expect(() => parseCadDocument(unknown)).toThrow();
    const negative = featured();
    (negative.parts[0]!.features![0] as { depth: unknown }).depth = -1;
    expect(evaluated(negative).errors).toContain('invalid-depth');
  });

  it('refuses a cut on a sketch that comes later, and a duplicate cut', () => {
    const missing = featured();
    (missing.parts[0]!.features![0] as { sketchId: string }).sketchId = 'later';
    expect(evaluated(missing).errors).toContain('invalid-cut');
    const twice = featured();
    twice.parts[0]!.features!.push({ ...twice.parts[0]!.features![0]!, id: 'copy' } as never);
    expect(evaluated(twice).errors).toContain('duplicate-cut');
  });

  it('keeps IDs unique across face sketches', () => {
    const document = createCadDocument(),
      part = createCadPart();
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 50, height: 50 });
    document.parts.push(part);
    const added = addFaceSketch(document, part.id, 'top'),
      copy = withFaceSketch(added.document, added.sketchId, { ...part.sketch, id: added.sketchId });
    expect(evaluated(copy).errors).toContain('duplicate-id');
  });
});
