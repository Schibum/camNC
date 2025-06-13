import { FluidncServer } from '@wbcnc/fluidnc-api/fluidnc-server';
import { useEffect, useState } from 'react';

export function useFluidncServer(roomId: string) {
  const [server, setServer] = useState<FluidncServer | null>(null);
  useEffect(() => {
    const server = new FluidncServer(roomId);
    server.start();
    setServer(server);
    return () => {
      server.stop();
      setServer(null);
    };
  }, [roomId]);
  return server;
}
