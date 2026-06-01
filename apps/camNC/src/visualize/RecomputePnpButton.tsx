import {
  detectMarkersInStillFrame,
  formatReprojectionError,
  getValidMarkers,
  kExpectedMarkerCount,
  setMarkersAndRecompute,
} from '@/store/store-p3p';
import { Button } from '@wbcnc/ui/components/button';
import { toast } from '@wbcnc/ui/components/sonner';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

/**
 * Small icon button that recomputes the camera extrinsics (PnP) immediately.
 *
 * It grabs a fresh still frame, re-detects the aruco tags and re-solves PnP. If
 * not all tags are visible the recompute fails and the user is told how many
 * tags are currently visible/hidden.
 */
export function RecomputePnpButton() {
  const [recomputing, setRecomputing] = useState(false);

  const handleRecompute = async () => {
    setRecomputing(true);
    try {
      const validMarkers = getValidMarkers(await detectMarkersInStillFrame());

      if (validMarkers.length < kExpectedMarkerCount) {
        const hidden = kExpectedMarkerCount - validMarkers.length;
        toast.error('Could not recompute PnP', {
          description: `${validMarkers.length}/${kExpectedMarkerCount} aruco tags visible, ${hidden} hidden`,
          position: 'top-right',
        });
        return;
      }

      const reprojectionError = setMarkersAndRecompute(validMarkers);
      toast.success('Recomputed PnP', {
        description: formatReprojectionError(reprojectionError),
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
    <Button variant="ghost" size="icon" className="size-5" title="Recompute PnP now" disabled={recomputing} onClick={handleRecompute}>
      <RefreshCw className={`size-3 ${recomputing ? 'animate-spin' : ''}`} />
    </Button>
  );
}
