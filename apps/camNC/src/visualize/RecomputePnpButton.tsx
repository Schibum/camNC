import { detectAruco } from '@/setup/detect-aruco';
import { useStore } from '@/store/store';
import { getRemappedStillFrame, updateCameraExtrinsics } from '@/store/store-p3p';
import { ensureOpenCvIsLoaded } from '@wbcnc/load-opencv';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

const kNumFrames = 5;
const kExpectedMarkers = 4;

/**
 * Small icon button that recomputes the camera extrinsics (PnP) immediately.
 *
 * It grabs a fresh still frame, re-detects the aruco tags and re-solves PnP. If
 * not all tags are visible the recompute fails and the user is told how many
 * tags are currently visible/hidden.
 */
export function RecomputePnpButton() {
  const [recomputing, setRecomputing] = useState(false);
  const setMarkerPosInCam = useStore(state => state.camSourceSetters.setMarkerPosInCam);

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      await ensureOpenCvIsLoaded();
      const imgMat = await getRemappedStillFrame(kNumFrames);
      const markers = detectAruco(imgMat);
      imgMat.delete();

      // Keep only the expected tags (ids 0..kExpectedMarkers-1), deduped and in id order.
      const validMarkers = markers.filter(
        (m, i, arr) => m.id >= 0 && m.id < kExpectedMarkers && arr.findIndex(x => x.id === m.id) === i
      );
      const visible = validMarkers.length;
      const hidden = kExpectedMarkers - visible;

      if (visible < kExpectedMarkers) {
        toast.error('Could not recompute PnP', {
          description: `${visible}/${kExpectedMarkers} aruco tags visible, ${hidden} hidden`,
          position: 'top-right',
        });
        return;
      }

      setMarkerPosInCam(validMarkers.flatMap(m => m.corners));
      const reprojectionError = updateCameraExtrinsics();
      toast.success('Recomputed PnP', {
        description: `Reprojection error: ${reprojectionError.toFixed(2)}px (< 1px is very good)`,
        position: 'top-right',
      });
    } catch (err) {
      console.error('Failed to recompute PnP', err);
      toast.error('Failed to recompute PnP', {
        description: err instanceof Error ? err.message : String(err),
        position: 'top-right',
      });
    } finally {
      setRecomputing(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-5"
      title="Recompute PnP now"
      disabled={recomputing}
      onClick={handleRecompute}>
      <RefreshCw className={`size-3 ${recomputing ? 'animate-spin' : ''}`} />
    </Button>
  );
}
