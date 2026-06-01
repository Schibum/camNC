import { detectMarkersInStillFrame } from '@/store/store-p3p';
import { Button } from '@wbcnc/ui/components/button';
import { LoadingSpinner } from '@wbcnc/ui/components/loading-spinner';
import { ScanQrCode } from 'lucide-react';
import { useState } from 'react';
import { IMarker } from './detect-aruco';

const kNumFrames = 5;
export function DetectArucosButton({ onMarkersDetected }: { onMarkersDetected: (markers: IMarker[]) => void }) {
  const [isDetecting, setIsDetecting] = useState(false);
  const handleClick = async () => {
    setIsDetecting(true);
    try {
      const markers = await detectMarkersInStillFrame(kNumFrames);
      onMarkersDetected(markers);
    } finally {
      setIsDetecting(false);
    }
  };

  return (
    <Button onClick={handleClick} disabled={isDetecting}>
      {isDetecting ? <LoadingSpinner /> : <ScanQrCode />} Detect Arucos
    </Button>
  );
}
