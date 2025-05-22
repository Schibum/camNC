import { useTimeout } from '@/hooks/useTimeout';
import { buildConnectionUrl, RtcConnectionParams } from '@wbcnc/go2webrtc/url-helpers';
import { VideoDimensions } from '@wbcnc/go2webrtc/video-source';
import { Button } from '@wbcnc/ui/components/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@wbcnc/ui/components/dialog';
import { useRef, useState } from 'react';
import { VideoPreview, VideoPreviewRef } from './VideoPreview';

// Show a warning if the connection takes longer than 10 seconds
const kSlowConnectionWarningTimeout = 10_000;

export function ConnectDialog({
  params,
  onConfirm,
  onCancel,
}: {
  params: RtcConnectionParams;
  onConfirm: (maxResolution: VideoDimensions) => void;
  onCancel: () => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [slowWarning, clearSlowWarning] = useTimeout(kSlowConnectionWarningTimeout);
  const videoPreviewRef = useRef<VideoPreviewRef>(null);

  function onError() {
    setHasError(true);
    clearSlowWarning();
  }

  function onPlaying() {
    setIsPlaying(true);
    clearSlowWarning();
  }
  return (
    <Dialog
      open={true}
      onOpenChange={v => {
        if (!v) onCancel();
      }}>
      <DialogContent className="max-w-none max-h-none sm:max-w-none sm:max-h-none w-full h-full md:w-[90%] md:h-[90%] flex flex-col">
        <DialogTitle>Video Source Preview</DialogTitle>
        <DialogDescription>
          {hasError && <span className="text-red-500">Failed to connect.</span>}
          {slowWarning && <span className="text-red-500">This is taking longer than expected. Something might be wrong.</span>}
          {!hasError && !slowWarning && !isPlaying && <span>Please wait while we connect to the video source.</span>}
          {isPlaying && <span>Confirm to use this video source.</span>}
        </DialogDescription>
        <div className="flex justify-center items-center flex-grow overflow-hidden">
          <VideoPreview
            ref={videoPreviewRef}
            className="max-w-full max-h-full object-contain rounded-md"
            connectionUrl={buildConnectionUrl(params)}
            onPlaying={onPlaying}
            onError={onError}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button disabled={!isPlaying} onClick={() => onConfirm(videoPreviewRef.current!.getMaxResolution())}>
              Confirm Video Source
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
