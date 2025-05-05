import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PageHeader } from '@wbcnc/ui/components/page-header';
import { IOnChangeArgs, VideoSourceSelection } from '../setup/video-source-selection/VideoSourceSelection';
import { useCamSource, useStore } from '../store';

export const Route = createFileRoute('/setup/url-entry')({
  component: UrlEntryComponent,
});

function UrlEntryComponent() {
  const navigate = useNavigate();
  const url = useCamSource()?.url;
  const setCamSource = useStore(state => state.camSourceSetters.setSource);
  const handleUrlConfirm = ({ url, maxResolution }: IOnChangeArgs) => {
    setCamSource(url, [maxResolution.width, maxResolution.height]);
    navigate({ to: '/setup/camera-calibration' as any });
  };

  return (
    <div className="w-full h-full">
      <PageHeader title="Camera Source" />
      <div className="flex justify-center p-1 flex-row">
        <div className="max-w-xl gap-4 flex flex-1 flex-col">
          {/* <UrlEntryStep initialUrl={videoSrc} onConfirm={handleUrlConfirm} /> */}
          <VideoSourceSelection value={url} onChange={handleUrlConfirm} />
        </div>
      </div>
    </div>
  );
}
