import * as React from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { videoSrcAtom } from '../atoms';
import { UrlEntryStep } from '../setup/UrlEntryStep';

export const Route = createFileRoute('/setup/url-entry')({
  component: UrlEntryComponent,
});

function UrlEntryComponent() {
  const navigate = useNavigate();
  const [videoSrc, setVideoSrc] = useAtom(videoSrcAtom);

  const handleUrlConfirm = (streamUrl: string) => {
    setVideoSrc(streamUrl);
    navigate({ to: '/setup/point-selection' as any });
  };

  return (
    <div className="mt-4">
      <UrlEntryStep initialUrl={videoSrc} onConfirm={handleUrlConfirm} />
    </div>
  );
}
