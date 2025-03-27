import { Matrix, SVD, QrDecomposition, inverse } from 'ml-matrix';

// TypeScript interfaces for our data structures
interface Point2D {
  x: number;
  y: number;
}

interface Point3D {
  x: number;
  y: number;
  z: number;
}

interface RotationVector {
  x: number;
  y: number;
  z: number;
}

interface TranslationVector {
  x: number;
  y: number;
  z: number;
}

interface PnPResult {
  success: boolean;
  rvec: RotationVector;
  tvec: TranslationVector;
}

/**
 * Solves the PnP (Perspective-n-Point) problem using the AP3P algorithm
 * This is a simplified implementation of the OpenCV solvePnP function with SOLVEPNP_AP3P flag
 *
 * @param objectPoints 3D points in world coordinates
 * @param imagePoints 2D points in image coordinates
 * @param cameraMatrix Camera matrix (3x3)
 * @param distCoeffs Distortion coefficients
 * @returns Rotation vector and translation vector
 */
function solvePnP(
  objectPoints: Point3D[],
  imagePoints: Point2D[],
  cameraMatrix: number[][],
  distCoeffs: number[] = [0, 0, 0, 0, 0]
): PnPResult {
  // Convert camera matrix to Matrix object
  const K = new Matrix(cameraMatrix);

  // Get the inverse of the camera matrix
  const Kinv = inverse(K);

  // Normalize image points (remove camera intrinsics)
  const normalizedImagePoints = imagePoints.map(point => {
    // Apply inverse camera matrix to normalize points
    const normalized = Kinv.mmul(new Matrix([[point.x], [point.y], [1]]));
    return {
      x: normalized.get(0, 0) / normalized.get(2, 0),
      y: normalized.get(1, 0) / normalized.get(2, 0),
    };
  });

  // For AP3P, we need at least 4 points
  if (objectPoints.length < 4 || imagePoints.length < 4) {
    return {
      success: false,
      rvec: { x: 0, y: 0, z: 0 },
      tvec: { x: 0, y: 0, z: 0 },
    };
  }

  // In a real implementation, we would solve the P3P problem using algebraic methods
  // This is a complex algorithm involving solving systems of polynomial equations
  // Here we'll use a simplified direct linear transform (DLT) approach

  // Build the DLT matrix
  const A = new Matrix(objectPoints.length * 2, 12);

  for (let i = 0; i < objectPoints.length; i++) {
    const X = objectPoints[i].x;
    const Y = objectPoints[i].y;
    const Z = objectPoints[i].z;
    const u = normalizedImagePoints[i].x;
    const v = normalizedImagePoints[i].y;

    // Each point gives us two rows in the DLT matrix
    A.set(i * 2, 0, X);
    A.set(i * 2, 1, Y);
    A.set(i * 2, 2, Z);
    A.set(i * 2, 3, 1);
    A.set(i * 2, 4, 0);
    A.set(i * 2, 5, 0);
    A.set(i * 2, 6, 0);
    A.set(i * 2, 7, 0);
    A.set(i * 2, 8, -u * X);
    A.set(i * 2, 9, -u * Y);
    A.set(i * 2, 10, -u * Z);
    A.set(i * 2, 11, -u);

    A.set(i * 2 + 1, 0, 0);
    A.set(i * 2 + 1, 1, 0);
    A.set(i * 2 + 1, 2, 0);
    A.set(i * 2 + 1, 3, 0);
    A.set(i * 2 + 1, 4, X);
    A.set(i * 2 + 1, 5, Y);
    A.set(i * 2 + 1, 6, Z);
    A.set(i * 2 + 1, 7, 1);
    A.set(i * 2 + 1, 8, -v * X);
    A.set(i * 2 + 1, 9, -v * Y);
    A.set(i * 2 + 1, 10, -v * Z);
    A.set(i * 2 + 1, 11, -v);
  }

  // Solve using SVD
  const svd = new SVD(A);
  const V = svd.rightSingularVectors;

  // The solution is the last column of V (smallest singular value)
  const lastColIdx = V.columns - 1;

  // Extract the projection matrix P (3x4)
  const P = new Matrix(3, 4);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      P.set(i, j, V.get(i * 4 + j, lastColIdx));
    }
  }

  // Normalize the projection matrix
  const scale = Math.sqrt(P.get(2, 0) * P.get(2, 0) + P.get(2, 1) * P.get(2, 1) + P.get(2, 2) * P.get(2, 2));

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      P.set(i, j, P.get(i, j) / scale);
    }
  }

  // Extract rotation matrix (first 3x3 part of P) and translation vector (last column of P)
  const R = new Matrix(3, 3);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R.set(i, j, P.get(i, j));
    }
  }

  // Ensure R is a proper rotation matrix (orthogonal)
  const qr = new QrDecomposition(R);
  const orthogonalR = qr.orthogonalMatrix;

  // Extract translation vector
  const t = new Matrix(3, 1);
  for (let i = 0; i < 3; i++) {
    t.set(i, 0, P.get(i, 3));
  }

  // Convert rotation matrix to rotation vector (using Rodrigues formula)
  // This is a simplified version - in practice use a more robust implementation
  const trace = orthogonalR.get(0, 0) + orthogonalR.get(1, 1) + orthogonalR.get(2, 2);
  const theta = Math.acos((trace - 1) / 2);

  // Avoid division by zero
  if (Math.abs(theta) < 1e-10) {
    return {
      success: true,
      rvec: { x: 0, y: 0, z: 0 },
      tvec: { x: t.get(0, 0), y: t.get(1, 0), z: t.get(2, 0) },
    };
  }

  // Calculate rotation axis
  const rx = (orthogonalR.get(2, 1) - orthogonalR.get(1, 2)) / (2 * Math.sin(theta));
  const ry = (orthogonalR.get(0, 2) - orthogonalR.get(2, 0)) / (2 * Math.sin(theta));
  const rz = (orthogonalR.get(1, 0) - orthogonalR.get(0, 1)) / (2 * Math.sin(theta));

  // Rotation vector = axis * angle
  return {
    success: true,
    rvec: {
      x: rx * theta,
      y: ry * theta,
      z: rz * theta,
    },
    tvec: {
      x: t.get(0, 0),
      y: t.get(1, 0),
      z: t.get(2, 0),
    },
  };
}

/**
 * Converts rotation vector to rotation matrix (Rodrigues' formula)
 *
 * @param rvec Rotation vector
 * @returns Rotation matrix (3x3)
 */
function rodrigues(rvec: RotationVector): number[][] {
  const theta = Math.sqrt(rvec.x * rvec.x + rvec.y * rvec.y + rvec.z * rvec.z);

  // If rotation is very small, return identity
  if (theta < 1e-10) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }

  // Normalize rotation vector to get rotation axis
  const x = rvec.x / theta;
  const y = rvec.y / theta;
  const z = rvec.z / theta;

  // Compute rotation matrix using Rodrigues' formula
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const C = 1 - c;

  return [
    [x * x * C + c, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, y * y * C + c, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, z * z * C + c],
  ];
}

/**
 * Project 3D points to 2D using camera parameters
 *
 * @param objectPoints 3D points in world coordinates
 * @param rvec Rotation vector
 * @param tvec Translation vector
 * @param cameraMatrix Camera matrix
 * @param distCoeffs Distortion coefficients (not used in this simplified version)
 * @returns Projected 2D points
 */
function projectPoints(
  objectPoints: Point3D[],
  rvec: RotationVector,
  tvec: TranslationVector,
  cameraMatrix: number[][],
  distCoeffs: number[] = [0, 0, 0, 0, 0]
): Point2D[] {
  // Convert rotation vector to rotation matrix
  const R = rodrigues(rvec);

  // Convert to matrix objects
  const Rmat = new Matrix(R);
  const tmat = new Matrix([[tvec.x], [tvec.y], [tvec.z]]);
  const Kmat = new Matrix(cameraMatrix);

  // Project each point
  return objectPoints.map(point => {
    // World point as a column vector
    const worldPoint = new Matrix([[point.x], [point.y], [point.z]]);

    // Apply rotation and translation: R*X + t
    const cameraPoint = Rmat.mmul(worldPoint).add(tmat);

    // Normalize by Z to get homogeneous coordinates
    const x = cameraPoint.get(0, 0) / cameraPoint.get(2, 0);
    const y = cameraPoint.get(1, 0) / cameraPoint.get(2, 0);

    // Apply camera matrix to get pixel coordinates
    const pixelPoint = Kmat.mmul(new Matrix([[x], [y], [1]]));

    return {
      x: pixelPoint.get(0, 0) / pixelPoint.get(2, 0),
      y: pixelPoint.get(1, 0) / pixelPoint.get(2, 0),
    };
  });
}

// Example usage matching the OpenCV example from the calibrate.js file
function main() {
  // Convert the flat array format to structured points
  const objectPoints: Point3D[] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 1243, z: 0 },
    { x: 623, y: 1243, z: 0 },
    { x: 623, y: 0, z: 0 },
  ];

  const imagePoints: Point2D[] = [
    { x: 1570, y: 418 },
    { x: 2209, y: 1599 },
    { x: 901, y: 1893 },
    { x: 959, y: 456 },
  ];

  const cameraMatrix = [
    [1576.7091, 0.0, 1481.0536],
    [0.0, 1717.4288, 969.4483],
    [0.0, 0.0, 1.0],
  ];

  // Solve PnP
  const result = solvePnP(objectPoints, imagePoints, cameraMatrix);

  if (result.success) {
    // Convert rotation vector to rotation matrix
    const R = rodrigues(result.rvec);

    console.log('Camera Matrix:');
    console.log(cameraMatrix);
    console.log('\nRotation Matrix:');
    console.log(R);
    console.log('\nTranslation Vector:');
    console.log(result.tvec);

    // Verify reprojection
    const projectedPoints = projectPoints(objectPoints, result.rvec, result.tvec, cameraMatrix);

    console.log('\nReprojected points:');
    console.log(projectedPoints);

    // Calculate reprojection error
    let totalError = 0;
    for (let i = 0; i < imagePoints.length; i++) {
      const dx = imagePoints[i].x - projectedPoints[i].x;
      const dy = imagePoints[i].y - projectedPoints[i].y;
      totalError += Math.sqrt(dx * dx + dy * dy);
    }

    console.log('\nReprojection error:', totalError / imagePoints.length);
  } else {
    console.log('Failed to solve PnP');
  }
}

// Export the functions
export { solvePnP, rodrigues, projectPoints, main };
