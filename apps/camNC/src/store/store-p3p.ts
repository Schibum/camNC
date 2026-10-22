import { calculateUndistortionMapsCached } from '@/calibration/rectifyMap';
import { remapCv } from '@/calibration/remapCv';
import { computeP3P, projectPoints } from '@/calibration/solveP3P';
import { averageVideoFrames } from '@/hooks/useStillFrameTexture';
import { detectAruco, type IMarker } from '@/setup/detect-aruco';
import { getActiveCamSource, useCameraExtrinsics, useNewCameraMatrix, useStore } from '@/store/store';
import { acquireVideoSource, releaseVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Vector3 } from 'three';

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

/** Machine-space marker corners reprojected into the (undistorted) camera image. */
export function useReprojectedMarkerPositions() {
  const extrinsics = useCameraExtrinsics();
  const cameraMatrix = useNewCameraMatrix();
  if (!extrinsics) return [];
  return projectPoints(getInflatedMarkerPositions(), cameraMatrix, extrinsics.R, extrinsics.t);
}

const kStillFrameTimeoutMs = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function getRemappedStillFrame(averageFrames = 25) {
  const camSource = getActiveCamSource()!;
  const url = camSource.url;
  const resolution = camSource.maxResolution;
  const calibrationData = camSource.calibration!;
  const [mapX, mapY] = calculateUndistortionMapsCached(calibrationData, resolution[0], resolution[1]);
  const vidSrc = acquireVideoSource(url);
  const videoElem = document.createElement('video');
  videoElem.muted = true;
  let imgData: ImageData;
  try {
    const { src } = await vidSrc.connectedPromise;
    // TODO: use videoSource
    if (typeof src === 'string') {
      videoElem.src = src;
    } else {
      videoElem.srcObject = src;
    }
    await videoElem.play();
    imgData = await withTimeout(averageVideoFrames(videoElem, averageFrames), kStillFrameTimeoutMs, 'Timed out capturing still frame');
  } finally {
    // Stop decoding the temporary video element and drop our reference to the source.
    videoElem.pause();
    videoElem.removeAttribute('src');
    videoElem.srcObject = null;
    videoElem.load();
    releaseVideoSource(url);
  }
  return remapCv(imgData, resolution, mapX, mapY);
}
