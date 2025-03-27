import { IBox, ITuple, useStore } from '@/store';
import { Box2, Matrix3, Vector3 } from 'three';
import { cv2 } from '../lib/loadOpenCv';
import { prettyPrintCv } from '../lib/prettyPrintCv';
import { cvToMatrix3, cvToVector3, matrix3ToCV } from '../lib/three-cv';
import { prettyPrintThree } from '@/lib/prettyPrintThree';
export function useComputeP3P() {
  const machineBoundsInCam = useStore(state => state.cameraConfig.machineBoundsInCam);
  const mp = useStore(state => state.cameraConfig.machineBounds);
  const calibrationData = useStore(state => state.calibrationData);
  const dimensions = useStore(state => state.cameraConfig.dimensions);
  // Convert machineBoundsInCam from three.js coordinates to regular image coordinates
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

  const machineBoundsInImageCoords = convertToImageCoords(machineBoundsInCam);

  return computeP3P(dimensions, mp, machineBoundsInImageCoords, calibrationData.new_camera_matrix);
}

export function computeP3P(dimensions: ITuple, mp: Box2, machineBoundsInCam: IBox, newCamMatrix: Matrix3) {
  // Create 3D object points (assuming z=0)
  // prettier-ignore
  const objectPoints = cv2.matFromArray(4, 3, cv2.CV_64F, [
    mp.min.x, mp.min.y, 0,
    mp.min.x, mp.max.y, 0,
    mp.max.x, mp.max.y, 0,
    mp.max.x, mp.min.y, 0,
  ]);

  // Create 2D image points from machineBoundsInCam, converting to image coordinates
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
  const success = cv2.solvePnP(objectPoints, imagePoints, cameraMatrix, distCoeffs, rvec, tvec, false, cv2.SOLVEPNP_AP3P);

  if (!success) {
    throw new Error('solvePnP failed to find a valid pose.');
  }

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

  return { R: threeR, t: threeT};
}
