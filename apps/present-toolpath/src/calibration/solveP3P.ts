import { IBox, useStore } from '@/store';
import { use } from 'react';
import { Box2, Matrix3, Vector2 } from 'three';
import { cv2, ensureOpenCvIsLoaded } from '../lib/loadOpenCv';
import { cvToMatrix3, cvToVector2, cvToVector3, matrix3ToCV, vector3ToCV } from '../lib/three-cv';

function useMachineBoundsInImageCoords() {
  const machineBoundsInCam = useStore(state => state.cameraConfig.machineBoundsInCam);
  const dimensions = useStore(state => state.cameraConfig.dimensions);
  const convertToImageCoords = (bounds: IBox): IBox => {
    // In three.js, Y is up, but in image coordinates, Y is down
    // Also need to account for the origin being at the center in three.js vs top-left in image coordinates
    return bounds.map(([x, y]) => [
      // Convert X from [-width/2, width/2] to [0, width]
      x + dimensions[0] / 2,
      // Convert Y from [height/2, -height/2] to [0, height]
      dimensions[1] / 2 - y,
    ]) as IBox;
  };

  return convertToImageCoords(machineBoundsInCam);
}
function useConvertImageToThree() {
  const dimensions = useStore(state => state.cameraConfig.dimensions);
  const convertToThreeCoords = (bounds: Vector2): Vector2 => {
    return new Vector2(bounds.x - dimensions[0] / 2, dimensions[1] / 2 - bounds.y);
  };
  return convertToThreeCoords;
}

export function useComputeP3P() {
  const mp = useStore(state => state.cameraConfig.machineBounds);
  const calibrationData = useStore(state => state.calibrationData);
  const machineBoundsInImageCoords = useMachineBoundsInImageCoords();
  console.log('machineBoundsInImageCoords', machineBoundsInImageCoords);

  return () => computeP3P(mp, machineBoundsInImageCoords, calibrationData.new_camera_matrix);
}

export function useUpdateCameraExtrinsics() {
  use(ensureOpenCvIsLoaded());
  const compute = useComputeP3P();
  const setCameraExtrinsics = useStore(state => state.setCameraExtrinsics);
  return () => {
    const { R, t } = compute();
    console.log('updated camera extrinsics', R, t);
    setCameraExtrinsics({ R, t });
  };
}

export function useReprojectedMachineBounds() {
  const convertToThree = useConvertImageToThree();
  const cameraMatrix = matrix3ToCV(useStore(state => state.calibrationData.new_camera_matrix));
  const { R, t } = useStore(state => state.cameraExtrinsics);
  const Rcv = matrix3ToCV(R);
  const tcv = vector3ToCV(t);
  const distCoeffs = cv2.Mat.zeros(1, 5, cv2.CV_64F);
  const reprojectedPoints = new cv2.Mat();
  const objectPoints = machineBoundsToCv(useStore(state => state.cameraConfig.machineBounds));
  cv2.projectPoints(objectPoints, Rcv, tcv, cameraMatrix, distCoeffs, reprojectedPoints);
  const pointsThree = [];
  for (let i = 0; i < reprojectedPoints.rows; i++) {
    const reprojectedPoint = cvToVector2(reprojectedPoints.row(i));
    pointsThree.push(convertToThree(reprojectedPoint));
  }
  objectPoints.delete();
  reprojectedPoints.delete();
  distCoeffs.delete();
  Rcv.delete();
  tcv.delete();
  return pointsThree;
}

// Return 3d machine bound points as 3d CV Mat
function machineBoundsToCv(mp: Box2) {
  // Create 3D object points (assuming z=0)
  // prettier-ignore
  const objectPoints = cv2.matFromArray(4, 3, cv2.CV_64F, [
    mp.min.x, mp.min.y, 0,
    mp.min.x, mp.max.y, 0,
    mp.max.x, mp.max.y, 0,
    mp.max.x, mp.min.y, 0,
  ]);
  return objectPoints;
}

export function computeP3P(mp: Box2, machineBoundsInCam: IBox, newCamMatrix: Matrix3) {
  const objectPoints = machineBoundsToCv(mp);
  // prettier-ignore
  const imagePoints = cv2.matFromArray(4, 2, cv2.CV_64F, [
    machineBoundsInCam[0][0], machineBoundsInCam[0][1],
    machineBoundsInCam[1][0], machineBoundsInCam[1][1],
    machineBoundsInCam[2][0], machineBoundsInCam[2][1],
    machineBoundsInCam[3][0], machineBoundsInCam[3][1],
  ]);

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
  const reprojectionError = computeReprojectionError(reprojectedPoints, machineBoundsInCam);
  console.log('reprojectionError', reprojectionError);
  // Convert rotation vector to rotation matrix
  const R = new cv2.Mat();
  cv2.Rodrigues(rvec, R);

  // Convert OpenCV matrix to Three.js format
  // Both OpenCV and Three.js Matrix3.set() use row-major order
  const threeR = cvToMatrix3(R);
  const threeT = cvToVector3(tvec);

  rvec.delete();
  tvec.delete();
  R.delete();

  // threeR.set(0.04977487, 0.99875775, -0.00232803, 0.99862155, -0.04972894, 0.01679364, 0.01665701, -0.00316072, -0.99985627);
  // threeT.set(-679.60095678, -273.72803363, 1258.42778199);

  return { R: threeR, t: threeT };
}

function computeReprojectionError(reprojectedPoints: cv2.Mat, machineBoundsInCam: IBox) {
  let error = 0;
  for (let i = 0; i < reprojectedPoints.rows; i++) {
    const reprojectedPoint = cvToVector2(reprojectedPoints.row(i));
    const machinePoint = new Vector2(machineBoundsInCam[i][0], machineBoundsInCam[i][1]);
    error += reprojectedPoint.distanceTo(machinePoint);
  }
  return error / reprojectedPoints.rows;
}
