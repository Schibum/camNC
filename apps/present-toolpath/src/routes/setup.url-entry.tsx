import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button } from '@wbcnc/ui/components/button';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { ArrowRight } from 'lucide-react';
import { VideoSourceSelection } from '../setup/VideoSourceSelection';
import { useStore } from '../store';

export const Route = createFileRoute('/setup/url-entry')({
  component: UrlEntryComponent,
});

function UrlEntryComponent() {
  const navigate = useNavigate();
  const videoSrc = useStore(state => state.cameraConfig?.url || '');
  const setVideoSrc = useStore(state => state.setVideoSrc);

  const handleUrlConfirm = (streamUrl: string) => {
    setVideoSrc(streamUrl);
    navigate({ to: '/setup/camera-calibration' as any });
  };

  return (
    <div className="w-full h-full">
      <PageHeader title="Camera Source" />
      <div className="flex justify-center p-1 flex-row">
        <div className="max-w-xl gap-4 flex flex-1 flex-col">
          {/* <UrlEntryStep initialUrl={videoSrc} onConfirm={handleUrlConfirm} /> */}
          <VideoSourceSelection />
          <Button type="submit" className="w-full" onClick={() => handleUrlConfirm(videoSrc)}>
            <ArrowRight className="size-4" />
            Continue to Camera Calibration
          </Button>
        </div>
      </div>
    </div>
  );
}
