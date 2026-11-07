import { describe, expect, it } from 'vitest';
import {
  addConstraint,
  addLine,
  createCadDocument,
  createCadPart,
  dimensionForSelection,
  solveCadDocument,
  updateDimension,
} from './index';

describe('new explicit axis dimensions preserve the drawn side', () => {
  it.each([
    ['distanceX', 'line'],
    ['distanceX', 'points'],
    ['distanceY', 'line'],
    ['distanceY', 'points'],
  ] as const)('creates positive %s from reversed %s operands and keeps the direction when edited', async (mode, selection) => {
    const part = createCadPart();
    part.sketch = addLine(part.sketch, mode === 'distanceX' ? { x1: 50, y1: 20, x2: 0, y2: 20 } : { x1: 20, y1: 50, x2: 20, y2: 0 });
    const line = part.sketch.entities.find(entity => entity.type === 'line')!;
    part.sketch.entities = part.sketch.entities.map(entity => (entity.id === line.startId ? { ...entity, fixed: true } : entity));
    const proposed = dimensionForSelection(part.sketch, selection === 'line' ? [line.id] : [line.startId, line.endId], { mode });
    if (!('constraint' in proposed)) throw Error(proposed.message);
    expect(proposed.constraint).toMatchObject({ type: mode, pointAId: line.endId, pointBId: line.startId, value: 50 });
    part.sketch = addConstraint(part.sketch, proposed.constraint);
    const id = part.sketch.constraints.at(-1)!.id;
    const document = { ...createCadDocument(), parts: [part] };
    const result = await solveCadDocument(updateDimension(document, id, 60));
    expect(result.sketches[0]!.status, JSON.stringify(result.diagnostics)).toBe('solved');
    const a = result.document.parts[0]!.sketch.entities.find(entity => entity.id === line.startId)!;
    const b = result.document.parts[0]!.sketch.entities.find(entity => entity.id === line.endId)!;
    if (a.type !== 'point' || b.type !== 'point') throw Error('Missing source endpoints');
    expect(mode === 'distanceX' ? a.x : a.y).toBeCloseTo(50, 7);
    expect(mode === 'distanceX' ? b.x : b.y).toBeCloseTo(-10, 7);
    expect(document.parts[0]!.sketch.constraints.at(-1)).toMatchObject({ value: 50 });
  });
});
