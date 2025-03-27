import cv from '@techstark/opencv-js';

await new Promise(resolve => {
  cv.onRuntimeInitialized = resolve;
});

function incorrect() {
  // Define the input data
  // Image points (corners in camera coordinates)
  const corners2 = cv.matFromArray(4, 2, cv.CV_32F, [1570, 418, 2209, 1599, 901, 1893, 959, 456]);

  // // Object points (corners in world coordinates)
  const objectPoints = cv.matFromArray(4, 3, cv.CV_32F, [0, 0, 0, 0, 1243, 0, 623, 1243, 0, 623, 0, 0]);

  // // Camera matrix from calibration
  const newCameraMtx = cv.matFromArray(3, 3, cv.CV_32F, [1576.7091, 0.0, 1481.0536, 0.0, 1717.4288, 969.4483, 0.0, 0.0, 1.0]);

  // Instead of 4x1 with 2 channels, create a 4x2 single-channel matrix for image points:
  // const corners2 = cv.matFromArray(4, 2, cv.CV_32F, [320, 240, 320, 340, 420, 340, 420, 240]);

  // // And for object points (4x3 single-channel matrix):
  // const objectPoints = cv.matFromArray(4, 3, cv.CV_32F, [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]);

  // // Camera matrix and distortion coefficients remain the same:
  // const newCameraMtx = cv.matFromArray(3, 3, cv.CV_32F, [800, 0, 320, 0, 800, 240, 0, 0, 1]);

  // Assume no distortion
  const dist = cv.Mat.zeros(5, 1, cv.CV_32F);

  // Create output matrices for solvePnP
  const rvecs = new cv.Mat();
  const tvecs = new cv.Mat();

  // Solve for pose using P3P algorithm
  const ret = cv.solvePnP(objectPoints, corners2, newCameraMtx, dist, rvecs, tvecs, false, cv.SOLVEPNP_AP3P);
  console.log('result', ret);

  console.log('Rotation Vector (rvec):', rvecs.data64F);
  console.log('Translation Vector (tvec):', tvecs.data64F);
  // // Convert rotation vector to rotation matrix
  const R = new cv.Mat();
  cv.Rodrigues(rvecs, R);

  // Print results
  console.log('Camera Matrix:');
  console.log(newCameraMtx.data64F);
  console.log('\nRotation Matrix:');
  console.log(R.data64F);
  console.log('\nTranslation Vector:');
  console.log(tvecs.data64F);

  // // Verify reprojection
  // const reproj = new cv.Mat();
  // cv.projectPoints(objectPoints, rvecs, tvecs, newCameraMtx, dist, reproj);

  // Calculate reprojection error
  // console.log(reproj);

  // Clean up
  corners2.delete();
  objectPoints.delete();
  newCameraMtx.delete();
  dist.delete();
  rvecs.delete();
  tvecs.delete();
  // R.delete();
  // reproj.delete();
}

function correct() {
  // Instead of 4x1 with 2 channels, create a 4x2 single-channel matrix for image points:
  const imagePoints = cv.matFromArray(4, 2, cv.CV_32F, [320, 240, 320, 340, 420, 340, 420, 240]);

  // And for object points (4x3 single-channel matrix):
  const objectPoints = cv.matFromArray(4, 3, cv.CV_32F, [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]);

  // Camera matrix and distortion coefficients remain the same:
  const cameraMatrix = cv.matFromArray(3, 3, cv.CV_32F, [800, 0, 320, 0, 800, 240, 0, 0, 1]);
  const distCoeffs = cv.Mat.zeros(5, 1, cv.CV_32F);

  // Prepare output arrays for rotation and translation vectors.
  const rvec = new cv.Mat();
  const tvec = new cv.Mat();

  // Run solvePnP using the iterative method.
  const ret = cv.solvePnP(objectPoints, imagePoints, cameraMatrix, distCoeffs, rvec, tvec, false, cv.SOLVEPNP_AP3P);

  // Print results. Now you should see rvec and tvec with 3 elements each.
  console.log(rvec.depth());
  console.log('Rotation Vector (rvec):', rvec.data64F);
  console.log('Translation Vector (tvec):', tvec.data64F);

  // Clean up.
  objectPoints.delete();
  imagePoints.delete();
  cameraMatrix.delete();
  distCoeffs.delete();
  rvec.delete();
  tvec.delete();
}

incorrect();
