import { describe, expect, it } from 'vitest';
import { addConstraint, addLine, createCadDocument, createCadPart } from './document';
import { migrateDimensionPlacements } from './dimensionPlacement';
import type { CadDimension } from './types';
import { isBareBaseUnitLiteral } from './dimensionExpressions';

function normalize(expression: string, value = 50, angle = false) {
  const source = createCadDocument(),
    part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 50, y2: 0 });
  const first = part.sketch.entities.find(entity => entity.type === 'line')!;
  if (angle) part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 30, y2: 40 });
  const second = part.sketch.entities.filter(entity => entity.type === 'line')[1];
  part.sketch = addConstraint(
    part.sketch,
    angle
      ? { type: 'angle', entityAId: first.id, entityBId: second!.id, value, expression }
      : { type: 'distanceX', pointAId: first.startId, pointBId: first.endId, value, expression }
  );
  source.parts.push(part);
  const migrated = migrateDimensionPlacements(source);
  expect(source.parts[0]!.sketch.constraints[0]).toHaveProperty('expression', expression);
  expect(migrated.revision).toBe(source.revision);
  return migrated.parts[0]!.sketch.constraints[0] as CadDimension;
}

describe('legacy base-unit dimension expression metadata', () => {
  it('classifies only finite, matching base-unit literals and unambiguous decimals', () => {
    expect(isBareBaseUnitLiteral('50,25 MM', 'mm', 50.25)).toBe(true);
    expect(isBareBaseUnitLiteral(' 45 ° ', 'deg', 45)).toBe(true);
    expect(isBareBaseUnitLiteral('1e-999mm', 'mm', 0)).toBe(false);
    expect(isBareBaseUnitLiteral('1,000mm', 'mm', 1000)).toBe(false);
    expect(isBareBaseUnitLiteral('50deg', 'mm', 50)).toBe(false);
    expect(isBareBaseUnitLiteral('50mm', 'deg', 50)).toBe(false);
    expect(isBareBaseUnitLiteral('50.0000000000001mm', 'mm', 50)).toBe(true);
    expect(isBareBaseUnitLiteral('50.001mm', 'mm', 50)).toBe(false);
  });
  it.each(['50mm', '50 mm', '50 MM', '5e1mm', '+50.000 mm'])(
    'clears the length base-unit literal %s without changing its value',
    expression => {
      expect(normalize(expression)).not.toHaveProperty('expression');
      expect(normalize(expression).value).toBe(50);
    }
  );
  it.each(['50deg', '50 DEG', '50°', '50 °'])('clears the angle base-unit literal %s', expression => {
    expect(normalize(expression, 50, true)).not.toHaveProperty('expression');
  });
  it.each(['2in', '20+30', '=50', '1,000mm', '5M', '40mm', '1e309mm', '1e-999mm'])(
    'retains arithmetic, converted, ambiguous or mismatched source %s',
    expression => {
      expect(normalize(expression).expression).toBe(expression);
    }
  );
});
