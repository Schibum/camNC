import { describe, expect, it } from 'vitest';
import {
  addArc,
  addCenterRectangle,
  addConstraint,
  addLine,
  constraintEntityIds,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  parseCadDocument,
  removeEntity,
  resolveDimensionPlacement,
  solveCadDocument,
  updateDimension,
  validateCadDocument,
} from './index';
import type { CadDocument, CadLineEntity } from './types';

function capsule() {
  const document = createCadDocument();
  const part = createCadPart();
  document.parts.push(part);
  part.sketch = addLine(part.sketch, { x1: 21, y1: 0, x2: 94, y2: 0 });
  part.sketch = addArc(part.sketch, { cx: 94, cy: 21, radius: 21, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
  part.sketch = addLine(part.sketch, { x1: 94, y1: 42, x2: 21, y2: 42 });
  part.sketch = addArc(part.sketch, { cx: 21, cy: 21, radius: 21, startAngle: Math.PI / 2, endAngle: -Math.PI / 2 });
  return { document, part, line: part.sketch.entities.find((entity): entity is CadLineEntity => entity.type === 'line')! };
}

describe('line dimension ownership', () => {
  it.each(['distance', 'distanceX', 'distanceY'] as const)(
    'deletes a line-derived %s while preserving an explicit dimension between the surviving endpoints',
    type => {
      const { document, part, line } = capsule();
      const arc = part.sketch.entities.find(entity => entity.type === 'arc')!;
      part.sketch = addConstraint(part.sketch, {
        id: 'owned',
        type,
        pointAId: line.startId,
        pointBId: line.endId,
        value: type === 'distanceY' ? 0 : 73,
        sourceEntityId: line.id,
      });
      part.sketch = addConstraint(part.sketch, {
        id: 'explicit',
        type,
        pointAId: line.startId,
        pointBId: line.endId,
        value: type === 'distanceY' ? 0 : 73,
      });
      part.sketch = addConstraint(part.sketch, { id: 'radius', type: 'radius', entityId: arc.id, value: 21 });
      const source = structuredClone(document);
      expect(constraintEntityIds(part.sketch.constraints.find(constraint => constraint.id === 'owned')!)).toEqual([
        line.startId,
        line.endId,
        line.id,
      ]);
      const deleted = removeEntity(part.sketch, line.id);
      expect(deleted.entities.some(entity => entity.id === line.startId)).toBe(true);
      expect(deleted.entities.some(entity => entity.id === line.endId)).toBe(true);
      expect(deleted.constraints.map(constraint => constraint.id)).toEqual(['explicit', 'radius']);
      const draft = { ...document, parts: [{ ...part, sketch: deleted }] };
      expect(validateCadDocument(draft)).toEqual([]);
      expect(evaluateCadDocument(draft).diagnostics.some(diagnostic => diagnostic.code === 'open-profile')).toBe(true);
      expect(document).toEqual(source);
    }
  );

  it('removes a dimensioned rectangle width with its bottom edge, retaining its independent height', () => {
    const document = createPlateDocument();
    const part = document.parts[0]!;
    const width = part.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    const height = part.sketch.constraints.find(constraint => constraint.label === 'Height')!;
    if (!('sourceEntityId' in width)) throw new Error('Expected a line-owned dimension');
    expect(width.sourceEntityId).toBe(part.sketch.entities.find(entity => entity.type === 'line')!.id);
    const deleted = removeEntity(part.sketch, width.sourceEntityId!);
    expect(deleted.constraints.some(constraint => constraint.id === width.id)).toBe(false);
    expect(deleted.constraints).toContainEqual(height);
    expect(validateCadDocument({ ...document, parts: [{ ...part, sketch: deleted }] })).toEqual([]);
  });

  it('assigns centered rectangle size dimensions to profile edges rather than the construction diagonals', () => {
    const sketch = addCenterRectangle(createCadPart().sketch, { x: 0, y: 0, width: 80, height: 40, dimensioned: true });
    const dimensions = sketch.constraints.filter(constraint => 'sourceEntityId' in constraint);
    expect(dimensions).toHaveLength(2);
    for (const dimension of dimensions) {
      if (!('sourceEntityId' in dimension)) throw new Error('Expected ownership');
      expect(sketch.entities.find(entity => entity.id === dimension.sourceEntityId)).toMatchObject({
        type: 'line',
        construction: undefined,
      });
    }
  });

  it('retains owner IDs and relative annotation placement through editing, portable snapshots, deletion and Undo-style restoration', async () => {
    const document = createPlateDocument();
    const width = document.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    if (!('sourceEntityId' in width)) throw new Error('Expected ownership');
    width.labelPosition = { x: 60, y: -20 };
    const edited = updateDimension(document, width.id, 130);
    const beforeDelete = parseCadDocument(JSON.parse(JSON.stringify(edited)));
    const solved = await solveCadDocument(beforeDelete);
    expect(solved.status).toBe('solved');
    expect(solved.document.parts[0]!.sketch.constraints.find(constraint => constraint.id === width.id)).toMatchObject({
      sourceEntityId: width.sourceEntityId,
      value: 130,
      labelPlacement: { kind: 'linear', fraction: 0.5, normalOffset: -20 },
    });
    const annotation = solved.document.parts[0]!.sketch.constraints.find(constraint => constraint.id === width.id)!;
    if (!('value' in annotation)) throw new Error('Expected numeric annotation');
    const position = resolveDimensionPlacement(solved.document.parts[0]!.sketch, annotation)!;
    expect(position.x).toBeCloseTo(65, 7);
    expect(position.y).toBeCloseTo(-20, 7);
    const deleted = structuredClone(solved.document);
    deleted.parts[0]!.sketch = removeEntity(deleted.parts[0]!.sketch, width.sourceEntityId!);
    expect(deleted.parts[0]!.sketch.constraints.some(constraint => constraint.id === width.id)).toBe(false);
    const restored = parseCadDocument(JSON.parse(JSON.stringify(solved.document)));
    expect(restored).toEqual(solved.document);
    expect((await solveCadDocument(restored)).status).toBe('solved');
  });

  it.each(['missing', 'point', 'other-line'] as const)('reports a %s owner without confusing it with a numeric operand', owner => {
    const document = createPlateDocument();
    const part = document.parts[0]!;
    const width = part.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    if (!('sourceEntityId' in width)) throw new Error('Expected ownership');
    width.sourceEntityId =
      owner === 'missing'
        ? 'deleted-line'
        : owner === 'point'
          ? width.pointAId
          : part.sketch.entities.filter(entity => entity.type === 'line')[2]!.id;
    const diagnostics = validateCadDocument(document);
    expect(
      diagnostics.some(
        diagnostic =>
          diagnostic.code === (owner === 'missing' ? 'missing-reference' : 'invalid-reference') &&
          diagnostic.constraintIds?.includes(width.id)
      )
    ).toBe(true);
  });

  it('accepts reversed source endpoint order and rejects malformed ownership in portable source', () => {
    const document = createPlateDocument();
    const width = document.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    if (!('sourceEntityId' in width)) throw new Error('Expected ownership');
    [width.pointAId, width.pointBId] = [width.pointBId, width.pointAId];
    width.value *= -1;
    expect(validateCadDocument(document)).toEqual([]);
    const malformed = JSON.parse(JSON.stringify(document)) as CadDocument;
    const target = malformed.parts[0]!.sketch.constraints.find(constraint => constraint.id === width.id)!;
    Object.assign(target, { sourceEntityId: 4 });
    expect(() => parseCadDocument(malformed)).toThrow('references');
    Object.assign(target, { sourceEntityId: '' });
    expect(() => parseCadDocument(malformed)).toThrow('references');
    const horizontal = malformed.parts[0]!.sketch.constraints.find(constraint => constraint.type === 'horizontal')!;
    Object.assign(target, { sourceEntityId: width.sourceEntityId });
    Object.assign(horizontal, { sourceEntityId: width.sourceEntityId });
    expect(() => parseCadDocument(malformed)).toThrow('Only point-pair dimensions');
  });
});
