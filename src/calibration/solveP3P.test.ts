import { cv2, ensureOpenCvIsLoaded } from '@/lib/loadOpenCv';
import { cvToVector2, matrix3ToCV, vector3ToCV } from '@/lib/three-cv';
import { IBox, ITuple } from '@/store';
import _cv from '@techstark/opencv-js';
import { Box2, Matrix3, Vector2, Vector3 } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeP3P } from './solveP3P';

// Avoid dynamic import of ensureOpenCvIsLoaded
vi.stubGlobal('cv', _cv);

describe('computeP3P', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await ensureOpenCvIsLoaded();
  });

  it('should stub cv', async () => {
    expect(cv2.Mat).toBe(_cv.Mat);
  });

  it('should compute P3P solution with valid inputs', () => {
    console.log(process.env.NODE_ENV);
    // Define inputs based on Python example
    const dimensions: ITuple = [2560, 1920]; // Image dimensions

    // Machine bounds (in machine coordinates)
    const mp = new Box2(new Vector2(0, 0), new Vector2(623, 1243));

    // Image points - corners2 from Python example
    const machineBoundsInCam: IBox = [
      [1570, 418],
      [2209, 1599],
      [901, 1893],
      [959, 456],
    ];

    const camMatrix = new Matrix3().set(
      // prettier-ignore
      1576.70915,
      0.0,
      1481.05363,
      0.0,
      1717.4288,
      969.448282,
      0.0,
      0.0,
      1.0
    );

    // Call the function
    const result = computeP3P(dimensions, mp, machineBoundsInCam, camMatrix);

    const objectPoints = cv2.matFromArray(4, 3, cv2.CV_32F, [0, 0, 0, 0, mp.max.y, 0, mp.max.x, mp.max.y, 0, mp.max.x, 0, 0]);

    // Calculate reprojection error to evaluate the quality of the pose estimation
    const error = computeReprojectionError(result.R, result.t, camMatrix, objectPoints, machineBoundsInCam);
    expect(error).toBeLessThan(3);
  });
});

function computeReprojectionError(R: Matrix3, t: Vector3, camMatrix: Matrix3, objectPoints: _cv.Mat, machineBoundsInCam: IBox) {
  const Rcv = matrix3ToCV(R);
  const rvec = new cv2.Mat();
  cv2.Rodrigues(Rcv, rvec);
  const tvec = vector3ToCV(t);
  const distCoeffs = cv2.Mat.zeros(5, 1, cv2.CV_32F);
  const cameraMatrix = matrix3ToCV(camMatrix);
  const reprojectedPoints = new cv2.Mat();
  cv2.projectPoints(objectPoints, rvec, tvec, cameraMatrix, distCoeffs, reprojectedPoints);

  let error = 0;
  for (let i = 0; i < reprojectedPoints.rows; i++) {
    const reprojectedPoint = cvToVector2(reprojectedPoints.row(i));
    const machinePoint = new Vector2(machineBoundsInCam[i][0], machineBoundsInCam[i][1]);
    error += reprojectedPoint.distanceTo(machinePoint);
  }
  reprojectedPoints.delete();
  return error;
}
