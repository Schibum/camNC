import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { UrlEntryStep } from '../setup/UrlEntryStep';
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
      <PageHeader title="Top View (Orthographic)" />
      <div className="m-4">
        <UrlEntryStep initialUrl={videoSrc} onConfirm={handleUrlConfirm} />
      </div>
    </div>
  );
}
