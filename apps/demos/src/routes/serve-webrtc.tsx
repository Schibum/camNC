import { createFileRoute } from "@tanstack/react-router";
import { send } from "@wbcnc/go2webrtc/server";
import { useEffect } from "react";

export const Route = createFileRoute("/serve-webrtc")({
  component: RouteComponent,
});

async function startServer() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: false,
  });
  const server = await send(stream, {
    share: "test",
    pwd: "test",
    onStatusUpdate: (status) => {
      console.log(status);
    },
  });
}

function RouteComponent() {
  useEffect(() => {
    startServer();
  }, []);
  return <div>Hello "/serve-webrtc"!</div>;
}
