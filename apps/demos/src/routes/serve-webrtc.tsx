import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { PersistentWebRTCServer, ServerOptions } from "@wbcnc/go2webrtc/server";
import { useWakeLock } from "@wbcnc/ui/hooks/use-wakelook";
import { useEffect, useState } from "react";
import { z } from "zod";

const kReloadInterval = 2 * 60 * 60 * 1000; // 2 hours

const searchSchema = z.object({
  share: z.string().catch("test"),
  pwd: z.string().catch("test"),
});

export const Route = createFileRoute("/serve-webrtc")({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
});

const streamFactory = async () => {
  console.log("Stream factory called, requesting user media...");
  const createdStream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      facingMode: "environment",
    },
    audio: false,
  });
  console.log("User media stream obtained.");
  // Prefer high-resolution over high-framerate
  const videoTrack = createdStream.getVideoTracks()[0];
  if (videoTrack && "contentHint" in videoTrack) {
    videoTrack.contentHint = "detail";
  }
  return createdStream;
};

function useWebRTCServer(options: ServerOptions) {
  useEffect(() => {
    const server = new PersistentWebRTCServer(options);
    server.start();
    // Cleanup function
    return () => {
      server.stop();
      console.log("WebRTC Server stopped.");
    };
  }, []); // Empty dependency array ensures this runs only once on mount and cleanup on unmount
}

// Just reload the app code periodically to ensure that the latest code is used.
function useAppUpdateOnIdle(status: string) {
  useEffect(() => {
    if (status === "idle") {
      const timer = setTimeout(() => {
        window.location.reload();
      }, kReloadInterval);
      return () => clearTimeout(timer);
    }
  }, [status]);
}

function RouteComponent() {
  const { share, pwd } = Route.useSearch();
  const [status, setStatus] = useState<string>("idle");
  useWebRTCServer({
    share,
    pwd,
    streamFactory: streamFactory,
    onStatusUpdate: (status) => setStatus(status),
  }); // Use the custom hook
  useWakeLock();
  useAppUpdateOnIdle(status);
  return <div>Hello {status}</div>;
}
