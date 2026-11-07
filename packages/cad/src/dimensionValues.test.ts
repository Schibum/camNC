import { describe, expect, it } from 'vitest';
import { createPlateDocument, dimensionValueError, parseCadDocument, updateDimension, validateCadDocument } from './index';

describe('owned line dimension value domains', () => {
  it.each(['distanceX', 'distanceY'] as const)(
    'rejects a zero driving %s line size while retaining valid signed dimensions and references',
    type => {
      const owned = { type, sourceEntityId: 'line' };
      for (const value of [0, -0, 1e-7, -1e-7]) expect(dimensionValueError(owned, value)).not.toBeNull();
      expect(dimensionValueError(owned, -20)).toBeNull();
      expect(dimensionValueError({ ...owned, driven: true }, 0)).toBeNull();
      expect(dimensionValueError({ type }, 0)).toBeNull();
    }
  );
  it('rejects zero owned width during source validation without imposing the rule on zero point coordinates or normal gaps', () => {
    const document = createPlateDocument(),
      width = document.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    const invalid = updateDimension(document, width.id, 0);
    expect(
      validateCadDocument(invalid).some(
        diagnostic => diagnostic.code === 'invalid-dimension' && diagnostic.constraintIds?.includes(width.id)
      )
    ).toBe(true);
    const portable = parseCadDocument(JSON.parse(JSON.stringify(invalid)));
    expect(validateCadDocument(portable).some(diagnostic => diagnostic.code === 'invalid-dimension')).toBe(true);
    for (const type of [
      'positionX',
      'positionY',
      'pointLineDistance',
      'lineLineDistance',
      'pointArcDistance',
      'lineCircleDistance',
      'circleCircleDistance',
    ] as const)
      expect(dimensionValueError({ type }, 0)).toBeNull();
    expect(document.parts[0]!.sketch.constraints.find(constraint => constraint.id === width.id)).toHaveProperty('value', 120);
  });
});
