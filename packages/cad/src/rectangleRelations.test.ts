import { describe, expect, it } from 'vitest';
import { addConstraint, addRectangle, createCadDocument, createCadPart, originId, solveCadDocument, type CadPointEntity } from './index';
describe('rectangle geometric relationships', () => {
  it('retains one horizontal, opposite parallel, and adjacent perpendicular relations during native resizing', async () => {
    const part = createCadPart();
    part.sketch = addRectangle(part.sketch, { x: 0, y: 0, width: 100, height: 60 });
    const lines = part.sketch.entities.filter(e => e.type === 'line'),
      topRight = lines[1]!.endId;
    expect(
      part.sketch.constraints
        .filter(c => c.type !== 'coincident')
        .map(c => c.type)
        .sort()
    ).toEqual(['horizontal', 'parallel', 'parallel', 'perpendicular']);
    expect(part.sketch.constraints.filter(c => c.type === 'coincident')).toHaveLength(4);
    part.sketch = addConstraint(part.sketch, { type: 'coincident', pointAId: lines[0]!.startId, pointBId: originId(part.sketch) });
    const document = { ...createCadDocument(), parts: [part] };
    const before = await solveCadDocument(document);
    expect(before.sketches[0]!.dof).toBe(2);
    const solved = await solveCadDocument(document, { drag: { pointId: topRight, x: 140, y: 85 } });
    expect(solved.sketches[0]!.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    const points = new Map(
      solved.document.parts[0]!.sketch.entities.filter((e): e is CadPointEntity => e.type === 'point').map(p => [p.id, p])
    );
    expect(points.get(topRight)).toMatchObject({ x: 140, y: 85 });
    expect(points.get(lines[0]!.startId)).toMatchObject({ x: 0, y: 0 });
    expect(points.get(originId(part.sketch))).toMatchObject({ x: 0, y: 0, fixed: true });
    for (const [i, line] of lines.entries()) {
      const a = points.get(line.startId)!,
        b = points.get(line.endId)!;
      expect(i % 2 ? b.x - a.x : b.y - a.y).toBeCloseTo(0, 7);
    }
    expect(solved.parts[0]!.outline).toHaveLength(4);
  });
});
