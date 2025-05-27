import { calculateUndistortionMapsCached } from '@/calibration/rectifyMap';
import { remapCv } from '@/calibration/remapCv';
import { computeP3P, markerMachinePosToCv } from '@/calibration/solveP3P';
import { averageVideoFrames } from '@/hooks/useStillFrameTexture';
import { useCameraExtrinsics, useStore } from '@/store/store';
import { acquireVideoSource, releaseVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { cv2 } from '@wbcnc/load-opencv';
import { cvToVector2, matrix3ToCV, vector3ToCV } from '../lib/three-cv';

function getMarkerPosInCam() {
  return useStore.getState().camSource!.markerPosInCam!;
}

function computeMarkerP3P() {
  const camSource = useStore.getState().camSource;
  const mp = camSource!.markerPositions!;
  const calibrationData = camSource!.calibration!;
  return computeP3P(mp, getMarkerPosInCam(), calibrationData.new_camera_matrix);
}

export function updateCameraExtrinsics() {
  // const setCameraExtrinsics = useSetCameraExtrinsics();
  const setCameraExtrinsics = useStore.getState().camSourceSetters.setExtrinsics;
  const { R, t, reprojectionError } = computeMarkerP3P();
  console.log('updated camera extrinsics', R, t, reprojectionError);
  setCameraExtrinsics({ R, t });
  return reprojectionError;
}

export function useReprojectedMachineBounds() {
  const extrinsics = useCameraExtrinsics();
  const cameraMatrix = matrix3ToCV(useStore(state => state.camSource!.calibration!.new_camera_matrix));
  const objectPoints = markerMachinePosToCv(useStore(state => state.camSource!.markerPositions!));
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
  const url = useStore.getState().camSource!.url;
  const resolution = useStore.getState().camSource!.maxResolution;
  const calibrationData = useStore.getState().camSource!.calibration!;
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
  return remapCv(imgData, mapX, mapY);
}
