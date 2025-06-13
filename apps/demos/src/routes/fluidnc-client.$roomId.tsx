import { useSignals } from '@preact/signals-react/runtime';
import { createFileRoute } from '@tanstack/react-router';
import { FluidncClient } from '@wbcnc/fluidnc-api/fluidnc-client';
import { Button } from '@wbcnc/ui/components/button';
import { useState } from 'react';

export const Route = createFileRoute('/fluidnc-client/$roomId')({
  component: RouteComponent,
});

function RouteComponent() {
  useSignals();
  const { roomId } = Route.useParams();
  const [client] = useState(() => {
    const client = new FluidncClient(roomId);
    client.start();
    return client;
  });

  async function sendCmd() {
    const result = await client.api!.cmd('?');
    console.log(result);
  }
  return (
    <div>
      <p>IsConnected: {client.isConnected.value ? 'connected' : 'disconnected'}</p>
      <Button onClick={sendCmd}>SendCmd</Button>
    </div>
  );
}
