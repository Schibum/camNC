import { calculateUndistortionMapsCached } from '@/calibration/rectifyMap';
import { remapCv } from '@/calibration/remapCv';
import { useConvertImageToThree } from '@/calibration/solveP3P';
import { averageVideoFrames } from '@/hooks/useStillFrameTexture';
import { acquireVideoSource, releaseVideoSource } from '@wbcnc/go2webrtc/use-video-source';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { ScanQrCode } from 'lucide-react';
import { use, useState } from 'react';
import { Vector2 } from 'three';
import { useStore } from '../store';
import { detectAruco } from './detect-aruco';

async function getStillFrame(averageFrames = 25) {
  const url = useStore.getState().camSource!.url;
  const resolution = useStore.getState().camSource!.maxResolution;
  const calibrationData = useStore.getState().camSource!.calibration!;
  const [mapX, mapY] = calculateUndistortionMapsCached(calibrationData, resolution[0], resolution[1]);
  const vidSrc = acquireVideoSource(url);
  const { src } = await vidSrc.connectedPromise;
  // TODO: use videoSource
  const videoElem = document.createElement('video');
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

export function DetectArucosButton({ onMarkersDetected }: { onMarkersDetected: (markers: Vector2[]) => void }) {
  use(ensureOpenCvIsLoaded());
  const [isDetecting, setIsDetecting] = useState(false);
  const convertToThree = useConvertImageToThree();
  const handleClick = async () => {
    setIsDetecting(true);
    const imgMat = await getStillFrame();
    const markers = detectAruco(imgMat);
    imgMat.delete();
    console.log('markers', markers);
    setIsDetecting(false);
    const markersThree = markers.map(m => convertToThree(new Vector2(m.origin[0], m.origin[1])));
    // console.log('markersThree', markersThree);
    onMarkersDetected(markersThree);
  };

  return (
    <Button onClick={handleClick} disabled={isDetecting}>
      {isDetecting ? <LoadingSpinner /> : <ScanQrCode />} Detect Arucos
    </Button>
  );
}
