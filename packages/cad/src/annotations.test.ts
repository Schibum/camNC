import { describe, expect, it } from 'vitest';
import { createPlateDocument, parseCadDocument } from './document';
import { resolveDimensionPlacement } from './dimensionPlacement';

describe('sketch annotation placement', () => {
  it('round-trips a user-placed label without changing its driving dimension', () => {
    const document = createPlateDocument();
    const dimension = document.parts[0]!.sketch.constraints.find(c => c.type === 'distanceX')!;
    dimension.labelPosition = { x: 60, y: -15 };
    const parsed = parseCadDocument(JSON.parse(JSON.stringify(document)));
    const normalized = parsed.parts[0]!.sketch.constraints.find(c => c.id === dimension.id)!;
    expect(normalized).not.toHaveProperty('labelPosition');
    if (!('value' in normalized)) throw new Error('Expected numeric annotation');
    expect(resolveDimensionPlacement(parsed.parts[0]!.sketch, normalized)).toEqual({ x: 60, y: -15 });
    expect(parseCadDocument(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    expect(dimension).toMatchObject({ value: 120 });
  });
  it('rejects a nonfinite annotation coordinate in portable source', () => {
    const document = createPlateDocument();
    document.parts[0]!.sketch.constraints[0]!.labelPosition = { x: Infinity, y: 0 };
    expect(() => parseCadDocument(document)).toThrow('CAD numeric fields must be finite numbers');
  });
});
