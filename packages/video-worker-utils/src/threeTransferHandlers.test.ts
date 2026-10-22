import * as Comlink from 'comlink';
import { Matrix3, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerThreeJsTransferHandlers } from './threeTransferHandlers';

function getHandler() {
  return Comlink.transferHandlers.get('THREE.DEEP')!;
}

describe('registerThreeJsTransferHandlers', () => {
  beforeAll(() => {
    registerThreeJsTransferHandlers();
  });

  it('round-trips nested Matrix3 and Vector3 values', () => {
    const handler = getHandler();
    const value = { calibration: { K: new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 9), dist: [0.1, 0.2] }, points: [new Vector3(1, 2, 3)] };
    expect(handler.canHandle(value)).toBe(true);

    const [wire] = handler.serialize(value);
    // Must survive structured cloning.
    const result = handler.deserialize(structuredClone(wire)) as typeof value;
    expect(result.calibration.K).toBeInstanceOf(Matrix3);
    expect(result.calibration.K.equals(value.calibration.K)).toBe(true);
    expect(result.calibration.dist).toEqual([0.1, 0.2]);
    expect(result.points[0]).toBeInstanceOf(Vector3);
    expect(result.points[0]!.equals(value.points[0]!)).toBe(true);
  });

  it('ignores values without three.js objects', () => {
    expect(getHandler().canHandle({ a: [1, 2, { b: 'c' }] })).toBe(false);
  });

  it('keeps typed arrays intact', () => {
    const handler = getHandler();
    const map = new Float32Array([1, 2, 3]);
    const [wire] = handler.serialize({ map, v: new Vector3() });
    const result = handler.deserialize(structuredClone(wire)) as { map: Float32Array };
    expect(result.map).toBeInstanceOf(Float32Array);
    expect(Array.from(result.map)).toEqual([1, 2, 3]);
  });

  it('handles cyclic objects', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    expect(getHandler().canHandle(obj)).toBe(false);
  });
});
