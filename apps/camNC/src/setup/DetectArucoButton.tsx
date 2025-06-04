import { measureTime } from '@/lib/measureTime';
import { getRemappedStillFrame } from '@/store/store-p3p';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { ScanQrCode } from 'lucide-react';
import { use, useState } from 'react';
import { Vector2 } from 'three';
import { detectAruco, IMarker } from './detect-aruco';

const kNumFrames = 5;
export function DetectArucosButton({ onMarkersDetected }: { onMarkersDetected: (markers: IMarker[]) => void }) {
  use(ensureOpenCvIsLoaded());
  const [isDetecting, setIsDetecting] = useState(false);
  const handleClick = async () => {
    setIsDetecting(true);
    const imgMat = await measureTime(() => getRemappedStillFrame(kNumFrames), 'getStillFrame');
    const markers = detectAruco(imgMat);
    imgMat.delete();
    console.log('markers', markers);
    setIsDetecting(false);
    const markerPosInCam = markers.map(m => {
      const sum = m.corners.reduce((acc, corner) => acc.add(corner), new Vector2(0, 0));
      return sum.divideScalar(m.corners.length);
    });
    // console.log('markersThree', markersThree);
    onMarkersDetected(markers);
  };

  return (
    <Button onClick={handleClick} disabled={isDetecting}>
      {isDetecting ? <LoadingSpinner /> : <ScanQrCode />} Detect Arucos
    </Button>
  );
}
