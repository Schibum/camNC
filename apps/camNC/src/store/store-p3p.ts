import { calculateUndistortionMapsCached } from '@/calibration/rectifyMap';
import { remapCv } from '@/calibration/remapCv';
import { computeP3P, markerMachinePosToCv } from '@/calibration/solveP3P';
import { averageVideoFrames } from '@/hooks/useStillFrameTexture';
import { detectAruco, type IMarker } from '@/setup/detect-aruco';
import { getActiveCamSource, useCameraExtrinsics, useNewCameraMatrix, useStore } from '@/store/store';
import { acquireVideoSource, releaseVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { cv2, ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Vector3 } from 'three';
import { cvToVector2, matrix3ToCV, vector3ToCV } from '../lib/three-cv';

function getMarkerPosInCam() {
  return getActiveCamSource()!.markerPosInCam!;
}

// Get position of aruco marker corners if using aruco, calculated from center
// positions and aruco size, otherwise just marker positions themselves.
function getInflatedMarkerPositions() {
  const camSource = getActiveCamSource();
  if (!camSource) throw new Error();
  const mp = camSource.markerPositions!;
  const as2 = camSource.arucoTagSize! / 2;
  // Inflate aruco marker positions CW, top left first.
  return mp.flatMap(m => {
    return [new Vector3(-as2, as2, 0), new Vector3(as2, as2, 0), new Vector3(as2, -as2, 0), new Vector3(-as2, -as2, 0)].map(v => v.add(m));
  });
}

function computeMarkerP3P() {
  const camSource = getActiveCamSource();
  if (!camSource) throw new Error();
  const mp = getInflatedMarkerPositions();
  const calibrationData = camSource!.calibration!;
  return computeP3P(mp, getMarkerPosInCam(), calibrationData.new_camera_matrix);
}

export function updateCameraExtrinsics() {
  const { setExtrinsics } = useStore.getState().camSourceSetters;
  const { setPnPResult } = useStore.getState();
  const { R, t, reprojectionError } = computeMarkerP3P();
  setExtrinsics({ R, t });
  setPnPResult(Date.now(), reprojectionError);
  return reprojectionError;
}

/** Number of aruco tags expected to be visible for a valid PnP solve. */
export const kExpectedMarkerCount = 4;

/** The expected aruco tags (ids 0..N-1) found among `markers`, deduped and ordered by id. */
export function getValidMarkers(markers: IMarker[]): IMarker[] {
  return markers.filter((m, i, arr) => m.id >= 0 && m.id < kExpectedMarkerCount && arr.findIndex(x => x.id === m.id) === i);
}

/** Grab a fresh still frame and detect the aruco tags visible in it. */
export async function detectMarkersInStillFrame(averageFrames = 5): Promise<IMarker[]> {
  await ensureOpenCvIsLoaded();
  const imgMat = await getRemappedStillFrame(averageFrames);
  try {
    return detectAruco(imgMat);
  } finally {
    imgMat.delete();
  }
}

/** Store detected marker corners and recompute the camera extrinsics. Returns reprojection error in px. */
export function setMarkersAndRecompute(markers: IMarker[]): number {
  useStore.getState().camSourceSetters.setMarkerPosInCam(markers.flatMap(m => m.corners));
  return updateCameraExtrinsics();
}

/** Human-readable reprojection error for toasts. */
export function formatReprojectionError(error: number): string {
  return `Reprojection error: ${error.toFixed(2)}px (< 1px is very good)`;
}

export function useReprojectedMarkerPositions() {
  const extrinsics = useCameraExtrinsics();
  const cameraMatrix = matrix3ToCV(useNewCameraMatrix());
  const objectPoints = markerMachinePosToCv(getInflatedMarkerPositions());
  if (!extrinsics) return [];
  const { R, t } = extrinsics;
  const Rcv = matrix3ToCV(R);
  const tcv = vector3ToCV(t);
  const distCoeffs = cv2.Mat.zeros(1, 5, cv2.CV_64F);
  const reprojectedPoints = new cv2.Mat();
  cv2.projectPoints(objectPoints, Rcv, tcv, cameraMatrix, distCoeffs, reprojectedPoints);
  const pointsThree = [];
  for (let i = 0; i < reprojectedPoints.rows; i++) {
    const reprojectedPoint = cvToVector2(reprojectedPoints.row(i));
    pointsThree.push(reprojectedPoint);
  }
  objectPoints.delete();
  reprojectedPoints.delete();
  distCoeffs.delete();
  Rcv.delete();
  tcv.delete();
  return pointsThree;
}

export async function getRemappedStillFrame(averageFrames = 25) {
  const camSource = getActiveCamSource()!;
  const url = camSource.url;
  const resolution = camSource.maxResolution;
  const calibrationData = camSource.calibration!;
  const [mapX, mapY] = calculateUndistortionMapsCached(calibrationData, resolution[0], resolution[1]);
  const vidSrc = acquireVideoSource(url);
  const { src } = await vidSrc.connectedPromise;
  // TODO: use videoSource
  const videoElem = document.createElement('video');
  videoElem.muted = true;
  if (typeof src === 'string') {
    videoElem.src = src;
  } else {
    videoElem.srcObject = src;
  }
  await videoElem.play();
  const imgData = await averageVideoFrames(videoElem, averageFrames);
  releaseVideoSource(url);
  return remapCv(imgData, resolution, mapX, mapY);
}
