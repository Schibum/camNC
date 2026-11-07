import { describe, expect, it } from 'vitest';
import { createCadDocument, createCadPart } from './document';
import { evaluateCadPart } from './geometry';
import { solveCadDocument } from './solver';
import type { CadPart, CadPointEntity, CadSplineEntity } from './types';

/** Minimal exact source exported from the 1440px real-pointer spline/closure rehearsal. */
function capturedPart(): CadPart {
  const part = createCadPart('Captured spline closure', 18);
  const coordinates: Record<string, [number, number]> = {
    start: [20.000002799777818, 19.999994400444393],
    fit1: [49.99999440044445, 100.00000000000007],
    fit2: [90.0000055995557, 49.9999944004445],
    end: [130, 19.999994400444393],
    pole1: [34.99999235932941, 19.999989332927193],
    pole2: [32.37763300904306, 120.72147246970204],
    pole3: [77.50250879402148, 95.23429059667518],
    pole4: [95.18102655024406, 22.475191982338135],
    pole5: [116.99823925174724, 28.59544203610048],
    fitExtra: [79.10094143267169, 80.69982611430599],
  };
  part.sketch.entities.push(
    ...Object.entries(coordinates).map(([id, [x, y]]): CadPointEntity => ({ id, type: 'point', x, y })),
    {
      id: 'spline',
      type: 'spline',
      startId: 'start',
      endId: 'end',
      controlPointIds: ['start', 'pole1', 'pole2', 'pole3', 'pole4', 'pole5', 'end'],
      fitPointIds: ['start', 'fit1', 'fitExtra', 'fit2', 'end'],
      fitParameters: [0, 0.4014915998708699, 0.5987063906573773, 0.7007458401520071, 1],
      degree: 3,
      knots: [0, 0, 0, 0, 0.4014915998708699, 0.5987063906573773, 0.7007458401520071, 1, 1, 1, 1],
      weights: [1, 1, 1, 1, 1, 1, 1],
      closed: false,
    },
    { id: 'closure', type: 'line', startId: 'end', endId: 'start' }
  );
  return part;
}
function point(part: CadPart, id: string) {
  return part.sketch.entities.find(entity => entity.id === id)! as CadPointEntity;
}
const blocked = (part: CadPart) => evaluateCadPart(part).diagnostics.some(diagnostic => diagnostic.code === 'intersecting-profiles');

describe('numerically degenerate contacts at joined spline endpoints', () => {
  it('accepts the captured pointer closure whose endpoint sliver is only 2.85e-13 mm deep', () => {
    const part = capturedPart();
    const before = structuredClone(part);
    const result = evaluateCadPart(part);
    expect(result.diagnostics).toEqual([]);
    expect(result.part?.loops).toHaveLength(1);
    expect(part).toEqual(before);
  });

  it('recognizes an explicit coincident endpoint without replacing either source point ID', () => {
    const part = capturedPart();
    part.sketch.entities.push({ ...point(part, 'start'), id: 'closure-start' });
    const closure = part.sketch.entities.find(entity => entity.id === 'closure')!;
    if (closure.type !== 'line') throw Error('Expected closure');
    closure.endId = 'closure-start';
    part.sketch.constraints.push({ id: 'join', type: 'coincident', pointAId: 'start', pointBId: 'closure-start' });
    expect(evaluateCadPart(part).diagnostics).toEqual([]);
    expect(closure.endId).toBe('closure-start');
  });

  it('accepts the same captured source through the actual native-solve and CAM-profile boundary', async () => {
    const document = createCadDocument('Captured spline');
    document.parts.push(capturedPart());
    const result = await solveCadDocument(document);
    expect(result.status).toBe('solved');
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.loops).toHaveLength(1);
  });

  it('recognizes the same sliver at the reversed final endpoint', () => {
    const part = capturedPart();
    const spline = part.sketch.entities.find(entity => entity.id === 'spline')! as CadSplineEntity;
    [spline.startId, spline.endId] = [spline.endId, spline.startId];
    spline.controlPointIds.reverse();
    spline.fitPointIds.reverse();
    spline.fitParameters = spline.fitParameters.map(t => 1 - t).reverse();
    spline.knots = spline.knots.map(t => 1 - t).reverse();
    spline.weights.reverse();
    expect(evaluateCadPart(part).diagnostics).toEqual([]);
  });

  it.each([
    { angle: 0.71, x: 10_000, y: -20_000 },
    { angle: Math.PI / 2, x: 0, y: 0 },
  ])('uses the same normal-distance proof at rotated/translated pose %j', pose => {
    const transform = (part: CadPart) => {
      for (const entity of part.sketch.entities)
        if (entity.type === 'point' && !entity.fixed) {
          const { x, y } = entity;
          entity.x = pose.x + x * Math.cos(pose.angle) - y * Math.sin(pose.angle);
          entity.y = pose.y + x * Math.sin(pose.angle) + y * Math.cos(pose.angle);
        }
      return part;
    };
    expect(evaluateCadPart(transform(capturedPart())).diagnostics).toEqual([]);
    const genuine = capturedPart();
    point(genuine, 'pole1').y = point(genuine, 'start').y - 1e-3;
    expect(blocked(transform(genuine))).toBe(true);
  });

  it.each([1e-3, 0.02])('retains a genuine near-endpoint crossing with pole depth %s mm', depth => {
    const part = capturedPart();
    point(part, 'pole1').y = point(part, 'start').y - depth;
    expect(blocked(part)).toBe(true);
  });

  it('does not merge separate near-end contacts merely because endpoint coordinates happen to agree', () => {
    const part = capturedPart();
    part.sketch.entities.push({ ...point(part, 'start'), id: 'unrelated-start' });
    const closure = part.sketch.entities.find(entity => entity.id === 'closure')!;
    if (closure.type !== 'line') throw Error('Expected closure');
    closure.endId = 'unrelated-start';
    expect(blocked(part)).toBe(true);
  });

  it('keeps a later interior crossing even when the first endpoint is genuinely joined', () => {
    const part = capturedPart();
    point(part, 'pole1').y = point(part, 'start').y + 1e-3;
    point(part, 'pole2').y = point(part, 'start').y - 10;
    expect(blocked(part)).toBe(true);
  });

  it('continues rejecting a spline support overlapping its closure', () => {
    const part = capturedPart();
    const spline = part.sketch.entities.find(entity => entity.id === 'spline')! as CadSplineEntity;
    for (const id of spline.controlPointIds) point(part, id).y = point(part, 'start').y;
    expect(blocked(part)).toBe(true);
  });
});
