import { createFileRoute } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { useTrysteroServer } from '@wbcnc/go2webrtc/trystero';
import { z } from 'zod';
import { PortraitOrientation } from '../portrait-orientation';
import { ServerCard } from '../server-card';
import { streamFactory } from '../utils';

const searchSchema = z.object({
  accessToken: z.string().min(10).catch(''),
});

export const Route = createFileRoute('/webrtc-custom')({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
});

function RtcServer({ accessToken }: { accessToken: string }) {
  const { serverState } = useTrysteroServer({
    accessToken,
    streamFactory: streamFactory,
  });

  return <ServerCard status={serverState} />;
}

function RouteComponent() {
  const { accessToken } = Route.useSearch();
  if (!accessToken) {
    return <div>No accessToken search param</div>;
  }
  return (
    <div>
      <PortraitOrientation />
      <RtcServer accessToken={accessToken} />
    </div>
  );
}
