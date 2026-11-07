import type { EvaluatedCadPart } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { designGeometryFingerprint, designGeometryKey } from './designGeometry';

const shape = (x0: number, y0: number, x1: number, y1: number): EvaluatedCadPart => ({
  partId: 'part',
  name: 'Plate',
  thickness: 12,
  outline: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
  holes: [
    [
      { x: 59, y: 39 },
      { x: 61, y: 39 },
      { x: 61, y: 41 },
      { x: 59, y: 41 },
    ],
  ],
  loops: [],
});
describe('native geometry identity', () => {
  it('recognizes a boundary resize independently of its absolute sketch origin', () => {
    const before = shape(20, 10, 120, 70),
      after = shape(0, 5, 120, 100);
    expect(designGeometryFingerprint(after)).not.toBe(designGeometryFingerprint(before));
  });

  it('ignores a translation of the entire sketch for manufacturing placement and geometry identity', () => {
    const before = shape(20, 10, 120, 70);
    const translate = (p: { x: number; y: number }) => ({ x: p.x + 17, y: p.y - 9 });
    const after = {
      ...before,
      name: 'Renamed plate',
      outline: before.outline.map(translate),
      holes: before.holes.map(h => h.map(translate)),
    };
    expect(designGeometryFingerprint(after)).toBe(designGeometryFingerprint(before));
  });

  it('binds physical content keys to the evaluated outline, holes and thickness', async () => {
    const part = shape(20, 10, 120, 70);
    const key = await designGeometryKey(part);
    expect(key).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await designGeometryKey({ ...part, name: 'Renamed' })).toBe(key);
    expect(await designGeometryKey({ ...part, thickness: 18 })).not.toBe(key);
    expect(await designGeometryKey({ ...part, holes: [] })).not.toBe(key);
    expect(await designGeometryKey({ ...part, holes: part.holes.map(hole => hole.map(point => ({ ...point, x: point.x + 1 }))) })).not.toBe(
      key
    );
    expect(await designGeometryKey(shape(20, 10, 130, 70))).not.toBe(key);
  });
});
