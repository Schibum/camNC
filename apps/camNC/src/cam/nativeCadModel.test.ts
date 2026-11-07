import { addCircle, createPlateDocument } from '@wbcnc/cad';
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
});
