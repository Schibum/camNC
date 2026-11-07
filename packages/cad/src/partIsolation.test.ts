import { describe, expect, it } from 'vitest';
import {
  addConstraint,
  addLine,
  addRectangle,
  createCadDocument,
  createCadPart,
  originId,
  solveCadDocument,
  updateDimension,
} from './index';
import type { CadPart, CadPointEntity } from './types';

function fixedConflictPart(): CadPart {
  const part = createCadPart('Conflicting fixed line');
  part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 20, y2: 0 });
  const line = part.sketch.entities.find(e => e.type === 'line')!;
  if (line.type !== 'line') throw new Error('Missing fixture line');
  part.sketch.entities = part.sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e));
  part.sketch = addConstraint(part.sketch, {
    type: 'distance',
    pointAId: line.startId,
    pointBId: line.endId,
    value: 35,
  });
  return part;
}
const sizedPart = (): CadPart => {
  const part = createCadPart('Editable rectangle');
  part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 40, height: 30, dimensioned: true });
  const bottom = part.sketch.entities.find(entity => entity.type === 'line')!;
  part.sketch = addConstraint(part.sketch, { type: 'coincident', pointAId: bottom.startId, pointBId: originId(part.sketch) });
  return part;
};

describe('independent sketch solving', () => {
  it.each([false, true])(
    'solves a valid part width edit when another part has a fixed-only conflict (bad part last: %s)',
    async badPartLast => {
      const document = createCadDocument();
      const bad = fixedConflictPart(),
        good = sizedPart();
      document.parts = badPartLast ? [good, bad] : [bad, good];
      const width = good.sketch.constraints.find(c => c.label === 'Width')!;
      const before = structuredClone(document);
      const edited = updateDimension(document, width.id, 75);
      const result = await solveCadDocument(edited);
      expect(result.status).toBe('conflict');
      expect(result.sketches).toEqual(
        document.parts.map(part => ({
          partId: part.id,
          dof: part.id === bad.id ? -1 : 0,
          status: part.id === bad.id ? 'conflict' : 'solved',
        }))
      );
      const solved = result.document.parts.find(p => p.id === good.id)!;
      const points = solved.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point');
      expect(Math.max(...points.map(p => p.x))).toBeCloseTo(75, 6);
      expect(Math.max(...points.map(p => p.y))).toBeCloseTo(30, 6);
      expect(solved.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 75 });
      expect(result.document.parts.find(p => p.id === bad.id)).toEqual(bad);
      expect(result.diagnostics.filter(d => d.severity === 'error')).toEqual([
        expect.objectContaining({ code: 'constraint-conflict', partId: bad.id, constraintIds: [bad.sketch.constraints[0]!.id] }),
      ]);
      expect(result.parts).toEqual([]);
      expect(document).toEqual(before);
    }
  );

  it('keeps a valid part editable alongside a separate native solver conflict', async () => {
    const document = createCadDocument();
    const bad = sizedPart(),
      good = sizedPart();
    const badWidth = bad.sketch.constraints.find(c => c.type === 'distanceX')!;
    if (badWidth.type !== 'distanceX') throw new Error('Missing fixture width');
    bad.sketch = addConstraint(bad.sketch, { ...badWidth, id: undefined, value: 60 });
    document.parts = [bad, good];
    const width = good.sketch.constraints.find(c => c.label === 'Width')!;
    const result = await solveCadDocument(updateDimension(document, width.id, 85));
    expect(result.status).toBe('conflict');
    expect(result.sketches.find(s => s.partId === bad.id)?.status).toBe('conflict');
    expect(result.sketches.find(s => s.partId === good.id)).toMatchObject({ status: 'solved', dof: 0 });
    const points = result.document.parts
      .find(p => p.id === good.id)!
      .sketch.entities.filter((e): e is CadPointEntity => e.type === 'point');
    expect(Math.max(...points.map(p => p.x))).toBeCloseTo(85, 6);
    expect(result.diagnostics.filter(d => d.severity === 'error').every(d => d.partId === bad.id)).toBe(true);
  });
});
