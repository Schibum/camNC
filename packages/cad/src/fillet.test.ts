import { describe, expect, it } from 'vitest';
import {
  addArc,
  addCircle,
  addLine,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  filletLineCorners,
  parseCadDocument,
  polygonArea,
  pointEquivalence,
  resolveFilletCorners,
  solveCadDocument,
  updateDimension,
  validateCadDocument,
} from './index';
import type { CadArcEntity, CadLineEntity, CadPointEntity, CadSketch } from './types';

const linesOf = (sketch: CadSketch) =>
  sketch.entities.filter((entity): entity is CadLineEntity => entity.type === 'line' && !entity.construction);
const pointOf = (sketch: CadSketch, id: string) =>
  sketch.entities.find((entity): entity is CadPointEntity => entity.type === 'point' && entity.id === id)!;

function apply(sketch: CadSketch, cornerPointIds: string[], radius = 10, sharedRadiusConstraintId?: string) {
  const result = filletLineCorners(sketch, { cornerPointIds, radius, sharedRadiusConstraintId });
  if (!result.ok) throw new Error(result.message);
  return result;
}

function assertTangency(sketch: CadSketch, arcIds: string[]) {
  for (const id of arcIds) {
    const arc = sketch.entities.find(entity => entity.id === id) as CadArcEntity;
    const center = pointOf(sketch, arc.centerId);
    for (const endpointId of [arc.startId, arc.endId]) {
      const endpoint = pointOf(sketch, endpointId);
      const line = linesOf(sketch).find(candidate => candidate.startId === endpointId || candidate.endId === endpointId)!;
      const other = pointOf(sketch, line.startId === endpointId ? line.endId : line.startId);
      const radial = { x: endpoint.x - center.x, y: endpoint.y - center.y };
      const tangent = { x: other.x - endpoint.x, y: other.y - endpoint.y };
      expect(Math.abs(radial.x * tangent.x + radial.y * tangent.y) / (arc.radius * Math.hypot(tangent.x, tangent.y))).toBeLessThan(1e-7);
      expect(Math.hypot(radial.x, radial.y)).toBeCloseTo(arc.radius, 6);
    }
  }
}

describe('atomic line corner fillets', () => {
  it('creates a real tangent arc while retaining the original dimensional virtual sharp', async () => {
    const document = createPlateDocument({ width: 120, height: 80 });
    const part = document.parts[0]!;
    const before = structuredClone(document);
    const bottom = linesOf(part.sketch)[0]!;
    const result = apply(part.sketch, [bottom.endId]);
    expect(document).toEqual(before);
    part.sketch = result.sketch;
    expect(linesOf(part.sketch).map(line => line.id)).toEqual(linesOf(before.parts[0]!.sketch).map(line => line.id));
    expect(part.sketch.constraints.slice(0, before.parts[0]!.sketch.constraints.length)).toEqual(before.parts[0]!.sketch.constraints);
    expect(pointOf(part.sketch, bottom.endId)).toMatchObject({ x: 120, y: 0, construction: true });
    expect(validateCadDocument(document)).toEqual([]);
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts[0]!.loops[0]!.entityIds).toHaveLength(5);
    expect(solved.sketches[0]!.dof).toBe(0);
    assertTangency(solved.document.parts[0]!.sketch, result.arcIds);
    const resized = await solveCadDocument(updateDimension(solved.document, result.radiusConstraintId, 15));
    expect(resized.status, JSON.stringify(resized.diagnostics)).toBe('solved');
    assertTangency(resized.document.parts[0]!.sketch, result.arcIds);
    expect(pointOf(resized.document.parts[0]!.sketch, bottom.endId).x).toBeCloseTo(120, 7);
    expect(pointOf(resized.document.parts[0]!.sketch, bottom.endId).y).toBeCloseTo(0, 7);
  });

  it('fillets all four rectangle corners atomically and edits their shared radius through equal constraints', async () => {
    const document = createPlateDocument({ width: 120, height: 80 });
    const part = document.parts[0]!;
    const original = structuredClone(document);
    const selection = resolveFilletCorners(
      part.sketch,
      linesOf(part.sketch).map(line => line.id)
    );
    expect(selection.ok).toBe(true);
    const result = apply(part.sketch, selection.cornerPointIds, 8);
    part.sketch = result.sketch;
    expect(result.arcIds).toHaveLength(4);
    expect(part.sketch.constraints.filter(constraint => constraint.type === 'radius')).toHaveLength(1);
    expect(part.sketch.constraints.filter(constraint => constraint.type === 'equal')).toHaveLength(3);
    expect(part.sketch.constraints.filter(constraint => constraint.type === 'tangent')).toHaveLength(8);
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(0);
    expect(solved.parts[0]!.loops[0]!.entityIds).toHaveLength(8);
    const resized = await solveCadDocument(updateDimension(solved.document, result.radiusConstraintId, 14));
    expect(resized.status, JSON.stringify(resized.diagnostics)).toBe('solved');
    assertTangency(resized.document.parts[0]!.sketch, result.arcIds);
    for (const id of result.arcIds)
      expect(resized.document.parts[0]!.sketch.entities.find(entity => entity.id === id)).toMatchObject({ radius: 14 });
    expect(parseCadDocument(JSON.parse(JSON.stringify(original)))).toEqual(original);
    expect(parseCadDocument(JSON.parse(JSON.stringify(resized.document)))).toEqual(resized.document);
  });

  it('preserves a separate hole, its size dimension, and unrelated construction geometry', async () => {
    const document = createPlateDocument();
    const part = document.parts[0]!;
    part.sketch = addCircle(part.sketch, { x: 60, y: 40, radius: 5, dimensioned: true });
    part.sketch = addLine(part.sketch, { x1: 40, y1: 20, x2: 70, y2: 50, construction: true });
    const unrelated = part.sketch.entities.filter(entity => entity.type === 'circle' || (entity.type === 'line' && entity.construction));
    const holeDimension = part.sketch.constraints.find(constraint => constraint.type === 'diameter')!;
    const corner = linesOf(part.sketch)[0]!.endId;
    const result = apply(part.sketch, [corner]);
    unrelated.forEach(entity => expect(result.sketch.entities).toContainEqual(entity));
    expect(result.sketch.constraints).toContainEqual(holeDimension);
    part.sketch = result.sketch;
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts[0]!.holes).toHaveLength(1);
  });

  it('continues a fillet session by sharing its original driving radius with a later corner', async () => {
    const document = createPlateDocument();
    const part = document.parts[0]!;
    const corners = linesOf(part.sketch).map(line => line.startId);
    const first = apply(part.sketch, [corners[1]!], 8);
    const firstSolved = await solveCadDocument({ ...document, parts: [{ ...part, sketch: first.sketch }] });
    expect(firstSolved.status, JSON.stringify(firstSolved.diagnostics)).toBe('solved');
    const second = apply(firstSolved.document.parts[0]!.sketch, [corners[2]!], 99, first.radiusConstraintId);
    expect(second.radiusConstraintId).toBe(first.radiusConstraintId);
    expect(second.sketch.constraints.filter(constraint => constraint.type === 'radius')).toHaveLength(1);
    const edited = await solveCadDocument(
      updateDimension({ ...document, parts: [{ ...part, sketch: second.sketch }] }, first.radiusConstraintId, 12)
    );
    expect(edited.status, JSON.stringify(edited.diagnostics)).toBe('solved');
    for (const id of [...first.arcIds, ...second.arcIds])
      expect(edited.document.parts[0]!.sketch.entities.find(entity => entity.id === id)).toMatchObject({ radius: 12 });
    assertTangency(edited.document.parts[0]!.sketch, [...first.arcIds, ...second.arcIds]);
  });

  it('rejects the whole batch when adjacent fillets would consume their shared edge', () => {
    const document = createPlateDocument({ width: 120, height: 80 });
    const sketch = document.parts[0]!.sketch;
    const before = structuredClone(sketch);
    const right = linesOf(sketch)[1]!;
    const result = filletLineCorners(sketch, { cornerPointIds: [right.startId, right.endId], radius: 40 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected rejection');
    expect(result.maximumRadius).toBeLessThan(40);
    const equivalent = pointEquivalence(sketch.constraints);
    expect(result.cornerPointIds).toEqual([right.startId, right.endId].map(equivalent.canonical));
    expect(sketch).toEqual(before);
  });

  it('rejects an otherwise fitting fillet that would cut into an unrelated hole', () => {
    let sketch = createPlateDocument().parts[0]!.sketch;
    sketch = addCircle(sketch, { x: 115, y: 5, radius: 2 });
    const before = structuredClone(sketch);
    const result = filletLineCorners(sketch, { cornerPointIds: [linesOf(sketch)[0]!.endId], radius: 20 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected rejection');
    expect(result.message).toContain('other profile geometry');
    expect(sketch).toEqual(before);
  });

  it.each([
    [0, 1],
    [Math.PI / 3, 1],
    [-Math.PI / 2, -1],
  ])('solves an acute rotated or reflected corner (%s,%s)', async (rotation, reflection) => {
    const document = createCadDocument();
    const part = createCadPart();
    document.parts.push(part);
    const transform = (x: number, y: number) => ({
      x: x * Math.cos(rotation!) - y * reflection! * Math.sin(rotation!),
      y: x * Math.sin(rotation!) + y * reflection! * Math.cos(rotation!),
    });
    const vertices = [
      [0, 0],
      [100, 0],
      [30, 80],
      [0, 0],
    ];
    for (let i = 0; i < vertices.length - 1; i++) {
      const a = transform(vertices[i]![0]!, vertices[i]![1]!),
        b = transform(vertices[i + 1]![0]!, vertices[i + 1]![1]!);
      part.sketch = addLine(part.sketch, { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    part.sketch.entities = part.sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity));
    const result = apply(part.sketch, [linesOf(part.sketch)[0]!.endId], 6);
    part.sketch = result.sketch;
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.sketches[0]!.dof).toBe(0);
    assertTangency(solved.document.parts[0]!.sketch, result.arcIds);
  });

  it('rounds a concave corner with a genuine circular arc and keeps the outline closed', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    document.parts.push(part);
    const vertices = [
      [0, 0],
      [100, 0],
      [100, 100],
      [60, 100],
      [60, 40],
      [0, 40],
      [0, 0],
    ];
    for (let i = 0; i < vertices.length - 1; i++)
      part.sketch = addLine(part.sketch, {
        x1: vertices[i]![0]!,
        y1: vertices[i]![1]!,
        x2: vertices[i + 1]![0]!,
        y2: vertices[i + 1]![1]!,
      });
    part.sketch.entities = part.sketch.entities.map(entity => (entity.type === 'point' ? { ...entity, fixed: true } : entity));
    const before = evaluateCadDocument(document).parts[0]!;
    const result = apply(part.sketch, [linesOf(part.sketch)[3]!.endId], 10);
    part.sketch = result.sketch;
    const solved = await solveCadDocument(document);
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(Math.abs(polygonArea(solved.parts[0]!.outline))).toBeGreaterThan(Math.abs(polygonArea(before.outline)));
    assertTangency(solved.document.parts[0]!.sketch, result.arcIds);
  });

  it('allows filleting an open polyline during sketch construction', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    document.parts.push(part);
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 40, y2: 0 });
    part.sketch = addLine(part.sketch, { x1: 40, y1: 0, x2: 40, y2: 40 });
    const result = apply(part.sketch, [linesOf(part.sketch)[0]!.endId]);
    part.sketch = result.sketch;
    const solved = await solveCadDocument(document);
    expect(solved.sketches[0]!.status).toBe('solved');
    expect(solved.diagnostics.some(diagnostic => diagnostic.code === 'open-profile')).toBe(true);
    assertTangency(solved.document.parts[0]!.sketch, result.arcIds);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid radius %s without changing any geometry', radius => {
    const sketch = createPlateDocument().parts[0]!.sketch;
    const before = structuredClone(sketch);
    expect(filletLineCorners(sketch, { cornerPointIds: [linesOf(sketch)[0]!.endId], radius }).ok).toBe(false);
    expect(sketch).toEqual(before);
  });

  it('resolves adjacent edge pairs or point selections once and rejects unsupported/isolated selections', () => {
    const sketch = createPlateDocument().parts[0]!.sketch;
    const lines = linesOf(sketch),
      corner = lines[0]!.endId;
    expect(resolveFilletCorners(sketch, [lines[0]!.id, lines[1]!.id, corner, corner])).toEqual({
      ok: true,
      cornerPointIds: [pointEquivalence(sketch.constraints).canonical(corner)],
    });
    expect(resolveFilletCorners(sketch, [lines[0]!.id, lines[2]!.id]).ok).toBe(false);
    expect(resolveFilletCorners(sketch, [lines[0]!.id]).ok).toBe(false);
    expect(resolveFilletCorners(sketch, ['missing']).ok).toBe(false);
    expect(filletLineCorners(sketch, { cornerPointIds: [corner], radius: 8, sharedRadiusConstraintId: 'missing' }).ok).toBe(false);
  });

  it('rejects a line/arc corner and a branch without deleting or approximating existing curves', () => {
    const document = createCadDocument();
    const part = createCadPart();
    document.parts.push(part);
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 40, y2: 0 });
    part.sketch = addArc(part.sketch, { cx: 40, cy: 20, radius: 20, startAngle: -Math.PI / 2, endAngle: Math.PI / 2 });
    const line = linesOf(part.sketch)[0]!;
    const before = structuredClone(part.sketch);
    expect(filletLineCorners(part.sketch, { cornerPointIds: [line.endId], radius: 5 }).ok).toBe(false);
    expect(part.sketch).toEqual(before);
    part.sketch = addLine(part.sketch, { x1: 40, y1: 0, x2: 60, y2: -20 });
    expect(filletLineCorners(part.sketch, { cornerPointIds: [line.endId], radius: 5 }).ok).toBe(false);
  });
});
