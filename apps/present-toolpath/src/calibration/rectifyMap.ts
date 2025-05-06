import { Matrix3 } from 'three';

// Define a 3x3 matrix type.
export type Matrix3x3 = [[number, number, number], [number, number, number], [number, number, number]];

// Define an interface for image size.
export interface Size {
  width: number;
  height: number;
}

// The result type returned from the function.
export interface UndistortResult {
  map1: Float32Array;
  map2: Float32Array;
}

/**
 * Computes undistortion and rectification maps using typed arrays.
 * This implementation always returns two Float32Array maps (CV_32FC1).
 *
 * Like openCV version
 * (https://docs.opencv.org/3.4/da/d54/group__imgproc__transform.html#ga7dfb72c9cf9780a347fbe3d1c47e5d5a),
 * but implemented in JS to avoid pulling in that large lib on startup.
 *
 * @param cameraMatrix - 3x3 matrix for the original camera intrinsics.
 * @param distCoeffs - Distortion coefficients [k1, k2, p1, p2, (optional) k3].
 * @param R - 3x3 rectification (rotation) matrix.
 * @param newCameraMatrix - 3x3 matrix for the new projection.
 * @param size - Destination image size.
 * @returns The computed maps as Float32Arrays.
 */
export function initUndistortRectifyMapTyped(
  cameraMatrix: Matrix3,
  distCoeffs: number[],
  R: Matrix3x3,
  newCameraMatrix: Matrix3,
  size: Size
): UndistortResult {
  const { width, height } = size;
  const map1 = new Float32Array(width * height);
  const map2 = new Float32Array(width * height);

  // Precompute parameters from newCameraMatrix.
  const fx_new = newCameraMatrix.elements[0],
    cx_new = newCameraMatrix.elements[6],
    fy_new = newCameraMatrix.elements[4],
    cy_new = newCameraMatrix.elements[7];

  // Precompute parameters from the original cameraMatrix.
  const fx = cameraMatrix.elements[0],
    cx = cameraMatrix.elements[6],
    fy = cameraMatrix.elements[4],
    cy = cameraMatrix.elements[7];

  // Load distortion coefficients.
  const k1 = distCoeffs[0] || 0;
  const k2 = distCoeffs[1] || 0;
  const p1 = distCoeffs[2] || 0;
  const p2 = distCoeffs[3] || 0;
  const k3 = distCoeffs.length >= 5 ? distCoeffs[4] : 0;

  // Helper: Multiply a 3x3 matrix by a 3x1 vector.
  function multiplyMat3Vec3(M: Matrix3x3, v: [number, number, number]): [number, number, number] {
    return [
      M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
      M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
      M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
    ];
  }

  // Iterate over every pixel in the destination image.
  for (let i = 0; i < width * height; i++) {
    const u = i % width;
    const v = Math.floor(i / width);

    // 1. Normalize pixel coordinates using newCameraMatrix.
    const nx = (u - cx_new) / fx_new;
    const ny = (v - cy_new) / fy_new;

    // 2. Apply rectification rotation: [x, y, z] = R * [nx, ny, 1]^T.
    const vec = multiplyMat3Vec3(R, [nx, ny, 1]);
    const x = vec[0] / vec[2];
    const y = vec[1] / vec[2];

    // 3. Apply distortion.
    const r2 = x * x + y * y;
    const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
    const deltaX = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
    const deltaY = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
    const xDistorted = x * radial + deltaX;
    const yDistorted = y * radial + deltaY;

    // 4. Reproject using the original cameraMatrix.
    const u_distorted = fx * xDistorted + cx;
    const v_distorted = fy * yDistorted + cy;

    // 5. Store the result.
    map1[i] = u_distorted;
    map2[i] = v_distorted;
  }

  return { map1, map2 };
}
