import { cv2 } from '@wbcnc/load-opencv';

const kDictId = 0; // DICT_4X4_50
const kRefinementMethod = 1; // subpixel

function createDetector() {
  const cv = cv2 as any;
  const detectorParams = new cv.aruco_DetectorParameters();
  detectorParams.cornerRefinementMethod = kRefinementMethod;

  const refineParams = new cv.aruco_RefineParameters(10.0, 3.0, true);

  const dictionary = cv.getPredefinedDictionary(kDictId);
  const detector = new cv.aruco_ArucoDetector(dictionary, detectorParams, refineParams);
  return detector;
}

type IMarker = {
  id: number;
  origin: [number, number];
};

export function detectAruco(matOrCanvas: HTMLCanvasElement | cv2.Mat) {
  const startTime = performance.now();
  const img = matOrCanvas instanceof HTMLCanvasElement ? cv2.imread(matOrCanvas) : matOrCanvas;

  // Convert to grayscale for detection
  const gray = new cv2.Mat();
  cv2.cvtColor(img, gray, cv2.COLOR_RGBA2GRAY);

  // Detect markers
  const corners = new cv2.MatVector();
  const ids = new cv2.Mat();
  const rejected = new cv2.MatVector();

  const detector = createDetector();

  // Use the ArucoDetector to detect markers
  detector.detectMarkers(gray, corners, ids, rejected);

  // Measure processing time
  const currentTime = performance.now() - startTime;
  console.log(`Detection time: ${currentTime} ms`);
  console.log(`Detected ${ids.rows} markers ${ids.rows} ids, ${rejected.size()} rejected`);

  const markers: IMarker[] = [];
  for (let i = 0; i < corners.size(); i++) {
    const points = corners.get(i);
    const pt1 = [points.data32F[0], points.data32F[1]] as [number, number];
    const idValue = ids.data32S[i];
    markers.push({ id: idValue, origin: pt1 });
  }
  markers.sort((a, b) => a.id - b.id);

  corners.delete();
  ids.delete();
  rejected.delete();
  gray.delete();
  if (matOrCanvas instanceof HTMLCanvasElement) {
    img.delete();
  }
  detector.delete();

  return markers;
}
