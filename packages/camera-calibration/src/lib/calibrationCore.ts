import {
  CalibrationResult,
  CapturedFrame,
  Corner,
  CornerMetrics,
  PatternSize,
} from "./calibrationTypes";

/**
 * Converts corners from OpenCV format to our simpler format
 */
export function convertCorners(corners: any): Corner[] {
  const result: Corner[] = [];
  const numCorners = corners.rows;

  for (let i = 0; i < numCorners; i++) {
    result.push({
      x: corners.data32F[i * 2],
      y: corners.data32F[i * 2 + 1],
    });
  }

  return result;
}

/**
 * Creates a set of 3D object points for the calibration pattern
 */
export function createObjectPoints(
  patternSize: PatternSize,
  squareSize: number = 1.0
): any {
  const { width, height } = patternSize;
  const numCorners = width * height;
  const cv = self.cv;

  const objp = new cv.Mat(numCorners, 1, cv.CV_32FC3);
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const index = i * width + j;
      objp.data32F[index * 3] = j * squareSize;
      objp.data32F[index * 3 + 1] = i * squareSize;
      objp.data32F[index * 3 + 2] = 0;
    }
  }

  return objp;
}

/**
 * Calculate metrics for a set of chessboard corners
 */
export function calculateCornerMetrics(corners: Corner[]): CornerMetrics {
  if (corners.length === 0) {
    throw new Error("No corners provided for metrics calculation");
  }

  const numCorners = corners.length;
  let centerX = 0,
    centerY = 0;

  // Calculate centroid
  for (const corner of corners) {
    centerX += corner.x;
    centerY += corner.y;
  }
  centerX /= numCorners;
  centerY /= numCorners;

  // Calculate standard deviation and bounds
  let stdDevX = 0,
    stdDevY = 0;
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;

  for (const corner of corners) {
    const { x, y } = corner;

    stdDevX += Math.pow(x - centerX, 2);
    stdDevY += Math.pow(y - centerY, 2);

    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  stdDevX = Math.sqrt(stdDevX / numCorners);
  stdDevY = Math.sqrt(stdDevY / numCorners);

  const width = maxX - minX;
  const height = maxY - minY;
  const aspectRatio = width / height;

  return {
    centerX,
    centerY,
    stdDevX,
    stdDevY,
    aspectRatio,
    width,
    height,
  };
}

/**
 * Calculate movement between two corner metrics
 */
export function calculateMovement(
  current: CornerMetrics,
  previous: CornerMetrics
): number {
  // Calculate centroid movement
  const centerDiffX = current.centerX - previous.centerX;
  const centerDiffY = current.centerY - previous.centerY;
  const centerDist = Math.sqrt(
    centerDiffX * centerDiffX + centerDiffY * centerDiffY
  );

  // We could incorporate other measures like aspect ratio difference, but
  // center distance is the most direct measure of movement
  return centerDist;
}

/**
 * Calculate similarity score between current corners and previously captured frames
 * Returns value between 0 and 1, where 1 means completely unique
 */
export function calculateSimilarityScore(
  currentCorners: Corner[],
  previousCaptures: CapturedFrame[],
  frameWidth: number,
  frameHeight: number
): number {
  if (previousCaptures.length === 0) {
    return 1.0; // Completely unique
  }

  const currentMetrics = calculateCornerMetrics(currentCorners);
  let highestSimilarity = 0;

  for (const capture of previousCaptures) {
    const existingMetrics = calculateCornerMetrics(capture.corners);

    // Calculate normalized distance between centroids
    const centerDistX =
      Math.abs(currentMetrics.centerX - existingMetrics.centerX) / frameWidth;
    const centerDistY =
      Math.abs(currentMetrics.centerY - existingMetrics.centerY) / frameHeight;
    const centerDist = Math.sqrt(
      centerDistX * centerDistX + centerDistY * centerDistY
    );

    // Calculate difference in orientation and spread
    const aspectRatioDiff =
      Math.abs(currentMetrics.aspectRatio - existingMetrics.aspectRatio) /
      Math.max(currentMetrics.aspectRatio, existingMetrics.aspectRatio);

    const stdDevDiffX =
      Math.abs(currentMetrics.stdDevX - existingMetrics.stdDevX) / frameWidth;
    const stdDevDiffY =
      Math.abs(currentMetrics.stdDevY - existingMetrics.stdDevY) / frameHeight;
    const stdDevDiff = (stdDevDiffX + stdDevDiffY) / 2;

    // Combined similarity score (lower is more similar)
    const similarityScore =
      centerDist * 0.5 + aspectRatioDiff * 0.3 + stdDevDiff * 0.2;

    // Track the highest similarity
    if (1 - similarityScore > highestSimilarity) {
      highestSimilarity = 1 - similarityScore;
    }
  }

  // Return uniqueness (opposite of similarity)
  return 1 - highestSimilarity;
}

/**
 * Performs camera calibration using the captured frames
 */
export function calibrateCamera(
  capturedFrames: CapturedFrame[],
  patternSize: PatternSize,
  frameSize: { width: number; height: number },
  squareSize: number = 1.0,
  zeroTangentDist = false
): CalibrationResult {
  if (capturedFrames.length < 3) {
    throw new Error("At least 3 frames required for calibration");
  }
  console.log(
    "calibrateCamera, frames: %o, patternSize: %o, frameSize: %o, squareSize: %o, zeroTangentDist: %o",
    capturedFrames,
    patternSize,
    frameSize,
    squareSize,
    zeroTangentDist
  );

  const cv = self.cv;
  const imageSize = new cv.Size(frameSize.width, frameSize.height);

  // Prepare MatVectors for object and image points
  const objectPoints = new cv.MatVector();
  const imagePoints = new cv.MatVector();

  // Add points from captured frames
  capturedFrames.forEach(() => {
    const objp = createObjectPoints(patternSize, squareSize);
    objectPoints.push_back(objp);
  });

  capturedFrames.forEach((frame) => {
    // Convert our corner format back to OpenCV format
    const points = new cv.Mat(frame.corners.length, 1, cv.CV_32FC2);
    frame.corners.forEach((corner, i) => {
      points.data32F[i * 2] = corner.x;
      points.data32F[i * 2 + 1] = corner.y;
    });
    imagePoints.push_back(points);
  });

  // Matrices to hold calibration results
  const cameraMatrix = new cv.Mat();
  const distCoeffs = new cv.Mat();
  const rvecs = new cv.MatVector();
  const tvecs = new cv.MatVector();

  const stdDevInt = new cv.Mat();
  const stdDevExt = new cv.Mat();
  const perViewErrors = new cv.Mat();

  const crit = new cv.TermCriteria(
    cv.TermCriteria.COUNT + cv.TermCriteria.EPS,
    30,
    1e-6
  );

  const flags = zeroTangentDist ? cv.CALIB_ZERO_TANGENT_DIST : 0;
  // Calibrate the camera
  const rms = cv.calibrateCameraExtended(
    objectPoints,
    imagePoints,
    imageSize,
    cameraMatrix,
    distCoeffs,
    rvecs,
    tvecs,
    stdDevInt,
    stdDevExt,
    perViewErrors,
    flags,
    crit
  );

  // Get optimal new camera matrix
  const newCameraMatrix = cv.getOptimalNewCameraMatrix(
    cameraMatrix,
    distCoeffs,
    imageSize,
    0.1
  );

  // Convert matrices to JS arrays
  const result: CalibrationResult = {
    rms,
    cameraMatrix: matToArray(cameraMatrix),
    distCoeffs: matToArray(distCoeffs)[0] || [],
    newCameraMatrix: matToArray(newCameraMatrix),
    perViewErrors: matToArray(perViewErrors).map((row) => row[0]) as number[],
  };

  // Clean up
  objectPoints.delete();
  imagePoints.delete();
  cameraMatrix.delete();
  distCoeffs.delete();
  rvecs.delete();
  tvecs.delete();
  newCameraMatrix.delete();
  stdDevInt.delete();
  stdDevExt.delete();
  perViewErrors.delete();

  return result;
}

/**
 * Converts OpenCV Mat to JS array
 */
function matToArray(mat: any): number[][] {
  const rows = mat.rows;
  const cols = mat.cols;
  const result: number[][] = [];

  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      const value = mat.data64F
        ? mat.data64F[i * cols + j]
        : mat.data32F[i * cols + j];
      row.push(value);
    }
    result.push(row);
  }

  return result;
}
