import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { PersistentWebRTCServer, ServerOptions } from "@wbcnc/go2webrtc/server";
import { useEffect, useState } from "react";

import { z } from "zod";
import { ServerCard } from "../server-card";
import { streamFactory } from "../utils";

const searchSchema = z.object({
  share: z.string().min(10).catch(""),
  pwd: z.string().min(10).catch(""),
});

export const Route = createFileRoute("/webtorrent")({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
});
function useWebRTCServer(options: ServerOptions) {
  useEffect(() => {
    const server = new PersistentWebRTCServer(options);
    server.start();
    // Cleanup function
    return () => {
      server.stop();
      console.log("WebRTC Server stopped.");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures this runs only once on mount and cleanup on unmount
}

function RtcServer({ share, pwd }: { share: string; pwd: string }) {
  const [status, setStatus] = useState<string>("idle");
  useWebRTCServer({
    share,
    pwd,
    streamFactory: streamFactory,
    onStatusUpdate: (status) => setStatus(status),
  });

  return <ServerCard status={status} />;
}

function RouteComponent() {
  const { share, pwd } = Route.useSearch();
  if (!share || !pwd) {
    return <div>No share or pwd search params</div>;
  }
  return (
    <div>
      <RtcServer share={share} pwd={pwd} />
    </div>
  );
}
