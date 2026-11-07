import {
  addCircle,
  addFaceSketch,
  addLine,
  addRectangle,
  cadSketchRegions,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  setCutDepth,
  type CadDocument,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { camWorker } from './camQueries';
import { nativeCadModel } from './nativeCadModel';
import { kDefaultPlan, toCamSettings } from './planSettings';

describe('native CAD to CAM', () => {
  it('compiles solved profiles and through holes directly, with stable IDs and a display solid', async () => {
    const document = createPlateDocument({ width: 100, height: 60, thickness: 12 });
    const part = document.parts[0];
    part.sketch = addCircle(part.sketch, { x: 30, y: 30, radius: 6 });
    const { model, entries } = await nativeCadModel(document);
    expect(model.parts[0].id).toBe(part.id);
    expect(model.parts[0].size).toEqual([100, 60, 12]);
    expect(model.parts[0].shape.holes).toHaveLength(1);
    expect(model.meshes[0].positions.length).toBeGreaterThan(24);
    const features = entries.get(part.id)!.features;
    expect(features.pockets).toEqual([]);
    expect(features.throughHoles).toHaveLength(1);
    expect(features.levels).toHaveLength(1);
  });

  it('generates a complete cutting program in the existing CAM worker without model-file bytes', async () => {
    const document = createPlateDocument({ width: 100, height: 60, thickness: 12 });
    const key = `${document.id}:native`;
    const model = await camWorker().importDesign(document, key);
    const partId = document.parts[0].id;
    expect(model.parts[0].id).toBe(partId);
    const result = await camWorker().generate(key, partId, toCamSettings(kDefaultPlan));
    expect(result.programs.length).toBeGreaterThan(0);
    expect(result.gcode).toContain('G');
    expect(result.ops.some(op => op.kind === 'profile')).toBe(true);
    expect(result.safety).toEqual([]);
    expect(result.path.length).toBeGreaterThan(0);
  });

  describe('with cuts', () => {
    function plate() {
      const document = createPlateDocument({ width: 100, height: 60, thickness: 12 }),
        part = document.parts[0];
      part.sketch = addCircle(part.sketch, { x: 30, y: 30, radius: 12 });
      part.sketch = addCircle(part.sketch, { x: 75, y: 30, radius: 5 });
      return document;
    }
    const regionAt = (document: CadDocument, sketchId: string, x: number, y: number) =>
      cadSketchRegions(document.parts[0], sketchId).find(region => {
        const xs = region.points.map(p => p.x),
          ys = region.points.map(p => p.y);
        return !region.holes.length && Math.min(...xs) < x && x < Math.max(...xs) && Math.min(...ys) < y && y < Math.max(...ys);
      })!;
    const pocketed = (depth: number | 'through', document = plate()) => {
      const sketchId = document.parts[0].sketch.id;
      return setCutDepth(document, document.parts[0].id, sketchId, regionAt(document, sketchId, 30, 30).id, depth);
    };

    it('turns a loop with a depth into a pocket, and keeps the other hole’s identity', async () => {
      const original = plate(),
        before = await nativeCadModel(original),
        document = pocketed(5, original),
        { model, entries } = await nativeCadModel(document),
        part = model.parts[0],
        features = entries.get(part.id)!.features;
      expect(features.pockets.map(pocket => pocket.floorZ)).toEqual([7]);
      expect(features.throughHoles).toHaveLength(1);
      expect(part.shape.holes).toHaveLength(1);
      expect(part.holeIds).toEqual([before.model.parts[0].holeIds![1]]);
      expect(part.shape.pockets.map(pocket => pocket.depth)).toEqual([5]);
      expect(part.summary.needsFlip).toBe(false);
    });

    it('leaves a part unchanged when its loop is cut through', async () => {
      const original = plate(),
        plain = await nativeCadModel(original),
        through = await nativeCadModel(pocketed('through', original));
      expect(through.model.parts[0].holeIds).toEqual(plain.model.parts[0].holeIds);
      expect(through.model.parts[0].shape).toEqual(plain.model.parts[0].shape);
      expect(through.entries.get(through.model.parts[0].id)!.features).toEqual(plain.entries.get(plain.model.parts[0].id)!.features);
    });

    it('generates a program that reaches the pocket floor in the CAM worker', async () => {
      const document = pocketed(5),
        key = `${document.id}:native-pocket`,
        model = await camWorker().importDesign(document, key),
        result = await camWorker().generate(key, model.parts[0].id, toCamSettings(kDefaultPlan));
      expect(result.programs.length).toBeGreaterThan(0);
      expect(result.safety).toEqual([]);
      expect(result.ops.some(op => op.kind === 'pocket' && Math.abs(op.zBottom - 7) < 0.01)).toBe(true);
    });

    it('cuts a rabbet from a face sketch, in part coordinates for a sketch away from the origin', async () => {
      const base = createCadDocument(),
        plateAway = createCadPart('Plate', 12),
        partId = plateAway.id;
      plateAway.sketch = addRectangle(plateAway.sketch, { x: 40, y: 10, width: 100, height: 60 });
      base.parts.push(plateAway);
      const added = addFaceSketch(base, partId, 'top'),
        face = added.document.parts[0].features![0]!;
      if (face.type !== 'sketch') throw new Error('Expected a sketch');
      face.sketch = addLine(face.sketch, { x1: 120, y1: 0, x2: 120, y2: 80 });
      const rabbet = regionAt(added.document, added.sketchId, 130, 40),
        { model, entries } = await nativeCadModel(setCutDepth(added.document, partId, added.sketchId, rabbet.id, 4)),
        pocket = entries.get(partId)!.features.pockets[0]!,
        strict = pocket.strictRegion.flat();
      expect(pocket.floorZ).toBe(8);
      expect(Math.min(...strict.map(p => p.x))).toBeCloseTo(80, 3);
      expect(Math.max(...strict.map(p => p.x))).toBeCloseTo(100, 3);
      expect(model.parts[0].sourceOrigin).toEqual([40, 10]);
      expect(model.parts[0].size).toEqual([100, 60, 12]);
    });

    it('resizes and re-zeroes a part whose edge a through cut removes', async () => {
      const base = createPlateDocument({ width: 100, height: 60, thickness: 12 }),
        partId = base.parts[0].id,
        added = addFaceSketch(base, partId, 'top'),
        face = added.document.parts[0].features![0]!;
      if (face.type !== 'sketch') throw new Error('Expected a sketch');
      face.sketch = addLine(face.sketch, { x1: 20, y1: 0, x2: 20, y2: 60 });
      const edge = regionAt(added.document, added.sketchId, 10, 30),
        { model, entries } = await nativeCadModel(setCutDepth(added.document, partId, added.sketchId, edge.id, 'through')),
        features = entries.get(partId)!.features;
      expect(model.parts[0].size).toEqual([80, 60, 12]);
      expect(model.parts[0].sourceOrigin).toEqual([20, 0]);
      expect(Math.min(...features.outlines.flat().map(p => p.x))).toBeCloseTo(0, 3);
    });

    it('refuses underside cuts until CAM can machine them, so they’re never silently dropped', async () => {
      const base = createPlateDocument({ width: 100, height: 60, thickness: 12 }),
        partId = base.parts[0].id,
        added = addFaceSketch(base, partId, 'underside'),
        face = added.document.parts[0].features![0]!;
      if (face.type !== 'sketch') throw new Error('Expected a sketch');
      face.sketch = addCircle(face.sketch, { x: 50, y: 30, radius: 10 });
      const region = regionAt(added.document, added.sketchId, 50, 30);
      await expect(nativeCadModel(setCutDepth(added.document, partId, added.sketchId, region.id, 4))).rejects.toThrow('underside');
    });
  });
});
