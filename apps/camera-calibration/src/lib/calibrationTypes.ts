export interface Corner {
  x: number;
  y: number;
}

export interface CornerMetrics {
  centerX: number;
  centerY: number;
  stdDevX: number;
  stdDevY: number;
  aspectRatio: number;
  width: number;
  height: number;
}

export interface CapturedFrame {
  id: string;
  imageBlob: Blob | null;
  corners: Corner[];
  timestamp: number;
}

export interface CalibrationResult {
  rms: number;
  cameraMatrix: number[][];
  distCoeffs: number[];
  newCameraMatrix: number[][];
}

export interface PatternSize {
  width: number;
  height: number;
}

// OpenCV is loaded through a script tag and attached to window
export interface OpenCVGlobal {
  Mat: any;
  MatVector: any;
  Size: any;
  Point: any;
  TermCriteria: any;
  TermCriteria_EPS: number;
  TermCriteria_MAX_ITER: number;
  CALIB_CB_ADAPTIVE_THRESH: number;
  CALIB_CB_NORMALIZE_IMAGE: number;
  CV_8UC4: number;
  CV_8UC1: number;
  CV_32FC3: number;
  CV_32FC2: number;
  findChessboardCorners: any;
  cornerSubPix: any;
  cvtColor: any;
  COLOR_RGBA2GRAY: number;
  calibrateCamera: any;
  getOptimalNewCameraMatrix: any;
  imshow: any;
  VideoCapture: any;
}

declare global {
  interface Window {
    cv: any;
  }
}