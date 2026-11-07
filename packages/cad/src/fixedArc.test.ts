import { describe, expect, it } from 'vitest';
import { addArc, addConstraint, createPlateDocument, solveCadDocument } from './index';

function fixedArc() {
  const document = createPlateDocument();
  const part = document.parts[0]!;
  part.sketch = addArc(part.sketch, { cx: 40, cy: 40, radius: 10, startAngle: 0, endAngle: Math.PI, construction: true });
  const arc = part.sketch.entities.find(e => e.type === 'arc')!;
  if (arc.type !== 'arc') throw new Error('Fixture');
  part.sketch.entities = part.sketch.entities.map(e =>
    e.type === 'point' && [arc.centerId, arc.startId, arc.endId].includes(e.id) ? { ...e, fixed: true } : e
  );
  return { document, part, arc };
}

describe('fully fixed arcs', () => {
  it('solves a valid fixed arc with zero degrees of freedom without redundant arc-rule conflicts', async () => {
    const { document, arc } = fixedArc();
    const first = await solveCadDocument(document);
    expect(first.status, JSON.stringify(first.diagnostics)).toBe('solved');
    expect(first.sketches[0]!.dof).toBe(0);
    const solved = first.document.parts[0]!.sketch.entities.find(e => e.id === arc.id)!;
    expect(solved).toMatchObject({ radius: 10, startAngle: 0, endAngle: Math.PI });
    const again = await solveCadDocument(first.document);
    expect(again.status).toBe('solved');
    expect(again.document).toEqual(first.document);
  });

  it('honors a matching radius dimension but reports an actually contradictory one through native diagnostics', async () => {
    const { document, part, arc } = fixedArc();
    part.sketch = addConstraint(part.sketch, { type: 'radius', entityId: arc.id, value: 10 });
    const matching = await solveCadDocument(document);
    expect(matching.status).toBe('solved');
    expect(matching.sketches[0]!.dof).toBe(0);
    const radius = part.sketch.constraints.at(-1)!;
    if (!('value' in radius)) throw new Error('Fixture');
    radius.value = 11;
    const conflict = await solveCadDocument(document);
    expect(conflict.status).toBe('conflict');
    expect(
      conflict.diagnostics.some(
        d => d.code === 'constraint-conflict' && d.constraintIds?.includes(radius.id) && d.entityIds?.includes(arc.id)
      )
    ).toBe(true);
    expect(conflict.parts).toEqual([]);
  });

  it('rejects fixed endpoints that cannot lie on one circle around the fixed center', async () => {
    const { document, part, arc } = fixedArc();
    const end = part.sketch.entities.find(e => e.id === arc.endId)!;
    if (end.type !== 'point') throw new Error('Fixture');
    end.y += 5;
    const result = await solveCadDocument(document);
    expect(result.status).toBe('conflict');
    expect(result.diagnostics.some(d => d.code === 'constraint-conflict' && d.entityIds?.includes(arc.id))).toBe(true);
    expect(result.parts).toEqual([]);
  });

  it('does not suppress a contradictory tangency against other fixed geometry', async () => {
    const { document, part, arc } = fixedArc();
    const bottom = part.sketch.entities.find(e => e.type === 'line')!;
    part.sketch = addConstraint(part.sketch, { type: 'tangent', entityAId: bottom.id, entityBId: arc.id });
    const tangent = part.sketch.constraints.at(-1)!;
    const result = await solveCadDocument(document);
    expect(result.status).toBe('conflict');
    expect(result.diagnostics.some(d => d.constraintIds?.includes(tangent.id))).toBe(true);
  });

  it('uses the fixed points to normalize stale non-driving arc parameters', async () => {
    const { document, arc } = fixedArc();
    arc.radius = 12;
    arc.startAngle = 0.2;
    const result = await solveCadDocument(document);
    expect(result.status).toBe('solved');
    expect(result.document.parts[0]!.sketch.entities.find(e => e.id === arc.id)).toMatchObject({ radius: 10, startAngle: 0 });
  });

  it('keeps a completely fixed arc stronger than a temporary radius target', async () => {
    const { document, arc } = fixedArc();
    const result = await solveCadDocument(document, { radiusDrag: { entityId: arc.id, radius: 15 } });
    expect(result.status).toBe('solved');
    expect(result.sketches[0]!.dof).toBe(0);
    expect(result.document.parts[0]!.sketch.entities.find(e => e.id === arc.id)).toMatchObject({ radius: 10 });
  });
});
