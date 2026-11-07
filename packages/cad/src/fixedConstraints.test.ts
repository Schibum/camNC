import { describe, expect, it } from 'vitest';
import {
  addArc,
  addCircle,
  addConstraint,
  addPoint,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  solveCadDocument,
} from './index';
import type { CadConstraint, CadDocument } from './types';

function fixedPlate() {
  const document = createPlateDocument();
  document.parts[0]!.sketch.entities = document.parts[0]!.sketch.entities.map(e => (e.type === 'point' ? { ...e, fixed: true } : e));
  return document;
}
const append = (document: CadDocument, constraint: Omit<Extract<CadConstraint, { type: 'positionX' | 'positionY' }>, 'id'>) => {
  document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, constraint);
};

describe('constant relationships on fixed geometry', () => {
  it('accepts matching fixed relationships but detects a changed length dimension before native zero-unknown filtering', async () => {
    const document = fixedPlate();
    expect((await solveCadDocument(document)).status).toBe('solved');
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    if (!('value' in width)) throw new Error('Fixture');
    width.value = 150;
    const result = await solveCadDocument(document);
    expect(result.status).toBe('conflict');
    expect(result.diagnostics.some(d => d.constraintIds?.includes(width.id))).toBe(true);
    expect(result.parts).toEqual([]);
  });

  it.each(['horizontal', 'vertical'] as const)('rejects a contradictory %s relationship on a fully fixed line', async type => {
    const document = fixedPlate();
    const line = document.parts[0]!.sketch.entities.filter(e => e.type === 'line')[type === 'horizontal' ? 1 : 0]!;
    document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, { type, entityId: line.id });
    const id = document.parts[0]!.sketch.constraints.at(-1)!.id;
    const result = await solveCadDocument(document);
    expect(result.status).toBe('conflict');
    expect(result.diagnostics.some(d => d.constraintIds?.includes(id))).toBe(true);
  });

  it.each(['horizontalPoints', 'verticalPoints', 'coincident', 'distance', 'distanceX', 'distanceY'] as const)(
    'checks fixed %s point-pair relationships',
    async type => {
      const document = fixedPlate();
      const points = document.parts[0]!.sketch.entities.filter(e => e.type === 'point');
      const a = points.find(point => point.x === 0 && point.y === 0)!,
        b = points.find(point => point.x === 120 && point.y === 80)!;
      const constraint =
        type === 'distance' || type === 'distanceX' || type === 'distanceY'
          ? { type, pointAId: a.id, pointBId: b.id, value: 7 }
          : { type, pointAId: a.id, pointBId: b.id };
      document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, constraint);
      const result = await solveCadDocument(document);
      expect(result.status).toBe('conflict');
      expect(result.diagnostics.at(-1)?.constraintIds).toContain(document.parts[0]!.sketch.constraints.at(-1)!.id);
    }
  );

  it.each(['positionX', 'positionY'] as const)('checks fixed %s values without treating free points as fixed', async type => {
    const document = fixedPlate();
    const origin = document.parts[0]!.sketch.entities[0]!;
    append(document, { type, pointId: origin.id, value: 3 });
    const result = await solveCadDocument(document);
    expect(result.status).toBe('conflict');
    const free = createPlateDocument();
    free.parts[0]!.sketch = addPoint(free.parts[0]!.sketch, { x: 20, y: 20 });
    const point = free.parts[0]!.sketch.entities.at(-1)!;
    append(free, { type, pointId: point.id, value: 3 });
    const solved = await solveCadDocument(free);
    expect(solved.status).toBe('solved');
    const changed = solved.document.parts[0]!.sketch.entities.find(e => e.id === point.id)!;
    expect(changed.type === 'point' && (type === 'positionX' ? changed.x : changed.y)).toBeCloseTo(3, 8);
  });

  it.each(['pointOnLine', 'midpoint'] as const)('rejects a wrong fixed-point %s relation and accepts a matching one', async type => {
    const document = fixedPlate();
    const line = document.parts[0]!.sketch.entities.find(e => e.type === 'line')!;
    document.parts[0]!.sketch = addPoint(document.parts[0]!.sketch, { x: 60, y: 5, fixed: true });
    const point = document.parts[0]!.sketch.entities.at(-1)!;
    if (point.type !== 'point') throw new Error('Fixture');
    document.parts[0]!.sketch = addConstraint(document.parts[0]!.sketch, { type, pointId: point.id, entityId: line.id });
    const bad = await solveCadDocument(document);
    expect(bad.status).toBe('conflict');
    expect(bad.diagnostics.at(-1)?.constraintIds).toContain(document.parts[0]!.sketch.constraints.at(-1)!.id);
    point.y = 0;
    const good = await solveCadDocument(document);
    expect(good.status, JSON.stringify(good.diagnostics)).toBe('solved');
  });

  it('does not infer a fixed radius from a fixed circle center', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addCircle(part.sketch, { x: 0, y: 0, radius: 8 });
    const circle = part.sketch.entities.find(e => e.type === 'circle')!;
    part.sketch = addConstraint(part.sketch, { type: 'radius', entityId: circle.id, value: 12 });
    document.parts.push(part);
    const result = await solveCadDocument(document);
    expect(result.status).toBe('solved');
    expect(result.document.parts[0]!.sketch.entities.find(e => e.id === circle.id)).toMatchObject({ radius: 12 });
  });
});

describe('native radius drag intent', () => {
  it('resizes a free circle circumference even when its center is the fixed origin', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addCircle(part.sketch, { x: 0, y: 0, radius: 10 });
    const circle = part.sketch.entities.find(e => e.type === 'circle')!;
    document.parts.push(part);
    const result = await solveCadDocument(document, { radiusDrag: { entityId: circle.id, radius: 15 } });
    expect(result.status).toBe('solved');
    expect(result.document.parts[0]!.sketch.entities.find(e => e.id === circle.id)).toMatchObject({ radius: 15 });
    expect(result.document.parts[0]!.sketch.entities.find(e => e.type === 'point' && e.fixed)).toMatchObject({ x: 0, y: 0 });
    expect(result.document.parts[0]!.sketch.constraints).toEqual([]);
  });

  it('keeps a driving diameter stronger than the temporary radius drag', async () => {
    const document = createCadDocument();
    const part = createCadPart();
    part.sketch = addCircle(part.sketch, { x: 0, y: 0, radius: 10, dimensioned: true });
    const circle = part.sketch.entities.find(e => e.type === 'circle')!;
    document.parts.push(part);
    const result = await solveCadDocument(document, { radiusDrag: { entityId: circle.id, radius: 15 } });
    expect(result.status).toBe('solved');
    expect(result.document.parts[0]!.sketch.entities.find(e => e.id === circle.id)).toMatchObject({ radius: 10 });
    expect(result.document.parts[0]!.sketch.constraints).toEqual(part.sketch.constraints);
  });

  it('resizes a free arc radius while preserving the fixed center and native arc endpoint rules', async () => {
    const document = createPlateDocument();
    const part = document.parts[0]!;
    part.sketch = addArc(part.sketch, { cx: 0, cy: 0, radius: 10, startAngle: 0, endAngle: Math.PI / 2, construction: true });
    const arc = part.sketch.entities.find(e => e.type === 'arc')!;
    if (arc.type !== 'arc') throw new Error('Fixture');
    const result = await solveCadDocument(document, { radiusDrag: { entityId: arc.id, radius: 15 } });
    expect(result.status).toBe('solved');
    expect(result.document.parts[0]!.sketch.entities.find(e => e.id === arc.id)).toMatchObject({ radius: 15 });
    for (const id of [arc.startId, arc.endId]) {
      const endpoint = result.document.parts[0]!.sketch.entities.find(e => e.id === id)!;
      expect(endpoint.type === 'point' && Math.hypot(endpoint.x, endpoint.y)).toBeCloseTo(15, 6);
    }
    expect(result.document.parts[0]!.sketch.entities.find(e => e.id === arc.centerId)).toMatchObject({ x: 0, y: 0, fixed: true });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])('rejects invalid radius drag %s', async radius => {
    const document = createPlateDocument();
    const result = await solveCadDocument(document, { radiusDrag: { entityId: 'unknown', radius } });
    expect(result.status).toBe('invalid');
    expect(result.diagnostics.some(d => d.code === 'invalid-drag')).toBe(true);
  });
});
