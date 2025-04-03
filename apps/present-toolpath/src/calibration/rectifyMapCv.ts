import { Matrix3 } from 'three';
import { cv2 } from '@/lib/loadOpenCv';

// Define a 3x3 matrix type
export type Matrix3x3 = [[number, number, number], [number, number, number], [number, number, number]];

// Define an interface for image size
export interface Size {
  width: number;
  height: number;
}

// The result type returned from the function
export interface UndistortResult {
  map1: Float32Array;
  map2: Float32Array;
}

/**
 * Computes undistortion and rectification maps using OpenCV.js.
 * This function returns two Float32Array maps (CV_32FC1).
 *
 * @param cameraMatrix - 3x3 matrix for the original camera intrinsics.
 * @param distCoeffs - Distortion coefficients [k1, k2, p1, p2, (optional) k3].
 * @param R - 3x3 rectification (rotation) matrix.
 * @param newCameraMatrix - 3x3 matrix for the new projection.
 * @param size - Destination image size.
 * @returns The computed maps as Float32Arrays.
 */
export function initUndistortRectifyMapCv(
  cameraMatrix: Matrix3x3,
  distCoeffs: number[],
  R: Matrix3x3,
  newCameraMatrix: Matrix3,
  size: Size
): UndistortResult {
  // Ensure OpenCV.js is loaded before using it

  const { width, height } = size;

  // Create OpenCV matrices
  const cameraMat = cv2.matFromArray(3, 3, cv2.CV_64F, [
    cameraMatrix[0][0],
    cameraMatrix[0][1],
    cameraMatrix[0][2],
    cameraMatrix[1][0],
    cameraMatrix[1][1],
    cameraMatrix[1][2],
    cameraMatrix[2][0],
    cameraMatrix[2][1],
    cameraMatrix[2][2],
  ]);

  // Create distortion coefficients matrix
  const distCoeffsMat = cv2.matFromArray(distCoeffs.length, 1, cv2.CV_64F, distCoeffs);

  // Create rotation matrix
  const rotationMat = cv2.matFromArray(3, 3, cv2.CV_64F, [R[0][0], R[0][1], R[0][2], R[1][0], R[1][1], R[1][2], R[2][0], R[2][1], R[2][2]]);

  // Create new camera matrix
  const newCameraMat = cv2.matFromArray(3, 3, cv2.CV_64F, [
    newCameraMatrix.elements[0],
    newCameraMatrix.elements[3],
    newCameraMatrix.elements[6],
    newCameraMatrix.elements[1],
    newCameraMatrix.elements[4],
    newCameraMatrix.elements[7],
    newCameraMatrix.elements[2],
    newCameraMatrix.elements[5],
    newCameraMatrix.elements[8],
  ]);

  // Create output maps
  const map1 = new cv2.Mat(height, width, cv2.CV_32FC1);
  const map2 = new cv2.Mat(height, width, cv2.CV_32FC1);

  // Calculate undistortion maps
  cv2.initUndistortRectifyMap(cameraMat, distCoeffsMat, rotationMat, newCameraMat, new cv2.Size(width, height), cv2.CV_32FC1, map1, map2);

  // Convert OpenCV maps to Float32Arrays
  const map1Data = new Float32Array(width * height);
  const map2Data = new Float32Array(width * height);

  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const index = i * width + j;
      map1Data[index] = map1.floatAt(i, j);
      map2Data[index] = map2.floatAt(i, j);
    }
  }

  // Clean up OpenCV resources
  cameraMat.delete();
  distCoeffsMat.delete();
  rotationMat.delete();
  newCameraMat.delete();
  map1.delete();
  map2.delete();

  return { map1: map1Data, map2: map2Data };
}
