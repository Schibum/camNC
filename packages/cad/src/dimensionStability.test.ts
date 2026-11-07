import { readFileSync } from 'node:fs';
import { Algorithm, GcsWrapper } from '@salusoft89/planegcs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addConstraint, addLine, createCadDocument, createCadPart, createPlateDocument, solveCadDocument, updateDimension } from './index';
import type { CadDocument, CadPointEntity } from './types';

function capsule(): CadDocument {
  return JSON.parse(readFileSync(new URL('./fixtures/capsule-stability.json', import.meta.url), 'utf8')) as CadDocument;
}

afterEach(() => vi.restoreAllMocks());

describe('underconstrained dimension editing', () => {
  it('changes the captured capsule length without collapsing its undimensioned arc radii', async () => {
    const document = capsule();
    const length = document.parts[0]!.sketch.constraints.find(constraint => constraint.type === 'distance')!;
    const before = structuredClone(document);
    const solved = await solveCadDocument(updateDimension(document, length.id, 80));
    expect(solved.status, JSON.stringify(solved.diagnostics)).toBe('solved');
    expect(solved.parts[0]!.loops).toHaveLength(1);
    for (const arc of solved.document.parts[0]!.sketch.entities.filter(entity => entity.type === 'arc')) {
      expect(arc.radius).toBeGreaterThan(20);
      expect(arc.radius).toBeLessThan(22);
    }
    expect(solved.sketches[0]!.dof).toBe(2);
    const points = new Map(
      solved.document.parts[0]!.sketch.entities.filter((entity): entity is CadPointEntity => entity.type === 'point').map(entity => [
        entity.id,
        entity,
      ])
    );
    if (!('pointAId' in length)) throw new Error('Expected length');
    const a = points.get(length.pointAId)!,
      b = points.get(length.pointBId)!;
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(80, 6);
    expect(solved.document.parts[0]!.sketch.constraints).toEqual(updateDimension(document, length.id, 80).parts[0]!.sketch.constraints);
    expect(document).toEqual(before);
  });

  it('retries from detached source primitives even if the native wrapper mutates its input objects', async () => {
    const push = GcsWrapper.prototype.push_primitives_and_params;
    const radii: number[][] = [];
    vi.spyOn(GcsWrapper.prototype, 'push_primitives_and_params').mockImplementation(function (this: GcsWrapper, primitives) {
      radii.push(primitives.filter(primitive => primitive.type === 'arc').map(primitive => primitive.radius));
      push.call(this, primitives);
      // The native wrapper retains supplied objects. Exercise a mutation of the first attempt's copy.
      if (radii.length === 1) for (const primitive of primitives) if (primitive.type === 'arc') primitive.radius = 1e-12;
    });
    const document = capsule();
    const before = structuredClone(document);
    const length = document.parts[0]!.sketch.constraints.find(constraint => constraint.type === 'distance')!;
    const result = await solveCadDocument(updateDimension(document, length.id, 80));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(radii.filter(values => values.length)).toEqual([
      [21, 21],
      [21, 21],
    ]);
    expect(document).toEqual(before);
  });

  it('lets a driving radius change the shape after the length-only edit', async () => {
    const document = capsule();
    const part = document.parts[0]!;
    const length = part.sketch.constraints.find(constraint => constraint.type === 'distance')!;
    const extended = await solveCadDocument(updateDimension(document, length.id, 80));
    expect(extended.status, JSON.stringify(extended.diagnostics)).toBe('solved');
    const arc = extended.document.parts[0]!.sketch.entities.find(entity => entity.type === 'arc')!;
    extended.document.parts[0]!.sketch = addConstraint(extended.document.parts[0]!.sketch, { type: 'radius', entityId: arc.id, value: 24 });
    const resized = await solveCadDocument(extended.document);
    expect(resized.status, JSON.stringify(resized.diagnostics)).toBe('solved');
    expect(resized.document.parts[0]!.sketch.entities.find(entity => entity.id === arc.id)).toMatchObject({ radius: 24 });
    expect(resized.parts[0]!.loops).toHaveLength(1);
  });

  it('does not retry an ordinary open profile or mistake it for invalid native geometry', async () => {
    const spy = vi.spyOn(GcsWrapper.prototype, 'solve');
    const document = createCadDocument();
    const part = createCadPart();
    document.parts.push(part);
    part.sketch = addLine(part.sketch, { x1: 0, y1: 0, x2: 40, y2: 10 });
    const result = await solveCadDocument(document);
    expect(result.status).toBe('invalid');
    expect(result.sketches[0]!.status).toBe('solved');
    expect(result.diagnostics.some(diagnostic => diagnostic.code === 'open-profile')).toBe(true);
    expect(spy.mock.calls.map(([algorithm]) => algorithm)).toEqual([Algorithm.DogLeg]);
  });

  it('reports a real driving conflict without retrying it away', async () => {
    const spy = vi.spyOn(GcsWrapper.prototype, 'solve');
    const document = createPlateDocument();
    const part = document.parts[0]!;
    const width = part.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    if (!('pointAId' in width)) throw new Error('Expected width');
    part.sketch = addConstraint(part.sketch, {
      id: 'wrong-width',
      type: 'distanceX',
      pointAId: width.pointAId,
      pointBId: width.pointBId,
      value: 140,
    });
    const result = await solveCadDocument(document);
    expect(result.status).toBe('conflict');
    expect(result.diagnostics.some(diagnostic => diagnostic.code === 'constraint-conflict')).toBe(true);
    expect(spy.mock.calls.map(([algorithm]) => algorithm)).toEqual([Algorithm.DogLeg]);
  });

  it('recovers a valid underconstrained part while another part has an independent native conflict', async () => {
    const document = capsule();
    const length = document.parts[0]!.sketch.constraints.find(constraint => constraint.type === 'distance')!;
    const other = createPlateDocument().parts[0]!;
    const width = other.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    if (!('pointAId' in width)) throw new Error('Expected width');
    other.sketch = addConstraint(other.sketch, { type: 'distanceX', pointAId: width.pointAId, pointBId: width.pointBId, value: 140 });
    document.parts.push(other);
    const result = await solveCadDocument(updateDimension(document, length.id, 80));
    expect(result.status).toBe('conflict');
    expect(result.sketches).toEqual([
      { partId: document.parts[0]!.id, status: 'solved', dof: 2 },
      expect.objectContaining({ partId: other.id, status: 'conflict' }),
    ]);
    for (const arc of result.document.parts[0]!.sketch.entities.filter(entity => entity.type === 'arc')) {
      expect(arc.radius).toBeGreaterThan(20);
      expect(arc.radius).toBeLessThan(22);
    }
    expect(result.parts).toEqual([]);
  });
});
