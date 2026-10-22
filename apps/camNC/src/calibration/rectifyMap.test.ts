import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Matrix3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { initUndistortRectifyMapTyped, Matrix3x3 } from './rectifyMap';
import { initUndistortRectifyMapCv } from './rectifyMapCv';

describe('initUndistortRectifyMapTyped', () => {
  beforeAll(async () => {
    await ensureOpenCvIsLoaded();
  });

  it('matches cv.initUndistortRectifyMap', () => {
    const size = { width: 64, height: 48 };
    const K: Matrix3x3 = [
      [60, 0, 31.5],
      [0, 62, 23.5],
      [0, 0, 1],
    ];
    // prettier-ignore
    const Kthree = new Matrix3().set(
      K[0][0], K[0][1], K[0][2],
      K[1][0], K[1][1], K[1][2],
      K[2][0], K[2][1], K[2][2]
    );
    // prettier-ignore
    const newK = new Matrix3().set(
      55, 0, 30,
      0, 57, 22,
      0, 0, 1
    );
    const identity: Matrix3x3 = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const dist = [-0.25, 0.08, 0.001, -0.002, -0.01];

    const expected = initUndistortRectifyMapCv(K, dist, identity, newK, size);
    const actual = initUndistortRectifyMapTyped(Kthree, dist, identity, newK, size);

    let maxDiff = 0;
    for (let i = 0; i < expected.map1.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(expected.map1[i] - actual.map1[i]), Math.abs(expected.map2[i] - actual.map2[i]));
    }
    expect(maxDiff).toBeLessThan(1e-3);
  });
});
