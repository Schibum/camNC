import { describe, expect, it } from 'vitest';
import {
  addConstraint,
  addLine,
  addRectangle,
  createCadDocument,
  createCadPart,
  dimensionForSelection,
  parseCadDocument,
  prepareDimensionCreation,
  resolveDimensionPlacement,
  setDimensionDriven,
  solveCadDocument,
  updateDimension,
  withDimensionPlacement,
  type CadDimension,
  type CadDimensionMode,
  type CadPart,
} from './index';

const documentOf = (part: CadPart) => ({ ...createCadDocument(), parts: [part] });
function proposal(part: CadPart, ids: string[], id: string, mode: CadDimensionMode = 'auto'): CadDimension {
  const result = dimensionForSelection(part.sketch, ids, { mode, placement: { x: 70, y: 95 } });
  if (!('constraint' in result)) throw new Error(result.message);
  return withDimensionPlacement(part.sketch, { ...result.constraint, id }, { x: 70, y: 95 });
}
async function prepare(part: CadPart, dimension: CadDimension) {
  const result = await prepareDimensionCreation(part, dimension);
  if (!result.ok) throw new Error(`${result.message} ${JSON.stringify(result.diagnostics)}`);
  return result;
}
const sourceDimension = (part: CadPart, id: string) => part.sketch.constraints.find(constraint => constraint.id === id)! as CadDimension;

describe('fresh dimension creation with native constraint rank', () => {
  it('makes only a redundant new rectangle size driven and preserves source identities, drivers and portable history', async () => {
    const original = createCadPart();
    original.sketch = addRectangle(original.sketch, { x: 40, y: 20, width: 60, height: 40 });
    const before = structuredClone(original),
      lines = original.sketch.entities.filter(entity => entity.type === 'line');
    const first = await prepare(original, proposal(original, [lines[2]!.id], 'top-width'));
    expect(first.driven).toBe(false);
    const oldDriver = structuredClone(sourceDimension(first.part, 'top-width'));
    const second = await prepare(first.part, proposal(first.part, [lines[0]!.id], 'bottom-reference'));
    expect(second.driven).toBe(true);
    expect(second.dimension).toMatchObject({
      id: 'bottom-reference',
      driven: true,
      value: 60,
      sourceEntityId: lines[0]!.id,
    });
    expect(resolveDimensionPlacement(second.part.sketch, second.dimension)).toEqual({ x: 70, y: 95 });
    expect(sourceDimension(second.part, 'top-width')).toEqual(oldDriver);
    expect(second.part.sketch.entities.map(entity => entity.id)).toEqual(before.sketch.entities.map(entity => entity.id));
    expect(second.part.sketch.constraints.filter(constraint => !('value' in constraint))).toEqual(before.sketch.constraints);
    expect(original).toEqual(before);
    const portable = JSON.parse(JSON.stringify(documentOf(second.part)));
    expect(parseCadDocument(portable)).toEqual(portable);
    // Detached snapshots let a caller Undo the whole placement without mutating either prior command.
    expect(first.part.sketch.constraints.some(constraint => constraint.id === 'bottom-reference')).toBe(false);
    const edited = await solveCadDocument(updateDimension(documentOf(second.part), 'top-width', 70));
    expect(edited.sketches[0]!.status).toBe('solved');
    expect(sourceDimension(edited.document.parts[0]!, 'bottom-reference').value).toBeCloseTo(70, 6);
  });

  it.each(['angle', 'gap'] as const)('retains a DOF-reducing new %s as driving', async kind => {
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 120, y2: 50 });
    part.sketch = addLine(part.sketch, kind === 'gap' ? { x1: 20, y1: 60, x2: 120, y2: 90 } : { x1: 140, y1: 30, x2: 170, y2: 100 });
    const lines = part.sketch.entities.filter(entity => entity.type === 'line');
    const baseline = await solveCadDocument(documentOf(part));
    const created = await prepare(
      part,
      proposal(
        part,
        lines.map(line => line.id),
        'new-measurement'
      )
    );
    expect(created.dimension.type).toBe(kind === 'gap' ? 'lineLineDistance' : 'angle');
    expect(created.driven).toBe(false);
    expect(created.dimension.driven).not.toBe(true);
    const solved = await solveCadDocument(documentOf(created.part));
    expect(solved.sketches[0]!.status).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(baseline.sketches[0]!.dof - (kind === 'gap' ? 2 : 1));
  });

  it('does not turn conflicting edits or an explicit reference-to-driving change into automatic references', async () => {
    const part = createCadPart();
    part.sketch = addRectangle(part.sketch, { x: 40, y: 20, width: 60, height: 40 });
    const lines = part.sketch.entities.filter(entity => entity.type === 'line');
    const first = await prepare(part, proposal(part, [lines[0]!.id], 'width'));
    const second = await prepare(first.part, proposal(first.part, [lines[2]!.id], 'reference'));
    const driving = setDimensionDriven(documentOf(second.part), 'reference', false);
    const conflict = await solveCadDocument(updateDimension(driving, 'width', 70));
    expect(conflict.sketches[0]!.status).toBe('conflict');
    expect(conflict.diagnostics.some(diagnostic => diagnostic.code === 'constraint-conflict')).toBe(true);
    expect(sourceDimension(conflict.document.parts[0]!, 'width').driven).not.toBe(true);
    expect(sourceDimension(conflict.document.parts[0]!, 'reference').driven).not.toBe(true);
  });

  it('rejects a fresh dimension in an already conflicting sketch without changing its old drivers', async () => {
    const part = createCadPart();
    part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 120, y2: 20 });
    const line = part.sketch.entities.at(-1)!;
    if (line.type !== 'line') throw new Error();
    part.sketch = {
      ...part.sketch,
      entities: part.sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity)),
    };
    part.sketch = addConstraint(part.sketch, { type: 'distance', pointAId: line.startId, pointBId: line.endId, value: 90 });
    const before = structuredClone(part);
    const result = await prepareDimensionCreation(part, proposal(part, [line.id], 'fresh', 'distanceX'));
    expect(result.ok).toBe(false);
    expect(part).toEqual(before);
  });

  it('rejects duplicate identities and invalid fresh references atomically', async () => {
    const part = createCadPart();
    part.sketch = addRectangle(part.sketch, { x: 20, y: 20, width: 60, height: 40 });
    const line = part.sketch.entities.find(entity => entity.type === 'line')!,
      before = structuredClone(part);
    const dimension = proposal(part, [line.id], 'new-dimension');
    expect((await prepareDimensionCreation(part, { ...dimension, id: line.id })).ok).toBe(false);
    expect((await prepareDimensionCreation(part, { ...dimension, sourceEntityId: 'missing-owner' } as CadDimension)).ok).toBe(false);
    expect(part).toEqual(before);
  });
});
