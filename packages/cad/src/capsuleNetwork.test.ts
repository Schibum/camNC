import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addArc,
  addConstraint,
  addLine,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  solveCadDocument,
  updateDimension,
} from './index';
import type { CadArcEntity, CadDocument, CadLineEntity, CadPointEntity, CadSolveResult } from './types';

// Captured from the real L → Shift+A → L → Shift+A capsule gesture, including solver roundoff.
function drawnCapsule(): CadDocument {
  return {
    version: 1,
    id: 'capsule-document',
    name: 'Capsule',
    revision: 19,
    parts: [
      {
        id: 'capsule-part',
        name: 'Capsule',
        thickness: 18,
        sketch: {
          id: 'capsule-sketch',
          entities: [
            { id: 'capsule-sketch:origin', type: 'point', x: 0, y: 0, fixed: true, construction: true },
            { id: 'bottom-left', type: 'point', x: 21, y: 0 },
            { id: 'bottom-right', type: 'point', x: 94, y: 0 },
            { id: 'bottom', type: 'line', startId: 'bottom-left', endId: 'bottom-right' },
            { id: 'right-center', type: 'point', x: 94, y: 21 },
            { id: 'top-right', type: 'point', x: 94, y: 42 },
            {
              id: 'right-arc',
              type: 'arc',
              centerId: 'right-center',
              startId: 'bottom-right',
              endId: 'top-right',
              radius: 21,
              startAngle: -Math.PI / 2,
              endAngle: Math.PI / 2,
            },
            { id: 'top-left', type: 'point', x: 21.000008070764522, y: 42 },
            { id: 'top', type: 'line', startId: 'top-right', endId: 'top-left' },
            { id: 'left-center', type: 'point', x: 21.000008070764522, y: 20.999999999999226 },
            {
              id: 'left-arc',
              type: 'arc',
              centerId: 'left-center',
              startId: 'top-left',
              endId: 'bottom-left',
              radius: 21.000000000000774,
              startAngle: Math.PI / 2,
              endAngle: -1.5707967111170167,
            },
          ],
          constraints: [
            { id: 'bottom-horizontal', type: 'horizontal', entityId: 'bottom' },
            { id: 'left-on-origin-row', type: 'horizontalPoints', pointAId: 'capsule-sketch:origin', pointBId: 'bottom-left' },
            { id: 'right-on-origin-row', type: 'horizontalPoints', pointAId: 'capsule-sketch:origin', pointBId: 'bottom-right' },
            { id: 'bottom-right-tangent', type: 'tangent', entityAId: 'bottom', entityBId: 'right-arc' },
            { id: 'right-vertical', type: 'verticalPoints', pointAId: 'bottom-right', pointBId: 'top-right' },
            { id: 'right-top-tangent', type: 'tangent', entityAId: 'right-arc', entityBId: 'top' },
            { id: 'top-left-tangent', type: 'tangent', entityAId: 'top', entityBId: 'left-arc' },
          ],
        },
      },
    ],
  };
}

function point(document: CadDocument, id: string): CadPointEntity {
  return document.parts[0]!.sketch.entities.find((entity): entity is CadPointEntity => entity.type === 'point' && entity.id === id)!;
}

function expectTangencies(document: CadDocument): void {
  const sketch = document.parts[0]!.sketch;
  for (const constraint of sketch.constraints) {
    if (constraint.type !== 'tangent') continue;
    const a = sketch.entities.find(entity => entity.id === constraint.entityAId) as CadLineEntity | CadArcEntity;
    const b = sketch.entities.find(entity => entity.id === constraint.entityBId) as CadLineEntity | CadArcEntity;
    const junction = point(document, [a.startId, a.endId].find(id => id === b.startId || id === b.endId)!);
    const normal = (curve: CadLineEntity | CadArcEntity) => {
      if (curve.type === 'line') {
        const start = point(document, curve.startId),
          end = point(document, curve.endId);
        return { x: start.y - end.y, y: end.x - start.x };
      }
      const center = point(document, curve.centerId);
      return { x: center.x - junction.x, y: center.y - junction.y };
    };
    const n1 = normal(a),
      n2 = normal(b);
    expect(Math.abs(n1.x * n2.y - n1.y * n2.x) / (Math.hypot(n1.x, n1.y) * Math.hypot(n2.x, n2.y))).toBeLessThan(1e-7);
  }
}

function expectSolved(result: CadSolveResult): void {
  expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
  expect(result.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(false);
}

describe('closed line/arc dimension edits', () => {
  it.each([1, -1])('edits the actual drawn capsule length and radius with winding reflection %s', async reflection => {
    const source = drawnCapsule();
    for (const entity of source.parts[0]!.sketch.entities) {
      if (entity.type === 'point') entity.y *= reflection;
      if (entity.type === 'arc' && reflection === -1) {
        [entity.startId, entity.endId] = [entity.endId, entity.startId];
        [entity.startAngle, entity.endAngle] = [-entity.endAngle, -entity.startAngle];
      }
    }
    const original = await solveCadDocument(source);
    expectSolved(original);
    // Three endpoint tangencies each remove one independent degree of freedom.
    expect(original.sketches[0]!.dof).toBe(4);
    const document = structuredClone(original.document);
    document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, {
      id: 'length',
      type: 'distance',
      pointAId: 'bottom-left',
      pointBId: 'bottom-right',
      value: 73,
    });
    document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, {
      id: 'radius',
      type: 'radius',
      entityId: 'right-arc',
      value: 21,
    });
    const before = structuredClone(document);
    const lengthOnly = await solveCadDocument(updateDimension(document, 'length', 80));
    expectSolved(lengthOnly);
    expect(lengthOnly.sketches[0]!.dof).toBe(2);
    const result = await solveCadDocument(updateDimension(lengthOnly.document, 'radius', 22));
    expectSolved(result);
    expectTangencies(result.document);
    expect(
      Math.hypot(
        point(result.document, 'bottom-right').x - point(result.document, 'bottom-left').x,
        point(result.document, 'bottom-right').y - point(result.document, 'bottom-left').y
      )
    ).toBeCloseTo(80, 6);
    expect(result.document.parts[0]!.sketch.entities.find(entity => entity.id === 'right-arc')).toMatchObject({ radius: 22 });
    expect(result.document.parts[0]!.sketch.constraints).toEqual(
      updateDimension(updateDimension(document, 'length', 80), 'radius', 22).parts[0]!.sketch.constraints
    );
    expect(result.parts[0]!.loops).toHaveLength(1);
    expect(result.parts[0]!.loops[0]!.id).toBe(original.parts[0]!.loops[0]!.id);
    expect(document).toEqual(before);
  });

  it('edits the actual four-arc rounded contour while preserving every inferred relationship', async () => {
    // Recorded from the real drawing workflow; only opaque IDs were renamed.
    const document = JSON.parse(readFileSync(new URL('./fixtures/drawn-corbel.json', import.meta.url), 'utf8')) as CadDocument;
    const length = document.parts[0]!.sketch.constraints.find(constraint => constraint.type === 'distance')!;
    const radius = document.parts[0]!.sketch.constraints.find(constraint => constraint.type === 'radius')!;
    const original = await solveCadDocument(document);
    expectSolved(original);
    const lengthEdited = await solveCadDocument(updateDimension(original.document, length.id, 70));
    expectSolved(lengthEdited);
    const edited = await solveCadDocument(updateDimension(lengthEdited.document, radius.id, 24));
    expectSolved(edited);
    expectTangencies(edited.document);
    expect(edited.parts[0]!.loops).toHaveLength(1);
    expect(edited.parts[0]!.loops[0]!.id).toBe(original.parts[0]!.loops[0]!.id);
    expect(edited.document.parts[0]!.sketch.constraints).toEqual(
      updateDimension(updateDimension(document, length.id, 70), radius.id, 24).parts[0]!.sketch.constraints
    );
  });

  it('honors a joined arc/arc tangency when its driving radius changes', async () => {
    const document = createPlateDocument();
    const part = document.parts[0]!;
    part.sketch = addArc(part.sketch, { cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2, construction: true });
    part.sketch = addArc(part.sketch, { cx: 0, cy: 20, radius: 10, startAngle: -Math.PI / 2, endAngle: 0, construction: true });
    const [a, b] = part.sketch.entities.filter((entity): entity is CadArcEntity => entity.type === 'arc');
    part.sketch = addConstraint(part.sketch, { type: 'tangent', entityAId: a!.id, entityBId: b!.id });
    part.sketch = addConstraint(part.sketch, { id: 'radius-a', type: 'radius', entityId: a!.id, value: 10 });
    part.sketch = addConstraint(part.sketch, { type: 'radius', entityId: b!.id, value: 10 });
    const original = await solveCadDocument(document);
    expectSolved(original);
    const edited = await solveCadDocument(updateDimension(original.document, 'radius-a', 15));
    expectSolved(edited);
    expectTangencies(edited.document);
    const centerA = point(edited.document, a!.centerId),
      centerB = point(edited.document, b!.centerId);
    expect(Math.hypot(centerB.x - centerA.x, centerB.y - centerA.y)).toBeCloseTo(25, 6);
  });

  it('keeps a closed S-shaped line/arc network valid after sequential length and radius edits', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    document.parts.push(part);
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 40, y2: 0 });
    part.sketch = addArc(part.sketch, { cx: 40, cy: 20, radius: 20, startAngle: -Math.PI / 2, endAngle: 0 });
    part.sketch = addArc(part.sketch, { cx: 80, cy: 20, radius: 20, startAngle: Math.PI / 2, endAngle: Math.PI });
    for (const [x1, y1, x2, y2] of [
      [80, 40, 120, 40],
      [120, 40, 120, -20],
      [120, -20, 0, -20],
      [0, -20, 0, 0],
    ]) {
      part.sketch = addLine(part.sketch, { x1: x1!, y1: y1!, x2: x2!, y2: y2! });
    }
    const lines = part.sketch.entities.filter((entity): entity is CadLineEntity => entity.type === 'line');
    const [a, b] = part.sketch.entities.filter((entity): entity is CadArcEntity => entity.type === 'arc');
    part.sketch.constraints.push(
      { id: 'line-a-tangent', type: 'tangent', entityAId: lines[0]!.id, entityBId: a!.id },
      { id: 'a-b-tangent', type: 'tangent', entityAId: a!.id, entityBId: b!.id },
      { id: 'b-line-tangent', type: 'tangent', entityAId: b!.id, entityBId: lines[1]!.id },
      { id: 's-length', type: 'distance', pointAId: lines[0]!.startId, pointBId: lines[0]!.endId, value: 40 },
      { id: 's-radius', type: 'radius', entityId: a!.id, value: 20 }
    );
    for (let i = 0; i < lines.length; i++)
      part.sketch = addConstraint(part.sketch, { type: i === 2 || i === 4 ? 'vertical' : 'horizontal', entityId: lines[i]!.id });
    const original = await solveCadDocument(document);
    expectSolved(original);
    const length = await solveCadDocument(updateDimension(original.document, 's-length', 45));
    expectSolved(length);
    const radius = await solveCadDocument(updateDimension(length.document, 's-radius', 22));
    expectSolved(radius);
    expectTangencies(radius.document);
    expect(radius.parts[0]!.loops[0]!.id).toBe(original.parts[0]!.loops[0]!.id);
  });

  it('recognizes an explicit coincident endpoint chain without merging application-owned IDs', async () => {
    const document = drawnCapsule();
    const sketch = document.parts[0]!.sketch;
    const arc = sketch.entities.find(entity => entity.id === 'right-arc') as CadArcEntity;
    const originalPoint = point(document, arc.startId);
    sketch.entities.push(
      { ...originalPoint, id: 'arc-start-alias' },
      { ...originalPoint, id: 'coincident-intermediate', construction: true }
    );
    arc.startId = 'arc-start-alias';
    sketch.constraints.push(
      { id: 'coincident-a', type: 'coincident', pointAId: originalPoint.id, pointBId: 'coincident-intermediate' },
      { id: 'coincident-b', type: 'coincident', pointAId: 'coincident-intermediate', pointBId: 'arc-start-alias' },
      { id: 'length', type: 'distance', pointAId: 'bottom-left', pointBId: 'bottom-right', value: 80 }
    );
    const result = await solveCadDocument(document);
    expectSolved(result);
    const alias = point(result.document, 'arc-start-alias'),
      endpoint = point(result.document, 'bottom-right');
    expect(alias.x).toBeCloseTo(endpoint.x, 7);
    expect(alias.y).toBeCloseTo(endpoint.y, 7);
    expect(result.document.parts[0]!.sketch.entities).toHaveLength(sketch.entities.length);
  });

  it('retains a genuine dimension conflict instead of suppressing native diagnostics', async () => {
    const document = drawnCapsule();
    document.parts[0]!.sketch.constraints.push(
      { id: 'length-80', type: 'distance', pointAId: 'bottom-left', pointBId: 'bottom-right', value: 80 },
      { id: 'length-90', type: 'distance', pointAId: 'bottom-left', pointBId: 'bottom-right', value: 90 }
    );
    const result = await solveCadDocument(document);
    expect(result.status).toBe('conflict');
    expect(result.diagnostics.some(diagnostic => diagnostic.constraintIds?.some(id => id === 'length-80' || id === 'length-90'))).toBe(
      true
    );
    expect(result.parts).toEqual([]);
  });

  it.each([true, false])('checks an entirely fixed shared-endpoint tangent analytically (matching %s)', async matching => {
    const document = createPlateDocument();
    const part = document.parts[0]!;
    part.sketch = addArc(part.sketch, { cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2, construction: true });
    part.sketch = addLine(part.sketch, { x1: 10, y1: 0, x2: matching ? 10 : 20, y2: matching ? 20 : 5, construction: true });
    part.sketch.entities = part.sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity));
    const arc = part.sketch.entities.find(entity => entity.type === 'arc')!;
    const line = part.sketch.entities.filter(entity => entity.type === 'line').at(-1)!;
    part.sketch = addConstraint(part.sketch, { id: 'wrong-tangent', type: 'tangent', entityAId: line.id, entityBId: arc.id });
    const result = await solveCadDocument(document);
    if (matching) {
      expectSolved(result);
      expect(result.sketches[0]!.dof).toBe(0);
    } else {
      expect(result.status).toBe('conflict');
      expect(result.diagnostics.some(diagnostic => diagnostic.constraintIds?.includes('wrong-tangent'))).toBe(true);
    }
  });
});
