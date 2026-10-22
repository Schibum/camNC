import { cv2 } from '@wbcnc/load-opencv';
import { Matrix3, Vector2, Vector3 } from 'three';
import { cvToMatrix3, cvToVector3, matrix3ToCV } from '../lib/three-cv';

// Return 3d machine bound points as 3d CV Mat
export function markerMachinePosToCv(mp: Vector3[]) {
  if (mp.length < 4) {
    throw new Error('Must have at least 4 marker positions');
  }
  // Create 3D object points
  const objectPoints = cv2.matFromArray(
    mp.length,
    3,
    cv2.CV_64F,
    mp.flatMap(point => [point.x, point.y, point.z])
  );
  return objectPoints;
}

/**
 * Project 3D points with a pinhole camera model (no distortion), equivalent to
 * cv.projectPoints with zero distortion coefficients.
 */
export function projectPoints(points: Vector3[], cameraMatrix: Matrix3, R: Matrix3, t: Vector3): Vector2[] {
  return points.map(point => {
    const p = point.clone().applyMatrix3(R).add(t).applyMatrix3(cameraMatrix);
    return new Vector2(p.x / p.z, p.y / p.z);
  });
}

export function computeP3P(mp: Vector3[], markersInCam: Vector2[], newCamMatrix: Matrix3) {
  if (mp.length !== markersInCam.length) {
    throw new Error(`Got ${markersInCam.length} image points for ${mp.length} marker positions`);
  }
  const objectPoints = markerMachinePosToCv(mp);
  const imagePoints = cv2.matFromArray(
    markersInCam.length,
    2,
    cv2.CV_64F,
    markersInCam.flatMap(m => [m.x, m.y])
  );
  const cameraMatrix = matrix3ToCV(newCamMatrix);
  // Use zeros for distortion coefficients since we're using the undistorted camera matrix
  const distCoeffs = cv2.Mat.zeros(1, 5, cv2.CV_64F);
  // Create empty output matrices for the rotation and translation vectors
  const rvec = new cv2.Mat();
  const tvec = new cv2.Mat();
  const R = new cv2.Mat();

  try {
    const success = cv2.solvePnP(
      objectPoints,
      imagePoints,
      cameraMatrix,
      distCoeffs,
      rvec,
      tvec,
      false,
      // cv2.SOLVEPNP_AP3P
      // cv2.SOLVEPNP_IPPE
      (cv2 as any).SOLVEPNP_SQPNP
    );

    if (!success) {
      throw new Error('solvePnP failed to find a valid pose.');
    }

    // Convert rotation vector to rotation matrix
    cv2.Rodrigues(rvec, R);
    const threeR = cvToMatrix3(R);
    const threeT = cvToVector3(tvec);
    const reprojectionError = computeReprojectionError(projectPoints(mp, newCamMatrix, threeR, threeT), markersInCam);
    return { R: threeR, t: threeT, reprojectionError };
  } finally {
    objectPoints.delete();
    imagePoints.delete();
    cameraMatrix.delete();
    distCoeffs.delete();
    rvec.delete();
    tvec.delete();
    R.delete();
  }
}

function computeReprojectionError(reprojectedPoints: Vector2[], markersInCam: Vector2[]) {
  let error = 0;
  for (let i = 0; i < reprojectedPoints.length; i++) {
    error += reprojectedPoints[i].distanceTo(markersInCam[i]);
  }
  return error / reprojectedPoints.length;
}
