// import _cv from '@techstark/opencv-js';
import { cv2, ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Matrix3, Vector2, Vector3 } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { matrix3ToCV, vector3ToCV } from '../lib/three-cv';
import { computeP3P, markerMachinePosToCv, projectPoints } from './solveP3P';

// Avoid dynamic import of ensureOpenCvIsLoaded
// vi.stubGlobal('cv', _cv);

describe('computeP3P', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await ensureOpenCvIsLoaded();
  });

  it('should compute P3P solution with valid inputs', () => {
    // Define inputs based on Python example

    // Machine bounds (in machine coordinates)
    const mp = [new Vector3(0, 0, 0), new Vector3(0, 1243, 0), new Vector3(623, 1243, 0), new Vector3(623, 0, 0)];

    // Image points - corners2 from Python example
    const markersInCam: Vector2[] = [new Vector2(1570, 418), new Vector2(2209, 1599), new Vector2(901, 1893), new Vector2(959, 456)];

    // prettier-ignore
    const camMatrix = new Matrix3().set(
      1576.70915, 0.0, 1481.05363,
      0.0, 1717.4288, 969.448282,
      0.0, 0.0, 1.0
    );

    // Call the function
    const result = computeP3P(mp, markersInCam, camMatrix);
    expect(result.reprojectionError).toBeLessThan(1);
  });

  it('throws if the number of image points does not match the marker positions', () => {
    const mp = [new Vector3(0, 0, 0), new Vector3(0, 1, 0), new Vector3(1, 1, 0), new Vector3(1, 0, 0)];
    const markersInCam = [new Vector2(0, 0), new Vector2(0, 1), new Vector2(1, 1)];
    expect(() => computeP3P(mp, markersInCam, new Matrix3())).toThrow(/3 image points for 4 marker positions/);
  });
});

describe('projectPoints', () => {
  beforeEach(async () => {
    await ensureOpenCvIsLoaded();
  });

  it('matches cv.projectPoints without distortion', () => {
    const points = [new Vector3(0, 0, 0), new Vector3(100, 0, 0), new Vector3(100, 200, 5), new Vector3(-30, 50, -10)];
    // prettier-ignore
    const K = new Matrix3().set(
      1500, 0, 960,
      0, 1600, 540,
      0, 0, 1
    );
    const R = new Matrix3()
      .makeRotation(0.3)
      .multiply(new Matrix3().set(1, 0, 0, 0, Math.cos(2.8), -Math.sin(2.8), 0, Math.sin(2.8), Math.cos(2.8)));
    const t = new Vector3(-50, 80, 1200);

    const objectPoints = markerMachinePosToCv(points);
    const Kcv = matrix3ToCV(K);
    const rvec = new cv2.Mat();
    const Rcv = matrix3ToCV(R);
    cv2.Rodrigues(Rcv, rvec);
    const tcv = vector3ToCV(t);
    const distCoeffs = cv2.Mat.zeros(1, 5, cv2.CV_64F);
    const expected = new cv2.Mat();
    cv2.projectPoints(objectPoints, rvec, tcv, Kcv, distCoeffs, expected);

    const actual = projectPoints(points, K, R, t);
    actual.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected.data64F[i * 2], 6);
      expect(p.y).toBeCloseTo(expected.data64F[i * 2 + 1], 6);
    });

    [objectPoints, Kcv, rvec, Rcv, tcv, distCoeffs, expected].forEach(m => m.delete());
  });
});
