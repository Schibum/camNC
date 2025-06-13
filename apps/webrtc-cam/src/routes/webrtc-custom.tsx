import { createFileRoute } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';
import { useTrysteroServer } from '@wbcnc/go2webrtc/trystero';
import { z } from 'zod';
import { PortraitOrientation } from '../portrait-orientation';
import { ServerCard } from '../server-card';
import { streamFactory } from '../utils';

const searchSchema = z.object({
  share: z.string().min(10).catch(''),
  pwd: z.string().min(10).catch(''),
});

export const Route = createFileRoute('/webrtc-custom')({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
});

function RtcServer({ share, pwd }: { share: string; pwd: string }) {
  const { serverState } = useTrysteroServer({
    share,
    pwd,
    streamFactory: streamFactory,
  });

  return <ServerCard status={serverState} />;
}

function RouteComponent() {
  const { share, pwd } = Route.useSearch();
  if (!share || !pwd) {
    return <div>No share or pwd search params</div>;
  }
  return (
    <div>
      <PortraitOrientation />
      <RtcServer share={share} pwd={pwd} />
    </div>
  );
}
