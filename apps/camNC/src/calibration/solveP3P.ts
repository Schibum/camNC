import { cv2 } from '@wbcnc/load-opencv';
import { Matrix3, Vector2, Vector3 } from 'three';
import { cvToMatrix3, cvToVector2, cvToVector3, matrix3ToCV } from '../lib/three-cv';

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

export function computeP3P(mp: Vector3[], markersInCam: Vector2[], newCamMatrix: Matrix3) {
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

  // Call solvePnP using the AP3P flag
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

  const reprojectedPoints = new cv2.Mat();
  cv2.projectPoints(objectPoints, rvec, tvec, cameraMatrix, distCoeffs, reprojectedPoints);
  const reprojectionError = computeReprojectionError(reprojectedPoints, markersInCam);
  console.log('reprojectionError', reprojectionError);
  // Convert rotation vector to rotation matrix
  const R = new cv2.Mat();
  cv2.Rodrigues(rvec, R);

  const threeR = cvToMatrix3(R);
  const threeT = cvToVector3(tvec);

  rvec.delete();
  tvec.delete();
  R.delete();

  return { R: threeR, t: threeT, reprojectionError };
}

function computeReprojectionError(reprojectedPoints: cv2.Mat, markersInCam: Vector2[]) {
  let error = 0;
  for (let i = 0; i < reprojectedPoints.rows; i++) {
    const reprojectedPoint = cvToVector2(reprojectedPoints.row(i));
    const markerPoint = markersInCam[i];
    error += reprojectedPoint.distanceTo(markerPoint);
  }
  return error / reprojectedPoints.rows;
}
