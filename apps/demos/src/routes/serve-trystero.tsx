import { createFileRoute } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { useTrysteroServer } from '@wbcnc/go2webrtc/trystero';
import { useWakeLock } from '@wbcnc/ui/hooks/use-wakelock';
import { z } from 'zod';

const searchSchema = z.object({
  accessToken: z.string().catch('test'),
});

export const Route = createFileRoute('/serve-trystero')({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
});

const streamFactory = async () => {
  console.log('Stream factory called, requesting user media...');
  const createdStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      facingMode: 'environment',
    },
    audio: false,
  });
  console.log('User media stream obtained.');
  // Prefer high-resolution over high-framerate
  const videoTrack = createdStream.getVideoTracks()[0];
  if (videoTrack && 'contentHint' in videoTrack) {
    videoTrack.contentHint = 'detail';
  }
  return createdStream;
};

function RouteComponent() {
  const { accessToken } = Route.useSearch();
  console.log('accessToken', accessToken);
  const { serverState } = useTrysteroServer({
    accessToken,
    streamFactory: streamFactory,
  });
  useWakeLock();
  return <div>Server state: {serverState}</div>;
}
