import { PageHeader } from '@/components/page-header';
import { Input } from '@heroui/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { useState } from 'react';
import { z } from 'zod';
import { IOnChangeArgs, VideoSourceSelection } from '../../setup/video-source-selection/VideoSourceSelection';
import { useCamSource, useStore } from '../../store/store';

export const Route = createFileRoute('/setup/url-entry')({
  component: UrlEntryComponent,
  validateSearch: zodValidator(
    z.object({
      new: z.boolean().optional(),
    })
  ),
});

function UrlEntryComponent() {
  const navigate = useNavigate();
  const { new: isNew } = Route.useSearch();
  const camSources = useStore(state => state.camSources);
  const camNames = Object.keys(camSources);
  const activeCamName = useStore(state => state.activeCamName);
  const currentCamSource = useCamSource();
  const url = isNew ? '' : currentCamSource?.url;
  const [name, setName] = useState(() => (isNew ? `Source ${camNames.length + 1}` : (activeCamName ?? 'default')));

  const setCamSource = useStore(state => state.camSourceSetters.setSource);
  const addCamSource = useStore(state => state.addCamSource);

  const handleUrlConfirm = ({ url: newUrl, maxResolution }: IOnChangeArgs) => {
    if (isNew) {
      addCamSource(name, { url: newUrl, maxResolution: [maxResolution.width, maxResolution.height] });
    } else {
      setCamSource(name, newUrl, [maxResolution.width, maxResolution.height]);
    }
    navigate({ to: '/setup/camera-calibration' as any });
  };

  return (
    <div className="w-full h-full">
      <PageHeader title="Camera Source" />
      <div className="flex justify-center p-1 flex-row">
        <div className="max-w-xl gap-4 flex flex-1 flex-col">
          <Input value={name} onChange={e => setName(e.target.value)} label="Camera name" />
          <VideoSourceSelection value={url} onChange={handleUrlConfirm} />
        </div>
      </div>
    </div>
  );
}
