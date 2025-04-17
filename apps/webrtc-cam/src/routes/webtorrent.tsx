import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { PersistentWebRTCServer, ServerOptions } from "@wbcnc/go2webrtc/server";
import { useWakeLock } from "@wbcnc/ui/hooks/use-wakelook";
import { useEffect, useState } from "react";

import { z } from "zod";

const searchSchema = z.object({
  share: z.string().min(10).catch(""),
  pwd: z.string().min(10).catch(""),
});

export const Route = createFileRoute("/webtorrent")({
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

function useCameraName() {
  const [cameraName, setCameraName] = useState<string>("Requesting camera...");
  useEffect(() => {
    const getCameraName = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      setCameraName(track?.label ?? "");
      stream.getTracks().forEach((track) => track.stop());
    };
    getCameraName();
  }, []);
  return cameraName;
}

function RtcServer({ share, pwd }: { share: string; pwd: string }) {
  const [status, setStatus] = useState<string>("idle");
  const wakeLock = useWakeLock();
  useWebRTCServer({
    share,
    pwd,
    streamFactory: streamFactory,
    onStatusUpdate: (status) => setStatus(status),
  });
  const cameraName = useCameraName();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">
        Serving Camera via Webtorrent/WebRTC
      </h1>
      <p>Camera: {cameraName}</p>
      <p>Wake Lock: {wakeLock ? "active" : "inactive"}</p>
      <p>Connection Status: {status}</p>
      {/* <p>Share: {share}</p>
      <p>Pwd: {pwd}</p> */}
    </div>
  );
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
